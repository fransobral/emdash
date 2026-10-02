import type { ClaudeUsageScan, CodexUsageScan } from '@emdash/core/services/usage/node';
import { describe, expect, it } from 'vitest';
import { buildUsageSnapshot, type UsageAccountScan } from './usage-snapshot';

const NOW = new Date('2026-10-02T12:00:00.000Z').getTime();
const TODAY_9AM = new Date('2026-10-02T09:00:00.000Z').getTime();
const YESTERDAY_9AM = new Date('2026-10-01T09:00:00.000Z').getTime();

function claudeAccount(
  scan: ClaudeUsageScan | null,
  overrides: Partial<UsageAccountScan<ClaudeUsageScan>> = {}
): UsageAccountScan<ClaudeUsageScan> {
  return { accountId: 'default', label: 'Claude', isDefault: true, scan, ...overrides };
}

function codexAccount(
  scan: CodexUsageScan | null,
  overrides: Partial<UsageAccountScan<CodexUsageScan>> = {}
): UsageAccountScan<CodexUsageScan> {
  return { accountId: 'default', label: 'Codex', isDefault: true, scan, ...overrides };
}

describe('buildUsageSnapshot', () => {
  it('reports unavailable when no accounts are linked at all', () => {
    const snapshot = buildUsageSnapshot({ claude: [], codex: [], now: NOW });
    expect(snapshot.availability).toBe('unavailable');
    expect(snapshot.providers).toEqual([]);
    expect(snapshot.sessionsToday).toEqual([]);
  });

  it('reports unavailable when accounts are linked but none of them scanned', () => {
    const snapshot = buildUsageSnapshot({ claude: [claudeAccount(null)], codex: [], now: NOW });
    expect(snapshot.availability).toBe('unavailable');
    // Still shown in the dashboard, "no disponible" per item, never hidden.
    expect(snapshot.providers).toEqual([
      { providerId: 'claude', accounts: [expect.objectContaining({ accountId: 'default' })] },
    ]);
  });

  it('reports partial when only some linked accounts scanned successfully', () => {
    const claude: ClaudeUsageScan = { sessions: [] };
    const snapshot = buildUsageSnapshot({
      claude: [claudeAccount(claude)],
      codex: [codexAccount(null)],
      now: NOW,
    });
    expect(snapshot.availability).toBe('partial');
  });

  it('reports exact when every linked account scanned successfully', () => {
    const claude: ClaudeUsageScan = { sessions: [] };
    const snapshot = buildUsageSnapshot({ claude: [claudeAccount(claude)], codex: [], now: NOW });
    expect(snapshot.availability).toBe('exact');
  });

  it('builds an exact Claude account from a cost-state-backed session, today only', () => {
    const claude: ClaudeUsageScan = {
      sessions: [
        {
          sessionId: 'today-session',
          cwd: '/home/ubuntu/demo',
          startedAt: TODAY_9AM,
          lastActivityAt: TODAY_9AM,
          totalCostUsd: 1.5,
          costSource: 'exact',
          hasUnknownModelCost: false,
          models: [
            {
              model: 'claude-sonnet-4-5-20250929',
              inputTokens: 1000,
              outputTokens: 200,
              cacheReadInputTokens: 50,
              cacheCreationInputTokens: 10,
              costUsd: 1.5,
              costSource: 'exact',
            },
          ],
        },
        {
          sessionId: 'yesterday-session',
          cwd: '/home/ubuntu/demo',
          startedAt: YESTERDAY_9AM,
          lastActivityAt: YESTERDAY_9AM,
          totalCostUsd: 9,
          costSource: 'exact',
          hasUnknownModelCost: false,
          models: [],
        },
      ],
    };

    const snapshot = buildUsageSnapshot({ claude: [claudeAccount(claude)], codex: [], now: NOW });
    const claudeProvider = snapshot.providers.find((p) => p.providerId === 'claude');
    expect(claudeProvider?.accounts).toHaveLength(1);
    const account = claudeProvider?.accounts[0];
    expect(account?.costTodayUsd).toBeCloseTo(1.5);
    expect(account?.costSource).toBe('exact');
    expect(account?.modelsToday).toEqual([
      {
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 1000,
        outputTokens: 200,
        cacheTokens: 60,
        costUsd: 1.5,
        costSource: 'exact',
      },
    ]);
    expect(account?.rateLimits).toEqual({ source: 'unavailable', fiveHour: null, weekly: null });

    // Only the session active today shows up in the sessions table.
    expect(snapshot.sessionsToday).toHaveLength(1);
    expect(snapshot.sessionsToday[0].sessionId).toBe('today-session');
  });

  it('merges per-model totals across multiple sessions using the same model', () => {
    const claude: ClaudeUsageScan = {
      sessions: [
        {
          sessionId: 'a',
          cwd: '/a',
          startedAt: TODAY_9AM,
          lastActivityAt: TODAY_9AM,
          totalCostUsd: 1,
          costSource: 'exact',
          hasUnknownModelCost: false,
          models: [
            {
              model: 'claude-haiku-4-5-20251001',
              inputTokens: 100,
              outputTokens: 10,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              costUsd: 1,
              costSource: 'exact',
            },
          ],
        },
        {
          sessionId: 'b',
          cwd: '/b',
          startedAt: TODAY_9AM,
          lastActivityAt: TODAY_9AM,
          totalCostUsd: 2,
          costSource: 'exact',
          hasUnknownModelCost: false,
          models: [
            {
              model: 'claude-haiku-4-5-20251001',
              inputTokens: 200,
              outputTokens: 20,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              costUsd: 2,
              costSource: 'exact',
            },
          ],
        },
      ],
    };

    const snapshot = buildUsageSnapshot({ claude: [claudeAccount(claude)], codex: [], now: NOW });
    const account = snapshot.providers[0].accounts[0];
    expect(account.modelsToday).toEqual([
      {
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 300,
        outputTokens: 30,
        cacheTokens: 0,
        costUsd: 3,
        costSource: 'exact',
      },
    ]);
    expect(account.costTodayUsd).toBeCloseTo(3);
  });

  it('builds a Codex account with exact local rate limits and estimated cost', () => {
    const codex: CodexUsageScan = {
      sessions: [
        {
          sessionId: 'codex-today',
          cwd: '/home/ubuntu/demo',
          startedAt: TODAY_9AM,
          lastActivityAt: TODAY_9AM,
          model: 'claude-haiku-4-5-20251001', // reuse a priced model id for a deterministic estimate
          tokens: {
            inputTokens: 1_000_000,
            cachedInputTokens: 10,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 1_000_010,
          },
        },
      ],
      latestRateLimits: {
        fiveHour: { usedPercent: 10, windowMinutes: 300, resetsAt: 123000 },
        weekly: { usedPercent: 50, windowMinutes: 10080, resetsAt: 456000 },
        observedAt: TODAY_9AM,
      },
    };

    const snapshot = buildUsageSnapshot({ claude: [], codex: [codexAccount(codex)], now: NOW });
    const account = snapshot.providers[0].accounts[0];
    expect(account.rateLimits).toEqual({
      source: 'exact',
      fiveHour: { usedPercent: 10, resetsAt: 123000 },
      weekly: { usedPercent: 50, resetsAt: 456000 },
    });
    expect(account.costSource).toBe('estimated');
    expect(account.costTodayUsd).toBeCloseTo(1, 5);
  });

  it('marks Codex cost unavailable for a model with no price entry, without hiding tokens', () => {
    const codex: CodexUsageScan = {
      sessions: [
        {
          sessionId: 'codex-unknown',
          cwd: '/d',
          startedAt: TODAY_9AM,
          lastActivityAt: TODAY_9AM,
          model: 'gpt-6.1-sol',
          tokens: {
            inputTokens: 500,
            cachedInputTokens: 0,
            outputTokens: 50,
            reasoningOutputTokens: 0,
            totalTokens: 550,
          },
        },
      ],
      latestRateLimits: null,
    };

    const snapshot = buildUsageSnapshot({ claude: [], codex: [codexAccount(codex)], now: NOW });
    const account = snapshot.providers[0].accounts[0];
    expect(account.costTodayUsd).toBeNull();
    expect(account.costSource).toBe('unavailable');
    expect(account.rateLimits).toEqual({ source: 'unavailable', fiveHour: null, weekly: null });
    // Tokens still show up even though cost is unavailable.
    expect(snapshot.sessionsToday[0].inputTokens).toBe(500);
    expect(snapshot.sessionsToday[0].costSource).toBe('unavailable');
  });

  it('sorts sessionsToday by most recent activity first', () => {
    const claude: ClaudeUsageScan = {
      sessions: [
        {
          sessionId: 'older',
          cwd: '/a',
          startedAt: TODAY_9AM,
          lastActivityAt: TODAY_9AM,
          totalCostUsd: null,
          costSource: 'unavailable',
          hasUnknownModelCost: false,
          models: [],
        },
        {
          sessionId: 'newer',
          cwd: '/b',
          startedAt: NOW,
          lastActivityAt: NOW,
          totalCostUsd: null,
          costSource: 'unavailable',
          hasUnknownModelCost: false,
          models: [],
        },
      ],
    };
    const snapshot = buildUsageSnapshot({ claude: [claudeAccount(claude)], codex: [], now: NOW });
    expect(snapshot.sessionsToday.map((s) => s.sessionId)).toEqual(['newer', 'older']);
  });

  it('keeps multiple accounts per provider distinct, each with its own label', () => {
    const scanA: ClaudeUsageScan = { sessions: [] };
    const scanB: ClaudeUsageScan = { sessions: [] };
    const snapshot = buildUsageSnapshot({
      claude: [
        claudeAccount(scanA, { accountId: 'default', label: 'Claude', isDefault: true }),
        claudeAccount(scanB, { accountId: 'work', label: 'Claude (work)', isDefault: false }),
      ],
      codex: [],
      now: NOW,
    });
    expect(snapshot.providers[0].accounts).toEqual([
      expect.objectContaining({ accountId: 'default', label: 'Claude', isDefault: true }),
      expect.objectContaining({ accountId: 'work', label: 'Claude (work)', isDefault: false }),
    ]);
  });
});
