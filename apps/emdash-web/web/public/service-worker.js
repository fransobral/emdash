/* Emdash web notifications are local-only. No push subscription or remote payload is used. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification.data;
  if (!payload || payload.type !== 'emdash-web-notification-open') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const client = clients[0];
      if (client) {
        await client.focus();
        client.postMessage(payload);
        return;
      }

      const opened = await self.clients.openWindow('/');
      opened?.postMessage(payload);
    })
  );
});
