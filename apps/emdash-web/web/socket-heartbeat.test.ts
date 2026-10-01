import { describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_FRAME, startHeartbeat } from './socket-heartbeat';

function manualTimer() {
  let tick: (() => void) | null = null;
  return {
    setInterval: (callback: () => void) => {
      tick = callback;
      return 1;
    },
    clearInterval: vi.fn(() => {
      tick = null;
    }),
    tick: () => tick?.(),
  };
}

describe('socket heartbeat', () => {
  it('keeps the socket while the server answers each probe', () => {
    const timer = manualTimer();
    const send = vi.fn();
    const onDead = vi.fn();
    const heartbeat = startHeartbeat({ send, onDead, ...timer });

    for (let i = 0; i < 5; i++) {
      timer.tick();
      heartbeat.received();
    }

    expect(send).toHaveBeenCalledTimes(5);
    expect(send).toHaveBeenCalledWith(HEARTBEAT_FRAME);
    expect(onDead).not.toHaveBeenCalled();
  });

  it('declares the socket dead when a probe gets no answer by the next tick', () => {
    const timer = manualTimer();
    const onDead = vi.fn();
    startHeartbeat({ send: vi.fn(), onDead, ...timer });

    timer.tick();
    timer.tick();

    expect(onDead).toHaveBeenCalledTimes(1);
    expect(timer.clearInterval).toHaveBeenCalled();
  });

  it('stops probing once stopped', () => {
    const timer = manualTimer();
    const send = vi.fn();
    const onDead = vi.fn();
    startHeartbeat({ send, onDead, ...timer }).stop();

    timer.tick();

    expect(send).not.toHaveBeenCalled();
    expect(onDead).not.toHaveBeenCalled();
  });
});
