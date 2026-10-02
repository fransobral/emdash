import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSnapshot } from '../api/contract';
import { createUsagePoller } from './usage-poller';

const SNAPSHOT: UsageSnapshot = {
  generatedAt: 0,
  availability: 'unavailable',
  providers: [],
  sessionsToday: [],
};

describe('createUsagePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches immediately, then at the polling interval', async () => {
    const fetchSnapshot = vi.fn(async () => SNAPSHOT);
    const onSnapshot = vi.fn();
    const poller = createUsagePoller({ fetchSnapshot, onSnapshot, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(SNAPSHOT);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('fully stops on stop(): no pending timers, in-flight results dropped', async () => {
    let resolveFetch: ((value: UsageSnapshot) => void) | null = null;
    const fetchSnapshot = vi.fn(
      () => new Promise<UsageSnapshot>((resolve) => (resolveFetch = resolve))
    );
    const onSnapshot = vi.fn();
    const poller = createUsagePoller({ fetchSnapshot, onSnapshot, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    poller.stop();
    resolveFetch!(SNAPSHOT);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps polling through transient fetch failures, showing last-known value', async () => {
    const fetchSnapshot = vi
      .fn<() => Promise<UsageSnapshot>>()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValue(SNAPSHOT);
    const onSnapshot = vi.fn();
    const poller = createUsagePoller({ fetchSnapshot, onSnapshot, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(onSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onSnapshot).toHaveBeenCalledWith(SNAPSHOT);

    poller.stop();
  });

  it('defaults to a 60s interval, matching the no-aggressive-polling budget', async () => {
    const fetchSnapshot = vi.fn(async () => SNAPSHOT);
    const onSnapshot = vi.fn();
    const poller = createUsagePoller({ fetchSnapshot, onSnapshot });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);

    poller.stop();
  });
});
