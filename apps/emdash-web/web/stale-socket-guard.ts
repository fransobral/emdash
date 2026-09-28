/**
 * Mobile browsers freeze pages in the background and often leave the WebSocket
 * half-open: no close event fires, so the reconnecting transport never kicks in
 * and live chats keep showing stale state (e.g. a "Thinking" timer that runs
 * for an hour while the agent keeps working). Closing the socket when the app
 * comes back, or when the network returns, forces a reconnect, which
 * re-establishes every live-model attachment with fresh snapshots.
 */

const OPEN = 1;

type ClosableSocket = { readyState: number; close(): void };

export type StaleSocketGuardOptions = {
  getSocket: () => ClosableSocket | null;
  /** Hidden longer than this means the socket may be dead; a quick app switch is not. */
  hiddenThresholdMs?: number;
  now?: () => number;
  doc?: EventTarget & { visibilityState: string };
  win?: EventTarget;
};

export function installStaleSocketGuard({
  getSocket,
  hiddenThresholdMs = 10_000,
  now = () => Date.now(),
  doc = document,
  win = window,
}: StaleSocketGuardOptions): () => void {
  let hiddenAt: number | null = null;

  const recycle = (): void => {
    const socket = getSocket();
    if (socket && socket.readyState === OPEN) socket.close();
  };

  const onVisibilityChange = (): void => {
    if (doc.visibilityState === 'hidden') {
      hiddenAt = now();
      return;
    }
    const wasHiddenFor = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    if (wasHiddenFor >= hiddenThresholdMs) recycle();
  };

  doc.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('online', recycle);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    win.removeEventListener('online', recycle);
  };
}
