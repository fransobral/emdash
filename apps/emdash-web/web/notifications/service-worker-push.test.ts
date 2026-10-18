// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Listener = (event: Record<string, unknown>) => void;
type FakeClient = {
  focused: boolean;
  visibilityState: string;
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
};

const source = readFileSync(resolve(__dirname, '../public/service-worker.js'), 'utf8');
const PAYLOAD = {
  notificationId: 'n-1',
  title: 'Claude - Mobile redesign',
  body: 'Your agent has finished working',
  target: { kind: 'task', projectId: 'p', taskId: 't' },
  kind: 'agent-complete',
  tag: 'conversation:c',
};

function client(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    focused: false,
    visibilityState: 'hidden',
    postMessage: vi.fn(),
    focus: vi.fn(async () => undefined),
    ...overrides,
  };
}

function loadWorker(clients: FakeClient[], openWindow = vi.fn(async () => null)) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const self = {
    location: { origin: 'https://emdash.example' },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clients), openWindow, claim: vi.fn() },
  };
  runInNewContext(source, { self, URL, caches: {}, fetch: vi.fn() });
  return { listeners, showNotification, openWindow };
}

async function dispatchPush(worker: ReturnType<typeof loadWorker>, data: unknown) {
  const waits: Promise<unknown>[] = [];
  worker.listeners.get('push')?.({
    data: data === undefined ? null : { json: () => data },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
  });
  await Promise.all(waits);
}

describe('service worker push handling', () => {
  it('shows an OS notification carrying the deep-link payload when no client is focused', async () => {
    const worker = loadWorker([client()]);

    await dispatchPush(worker, PAYLOAD);

    expect(worker.showNotification).toHaveBeenCalledWith(
      PAYLOAD.title,
      expect.objectContaining({
        body: PAYLOAD.body,
        tag: PAYLOAD.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: {
          type: 'emdash-web-notification-open',
          notificationId: 'n-1',
          target: PAYLOAD.target,
        },
      })
    );
  });

  it('still shows a silent notification and messages the page when a visible client is focused', async () => {
    const focused = client({ focused: true, visibilityState: 'visible' });
    const worker = loadWorker([client(), focused]);

    await dispatchPush(worker, PAYLOAD);

    expect(worker.showNotification).toHaveBeenCalledWith(
      PAYLOAD.title,
      expect.objectContaining({ silent: true, tag: PAYLOAD.tag })
    );
    expect(focused.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'emdash-web-push-received', notificationId: 'n-1' })
    );
  });

  it('still notifies when a client is focused but not visible', async () => {
    const worker = loadWorker([client({ focused: true, visibilityState: 'hidden' })]);

    await dispatchPush(worker, PAYLOAD);

    expect(worker.showNotification).toHaveBeenCalledWith(
      PAYLOAD.title,
      expect.objectContaining({ silent: false })
    );
  });

  it.each([
    ['no data', undefined],
    ['non-object data', 'oops'],
    ['missing target', { ...PAYLOAD, target: undefined }],
    ['missing id', { ...PAYLOAD, notificationId: undefined }],
  ])('ignores malformed payloads (%s)', async (_label, data) => {
    const worker = loadWorker([client()]);

    await dispatchPush(worker, data);

    expect(worker.showNotification).not.toHaveBeenCalled();
  });

  it('delivers a click that cold-starts the app once the page announces it is ready', async () => {
    const worker = loadWorker([]);
    const data = {
      type: 'emdash-web-notification-open',
      notificationId: 'n-1',
      target: PAYLOAD.target,
    };
    const waits: Promise<unknown>[] = [];
    worker.listeners.get('notificationclick')?.({
      notification: { close: vi.fn(), data },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    await Promise.all(waits);
    expect(worker.openWindow).toHaveBeenCalledWith('/');

    const source = { postMessage: vi.fn() };
    worker.listeners.get('message')?.({
      data: { type: 'emdash-web-notification-ready' },
      source,
    });
    expect(source.postMessage).toHaveBeenCalledWith(data);

    worker.listeners.get('message')?.({
      data: { type: 'emdash-web-notification-ready' },
      source,
    });
    expect(source.postMessage).toHaveBeenCalledOnce();
  });
});
