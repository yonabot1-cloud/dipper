// Dipper service worker: price-drop notifications + home-screen install.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Dipper', body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Dipper', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      data: { url: data.url || '/' },
      tag: data.url || 'dipper',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
