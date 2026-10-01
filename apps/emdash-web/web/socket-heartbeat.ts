/**
 * A WebSocket behind a tunnel or proxy can die without a close event: the
 * page keeps a socket that looks open, the reconnecting transport never kicks
 * in, and agent replies only show up after a manual reload. The browser sends
 * a heartbeat every tick and drops the socket if nothing at all came back by
 * the next tick, which makes the transport reconnect and re-attach every live
 * model with fresh snapshots.
 *
 * Must match `HEARTBEAT_FRAME` in `server/ws-gateway.ts`.
 */
export const HEARTBEAT_FRAME = '__emdash_heartbeat';

const HEARTBEAT_INTERVAL_MS = 15_000;

export type HeartbeatOptions = {
  send: (frame: string) => void;
  /** Called once when the peer stopped answering. */
  onDead: () => void;
  intervalMs?: number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export type Heartbeat = {
  /** Call for every frame received from the server. */
  received(): void;
  stop(): void;
};

export function startHeartbeat({
  send,
  onDead,
  intervalMs = HEARTBEAT_INTERVAL_MS,
  setInterval: schedule = (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: cancel = (handle) =>
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
}: HeartbeatOptions): Heartbeat {
  // Waiting is measured in ticks, not wall time: background tabs throttle
  // timers to once a minute, and a reply that arrived in between still counts.
  let awaitingReply = false;
  let stopped = false;
  const handle = schedule(() => {
    if (awaitingReply) {
      stop();
      onDead();
      return;
    }
    awaitingReply = true;
    send(HEARTBEAT_FRAME);
  }, intervalMs);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancel(handle);
  }

  return {
    received() {
      awaitingReply = false;
    },
    stop,
  };
}
