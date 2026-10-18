const PUBLIC_KEY_PATH = '/api/push/public-key';
const SUBSCRIBE_PATH = '/api/push/subscribe';

export type WebPushClientDependencies = {
  /** GET a same-origin JSON endpoint; returns null on any failure. */
  getJson(path: string): Promise<unknown>;
  /** POST a same-origin JSON endpoint; returns whether the server accepted it. */
  postJson(path: string, body: unknown): Promise<boolean>;
};

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function readPublicKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const key = (value as Record<string, unknown>).publicKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current || current.byteLength !== expected.byteLength) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((byte, index) => byte === expected[index]);
}

/**
 * Ensures this browser has a push subscription registered with the server.
 * Safe to call on every startup: the subscription may have rotated or been
 * dropped by the push service, so it is always re-posted.
 * Resolves true only when the server holds a live subscription for this browser.
 */
export async function syncPushSubscription(
  registration: Pick<ServiceWorkerRegistration, 'pushManager'>,
  deps: WebPushClientDependencies
): Promise<boolean> {
  if (!registration.pushManager) return false;
  const publicKey = readPublicKey(await deps.getJson(PUBLIC_KEY_PATH));
  if (!publicKey) return false;
  const serverKey = decodeBase64Url(publicKey);

  let subscription = await registration.pushManager.getSubscription();
  // A subscription created for a different VAPID key (e.g. regenerated keys) can never receive pushes.
  if (subscription && !sameKey(subscription.options.applicationServerKey, serverKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: serverKey,
  });
  return await deps.postJson(SUBSCRIBE_PATH, subscription.toJSON());
}
