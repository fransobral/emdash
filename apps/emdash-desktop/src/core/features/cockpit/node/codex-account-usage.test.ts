import { describe, expect, it, vi } from 'vitest';
import { CodexAccountUsageClient, parseCodexAccountUsage } from './codex-account-usage';

describe('Codex account usage', () => {
  it('classifies weekly primary slots by duration and preserves workspace blocking', () => {
    const value = parseCodexAccountUsage(
      { account: { type: 'chatgpt', email: 'team@example.com', planType: 'team' } },
      {
        ordinaryUsageAllowed: false,
        rateLimits: {
          primary: { usedPercent: 70, windowDurationMins: 10080, resetsAt: 100 },
          rateLimitReachedType: 'workspace_owner_credits_depleted',
        },
      },
      5000
    );
    expect(value).toMatchObject({
      email: 'team@example.com',
      plan: 'team',
      usageAllowed: false,
      blockedReason: 'workspace_owner_credits_depleted',
      rateLimits: { fiveHour: null, weekly: { usedPercent: 70, resetsAt: 100000 } },
    });
  });

  it('caches and coalesces account reads, keeping different homes separate', async () => {
    const read = vi.fn(async (home: string) => ({
      account: { account: { email: home, planType: 'pro' } },
      limits: { rateLimits: { primary: { usedPercent: 1, windowDurationMins: 10080 } } },
    }));
    const client = new CodexAccountUsageClient(read);
    const results = await Promise.all([
      client.getUsage('/a', 1000),
      client.getUsage('/a', 1000),
      client.getUsage('/b', 1000),
    ]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(results.map((x) => x?.email)).toEqual(['/a', '/a', '/b']);
    await client.getUsage('/a', 2000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('backs off failures instead of repeatedly launching Codex', async () => {
    const read = vi.fn(async () => {
      throw new Error('unavailable');
    });
    const client = new CodexAccountUsageClient(read);
    expect(await client.getUsage('/a', 1000)).toBeNull();
    expect(await client.getUsage('/a', 2000)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
