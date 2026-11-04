import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_IMAGE_REPO,
  IMAGE_REPO_RE,
  LEGACY_AGENT_IMAGE_REPO,
  compareVersions,
  isOutdated,
  needsImageMove,
  normalizeVersion,
} from './version';
import {
  AGENT_ACKED_TYPES,
  AgentUpdatePayloadSchema,
  SERVER_ACKED_TYPES,
  agentMessage,
  parseAgentMessage,
  parseServerMessage,
  serverMessage,
} from '../protocol';

describe('versions', () => {
  it('compares release versions with semver rules', () => {
    expect(compareVersions('0.4.1', '0.4.3')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compareVersions('dev', '1.0.0')).toBeNull();
  });

  it('dev and unknown versions are never outdated', () => {
    expect(isOutdated('0.4.1', '0.4.3')).toBe(true);
    expect(isOutdated('0.4.3', '0.4.3')).toBe(false);
    expect(isOutdated('0.5.0', '0.4.3')).toBe(false);
    expect(isOutdated('dev', '0.4.3')).toBe(false);
    expect(isOutdated('0.4.1', 'dev')).toBe(false);
    expect(isOutdated(null, '0.4.3')).toBe(false);
    expect(isOutdated('installer', '0.4.3')).toBe(false);
    expect(normalizeVersion('v0.4.1')).toBe('0.4.1');
    expect(normalizeVersion('0.4')).toBeNull();
  });

  it('image repo pattern accepts registries and rejects tags or options', () => {
    expect(IMAGE_REPO_RE.test('ghcr.io/selfhostr/orch-agent')).toBe(true);
    expect(IMAGE_REPO_RE.test('localhost:5000/orch-agent')).toBe(true);
    expect(IMAGE_REPO_RE.test('ghcr.io/selfhostr/orch-agent:1.0.0')).toBe(false);
    expect(IMAGE_REPO_RE.test('--privileged')).toBe(false);
    expect(IMAGE_REPO_RE.test('orch-agent')).toBe(false);
  });

  it('flags agents that still pull from the legacy image repository', () => {
    const repo = DEFAULT_AGENT_IMAGE_REPO;
    expect(needsImageMove('0.9.0', '0.10.0', repo)).toBe(true);
    expect(needsImageMove('v0.4.1', '0.10.0', repo)).toBe(true);
    expect(needsImageMove('0.9.0', '1.0.0-rc.1', repo)).toBe(true);
    // Newer agents already use the new repository; older targets still exist in the old one.
    expect(needsImageMove('0.10.0', '0.11.0', repo)).toBe(false);
    expect(needsImageMove('0.4.1', '0.9.0', repo)).toBe(false);
    // A server that keeps (or mirrors) another repository decides for itself.
    expect(needsImageMove('0.9.0', '0.10.0', LEGACY_AGENT_IMAGE_REPO)).toBe(false);
    expect(needsImageMove('0.9.0', '0.10.0', 'reg.example/o/agent')).toBe(false);
    expect(needsImageMove('dev', '0.10.0', repo)).toBe(false);
    expect(needsImageMove('0.9.0', null, repo)).toBe(false);
  });
});

describe('agent.update protocol', () => {
  it('round-trips agent.update and update.status, both acked', () => {
    const m = serverMessage('agent.update', {
      updateId: 'u1',
      targetVersion: '0.4.3',
      image: 'ghcr.io/selfhostr/orch-agent:0.4.3',
      whenIdle: false,
    });
    expect(parseServerMessage(JSON.stringify(m)).ok).toBe(true);
    const s = agentMessage('update.status', {
      updateId: 'u1',
      targetVersion: '0.4.3',
      status: 'pulling',
    });
    expect(parseAgentMessage(JSON.stringify(s)).ok).toBe(true);
    expect(SERVER_ACKED_TYPES).toContain('agent.update');
    expect(AGENT_ACKED_TYPES).toContain('update.status');
  });

  it('rejects a non-release target version', () => {
    const base = { updateId: 'u', image: 'x/y:1', whenIdle: false };
    const ok = (targetVersion: string) =>
      AgentUpdatePayloadSchema.safeParse({ ...base, targetVersion }).success;
    expect(ok('latest')).toBe(false);
    expect(ok('1.0.0;rm -rf /')).toBe(false);
    expect(ok('1.0.0')).toBe(true);
  });
});
