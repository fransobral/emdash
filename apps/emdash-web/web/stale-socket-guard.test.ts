import { describe, expect, it, vi } from 'vitest';
import { installStaleSocketGuard } from './stale-socket-guard';

function setup(hiddenThresholdMs = 10_000) {
  let now = 0;
  let visibility: 'visible' | 'hidden' = 'visible';
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  Object.defineProperty(doc, 'visibilityState', { get: () => visibility });
  const win = new EventTarget();
  const socket = { readyState: 1, close: vi.fn() };
  const dispose = installStaleSocketGuard({
    getSocket: () => socket,
    now: () => now,
    hiddenThresholdMs,
    doc,
    win,
  });
  return {
    socket,
    dispose,
    hide: () => {
      visibility = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    show: (afterMs: number) => {
      now += afterMs;
      visibility = 'visible';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    online: () => win.dispatchEvent(new Event('online')),
  };
}

// Regression: after the phone slept, the WebSocket was silently dead, nothing
// reconnected, and a chat kept showing "Thinking 2904s" while the agent worked.
describe('installStaleSocketGuard', () => {
  it('recycles the socket when the app returns after being hidden a while', () => {
    const t = setup();
    t.hide();
    t.show(60_000);
    expect(t.socket.close).toHaveBeenCalledOnce();
  });

  it('keeps the socket after a brief switch away', () => {
    const t = setup();
    t.hide();
    t.show(2_000);
    expect(t.socket.close).not.toHaveBeenCalled();
  });

  it('recycles the socket when the network comes back', () => {
    const t = setup();
    t.online();
    expect(t.socket.close).toHaveBeenCalledOnce();
  });

  it('stops listening once disposed', () => {
    const t = setup();
    t.dispose();
    t.hide();
    t.show(60_000);
    t.online();
    expect(t.socket.close).not.toHaveBeenCalled();
  });
});
