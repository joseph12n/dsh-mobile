/* global self */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();

  const title = typeof payload.title === 'string' ? payload.title : 'DSH Mobile';
  const body = typeof payload.body === 'string' ? payload.body : 'Open DSH Mobile';
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
  const url = sessionId ? `/#/session/${encodeURIComponent(sessionId)}` : '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: sessionId || 'dsh-mobile',
      renotify: true,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url =
    event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = all.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        await existing.focus();
        await existing.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
