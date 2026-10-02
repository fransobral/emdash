import type { UsageSnapshot } from '../api/contract';

/** "max 1×/60s while visible" from the usage dashboard's polling design. */
export const USAGE_POLL_INTERVAL_MS = 60_000;

export type UsagePollerOptions = {
  fetchSnapshot(): Promise<UsageSnapshot>;
  onSnapshot(snapshot: UsageSnapshot): void;
  intervalMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

/**
 * Polls the main process's local-file usage snapshot while the Hoy view is
 * mounted. Fetches immediately, then re-fetches `intervalMs` after each
 * response lands (never overlapping); `stop()` cancels the pending timer so
 * nothing runs once the view closes — there is no background polling while
 * nobody is looking at the dashboard.
 */
export function createUsagePoller(options: UsagePollerOptions): { stop(): void } {
  const intervalMs = options.intervalMs ?? USAGE_POLL_INTERVAL_MS;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    let snapshot: UsageSnapshot | null = null;
    try {
      snapshot = await options.fetchSnapshot();
    } catch {
      // Transient RPC failure; keep polling, keep showing the last-known value.
    }
    if (stopped) return;
    if (snapshot) options.onSnapshot(snapshot);
    timer = setTimer(() => void tick(), intervalMs);
  };
  void tick();

  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
