import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createPortPolicy,
  createPreviewOpenHandler,
  createPreviewProxy,
  createPreviewTokens,
  forwardRequestHeaders,
  forwardResponseHeaders,
  parsePreviewPort,
  PREVIEW_ENTER_PATH,
  safePreviewPath,
} from './preview-proxy';

const SECRET = 'test-secret';
const allowAll = () => true;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        })
    )
  );
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

async function startPreview(): Promise<number> {
  const proxy = createPreviewProxy({ secret: SECRET, isAllowed: allowAll });
  const server = createServer(proxy.handleRequest);
  server.on('upgrade', proxy.handleUpgrade);
  return listen(server);
}

function sessionCookie(port: number): string {
  return `emdash_preview=${createPreviewTokens(SECRET).issueSession(port).value}`;
}

describe('port policy', () => {
  const isAllowed = createPortPolicy([4200, 3000]);

  it('accepts dev ports and rejects privileged, ephemeral, and denied ports', () => {
    expect(isAllowed(3017)).toBe(true);
    expect(isAllowed(5173)).toBe(true);
    expect(isAllowed(80)).toBe(false);
    expect(isAllowed(4200)).toBe(false);
    expect(isAllowed(3000)).toBe(false);
    expect(isAllowed(41073)).toBe(false);
  });

  it('parses only plain decimal ports', () => {
    expect(parsePreviewPort('3017', isAllowed)).toBe(3017);
    expect(parsePreviewPort('3017abc', isAllowed)).toBeNull();
    expect(parsePreviewPort('0x10', isAllowed)).toBeNull();
    expect(parsePreviewPort('evil.com:80', isAllowed)).toBeNull();
    expect(parsePreviewPort(null, isAllowed)).toBeNull();
  });

  it('keeps redirect paths on the preview origin', () => {
    expect(safePreviewPath('/presentaciones/roadmap?x=1')).toBe('/presentaciones/roadmap?x=1');
    expect(safePreviewPath('//evil.com/')).toBe('/');
    expect(safePreviewPath('/\\evil.com')).toBe('/');
    expect(safePreviewPath('https://evil.com')).toBe('/');
  });
});

describe('preview tokens', () => {
  it('round-trips tickets and rejects tampering and expiry', () => {
    let now = 1_000;
    const tokens = createPreviewTokens(SECRET, () => now);
    const ticket = tokens.issueTicket(3017, '/a');
    expect(tokens.redeemTicket(ticket)).toEqual({ port: 3017, path: '/a' });
    expect(createPreviewTokens('other', () => now).redeemTicket(ticket)).toBeNull();
    expect(tokens.redeemTicket(`${ticket}x`)).toBeNull();
    now += 61_000;
    expect(tokens.redeemTicket(ticket)).toBeNull();
  });

  it('does not accept a ticket as a session cookie', () => {
    const tokens = createPreviewTokens(SECRET);
    const session = tokens.issueSession(3017).value;
    expect(tokens.readSession(`a=b; emdash_preview=${session}`)).toBe(3017);
    expect(tokens.readSession(`emdash_preview=${session.replace(/^3017/, '3018')}`)).toBeNull();
    expect(tokens.readSession(`emdash_preview=${tokens.issueTicket(3017, '/')}`)).toBeNull();
  });
});

describe('header filtering', () => {
  it('strips Emdash credentials and hop-by-hop headers', () => {
    const headers: IncomingHttpHeaders = {
      host: 'preview.example.com',
      cookie: 'app=1; emdash_preview=secret',
      authorization: 'Bearer x',
      connection: 'keep-alive, x-private',
      'x-private': 'drop me',
      'keep-alive': 'timeout=5',
      accept: 'text/html',
    };
    const forwarded = forwardRequestHeaders(headers, 3017);
    expect(forwarded).toMatchObject({
      host: 'localhost:3017',
      cookie: 'app=1',
      accept: 'text/html',
      'x-forwarded-host': 'preview.example.com',
    });
    expect(forwarded).not.toHaveProperty('authorization');
    expect(forwarded).not.toHaveProperty('x-private');
    expect(forwarded).not.toHaveProperty('keep-alive');
    expect(forwardRequestHeaders({ cookie: 'emdash_preview=s' }, 3017)).not.toHaveProperty(
      'cookie'
    );
  });

  it('rewrites redirects that point back at the local port', () => {
    expect(forwardResponseHeaders({ location: 'http://localhost:3017/next' }, 3017).location).toBe(
      '/next'
    );
    expect(forwardResponseHeaders({ location: 'http://127.0.0.1:3017' }, 3017).location).toBe('/');
    expect(forwardResponseHeaders({ location: 'https://github.com/' }, 3017).location).toBe(
      'https://github.com/'
    );
  });
});

describe('preview open route', () => {
  async function open(query: string, options: { origin?: string; listening?: boolean } = {}) {
    const handle = createPreviewOpenHandler({
      origin: options.origin ?? 'https://preview.example.com',
      secret: SECRET,
      isAllowed: createPortPolicy([4200]),
      probe: async () => options.listening ?? true,
    });
    const port = await listen(createServer((req, res) => void handle(req, res)));
    return fetch(`http://127.0.0.1:${port}/preview/open?${query}`, { redirect: 'manual' });
  }

  it('redirects to the preview origin with a ticket for the requested path', async () => {
    const response = await open('port=3017&path=%2Fpresentaciones%2Froadmap');
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('https://preview.example.com');
    expect(location.pathname).toBe(PREVIEW_ENTER_PATH);
    expect(createPreviewTokens(SECRET).redeemTicket(location.searchParams.get('ticket'))).toEqual({
      port: 3017,
      path: '/presentaciones/roadmap',
    });
  });

  it('refuses denied ports and explains when nothing is listening', async () => {
    expect((await open('port=4200')).status).toBe(400);
    const idle = await open('port=3017', { listening: false });
    expect(idle.status).toBe(502);
    expect(await idle.text()).toContain('No hay nada corriendo en el puerto 3017');
  });

  it('reports a missing preview origin instead of redirecting', async () => {
    expect((await open('port=3017', { origin: '' })).status).toBe(503);
  });
});

describe('preview proxy', () => {
  it('blocks requests without a preview session', async () => {
    const preview = await startPreview();
    const response = await fetch(`http://127.0.0.1:${preview}/`);
    expect(response.status).toBe(401);
    const forged = await fetch(`http://127.0.0.1:${preview}/`, {
      headers: { cookie: 'emdash_preview=3017.9999999999999.forged' },
    });
    expect(forged.status).toBe(401);
  });

  it('trades a ticket for a session cookie and redirects to the path', async () => {
    const preview = await startPreview();
    const ticket = createPreviewTokens(SECRET).issueTicket(3017, '/a?b=1');
    const response = await fetch(
      `http://127.0.0.1:${preview}${PREVIEW_ENTER_PATH}?ticket=${encodeURIComponent(ticket)}`,
      { redirect: 'manual' }
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/a?b=1');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^emdash_preview=3017\./);
    expect(cookie).toContain('HttpOnly');
  });

  it('proxies HTTP to the loopback port without Emdash credentials', async () => {
    let seen: IncomingHttpHeaders = {};
    const upstream = await listen(
      createServer((req, res) => {
        seen = req.headers;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`upstream ${req.method} ${req.url}`);
      })
    );
    const preview = await startPreview();
    const response = await fetch(`http://127.0.0.1:${preview}/assets/app.js?v=1`, {
      headers: { cookie: `${sessionCookie(upstream)}; app=1`, authorization: 'Bearer x' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('upstream GET /assets/app.js?v=1');
    expect(seen.cookie).toBe('app=1');
    expect(seen.authorization).toBeUndefined();
    expect(seen.host).toBe(`localhost:${upstream}`);
  });

  it('shows the not-running page when the dev server is gone', async () => {
    const gone = await listen(createServer());
    await new Promise<void>((done) => servers.pop()?.close(() => done()));
    const preview = await startPreview();
    const response = await fetch(`http://127.0.0.1:${preview}/`, {
      headers: { cookie: sessionCookie(gone) },
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toContain(`No hay nada corriendo en el puerto ${gone}`);
  });

  it('proxies websockets for live reload', async () => {
    const upstreamServer = createServer();
    const wss = new WebSocketServer({ server: upstreamServer });
    wss.on('connection', (socket) => socket.on('message', (data) => socket.send(`echo:${data}`)));
    const upstream = await listen(upstreamServer);
    const preview = await startPreview();

    const reply = await new Promise<string>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${preview}/hmr`, {
        headers: { cookie: sessionCookie(upstream) },
      });
      client.on('open', () => client.send('ping'));
      client.on('message', (data) => {
        resolve(String(data));
        client.close();
      });
      client.on('error', reject);
    });
    wss.close();
    expect(reply).toBe('echo:ping');
  });
});
