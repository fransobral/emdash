import { seedWireConnection } from '@core/primitives/wire/browser/connection';
/**
 * Web wire seed: replaces the Electron MessagePort seed with a reconnecting
 * WebSocket transport speaking the same framed stream protocol as the
 * workspace-server (JSON frames + length-prefixed binary blob-chunk frames).
 *
 * The access token is captured from ?token=... on first load and persisted in
 * localStorage; the URL is cleaned afterwards so the token does not linger in
 * history or get pasted into shared links.
 */
import {
  connect,
  reconnectingTransport,
  streamTransport,
  type WireTransport,
} from '@emdash/wire/rpc';
import { HEARTBEAT_FRAME, startHeartbeat } from './socket-heartbeat';
import { installStaleSocketGuard } from './stale-socket-guard';

const TOKEN_STORAGE_KEY = 'emdash-web-token';

type DroppableSocket = { readonly readyState: number; close(): void };

/** The socket currently carrying the wire connection, for the stale-socket guard. */
let currentSocket: DroppableSocket | null = null;

export function captureTokenFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    params.delete('token');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );
  }
}

export function getWebToken(): string | null {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function webSocketUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Adapts a browser WebSocket to the ReadableLike/WritableLike pair streamTransport expects.
 * `drop` reports the disconnect right away instead of waiting for a close handshake that a
 * dead connection never completes.
 */
function browserStreamAdapter(ws: WebSocket): {
  input: { on(event: string, cb: (chunk: Uint8Array | string) => void): unknown };
  output: { write(chunk: string | Uint8Array): unknown };
  drop: () => void;
} {
  const dataListeners = new Set<(chunk: Uint8Array | string) => void>();
  const closeListeners = new Set<() => void>();
  let closed = false;
  const notifyClose = (): void => {
    if (closed) return;
    closed = true;
    heartbeat.stop();
    for (const listener of closeListeners) listener();
  };
  const drop = (): void => {
    ws.onmessage = null;
    ws.onclose = null;
    notifyClose();
    ws.close();
  };
  const heartbeat = startHeartbeat({ send: (frame) => ws.send(frame), onDead: drop });
  ws.onmessage = (event: MessageEvent) => {
    heartbeat.received();
    if (event.data === HEARTBEAT_FRAME) return;
    const chunk =
      typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer);
    for (const listener of dataListeners) listener(chunk);
  };
  ws.onclose = notifyClose;
  ws.onerror = () => {
    /* close follows; streamTransport treats it as disconnect */
  };
  return {
    input: {
      on(event: string, cb: (chunk: Uint8Array | string) => void): unknown {
        if (event === 'data') dataListeners.add(cb);
        else closeListeners.add(cb as () => void);
        return this;
      },
    },
    output: {
      write(chunk: string | Uint8Array): unknown {
        ws.send(chunk as BufferSource);
        return true;
      },
    },
    drop,
  };
}

function openWebSocketTransport(token: string): Promise<WireTransport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketUrl(token));
    ws.binaryType = 'arraybuffer';
    const fail = (error: unknown): void => {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      reject(error);
    };
    ws.onopen = () => {
      ws.onopen = null;
      ws.onerror = null;
      const { input, output, drop } = browserStreamAdapter(ws);
      currentSocket = {
        get readyState() {
          return ws.readyState;
        },
        close: drop,
      };
      resolve(streamTransport(input, output));
    };
    ws.onclose = (event: CloseEvent) => {
      if (event.code === 4401) {
        // Terminal auth failure (server restarted with a fresh token): drop
        // the stale value and reload so the token prompt reappears instead of
        // retrying the rejected token forever.
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.location.reload();
        return;
      }
      fail(new Error(`WebSocket closed before opening (code ${event.code})`));
    };
    ws.onerror = () => fail(new Error('WebSocket failed to connect'));
  });
}

export function seedWebWire(): void {
  installStaleSocketGuard({ getSocket: () => currentSocket });
  seedWireConnection(async () => {
    const token = getWebToken();
    if (!token) {
      throw new Error(
        'Missing access token. Open the URL printed by the emdash-web server (it carries ?token=...).'
      );
    }
    return connect(
      reconnectingTransport(() => openWebSocketTransport(token), {
        backoffMs: [250, 500, 1000, 2000, 5000],
      })
    );
  });
}
