import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { noopLogger } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usageSnapshotSchema } from '../api/contract';
import { createCockpitWireController } from './wire-controller';

let claudeConfigDir: string;
let codexHome: string;
let previousClaudeConfigDir: string | undefined;
let previousCodexHome: string | undefined;

beforeEach(async () => {
  claudeConfigDir = await mkdtemp(path.join(tmpdir(), 'emdash-cockpit-claude-'));
  codexHome = await mkdtemp(path.join(tmpdir(), 'emdash-cockpit-codex-'));
  previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  previousCodexHome = process.env.CODEX_HOME;
  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  process.env.CODEX_HOME = codexHome;
});

afterEach(async () => {
  process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  process.env.CODEX_HOME = previousCodexHome;
  await rm(claudeConfigDir, { recursive: true, force: true });
  await rm(codexHome, { recursive: true, force: true });
});

describe('createCockpitWireController', () => {
  it('reports unavailable when both config dirs are empty but present', async () => {
    const controller = createCockpitWireController(noopLogger);
    const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
    expect(snapshot.availability).toBe('exact');
    expect(snapshot.providers).toEqual([
      { providerId: 'claude', accounts: [expect.objectContaining({ accountId: 'default' })] },
      { providerId: 'codex', accounts: [expect.objectContaining({ accountId: 'default' })] },
    ]);
    expect(snapshot.sessionsToday).toEqual([]);
  });

  it('reads a real Claude session file end to end through the wire contract', async () => {
    const now = Date.now();
    const dir = path.join(claudeConfigDir, 'projects', '-home-ubuntu-demo');
    await mkdir(dir, { recursive: true });
    const lines = [
      {
        type: 'cost-state',
        sessionId: 'wire-session',
        totalCostUSD: 4.2,
        startTime: now,
        hasUnknownModelCost: false,
        modelUsage: {
          'claude-sonnet-4-5-20250929': {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 4.2,
          },
        },
      },
      {
        type: 'assistant',
        sessionId: 'wire-session',
        cwd: '/home/ubuntu/demo',
        timestamp: new Date(now).toISOString(),
        message: { model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 10 } },
      },
    ];
    await writeFile(
      path.join(dir, 'wire-session.jsonl'),
      lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
    );

    const controller = createCockpitWireController(noopLogger);
    const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
    const claudeAccount = snapshot.providers.find((p) => p.providerId === 'claude')?.accounts[0];
    expect(claudeAccount?.costTodayUsd).toBeCloseTo(4.2);
    expect(snapshot.sessionsToday).toHaveLength(1);
    expect(snapshot.sessionsToday[0].cwd).toBe('/home/ubuntu/demo');
  });

  it('treats a missing config dir as not configured instead of an error', async () => {
    await rm(codexHome, { recursive: true, force: true });
    const controller = createCockpitWireController(noopLogger);
    const snapshot = usageSnapshotSchema.parse(await controller.call('usageSnapshot', undefined));
    expect(snapshot.availability).toBe('partial');
    expect(snapshot.providers.map((p) => p.providerId)).toEqual(['claude']);
  });
});
