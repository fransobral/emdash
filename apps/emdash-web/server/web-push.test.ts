import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSubscriptionStore,
  createWebPushService,
  loadOrCreateVapidKeys,
  redactEndpoint,
  type PushSender,
  type PushSubscriptionRecord,
} from './web-push';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'emdash-web-push-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const keys = { publicKey: 'pub-key', privateKey: 'priv-key' };
const subscription = (id: string): PushSubscriptionRecord => ({
  endpoint: `https://push.example/send/${id}`,
  keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
});

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

async function call(
  service: ReturnType<typeof createWebPushService>,
  method: string,
  path: string,
  body?: unknown
) {
  const req = Object.assign(new EventEmitter(), {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined)
        yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    },
  }) as unknown as IncomingMessage;
  let status = 0;
  let payload = '';
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk?: string) => {
      payload = chunk ?? '';
    },
  } as unknown as ServerResponse;
  const handled = await service.handle(req, res);
  return { handled, status, json: payload ? JSON.parse(payload) : null };
}

describe('VAPID keys', () => {
  it('generates once, persists with mode 0600, and reuses the same keys', () => {
    const generate = vi.fn(() => keys);

    expect(loadOrCreateVapidKeys(dir, generate)).toEqual(keys);
    expect(loadOrCreateVapidKeys(dir, generate)).toEqual(keys);

    expect(generate).toHaveBeenCalledOnce();
    expect(mode(join(dir, 'web-push-vapid.json'))).toBe(0o600);
  });
});

describe('subscription store', () => {
  it('persists atomically (0600), de-duplicates by endpoint, and reloads from disk', () => {
    const store = createSubscriptionStore(dir);
    store.upsert(subscription('a'));
    store.upsert(subscription('a'));
    store.upsert(subscription('b'));

    const path = join(dir, 'web-push-subscriptions.json');
    expect(mode(path)).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(2);
    expect(createSubscriptionStore(dir).list()).toHaveLength(2);
    expect(store.remove(subscription('a').endpoint)).toBe(true);
    expect(store.remove(subscription('a').endpoint)).toBe(false);
  });

  it('starts empty when the file is corrupt', () => {
    writeFileSync(join(dir, 'web-push-subscriptions.json'), '{not json');
    expect(createSubscriptionStore(dir).list()).toEqual([]);
  });

  it('refuses new subscriptions beyond the cap', () => {
    const store = createSubscriptionStore(dir);
    for (let i = 0; i < 50; i += 1) expect(store.upsert(subscription(String(i)))).toBe(true);
    expect(store.upsert(subscription('overflow'))).toBe(false);
    expect(store.upsert(subscription('0'))).toBe(true);
  });
});

describe('push endpoints', () => {
  const make = (sender?: PushSender) =>
    createWebPushService({ dataDir: dir, generateKeys: () => keys, sender });

  it('serves the public key and ignores other routes', async () => {
    const service = make();

    expect(await call(service, 'GET', '/api/push/public-key')).toMatchObject({
      status: 200,
      json: { publicKey: 'pub-key' },
    });
    expect((await call(service, 'GET', '/api/other')).handled).toBe(false);
    expect((await call(service, 'GET', '/api/push/nope')).status).toBe(404);
  });

  it('never exposes the private key', async () => {
    const response = await call(make(), 'GET', '/api/push/public-key');
    expect(JSON.stringify(response.json)).not.toContain('priv-key');
  });

  it('subscribes and unsubscribes', async () => {
    const service = make();

    expect((await call(service, 'POST', '/api/push/subscribe', subscription('a'))).status).toBe(
      200
    );
    expect(service.listSubscriptions()).toHaveLength(1);
    expect(
      (
        await call(service, 'POST', '/api/push/unsubscribe', {
          endpoint: subscription('a').endpoint,
        })
      ).status
    ).toBe(200);
    expect(service.listSubscriptions()).toHaveLength(0);
  });

  it.each([
    ['non-JSON body', 'not json'],
    ['missing keys', { endpoint: 'https://push.example/x' }],
    ['non-https endpoint', { ...subscription('a'), endpoint: 'http://push.example/x' }],
    ['non-url endpoint', { ...subscription('a'), endpoint: 'nope' }],
  ])('rejects invalid subscribe input (%s)', async (_label, body) => {
    const service = make();

    expect((await call(service, 'POST', '/api/push/subscribe', body)).status).toBe(400);
    expect(service.listSubscriptions()).toHaveLength(0);
  });

  it('rejects an invalid unsubscribe body', async () => {
    expect((await call(make(), 'POST', '/api/push/unsubscribe', { endpoint: 1 })).status).toBe(400);
  });

  it('does not accept wrong methods', async () => {
    expect((await call(make(), 'GET', '/api/push/subscribe')).status).toBe(404);
  });
});

describe('notify', () => {
  const payload = {
    notificationId: 'n-1',
    title: 'Claude',
    body: 'Done',
    target: { kind: 'none' as const },
    kind: 'agent-complete',
    tag: 'conversation:c',
  };

  it('sends the JSON payload to every subscription', async () => {
    const send = vi.fn(async () => undefined);
    const service = createWebPushService({
      dataDir: dir,
      generateKeys: () => keys,
      sender: { send },
    });
    await call(service, 'POST', '/api/push/subscribe', subscription('a'));
    await call(service, 'POST', '/api/push/subscribe', subscription('b'));

    await service.notify(payload);

    expect(send).toHaveBeenCalledTimes(2);
    const [, body, vapid] = send.mock.calls[0] as unknown as [unknown, string, { subject: string }];
    expect(JSON.parse(body)).toEqual(payload);
    expect(vapid.subject).toMatch(/^mailto:|^https:/);
  });

  it('prunes subscriptions that answer 404 or 410 and keeps the rest', async () => {
    const send = vi.fn(async (sub: PushSubscriptionRecord) => {
      if (sub.endpoint.endsWith('/gone'))
        throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('/missing'))
        throw Object.assign(new Error('nf'), { statusCode: 404 });
    });
    const service = createWebPushService({
      dataDir: dir,
      generateKeys: () => keys,
      sender: { send },
    });
    for (const id of ['gone', 'missing', 'ok']) {
      await call(service, 'POST', '/api/push/subscribe', subscription(id));
    }

    await service.notify(payload);

    expect(service.listSubscriptions().map((item) => item.endpoint)).toEqual([
      subscription('ok').endpoint,
    ]);
    expect(createSubscriptionStore(dir).list()).toHaveLength(1);
  });

  it('keeps subscriptions on transient errors and never logs full endpoints', async () => {
    const warn = vi.fn();
    const send = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { statusCode: 500 });
    });
    const service = createWebPushService({
      dataDir: dir,
      generateKeys: () => keys,
      sender: { send },
      logger: { info: vi.fn(), warn },
    });
    await call(service, 'POST', '/api/push/subscribe', subscription('secret-token'));

    await service.notify(payload);

    expect(service.listSubscriptions()).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token-full');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(subscription('secret-token').endpoint);
  });

  it('truncates oversized text', async () => {
    const send = vi.fn(async () => undefined);
    const service = createWebPushService({
      dataDir: dir,
      generateKeys: () => keys,
      sender: { send },
    });
    await call(service, 'POST', '/api/push/subscribe', subscription('a'));

    await service.notify({ ...payload, body: 'x'.repeat(5000) });

    const body = JSON.parse((send.mock.calls[0] as unknown as [unknown, string])[1]);
    expect(body.body.length).toBeLessThanOrEqual(300);
  });
});

describe('notification sink', () => {
  const batch = (kind: string) =>
    ({
      notification: {
        id: 'n-1',
        kind,
        groupKey: 'conversation:c',
        title: 'Claude - Task',
        body: 'Done',
        target: { kind: 'task', projectId: 'p', taskId: 't' },
        source: { kind: 'app' },
        sound: null,
        count: 1,
        createdAt: 1,
        readAt: null,
      },
      items: [],
      summary: { title: 'Claude - Task', body: 'Done (2 notifications)' },
    }) as unknown as Parameters<
      ReturnType<ReturnType<typeof createWebPushService>['sink']>['deliver']
    >[0];

  it('pushes agent events using the batch summary, and ignores other kinds', async () => {
    const send = vi.fn(async () => undefined);
    const service = createWebPushService({
      dataDir: dir,
      generateKeys: () => keys,
      sender: { send },
    });
    await call(service, 'POST', '/api/push/subscribe', subscription('a'));
    const sink = service.sink();

    await sink.deliver(batch('update-available'));
    expect(send).not.toHaveBeenCalled();

    await sink.deliver(batch('agent-attention'));
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse((send.mock.calls[0] as unknown as [unknown, string])[1])).toMatchObject({
      notificationId: 'n-1',
      kind: 'agent-attention',
      tag: 'conversation:c',
      body: 'Done (2 notifications)',
      target: { kind: 'task', projectId: 'p', taskId: 't' },
    });
    expect(sink.id).toBe('system');
  });
});

describe('redactEndpoint', () => {
  it('keeps only host and a short suffix', () => {
    const redacted = redactEndpoint('https://fcm.example/wpush/v2/SECRETSECRETSECRET123456');
    expect(redacted).toBe('fcm.example/…123456');
    expect(existsSync(dir)).toBe(true);
  });
});
