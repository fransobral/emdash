import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface OAuthFlowOptions {
  authorizeUrl: string;
  exchangeUrl: string;
  successRedirectUrl: string;
  errorRedirectUrl: string;
  extraParams?: Record<string, string>;
  timeoutMs?: number;
}

type PendingFlow = {
  authorizeUrl: string;
  errorRedirectUrl: string;
  expiresAt: number;
  reject: (error: Error) => void;
  resolve: (code: string) => void;
  state: string;
};

const pendingFlows = new Map<string, PendingFlow>();
const launchWaiters: Array<(url: string) => void> = [];
const queuedAuthorizeUrls: string[] = [];

export async function executeOAuthFlow(
  options: OAuthFlowOptions
): Promise<Record<string, unknown>> {
  const publicUrl = requiredPublicUrl();
  const state = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const timeoutMs = options.timeoutMs ?? 300_000;
  const redirectUri = new URL('/auth/oauth/callback', publicUrl).toString();
  const params = new URLSearchParams({
    state,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...options.extraParams,
  });
  const authorizeUrl = `${options.authorizeUrl}?${params.toString()}`;

  const code = await new Promise<string>((resolve, reject) => {
    const flow: PendingFlow = {
      authorizeUrl,
      errorRedirectUrl: options.errorRedirectUrl,
      expiresAt: Date.now() + timeoutMs,
      reject,
      resolve,
      state,
    };
    pendingFlows.set(state, flow);
    publishAuthorizeUrl(authorizeUrl);
    const timer = setTimeout(() => {
      if (pendingFlows.delete(state)) reject(new Error('OAuth authentication timed out'));
    }, timeoutMs);
    timer.unref();
  });

  const response = await fetch(options.exchangeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, code, code_verifier: codeVerifier }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Token exchange failed (${response.status})`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export function createWebOAuthHandler(options: {
  isAuthenticated: (req: IncomingMessage) => boolean;
}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/auth/oauth/launch') {
      if (!options.isAuthenticated(req)) {
        res.writeHead(303, { location: '/auth/login', 'cache-control': 'no-store' });
        res.end();
        return true;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' }).end();
        return true;
      }
      try {
        const authorizeUrl = await nextAuthorizeUrl();
        res.writeHead(303, { location: authorizeUrl, 'cache-control': 'no-store' });
        res.end();
      } catch (error) {
        renderResult(res, 504, error instanceof Error ? error.message : 'OAuth launch failed');
      }
      return true;
    }
    if (url.pathname === '/auth/oauth/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const flow = state ? pendingFlows.get(state) : undefined;
      if (!flow || flow.expiresAt < Date.now() || !code) {
        if (flow) {
          pendingFlows.delete(flow.state);
          flow.reject(new Error('State mismatch or missing code in OAuth callback'));
          res.writeHead(303, { location: flow.errorRedirectUrl }).end();
        } else {
          renderResult(res, 400, 'El enlace de autenticación es inválido o venció.');
        }
        return true;
      }
      pendingFlows.delete(flow.state);
      flow.resolve(code);
      renderResult(res, 200, 'Cuenta conectada. Ya podés cerrar esta ventana.', true);
      return true;
    }
    return false;
  };
}

function requiredPublicUrl(): URL {
  const value = process.env.EMDASH_WEB_PUBLIC_URL;
  if (!value) throw new Error('EMDASH_WEB_PUBLIC_URL is required for browser OAuth');
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('EMDASH_WEB_PUBLIC_URL must use HTTPS');
  }
  return url;
}

function publishAuthorizeUrl(url: string): void {
  const waiter = launchWaiters.shift();
  if (waiter) waiter(url);
  else queuedAuthorizeUrls.push(url);
}

function nextAuthorizeUrl(): Promise<string> {
  const queued = queuedAuthorizeUrls.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = launchWaiters.indexOf(onReady);
      if (index >= 0) launchWaiters.splice(index, 1);
      reject(new Error('No se inició el flujo OAuth desde Emdash.'));
    }, 15_000);
    const onReady = (url: string): void => {
      clearTimeout(timer);
      resolve(url);
    };
    launchWaiters.push(onReady);
  });
}

function renderResult(
  res: ServerResponse,
  status: number,
  message: string,
  closeWindow = false
): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Emdash OAuth</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:16px system-ui}.card{padding:32px;border:1px solid #333;border-radius:14px;background:#191919}</style></head><body><main class="card">${escapeHtml(message)}</main>${closeWindow ? '<script>setTimeout(()=>window.close(),1200)</script>' : ''}</body></html>`);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
