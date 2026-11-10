/**
 * Opt-in integration test with the real docker CLI (needs a reachable daemon; the default tools
 * container has none). Run with ORCH_DOCKER_IT=1 where `docker` works.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkComposeModel,
  planEnvFileFallbacks,
  sanitizeComposeModel,
  scanComposeSources,
} from '../../src/exec/compose-guard';
import { selectDevEnv } from '../../src/exec/devcontainer';
import { CliDocker } from '../../src/exec/docker';
import { spawnRunner } from '../../src/exec/runner';
import { STOP_PREPARATION_SCRIPT, buildCreateArgs } from '../../src/exec/sandbox';
import { tempDir } from '../helpers/util';
import { BOT_REPO_FILES } from './compose-fixtures';

const enabled = process.env.ORCH_DOCKER_IT === '1';

describe.skipIf(!enabled)('docker integration (ORCH_DOCKER_IT=1)', () => {
  it('builds the fixture repo Dockerfile and labels the image', async () => {
    const repo = join(__dirname, 'fixtures', 'tiny-repo');
    const env = selectDevEnv(repo, 'node:22-bookworm');
    expect(env.kind).toBe('build');
    if (env.kind !== 'build') return;
    const docker = new CliDocker(spawnRunner);
    const tag = 'orch-task-it-fixture:latest';
    await docker.build({
      tag,
      dockerfile: env.dockerfile,
      context: env.context,
      args: {},
      labels: { 'orch.task': 'it_fixture' },
    });
    const r = await spawnRunner.run('docker', [
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "orch.task"}}',
      tag,
    ]);
    expect(r.stdout.trim()).toBe('it_fixture');
    await docker.removeImage(tag);
  }, 300_000);

  it('bot-repo shape: config, up and down with the env_file override, no .env in the clone', async () => {
    const tmp = tempDir();
    const clone = join(tmp.dir, 'src');
    mkdirSync(clone, { recursive: true });
    for (const [f, c] of Object.entries(BOT_REPO_FILES)) {
      mkdirSync(dirname(join(clone, f)), { recursive: true });
      writeFileSync(join(clone, f), c);
    }
    const docker = new CliDocker(spawnRunner);
    const project = `orch-task-it-${process.pid}`;
    const network = `orch-net-it-${process.pid}`;
    const compose = join(clone, 'docker-compose.yml');
    const labels = { 'orch.task': `it-${process.pid}` };
    await docker.createNetwork(network, labels);
    try {
      expect(scanComposeSources(clone, compose)).toEqual([]);
      const fix = planEnvFileFallbacks(clone, compose);
      expect(fix.override).not.toBeNull();
      const envfix = join(tmp.dir, 'compose.orch.envfix.yaml');
      writeFileSync(envfix, fix.override as string);
      // Without the override, docker refuses the model exactly like in production.
      await expect(docker.composeConfig(project, [compose], clone)).rejects.toThrow(
        /env file .*\.env not found/,
      );
      const model = await docker.composeConfig(project, [compose, envfix], clone);
      expect(checkComposeModel(model, clone, project)).toEqual([]);
      const safe = sanitizeComposeModel(model, labels);
      const checked = join(tmp.dir, 'compose.orch.checked.json');
      const net = join(tmp.dir, 'compose.orch.yaml');
      writeFileSync(checked, JSON.stringify(safe.model));
      writeFileSync(net, `networks:\n  default:\n    name: ${network}\n    external: true\n`);
      await docker.composeUp(project, [checked, net], clone);
      const ps = await spawnRunner.run('docker', [
        'compose',
        '-p',
        project,
        'ps',
        '--format',
        '{{.Name}}',
      ]);
      expect(ps.stdout).toContain(`${project}-helper-1`);
      expect(existsSync(join(clone, '.env'))).toBe(false);
      await docker.composeDown(project, { files: [checked, net], cwd: clone });
      const left = await spawnRunner.run('docker', [
        'ps',
        '-aq',
        '--filter',
        `label=com.docker.compose.project=${project}`,
      ]);
      expect(left.stdout.trim()).toBe('');
    } finally {
      await docker.composeDown(project).catch(() => undefined);
      await docker.removeNetwork(network).catch(() => undefined);
      tmp.cleanup();
    }
  }, 600_000);

  it('stops what the preparation left running, keeps docker-init and the keep-alive', async () => {
    const tmp = tempDir();
    const docker = new CliDocker(spawnRunner);
    const id = `it-stop-${process.pid}`;
    const tag = `orch-task-${id}:latest`;
    const name = `orch-task-${id}`;
    const ctx = join(tmp.dir, 'ctx');
    mkdirSync(join(tmp.dir, 'src'), { recursive: true });
    mkdirSync(ctx, { recursive: true });
    // An image with a HEALTHCHECK: it must not run in a task container.
    writeFileSync(
      join(ctx, 'Dockerfile'),
      `FROM ${process.env.ORCH_IT_IMAGE ?? 'node:22-bookworm'}\nHEALTHCHECK --interval=1s CMD touch /tmp/hc\n`,
    );
    try {
      await docker.build({
        tag,
        dockerfile: join(ctx, 'Dockerfile'),
        context: ctx,
        args: {},
        labels: {},
      });
      await docker.create(
        buildCreateArgs({
          name,
          image: tag,
          clonePath: join(tmp.dir, 'src'),
          workspaceFolder: '/workspace',
          uid: 1000,
          gid: 1000,
          network: 'none',
          size: 'S',
          labels: {},
          containerEnv: {},
        }),
      );
      await docker.start(name);
      const hc = await spawnRunner.run('docker', [
        'inspect',
        '-f',
        '{{json .Config.Healthcheck.Test}}',
        name,
      ]);
      expect(hc.stdout.trim()).toBe('["NONE"]');
      // What a postCreateCommand can leave behind: nohup'd, signal-ignoring, own session, respawning.
      const prep = await docker.exec(name, [
        'sh',
        '-c',
        'nohup sh -c \'trap "" TERM HUP; while :; do sleep 1; done\' >/dev/null 2>&1 &\n' +
          "setsid sh -c 'while :; do sleep 1 & sleep 0.2; done' >/dev/null 2>&1 </dev/null &\n" +
          'exit 0',
      ]);
      expect(prep.code).toBe(0);
      const list = ['sh', '-c', 'for d in /proc/[0-9]*; do tr "\\0" " " <$d/cmdline; echo; done'];
      const before = await docker.exec(name, list);
      expect(before.stdout).toContain('while :');
      const stop = await docker.exec(name, ['sh', '-c', STOP_PREPARATION_SCRIPT]);
      expect(stop.code).toBe(0);
      const after = await docker.exec(name, list);
      const procs = after.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('sh -c for d in'));
      expect(procs.sort()).toEqual(['/sbin/docker-init -- sleep infinity', 'sleep infinity']);
      expect(await docker.isRunning(name)).toBe(true);
      // The container holds no token value.
      const tok = await docker.exec(name, ['sh', '-c', 'printf %s "$CLAUDE_CODE_OAUTH_TOKEN"']);
      expect(tok.stdout).toBe('');
    } finally {
      await docker.remove(name).catch(() => undefined);
      await docker.removeImage(tag).catch(() => undefined);
      tmp.cleanup();
    }
  }, 600_000);
});
