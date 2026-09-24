import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const COOKIE_NAME = 'emdash_web_session';
const MAX_BODY_BYTES = 16_384;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

type FailureWindow = { count: number; startedAt: number };

export function createPasswordAuth(options: { password: string; secret: string }) {
  const session = createHmac('sha256', options.secret)
    .update('emdash-web-password-session-v1')
    .digest('base64url');
  const failures = new Map<string, FailureWindow>();

  function isAuthenticated(req: IncomingMessage): boolean {
    if (!options.password) return true;
    const candidate = readCookie(req.headers.cookie, COOKIE_NAME);
    return candidate !== null && safeEqual(candidate, session);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!options.password) return false;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/auth/logout') {
      res.writeHead(303, {
        location: '/auth/login',
        'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      });
      res.end();
      return true;
    }
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      const client = clientAddress(req);
      const failure = failures.get(client);
      if (failure && Date.now() - failure.startedAt < FAILURE_WINDOW_MS && failure.count >= MAX_FAILURES) {
        renderLogin(res, 429, 'Demasiados intentos. Esperá 15 minutos.');
        return true;
      }
      const body = await readBody(req);
      const password = new URLSearchParams(body).get('password') ?? '';
      if (!safeEqual(password, options.password)) {
        recordFailure(failures, client);
        renderLogin(res, 401, 'Clave incorrecta.');
        return true;
      }
      failures.delete(client);
      res.writeHead(303, {
        location: `/?token=${encodeURIComponent(options.secret)}`,
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
      });
      res.end();
      return true;
    }
    if (url.pathname === '/auth/login' && (req.method === 'GET' || req.method === 'HEAD')) {
      renderLogin(res, 200);
      return true;
    }
    return false;
  }

  function requireAuthentication(req: IncomingMessage, res: ServerResponse): boolean {
    if (isAuthenticated(req)) return false;
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(303, { location: '/auth/login', 'cache-control': 'no-store' });
      res.end();
    } else {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'authentication required' }));
    }
    return true;
  }

  return { handle, isAuthenticated, requireAuthentication };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Login body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const item of header?.split(';') ?? []) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return null;
}

function clientAddress(req: IncomingMessage): string {
  const cloudflareAddress = req.headers['cf-connecting-ip'];
  return (Array.isArray(cloudflareAddress) ? cloudflareAddress[0] : cloudflareAddress) ??
    req.socket.remoteAddress ??
    'unknown';
}

function recordFailure(failures: Map<string, FailureWindow>, client: string): void {
  const current = failures.get(client);
  if (!current || Date.now() - current.startedAt >= FAILURE_WINDOW_MS) {
    failures.set(client, { count: 1, startedAt: Date.now() });
    return;
  }
  current.count += 1;
}

function renderLogin(res: ServerResponse, status: number, error?: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  res.end(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Emdash — Acceso</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:15px system-ui,sans-serif}.card{width:min(92vw,380px);padding:32px;border:1px solid #333;border-radius:14px;background:#191919;box-shadow:0 20px 60px #0008}h1{margin:0 0 8px;font-size:24px}p{margin:0 0 22px;color:#aaa}label{display:block;margin-bottom:7px}input,button{width:100%;height:44px;border-radius:8px;font:inherit}input{border:1px solid #444;background:#101010;color:#fff;padding:0 12px}input:focus{outline:2px solid #777;outline-offset:1px}button{margin-top:14px;border:0;background:#eee;color:#111;font-weight:650;cursor:pointer}.error{color:#ff8d8d;margin-bottom:14px}
</style></head><body><main class="card"><h1>Emdash Agents</h1><p>Ingresá la clave para acceder al cockpit.</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/auth/login"><label for="password">Clave</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus required><button type="submit">Ingresar</button></form></main></body></html>`);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
