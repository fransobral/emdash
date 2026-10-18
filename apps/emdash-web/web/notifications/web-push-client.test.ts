import { describe, expect, it, vi } from 'vitest';
import {
  decodeBase64Url,
  syncPushSubscription,
  type WebPushClientDependencies,
} from './web-push-client';

// base64url of bytes [1, 2, 3, 250, 251]
const KEY = 'AQID-vs';
const KEY_BYTES = new Uint8Array([1, 2, 3, 250, 251]);

function subscriptionFixture(key: Uint8Array | null) {
  return {
    options: { applicationServerKey: key ? key.buffer.slice(0) : null },
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
  };
}

function setup(existing: ReturnType<typeof subscriptionFixture> | null) {
  const created = subscriptionFixture(KEY_BYTES);
  const pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => created),
  };
  const deps: WebPushClientDependencies = {
    getJson: vi.fn(async () => ({ publicKey: KEY })),
    postJson: vi.fn(async () => true),
  };
  return {
    pushManager,
    deps,
    created,
    registration: { pushManager } as unknown as ServiceWorkerRegistration,
  };
}

describe('syncPushSubscription', () => {
  it('decodes base64url keys', () => {
    expect([...decodeBase64Url(KEY)]).toEqual([...KEY_BYTES]);
  });

  it('subscribes with userVisibleOnly and posts the new subscription', async () => {
    const f = setup(null);

    expect(await syncPushSubscription(f.registration, f.deps)).toBe(true);
    expect(f.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(f.deps.postJson).toHaveBeenCalledWith('/api/push/subscribe', f.created.toJSON());
  });

  it('re-posts an existing subscription on startup instead of resubscribing', async () => {
    const existing = subscriptionFixture(KEY_BYTES);
    const f = setup(existing);

    expect(await syncPushSubscription(f.registration, f.deps)).toBe(true);
    expect(f.pushManager.subscribe).not.toHaveBeenCalled();
    expect(f.deps.postJson).toHaveBeenCalledWith('/api/push/subscribe', existing.toJSON());
  });

  it('replaces a subscription created for a different server key', async () => {
    const stale = subscriptionFixture(new Uint8Array([9, 9, 9]));
    const f = setup(stale);

    expect(await syncPushSubscription(f.registration, f.deps)).toBe(true);
    expect(stale.unsubscribe).toHaveBeenCalledOnce();
    expect(f.pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it('reports inactive when the public key cannot be fetched', async () => {
    const f = setup(null);
    f.deps.getJson = vi.fn(async () => null);

    expect(await syncPushSubscription(f.registration, f.deps)).toBe(false);
    expect(f.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('reports inactive when the server rejects the subscription', async () => {
    const f = setup(null);
    f.deps.postJson = vi.fn(async () => false);

    expect(await syncPushSubscription(f.registration, f.deps)).toBe(false);
  });
});
