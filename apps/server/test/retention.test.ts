/** Retention purge: each table is purged past its duration and not before, 0 disables it. */
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { Metrics } from '../src/observability';
import { runRetention } from '../src/retention';
import { prisma, uid, uniqueInt } from './harness';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const cfg = (env: Record<string, string> = {}) =>
  loadConfig({ DATABASE_URL: process.env.DATABASE_URL_TEST ?? '', LOG_LEVEL: 'silent', ...env });

afterAll(async () => {
  await prisma.$disconnect();
});

async function fixtures() {
  const tag = uid();
  const user = await prisma.user.create({
    data: { githubId: BigInt(uniqueInt()), login: `ret-${tag}` },
  });
  const installation = await prisma.installation.create({
    data: {
      githubInstallationId: BigInt(uniqueInt()),
      accountLogin: `o-${tag}`,
      accountType: 'User',
    },
  });
  const project = await prisma.project.create({
    data: {
      githubRepoId: BigInt(uniqueInt()),
      fullName: `o-${tag}/r`,
      installationId: installation.id,
      defaultBranch: 'main',
      isPrivate: false,
      addedById: user.id,
    },
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      githubIssueNumber: 1,
      githubIssueNodeId: `n-${tag}`,
      title: 't',
      bodySnapshot: '',
      bodyHash: 'h',
      baseBranch: 'main',
      createdById: user.id,
    },
  });
  return { tag, user, task };
}

describe('retention purge', () => {
  it('purges every table past its duration, and only then', async () => {
    const { tag, user, task } = await fixtures();
    const old = ago(400);
    const mid = ago(10); // older than the 7 and 1 day settings, younger than the defaults
    const fresh = new Date();
    const assignment = (
      status: 'EXPIRED' | 'CANCELLED' | 'REJECTED' | 'SUCCEEDED' | 'FAILED',
      updatedAt: Date,
      startedAt?: Date,
    ) =>
      prisma.assignment.create({
        data: {
          taskId: task.id,
          userId: user.id,
          kind: 'AUTO_OFFER',
          status,
          updatedAt,
          startedAt,
        },
      });

    await prisma.auditLog.createMany({
      data: [
        { actorType: 'SYSTEM', action: `ret.${tag}.old`, at: old },
        { actorType: 'SYSTEM', action: `ret.${tag}.fresh`, at: fresh },
      ],
    });
    await prisma.webhookDelivery.createMany({
      data: [
        { deliveryId: `${tag}-old`, event: 'push', receivedAt: ago(40) },
        { deliveryId: `${tag}-fresh`, event: 'push', receivedAt: ago(5) },
      ],
    });
    const gone = [
      await assignment('EXPIRED', old),
      await assignment('CANCELLED', old),
      await assignment('REJECTED', old),
    ];
    const kept = [
      await assignment('EXPIRED', ago(80)),
      // Runs feed the History page and the usage figures: never purged.
      await assignment('SUCCEEDED', old, old),
      await assignment('FAILED', old, old),
      await assignment('CANCELLED', old, old),
    ];
    await prisma.session.createMany({
      data: [
        { id: `${tag}-s-old`, userId: user.id, expiresAt: ago(8) },
        { id: `${tag}-s-recent`, userId: user.id, expiresAt: ago(6) },
        { id: `${tag}-s-live`, userId: user.id, expiresAt: new Date(Date.now() + DAY) },
      ],
    });
    await prisma.enrollmentToken.createMany({
      data: [
        { tokenHash: `${tag}-t-old`, userId: user.id, expiresAt: ago(8), usedAt: ago(9) },
        { tokenHash: `${tag}-t-recent`, userId: user.id, expiresAt: ago(2) },
      ],
    });

    const metrics = new Metrics('test');
    const done = await runRetention(prisma, cfg(), { metrics });
    expect(done.AuditLog).toBeGreaterThanOrEqual(1);

    const audits = await prisma.auditLog.findMany({
      where: { action: { startsWith: `ret.${tag}.` } },
    });
    expect(audits.map((a) => a.action)).toEqual([`ret.${tag}.fresh`]);
    const hooks = await prisma.webhookDelivery.findMany({
      where: { deliveryId: { startsWith: tag } },
    });
    expect(hooks.map((h) => h.deliveryId)).toEqual([`${tag}-fresh`]);
    const left = await prisma.assignment.findMany({
      where: { taskId: task.id },
      select: { id: true },
    });
    expect(left.map((a) => a.id).sort()).toEqual(kept.map((a) => a.id).sort());
    expect(gone.every((g) => !left.some((l) => l.id === g.id))).toBe(true);
    const sessions = await prisma.session.findMany({ where: { id: { startsWith: tag } } });
    expect(sessions.map((s) => s.id).sort()).toEqual([`${tag}-s-live`, `${tag}-s-recent`]);
    const tokens = await prisma.enrollmentToken.findMany({
      where: { tokenHash: { startsWith: tag } },
    });
    expect(tokens.map((t) => t.tokenHash)).toEqual([`${tag}-t-recent`]);
    expect(await metrics.registry.metrics()).toContain(
      'orch_retention_purged_rows_total{table="AuditLog"}',
    );

    // Shorter durations reach the younger rows.
    await prisma.webhookDelivery.create({
      data: { deliveryId: `${tag}-mid`, event: 'push', receivedAt: mid },
    });
    await runRetention(
      prisma,
      cfg({
        RETENTION_WEBHOOK_DAYS: '7',
        RETENTION_ASSIGNMENT_DAYS: '70',
        RETENTION_EXPIRED_DAYS: '1',
      }),
    );
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: `${tag}-mid` } })).toBe(0);
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: `${tag}-fresh` } })).toBe(1);
    expect(await prisma.assignment.count({ where: { id: kept[0]!.id } })).toBe(0);
    expect(await prisma.session.count({ where: { id: `${tag}-s-recent` } })).toBe(0);
    expect(await prisma.enrollmentToken.count({ where: { tokenHash: `${tag}-t-recent` } })).toBe(0);
    expect(await prisma.session.count({ where: { id: `${tag}-s-live` } })).toBe(1);
  });

  it('a duration of 0 disables the purge of that table', async () => {
    const { tag, user, task } = await fixtures();
    await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', action: `ret.${tag}`, at: ago(900) },
    });
    await prisma.webhookDelivery.create({
      data: { deliveryId: `${tag}-w`, event: 'push', receivedAt: ago(900) },
    });
    await prisma.assignment.create({
      data: {
        taskId: task.id,
        userId: user.id,
        kind: 'AUTO_OFFER',
        status: 'EXPIRED',
        updatedAt: ago(900),
      },
    });
    await prisma.session.create({ data: { id: `${tag}-s`, userId: user.id, expiresAt: ago(900) } });
    await prisma.enrollmentToken.create({
      data: { tokenHash: `${tag}-t`, userId: user.id, expiresAt: ago(900) },
    });

    await runRetention(
      prisma,
      cfg({
        RETENTION_AUDIT_DAYS: '0',
        RETENTION_WEBHOOK_DAYS: '0',
        RETENTION_ASSIGNMENT_DAYS: '0',
        RETENTION_EXPIRED_DAYS: '0',
      }),
    );
    expect(await prisma.auditLog.count({ where: { action: `ret.${tag}` } })).toBe(1);
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: `${tag}-w` } })).toBe(1);
    expect(await prisma.assignment.count({ where: { taskId: task.id } })).toBe(1);
    expect(await prisma.session.count({ where: { id: `${tag}-s` } })).toBe(1);
    expect(await prisma.enrollmentToken.count({ where: { tokenHash: `${tag}-t` } })).toBe(1);
  });

  it('the config rejects negative durations and reads empty values as the default', () => {
    expect(() => cfg({ RETENTION_AUDIT_DAYS: '-1' })).toThrow();
    expect(cfg({ RETENTION_AUDIT_DAYS: '' }).RETENTION_AUDIT_DAYS).toBe(365);
    expect(cfg().RETENTION_WEBHOOK_DAYS).toBe(30);
    expect(cfg().RETENTION_ASSIGNMENT_DAYS).toBe(90);
    expect(cfg().RETENTION_EXPIRED_DAYS).toBe(7);
  });

  it('an ordinary DELETE or UPDATE on the audit log is still refused', async () => {
    const tag = uid();
    const row = await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', action: `ret.${tag}`, at: ago(900) },
    });
    await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${row.id}`).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'x' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
    // The cutoff setting is not a bypass: it only frees rows older than it, inside the function's
    // own transaction, and the function refuses a nonsensical window.
    await expect(prisma.$queryRaw`SELECT audit_log_purge(0, 10)`).rejects.toThrow();
    const recent = await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', action: `ret.${tag}.r` },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('orch.audit_purge_before', (now() - interval '1 day')::text, true)`;
        await tx.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${recent.id}`;
      }),
    ).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: `ret.${tag}` } } })).toBe(
      2,
    );
    // The purge function is the way out, and the trigger still guards the next ordinary delete.
    await runRetention(prisma, cfg());
    expect(await prisma.auditLog.count({ where: { id: row.id } })).toBe(0);
    await expect(
      prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${recent.id}`,
    ).rejects.toThrow(/append-only/);
  });

  it('two concurrent passes purge in batches without getting in each other s way', async () => {
    const tag = uid();
    const N = 2500; // more than two batches
    await prisma.auditLog.createMany({
      data: Array.from({ length: N }, () => ({
        actorType: 'SYSTEM' as const,
        action: `ret.${tag}`,
        at: ago(500),
      })),
    });
    await prisma.webhookDelivery.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        deliveryId: `${tag}-${i}`,
        event: 'push',
        receivedAt: ago(100),
      })),
    });
    const [a, b] = await Promise.all([runRetention(prisma, cfg()), runRetention(prisma, cfg())]);
    expect(await prisma.auditLog.count({ where: { action: `ret.${tag}` } })).toBe(0);
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: { startsWith: tag } } })).toBe(
      0,
    );
    expect((a.AuditLog ?? 0) + (b.AuditLog ?? 0)).toBeGreaterThanOrEqual(N);
    expect((a.WebhookDelivery ?? 0) + (b.WebhookDelivery ?? 0)).toBeGreaterThanOrEqual(N);
  });
});
