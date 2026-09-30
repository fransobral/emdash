import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';

/**
 * Local preview proxy: lets a browser reach a dev server an agent started on
 * this machine (`http://localhost:3017/`) without an SSH tunnel.
 *
 * Pages use absolute asset paths and HMR websockets, so the proxy serves them
 * at the root of a dedicated origin (for example `https://preview.example.com`)
 * instead of under a sub-path of Emdash. The flow is:
 *
 *   1. The chat rewrites `http://localhost:PORT/x` to `/preview/open?port=PORT&path=/x`
 *      on the Emdash origin, which sits behind the Emdash login.
 *   2. That route checks the port and redirects to the preview origin with a
 *      short-lived signed ticket.
 *   3. The preview origin trades the ticket for its own signed cookie that
 *      names the port, then proxies every request to `127.0.0.1:PORT`.
 *
 * The target host is always loopback and the port must pass the port policy,
 * so the proxy can't be pointed at other hosts or at infrastructure services.
 */

export const PREVIEW_OPEN_PATH = '/preview/open';
export const PREVIEW_ENTER_PATH = '/__emdash_preview/enter';

const COOKIE_NAME = 'emdash_preview';
const TARGET_HOST = '127.0.0.1';
const TICKET_TTL_MS = 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const PROBE_TIMEOUT_MS = 1_000;
const MIN_PORT = 1024;
/** Linux hands out ephemeral ports from 32768 up; agent relays and helpers live there, dev servers don't. */
const MAX_PORT = 32767;

/** Services on this host that must never be reachable through the preview. */
export const INFRA_PORTS: readonly number[] = [3000, 6379, 8088, 8090, 15432, 20241];

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

export type PortPolicy = (port: number) => boolean;

export function createPortPolicy(denied: Iterable<number>): PortPolicy {
  const blocked = new Set(denied);
  return (port) =>
    Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT && !blocked.has(port);
}

export function parsePreviewPort(value: string | null, isAllowed: PortPolicy): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return isAllowed(port) ? port : null;
}

/** Only same-origin absolute paths; `//host` and `/\host` would redirect off-site. */
export function safePreviewPath(value: string | null): string {
  return value && /^\/(?![/\\])/.test(value) ? value : '/';
}

function createSigner(secret: string) {
  const sign = (purpose: string, payload: string) =>
    createHmac('sha256', secret)
      .update(`emdash-preview-${purpose}-v1:${payload}`)
      .digest('base64url');
  const verify = (purpose: string, payload: string, signature: string) => {
    const expected = Buffer.from(sign(purpose, payload));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  };
  return { sign, verify };
}

export function createPreviewTokens(secret: string, now: () => number = Date.now) {
  const signer = createSigner(secret);

  function issueTicket(port: number, path: string): string {
    const payload = Buffer.from(
      JSON.stringify({ port, path, exp: now() + TICKET_TTL_MS })
    ).toString('base64url');
    return `${payload}.${signer.sign('ticket', payload)}`;
  }

  function redeemTicket(ticket: string | null): { port: number; path: string } | null {
    const [payload = '', signature = ''] = (ticket ?? '').split('.');
    if (!payload || !signer.verify('ticket', payload, signature)) return null;
    try {
      const { port, path, exp } = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8')
      ) as {
        port: number;
        path: string;
        exp: number;
      };
      if (typeof exp !== 'number' || exp < now() || typeof port !== 'number') return null;
      return { port, path: safePreviewPath(typeof path === 'string' ? path : null) };
    } catch {
      return null;
    }
  }

  function issueSession(port: number): { value: string; maxAgeSeconds: number } {
    const payload = `${port}.${now() + SESSION_TTL_MS}`;
    return {
      value: `${payload}.${signer.sign('session', payload)}`,
      maxAgeSeconds: SESSION_TTL_MS / 1000,
    };
  }

  function readSession(cookieHeader: string | undefined): number | null {
    const value = readCookie(cookieHeader, COOKIE_NAME);
    const match = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(value ?? '');
    if (!match) return null;
    const [, port, exp, signature] = match;
    if (!signer.verify('session', `${port}.${exp}`, signature) || Number(exp) < now()) return null;
    return Number(port);
  }

  return { issueTicket, redeemTicket, issueSession, readSession };
}

export type PreviewTokens = ReturnType<typeof createPreviewTokens>;

/** Resolves true when something accepts TCP connections on the loopback port. */
export function probeLoopbackPort(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: TARGET_HOST, port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export type PreviewOptions = {
  /** Public origin of the preview listener, e.g. `https://preview.example.com`; empty disables previews. */
  origin: string;
  secret: string;
  isAllowed: PortPolicy;
  probe?: (port: number) => Promise<boolean>;
  now?: () => number;
};

/** `GET /preview/open` on the Emdash origin; must run after the Emdash login check. */
export function createPreviewOpenHandler(options: PreviewOptions) {
  const tokens = createPreviewTokens(options.secret, options.now);
  const probe = options.probe ?? probeLoopbackPort;
  const origin = options.origin.replace(/\/+$/, '');

  return async function handleOpen(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PREVIEW_OPEN_PATH) return false;
    if (!origin) {
      sendPage(
        res,
        503,
        'Preview sin configurar',
        'Falta EMDASH_WEB_PREVIEW_ORIGIN en el servidor de Emdash, así que todavía no se pueden abrir páginas locales.'
      );
      return true;
    }
    const port = parsePreviewPort(url.searchParams.get('port'), options.isAllowed);
    if (port === null) {
      sendPage(
        res,
        400,
        'Puerto no permitido',
        `El preview solo abre puertos de desarrollo entre ${MIN_PORT} y ${MAX_PORT} que no sean servicios del servidor.`
      );
      return true;
    }
    if (!(await probe(port))) {
      sendNotRunning(res, port);
      return true;
    }
    const ticket = tokens.issueTicket(port, safePreviewPath(url.searchParams.get('path')));
    res.writeHead(303, {
      location: `${origin}${PREVIEW_ENTER_PATH}?ticket=${encodeURIComponent(ticket)}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    res.end();
    return true;
  };
}

/** Request and websocket handlers for the dedicated preview listener. */
export function createPreviewProxy(options: Omit<PreviewOptions, 'origin' | 'probe'>) {
  const tokens = createPreviewTokens(options.secret, options.now);

  function sessionPort(req: IncomingMessage): number | null {
    const port = tokens.readSession(req.headers.cookie);
    return port !== null && options.isAllowed(port) ? port : null;
  }

  function enter(url: URL, res: ServerResponse): void {
    const redeemed = tokens.redeemTicket(url.searchParams.get('ticket'));
    if (!redeemed || !options.isAllowed(redeemed.port)) {
      sendPage(res, 401, 'Link vencido', 'Volvé a tocar el link desde el chat de Emdash.');
      return;
    }
    const session = tokens.issueSession(redeemed.port);
    res.writeHead(303, {
      location: redeemed.path,
      'cache-control': 'no-store',
      'set-cookie': `${COOKIE_NAME}=${session.value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${session.maxAgeSeconds}`,
    });
    res.end();
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === PREVIEW_ENTER_PATH) {
      enter(url, res);
      return;
    }
    const port = sessionPort(req);
    if (port === null) {
      sendPage(res, 401, 'Sin acceso', 'Abrí el preview tocando el link desde el chat de Emdash.');
      return;
    }
    const upstream = httpRequest(
      {
        host: TARGET_HOST,
        port,
        method: req.method,
        path: req.url,
        headers: forwardRequestHeaders(req.headers, port),
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, forwardResponseHeaders(response.headers, port));
        response.pipe(res);
      }
    );
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else sendNotRunning(res, port);
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const port = sessionPort(req);
    if (port === null) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstream = connect({ host: TARGET_HOST, port }, () => {
      upstream.write(serializeRequestHead(req, forwardRequestHeaders(req.headers, port, true)));
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
    upstream.on('close', close);
    socket.on('close', close);
  }

  return { handleRequest, handleUpgrade };
}

/**
 * Drops hop-by-hop headers and every Emdash credential before the request
 * leaves for the dev server. The Host header is rewritten to `localhost:PORT`
 * so dev servers that check it (Vite `allowedHosts`) accept the request.
 */
export function forwardRequestHeaders(
  headers: IncomingHttpHeaders,
  port: number,
  isUpgrade = false
): OutgoingHttpHeaders {
  const forwarded: OutgoingHttpHeaders = { ...headers };
  const listed = String(headers.connection ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...HOP_BY_HOP_HEADERS, ...listed]) delete forwarded[name];
  delete forwarded.authorization;
  const cookie = withoutCookie(headers.cookie, COOKIE_NAME);
  if (cookie) forwarded.cookie = cookie;
  else delete forwarded.cookie;
  if (headers.host) forwarded['x-forwarded-host'] = headers.host;
  forwarded['x-forwarded-proto'] = 'https';
  forwarded.host = `localhost:${port}`;
  if (isUpgrade) {
    forwarded.connection = 'Upgrade';
    forwarded.upgrade = headers.upgrade ?? 'websocket';
  }
  return forwarded;
}

/** Drops hop-by-hop headers and turns redirects to `localhost:PORT` into same-origin paths. */
export function forwardResponseHeaders(
  headers: IncomingHttpHeaders,
  port: number
): OutgoingHttpHeaders {
  const forwarded: OutgoingHttpHeaders = { ...headers };
  for (const name of HOP_BY_HOP_HEADERS) delete forwarded[name];
  const location = headers.location;
  if (location) {
    const local = new RegExp(
      `^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}(?=/|$)`,
      'i'
    );
    forwarded.location = location.replace(local, '') || '/';
  }
  return forwarded;
}

function serializeRequestHead(req: IncomingMessage, headers: OutgoingHttpHeaders): string {
  const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const item of header?.split(';') ?? []) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return null;
}

function withoutCookie(header: string | undefined, name: string): string {
  return (header ?? '')
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item && item.split('=')[0]?.trim() !== name)
    .join('; ');
}

function sendNotRunning(res: ServerResponse, port: number): void {
  sendPage(
    res,
    502,
    `Nada en el puerto ${port}`,
    `No hay nada corriendo en el puerto ${port}. Pedile al agente que deje el servidor levantado.`
  );
}

function sendPage(res: ServerResponse, status: number, title: string, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  });
  res.end(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:15px system-ui,sans-serif}main{width:min(92vw,440px);padding:28px;border:1px solid #333;border-radius:14px;background:#191919}h1{margin:0 0 10px;font-size:20px}p{margin:0;color:#bbb;line-height:1.5}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
