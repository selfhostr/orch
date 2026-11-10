import type { AccessGrant, AccessInvite } from '@prisma/client';
import type { PrismaClient } from '../db';

/** Signed-token purposes (each gets its own HKDF sub-key of ORCH_ENCRYPTION_KEY). */
export const ACCESS_REQUEST_PURPOSE = 'access-request';
export const INVITE_COOKIE_PURPOSE = 'invite-cookie';
export const ACCESS_REQUEST_TTL_MS = 15 * 60_000;
export const INVITE_COOKIE = 'orch_invite';
export const INVITE_COOKIE_TTL_SEC = 15 * 60;

/** GitHub login syntax: alphanumerics and single inner hyphens, at most 39 characters. */
export const GITHUB_LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export interface GrantView {
  id: string;
  githubLogin: string;
  githubUserId: string | null;
  avatarUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  note: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface InviteView {
  id: string;
  multiUse: boolean;
  expiresAt: string;
  uses: number;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

export function grantView(g: AccessGrant): GrantView {
  return {
    id: g.id,
    githubLogin: g.githubLogin,
    githubUserId: g.githubUserId === null ? null : g.githubUserId.toString(),
    avatarUrl: g.avatarUrl,
    status: g.status,
    note: g.note,
    requestedAt: g.requestedAt?.toISOString() ?? null,
    decidedAt: g.decidedAt?.toISOString() ?? null,
    decidedBy: g.decidedBy,
  };
}

/**
 * The access grants that apply to a GitHub account: those bound to its id (whatever its login is
 * now) and an unbound one for its current login. A grant bound to another account id is ignored
 * (the login was renamed and reused). DENIED wins, then APPROVED, then PENDING.
 */
export async function findGrant(
  prisma: PrismaClient,
  login: string,
  githubId: bigint,
): Promise<AccessGrant | null> {
  const githubLogin = login.toLowerCase();
  const rows = await prisma.accessGrant.findMany({
    where: { OR: [{ githubLogin }, { githubUserId: githubId }] },
    orderBy: { updatedAt: 'desc' },
  });
  const mine = rows.filter((g) =>
    g.githubUserId === null ? g.githubLogin === githubLogin : g.githubUserId === githubId,
  );
  for (const status of ['DENIED', 'APPROVED', 'PENDING'] as const) {
    const g = mine.find((x) => x.status === status);
    if (g) return g;
  }
  return null;
}

/**
 * The login changed hands on GitHub: a grant keyed by it but bound to another account id is
 * re-keyed to `<login>~<id>` (never a valid login), so the new holder can request access or use
 * an invite with a row of their own. The old account's decision still applies to it (by id).
 */
export async function releaseGrantLogin(
  prisma: PrismaClient,
  login: string,
  githubId: bigint,
): Promise<void> {
  const githubLogin = login.toLowerCase();
  const g = await prisma.accessGrant.findUnique({ where: { githubLogin } });
  if (!g || g.githubUserId === null || g.githubUserId === githubId) return;
  await prisma.accessGrant.updateMany({
    where: { id: g.id, githubUserId: g.githubUserId },
    data: { githubLogin: `${githubLogin}~${g.githubUserId}` },
  });
}

export function inviteIsActive(i: AccessInvite, now = Date.now()): boolean {
  return !i.revokedAt && i.expiresAt.getTime() > now && (i.multiUse || i.uses === 0);
}

export function inviteView(i: AccessInvite): InviteView {
  return {
    id: i.id,
    multiUse: i.multiUse,
    expiresAt: i.expiresAt.toISOString(),
    uses: i.uses,
    revokedAt: i.revokedAt?.toISOString() ?? null,
    createdBy: i.createdBy,
    createdAt: i.createdAt.toISOString(),
    lastUsedAt: i.lastUsedAt?.toISOString() ?? null,
    active: inviteIsActive(i),
  };
}

/**
 * Uses one invite: the `uses` increment is conditional (not revoked, not expired, single-use
 * still unused), so a single-use invite cannot be spent twice, even concurrently.
 */
export async function useInvite(prisma: PrismaClient, inviteId: string): Promise<boolean> {
  const now = new Date();
  const res = await prisma.accessInvite.updateMany({
    where: {
      id: inviteId,
      revokedAt: null,
      expiresAt: { gt: now },
      OR: [{ multiUse: true }, { uses: 0 }],
    },
    data: { uses: { increment: 1 }, lastUsedAt: now },
  });
  return res.count === 1;
}
