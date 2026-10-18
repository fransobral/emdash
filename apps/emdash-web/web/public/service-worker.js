/* Emdash web service worker: offline app shell, local notifications, and Web Push
   (payloads come from the Emdash Web server, signed with its VAPID key). */
const CACHE_NAME = 'emdash-shell-v1';
const OPEN_MESSAGE_TYPE = 'emdash-web-notification-open';
const PUSH_RECEIVED_MESSAGE_TYPE = 'emdash-web-push-received';
const READY_MESSAGE_TYPE = 'emdash-web-notification-ready';
const NOTIFICATION_ICON = '/icons/icon-192.png';
// A click that cold-starts the app has no listener to message yet; the page asks for it once ready.
let pendingOpen = null;
const APP_SHELL = ['/index.html', '/favicon.svg', '/manifest.webmanifest'];

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/favicon.svg' ||
    pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  // Only immutable static assets are cache-first; API, auth, and WebSocket
  // traffic always goes to the network so live state is never served stale.
  if (!isStaticAsset(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

function parsePushPayload(event) {
  if (!event.data) return null;
  let value;
  try {
    value = event.data.json();
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { notificationId, title, body, target, tag } = value;
  if (typeof notificationId !== 'string' || typeof title !== 'string') return null;
  if (!target || typeof target !== 'object' || typeof target.kind !== 'string') return null;
  return {
    notificationId,
    title,
    body: typeof body === 'string' ? body : '',
    target,
    tag: typeof tag === 'string' && tag ? tag : notificationId,
  };
}

async function handlePush(push) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // The user is already looking at the app: the in-app feed covers it, so skip the OS banner.
  const visible = windows.find((client) => client.focused && client.visibilityState === 'visible');
  if (visible) {
    visible.postMessage({
      type: PUSH_RECEIVED_MESSAGE_TYPE,
      notificationId: push.notificationId,
      target: push.target,
    });
    return;
  }
  await self.registration.showNotification(push.title, {
    body: push.body,
    tag: push.tag,
    renotify: true,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    data: { type: OPEN_MESSAGE_TYPE, notificationId: push.notificationId, target: push.target },
  });
}

self.addEventListener('push', (event) => {
  const push = parsePushPayload(event);
  if (push) event.waitUntil(handlePush(push));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification.data;
  if (!payload || payload.type !== OPEN_MESSAGE_TYPE) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const client = clients[0];
      if (client) {
        await client.focus();
        client.postMessage(payload);
        return;
      }

      pendingOpen = payload;
      const opened = await self.clients.openWindow('/');
      opened?.postMessage(payload);
    })
  );
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== READY_MESSAGE_TYPE || !pendingOpen) return;
  const payload = pendingOpen;
  pendingOpen = null;
  event.source?.postMessage(payload);
});
