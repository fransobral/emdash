import { describe, expect, it, vi } from 'vitest';
import { ClaudeOAuthUsageClient } from './claude-oauth-usage-client';

function fakeResponse(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('ClaudeOAuthUsageClient', () => {
  it('parses five_hour and seven_day into fiveHour/weekly windows', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse(200, {
        five_hour: { utilization: 62, resets_at: '2026-01-01T00:00:00.000Z' },
        seven_day: { utilization: 41, resets_at: null },
      })
    );
    const client = new ClaudeOAuthUsageClient(fetchImpl);

    const snapshot = await client.getUsage('tok', 0);

    expect(snapshot).toEqual({
      fiveHour: { usedPercent: 62, resetsAt: Date.parse('2026-01-01T00:00:00.000Z') },
      weekly: { usedPercent: 41, resetsAt: null },
      fetchedAt: 0,
      stale: false,
    });
  });

  it('treats missing or malformed window fields as null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, {}));
    const client = new ClaudeOAuthUsageClient(fetchImpl);

    const snapshot = await client.getUsage('tok', 0);

    expect(snapshot).toEqual({ fiveHour: null, weekly: null, fetchedAt: 0, stale: false });
  });

  it('serves a successful response from cache for 5 minutes without refetching', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, {}));
    const client = new ClaudeOAuthUsageClient(fetchImpl);

    await client.getUsage('tok', 0);
    await client.getUsage('tok', 4 * 60_000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches once the 5-minute cache has expired', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, {}));
    const client = new ClaudeOAuthUsageClient(fetchImpl);

    await client.getUsage('tok', 0);
    await client.getUsage('tok', 5 * 60_000 + 1);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('on a 429 returns the last-known value marked stale and withholds retry during backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(200, { five_hour: { utilization: 10, resets_at: null } }))
      .mockResolvedValueOnce(fakeResponse(429));
    const client = new ClaudeOAuthUsageClient(fetchImpl);

    await client.getUsage('tok', 0);
    const afterTtl = 5 * 60_000 + 1;
    const retried = await client.getUsage('tok', afterTtl);
    const duringBackoff = await client.getUsage('tok', afterTtl + 1_000);

    expect(retried).toEqual({
      fiveHour: { usedPercent: 10, resetsAt: null },
      weekly: null,
      fetchedAt: 0,
      stale: true,
    });
    expect(duringBackoff).toEqual(retried);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('degrades to null without throwing when there is no cache and the fetch rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const client = new ClaudeOAuthUsageClient(fetchImpl);

    const snapshot = await client.getUsage('tok', 0);

    expect(snapshot).toBeNull();
  });

  it('on a non-retryable 401 degrades without entering a backoff window', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(401));
    const client = new ClaudeOAuthUsageClient(fetchImpl);

    const first = await client.getUsage('tok', 0);
    await client.getUsage('tok', 1);

    expect(first).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
