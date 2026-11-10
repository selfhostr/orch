/**
 * The ONLY place where task container specs are built.
 *
 * Guarantees, asserted by the unit tests:
 *  - exactly one mount: the task clone's worktree (rw) at the workspace folder. Its real git dir
 *    is agent-private (`git.ts`); the worktree only holds a throwaway copy. No docker socket, no host
 *    home, no /data, no mirrors, no other task. The Claude binary is copied in (`docker cp`)
 *    instead of being mounted.
 *  - a non-root `--user uid:gid`, `--cap-drop ALL`, `no-new-privileges`, no `--privileged`,
 *    pids/memory/cpu limits by size, `/tmp` as tmpfs, a per-task network, no published ports,
 *    the image's ENTRYPOINT/CMD replaced by `sleep infinity` and its HEALTHCHECK disabled.
 *  - the Claude token is never part of the container: `docker create` blanks it, and only the
 *    `docker exec` that starts Claude passes it, by NAME only (`-e CLAUDE_CODE_OAUTH_TOKEN`, value
 *    from the docker CLI child's environment). It never appears in argv, logs, files, `docker
 *    inspect` or the environment of the repository's commands (`postCreateCommand`, `orch shell`).
 */
import { isAbsolute, normalize } from 'node:path';
import type { TaskSize } from '@orch/shared';

export const CLAUDE_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
/** Claude config dir inside the container (on the /tmp tmpfs, never in the clone). */
export const TASK_CLAUDE_CONFIG_DIR = '/tmp/.claude';

export const SIZE_LIMITS: Record<TaskSize, { memory: string; cpus: string; pids: number }> = {
  S: { memory: '4g', cpus: '2', pids: 2048 },
  M: { memory: '6g', cpus: '4', pids: 4096 },
  L: { memory: '8g', cpus: '4', pids: 4096 },
};

export interface SandboxSpec {
  name: string;
  image: string;
  /** Absolute host path of the task clone. */
  clonePath: string;
  workspaceFolder: string;
  uid: number;
  gid: number;
  network: string;
  size: TaskSize;
  labels: Record<string, string>;
  /** From devcontainer containerEnv. Reserved names are dropped. */
  containerEnv: Record<string, string>;
}

export class SandboxError extends Error {
  override name = 'SandboxError';
}

const FORBIDDEN_SOURCES = [
  '/',
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/var/run',
  '/run',
  '/data',
  '/secrets',
  '/root',
  '/home',
  '/etc',
];
/**
 * Variables that would make Claude Code authenticate (or talk) elsewhere than with the member's
 * OAuth token. Passed as `-e NAME=` (empty: Claude Code treats it as unset), which also overrides
 * an `ENV` of the repo's image, so a devcontainer cannot swap the credential.
 */
export const BLANKED_AUTH_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
] as const;

const RESERVED_ENV = new Set<string>([
  CLAUDE_TOKEN_ENV,
  'CLAUDE_CONFIG_DIR',
  'HOME',
  'DOCKER_HOST',
  ...BLANKED_AUTH_ENV,
]);

/** Env the sandbox always sets (values are not secret). */
export const SANDBOX_ENV: Record<string, string> = {
  HOME: '/tmp',
  CLAUDE_CONFIG_DIR: TASK_CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_AUTOUPDATER: '1',
};

/**
 * The `-e` arguments of every Claude container (tasks and the auth check): the devcontainer env
 * without reserved names, then SANDBOX_ENV, the blanked auth variables and, last, the token
 * variable blanked too (it also overrides an `ENV` of the repo's image). The token itself is
 * passed only to the `docker exec` that starts Claude (CLAUDE_TOKEN_EXEC_ARGS).
 */
export function sandboxEnvArgs(containerEnv: Record<string, string> = {}): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(containerEnv)) {
    if (!RESERVED_ENV.has(k)) args.push('-e', `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(SANDBOX_ENV)) args.push('-e', `${k}=${v}`);
  for (const k of BLANKED_AUTH_ENV) args.push('-e', `${k}=`);
  args.push('-e', `${CLAUDE_TOKEN_ENV}=`);
  return args;
}

/**
 * `docker exec` options that hand the token to the Claude process only, by NAME: docker reads the
 * value from the docker CLI child's environment (`claudeTokenEnv`), never from argv.
 */
export const CLAUDE_TOKEN_EXEC_ARGS: readonly string[] = ['-e', CLAUDE_TOKEN_ENV];

/** Environment of the docker CLI child that starts Claude (kept in memory, never persisted). */
export const claudeTokenEnv = (token: string): Record<string, string> => ({
  [CLAUDE_TOKEN_ENV]: token,
});

/**
 * Run with `sh -c` after the repository's `postCreateCommand`, before Claude starts: kills every
 * process the preparation left behind (a background job could otherwise read the environment of
 * the Claude process, which runs as the same user). Spared: PID 1 (docker-init), the keep-alive
 * `sleep` (the lowest other PID, started before any exec) and this shell. Zombies are skipped.
 * Exits 1 when processes are still there after 50 rounds.
 */
export const STOP_PREPARATION_SCRIPT = [
  'main=',
  'for d in /proc/[0-9]*; do',
  '  p=${d#/proc/}',
  '  [ "$p" = 1 ] || [ "$p" = $$ ] && continue',
  '  if [ -z "$main" ] || [ "$p" -lt "$main" ]; then main=$p; fi',
  'done',
  'n=0',
  'while :; do',
  '  left=',
  '  for d in /proc/[0-9]*; do',
  '    p=${d#/proc/}',
  '    case $p in 1 | $$ | "$main" | \'[0-9]*\') continue ;; esac',
  '    s=',
  '    read -r s <"$d/stat" 2>/dev/null || continue',
  '    s=${s##*) }',
  '    case $s in Z*) continue ;; esac',
  '    left="$left $p"',
  '  done',
  '  [ -z "$left" ] && exit 0',
  '  n=$((n + 1))',
  '  [ "$n" -gt 50 ] && exit 1',
  '  kill -9 $left 2>/dev/null',
  '  sleep 0.2 2>/dev/null || sleep 1',
  'done',
].join('\n');

function checkSpec(s: SandboxSpec): void {
  if (!Number.isInteger(s.uid) || s.uid <= 0 || !Number.isInteger(s.gid) || s.gid < 0) {
    throw new SandboxError(`Task containers must run as a non-root uid (got ${s.uid}:${s.gid})`);
  }
  const src = normalize(s.clonePath).replace(/\/+$/, '');
  if (
    !isAbsolute(src) ||
    src.includes(',') ||
    FORBIDDEN_SOURCES.includes(src) ||
    src.includes('docker.sock')
  ) {
    throw new SandboxError(`Refusing to mount ${s.clonePath} into a task container`);
  }
  if (!/^\/[A-Za-z0-9._/-]+$/.test(s.workspaceFolder) || s.workspaceFolder.includes('..')) {
    throw new SandboxError(`Invalid workspace folder ${s.workspaceFolder}`);
  }
  if (s.image.startsWith('-') || s.name.startsWith('-') || s.network.startsWith('-')) {
    throw new SandboxError('Invalid image, name or network');
  }
}

/** Arguments for `docker create` (everything after the subcommand). */
export function buildCreateArgs(s: SandboxSpec): string[] {
  checkSpec(s);
  const lim = SIZE_LIMITS[s.size];
  const args = [
    '--name',
    s.name,
    '--user',
    `${s.uid}:${s.gid}`,
    '--network',
    s.network,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(lim.pids),
    '--memory',
    lim.memory,
    '--cpus',
    lim.cpus,
    '--tmpfs',
    '/tmp:rw,exec,nosuid,nodev,mode=1777,size=2g',
    '--mount',
    `type=bind,source=${normalize(s.clonePath)},target=${s.workspaceFolder}`,
    '--workdir',
    s.workspaceFolder,
    '--init',
    // An image HEALTHCHECK would run repository code periodically, as the same user, while
    // Claude runs: it could read the Claude process's environment (the token).
    '--no-healthcheck',
  ];
  for (const [k, v] of Object.entries(s.labels)) args.push('--label', `${k}=${v}`);
  args.push(...sandboxEnvArgs(s.containerEnv));
  // Keep the container alive; the member's Claude session runs through `docker exec`.
  args.push('--entrypoint', 'sleep', s.image, 'infinity');
  return args;
}
