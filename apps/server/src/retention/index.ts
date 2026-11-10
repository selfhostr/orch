/**
 * Retention of the tables that only grow. Runs on the `maintenance` leader (one instance purges),
 * at most every RETENTION_PURGE_INTERVAL_MS, in bounded batches so no statement holds locks long.
 * A duration of 0 disables the purge of the table.
 *
 * What is kept, and why:
 * - Assignments: only offers that never started (REJECTED, EXPIRED, CANCELLED, startedAt null) are
 *   purged. Runs (startedAt set) feed the History page, its people filter, the usage figures,
 *   the cost medians and the attempts of the MCP task tool, so they stay.
 * - WebhookDelivery: a row is only a dedupe key; GitHub does not redeliver after weeks.
 */
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import type { PrismaClient } from '../db';
import type { Metrics } from '../observability';

export const BATCH_SIZE = 1000;
/** Batches per table and pass: a large backlog is worked off over several passes. */
export const MAX_BATCHES = 50;

export type RetentionTable =
  'AuditLog' | 'WebhookDelivery' | 'Assignment' | 'Session' | 'EnrollmentToken';
export type RetentionResult = Partial<Record<RetentionTable, number>>;

interface Rule {
  table: Exclude<RetentionTable, 'AuditLog'>;
  days: (c: Config) => number;
  /** Primary key and indexed date column the batch is selected by. */
  key: string;
  dateColumn: string;
  /** SQL condition; `cutoff` is the SQL expression of the oldest instant kept. */
  where: (cutoff: Prisma.Sql) => Prisma.Sql;
}

const RULES: Rule[] = [
  {
    table: 'WebhookDelivery',
    key: 'deliveryId',
    dateColumn: 'receivedAt',
    days: (c) => c.RETENTION_WEBHOOK_DAYS,
    where: (cutoff) => Prisma.sql`"receivedAt" < ${cutoff}`,
  },
  {
    table: 'Assignment',
    key: 'id',
    dateColumn: 'updatedAt',
    days: (c) => c.RETENTION_ASSIGNMENT_DAYS,
    where: (cutoff) => Prisma.sql`"status" IN ('REJECTED', 'EXPIRED', 'CANCELLED')
      AND "startedAt" IS NULL AND "cleanupPending" = false AND "updatedAt" < ${cutoff}`,
  },
  {
    table: 'Session',
    key: 'id',
    dateColumn: 'expiresAt',
    days: (c) => c.RETENTION_EXPIRED_DAYS,
    where: (cutoff) => Prisma.sql`"expiresAt" < ${cutoff}`,
  },
  {
    table: 'EnrollmentToken',
    key: 'id',
    dateColumn: 'expiresAt',
    days: (c) => c.RETENTION_EXPIRED_DAYS,
    where: (cutoff) => Prisma.sql`"expiresAt" < ${cutoff}`,
  },
];

const ago = (days: number) => Prisma.sql`now() - make_interval(days => ${days})`;

/** One pass over every enabled table. Resolves with the rows deleted per table. */
export async function runRetention(
  prisma: PrismaClient,
  config: Config,
  hooks: { log?: FastifyBaseLogger; metrics?: Metrics } = {},
): Promise<RetentionResult> {
  const result: RetentionResult = {};
  const run = async (table: RetentionTable, batch: () => Promise<number>) => {
    let total = 0;
    try {
      for (let i = 0; i < MAX_BATCHES; i++) {
        const n = await batch();
        total += n;
        if (n < BATCH_SIZE) break;
      }
    } catch (err) {
      hooks.log?.warn({ err, table }, 'retention: purge failed');
    }
    if (total > 0) {
      result[table] = total;
      hooks.metrics?.retentionPurged.inc({ table }, total);
      hooks.log?.info({ table, rows: total }, 'retention: rows purged');
    }
  };

  if (config.RETENTION_AUDIT_DAYS > 0) {
    await run('AuditLog', async () => {
      const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT audit_log_purge(${config.RETENTION_AUDIT_DAYS}::int, ${BATCH_SIZE}::int) AS n`;
      return Number(row?.n ?? 0);
    });
  }
  for (const rule of RULES) {
    const days = rule.days(config);
    if (days <= 0) continue;
    const table = Prisma.raw(`"${rule.table}"`);
    const key = Prisma.raw(`"${rule.key}"`);
    const date = Prisma.raw(`"${rule.dateColumn}"`);
    await run(
      rule.table,
      () =>
        // Batch picked on the indexed date column, deleted by primary key. SKIP LOCKED: a row
        // another pass is deleting is left to it.
        prisma.$executeRaw`DELETE FROM ${table} WHERE ${key} IN (
        SELECT ${key} FROM ${table} WHERE ${rule.where(ago(days))}
        ORDER BY ${date} LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED)`,
    );
  }
  return result;
}

export interface RetentionDeps {
  prisma: PrismaClient;
  config: Config;
  log: FastifyBaseLogger;
  metrics?: Metrics;
  /** Fencing: true while this instance still holds the maintenance leadership. */
  confirmLeader: () => Promise<boolean>;
}

/** Maintenance job: runs a pass when the last one is older than RETENTION_PURGE_INTERVAL_MS. */
export function retentionJob(deps: RetentionDeps): () => Promise<void> {
  let last = 0;
  return async () => {
    if (Date.now() - last < deps.config.RETENTION_PURGE_INTERVAL_MS) return;
    if (!(await deps.confirmLeader())) return;
    last = Date.now();
    await runRetention(deps.prisma, deps.config, deps);
  };
}
