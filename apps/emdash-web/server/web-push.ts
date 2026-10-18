import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AppNotification, NotificationTarget } from '@core/services/notifications/api';
import type { NotificationSink } from '@core/services/notifications/api/ports';
import webpush from 'web-push';
import { z } from 'zod';

const VAPID_FILE = 'web-push-vapid.json';
const SUBSCRIPTIONS_FILE = 'web-push-subscriptions.json';
const MAX_BODY_BYTES = 16_384;
const MAX_SUBSCRIPTIONS = 50;
const MAX_TITLE_CHARS = 120;
const MAX_BODY_CHARS = 300;
const PUSH_TTL_SECONDS = 60 * 60;
const DEFAULT_VAPID_SUBJECT = 'mailto:emdash-web@example.com';
const PUSH_ROUTE_PREFIX = '/api/push/';
/** Same event filter the in-page controller applies before showing an OS notification. */
const PUSHED_KINDS: ReadonlySet<string> = new Set(['agent-complete', 'agent-attention']);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).startsWith('https://'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});
const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });
const vapidSchema = z.object({ publicKey: z.string().min(1), privateKey: z.string().min(1) });
const storedSubscriptionsSchema = z.array(subscriptionSchema);

export type PushSubscriptionRecord = z.infer<typeof subscriptionSchema>;
export type VapidKeys = z.infer<typeof vapidSchema>;

export type PushPayload = {
  notificationId: string;
  title: string;
  body: string;
  target: NotificationTarget;
  kind: string;
  tag: string;
};

export type PushSender = {
  send(
    subscription: PushSubscriptionRecord,
    payload: string,
    vapid: VapidKeys & { subject: string }
  ): Promise<void>;
};

export type WebPushLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
};

export const webPushSender: PushSender = {
  async send(subscription, payload, vapid) {
    await webpush.sendNotification(subscription, payload, {
      TTL: PUSH_TTL_SECONDS,
      urgency: 'high',
      vapidDetails: {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    });
  },
};

/** Endpoints are bearer capabilities; only log the host and a short suffix. */
export function redactEndpoint(endpoint: string): string {
  try {
    return `${new URL(endpoint).host}/…${endpoint.slice(-6)}`;
  } catch {
    return '<invalid-endpoint>';
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function loadOrCreateVapidKeys(
  dataDir: string,
  generate: () => VapidKeys = () => webpush.generateVAPIDKeys()
): VapidKeys {
  const path = join(dataDir, VAPID_FILE);
  if (existsSync(path)) {
    const parsed = vapidSchema.safeParse(readJson(path));
    if (parsed.success) return parsed.data;
  }
  mkdirSync(dataDir, { recursive: true });
  const keys = generate();
  writeJsonAtomic(path, keys);
  return keys;
}

export function createSubscriptionStore(dataDir: string) {
  const path = join(dataDir, SUBSCRIPTIONS_FILE);
  const parsed = storedSubscriptionsSchema.safeParse(readJson(path));
  let subscriptions: readonly PushSubscriptionRecord[] = parsed.success ? parsed.data : [];

  function persist(next: readonly PushSubscriptionRecord[]): void {
    mkdirSync(dataDir, { recursive: true });
    writeJsonAtomic(path, next);
    subscriptions = next;
  }

  return {
    list: (): readonly PushSubscriptionRecord[] => subscriptions,
    /** Returns false when the store is full and the subscription is new. */
    upsert(subscription: PushSubscriptionRecord): boolean {
      const others = subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
      if (others.length >= MAX_SUBSCRIPTIONS) return false;
      persist([...others, subscription]);
      return true;
    },
    remove(endpoint: string): boolean {
      const next = subscriptions.filter((item) => item.endpoint !== endpoint);
      if (next.length === subscriptions.length) return false;
      persist(next);
      return true;
    },
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : null;
}

function toPayload(
  notification: AppNotification,
  summary: { title: string; body: string }
): PushPayload {
  return {
    notificationId: notification.id,
    title: summary.title,
    body: summary.body,
    target: notification.target,
    kind: notification.kind,
    tag: notification.groupKey,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export function createWebPushService(options: {
  dataDir: string;
  subject?: string;
  sender?: PushSender;
  generateKeys?: () => VapidKeys;
  logger?: WebPushLogger;
}) {
  const vapid = loadOrCreateVapidKeys(options.dataDir, options.generateKeys);
  const subject = options.subject || DEFAULT_VAPID_SUBJECT;
  const sender = options.sender ?? webPushSender;
  const store = createSubscriptionStore(options.dataDir);
  const logger = options.logger;

  async function notify(payload: PushPayload): Promise<void> {
    const body = JSON.stringify({
      ...payload,
      title: truncate(payload.title, MAX_TITLE_CHARS),
      body: truncate(payload.body, MAX_BODY_CHARS),
    });
    await Promise.all(
      store.list().map(async (subscription) => {
        try {
          await sender.send(subscription, body, { ...vapid, subject });
        } catch (error) {
          const status = statusOf(error);
          if (status === 404 || status === 410) {
            store.remove(subscription.endpoint);
            logger?.info('web-push: pruned expired subscription', {
              endpoint: redactEndpoint(subscription.endpoint),
            });
            return;
          }
          logger?.warn('web-push: send failed', {
            endpoint: redactEndpoint(subscription.endpoint),
            status,
          });
        }
      })
    );
  }

  /**
   * Replaces the service's `system` sink, which the notification routing policy
   * only invokes when notifications and OS notifications are enabled and the app
   * is not focused. Web has no Electron window, so the stock sink is a no-op.
   */
  function sink(): NotificationSink {
    return {
      id: 'system',
      async deliver({ notification, summary }) {
        if (!PUSHED_KINDS.has(notification.kind)) return;
        await notify(toPayload(notification, summary));
      },
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(PUSH_ROUTE_PREFIX)) return false;
    const route = url.pathname.slice(PUSH_ROUTE_PREFIX.length);

    if (route === 'public-key' && req.method === 'GET') {
      return sendJson(res, 200, { publicKey: vapid.publicKey });
    }
    if (route === 'subscribe' && req.method === 'POST') {
      const parsed = subscriptionSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: 'invalid subscription' });
      if (!store.upsert(parsed.data)) {
        return sendJson(res, 409, { error: 'too many subscriptions' });
      }
      return sendJson(res, 200, { ok: true });
    }
    if (route === 'unsubscribe' && req.method === 'POST') {
      const parsed = unsubscribeSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: 'invalid request' });
      store.remove(parsed.data.endpoint);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: 'not found' });
  }

  return { publicKey: vapid.publicKey, notify, sink, handle, listSubscriptions: store.list };
}
