const CACHE_NAME = 'time-aware-v1';
const ASSETS = ['/', '/index.html', '/css/style.css', '/js/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => new Response('Offline', {status: 503})))
  );
});

self.addEventListener('message', e => {
  if (e.data.type === 'NOTIFY') {
    self.registration.showNotification('时间觉察', {
      body: e.data.body,
      icon: '/icon-192.png',
      tag: 'time-reminder',
      vibrate: [200, 100, 200],
      requireInteraction: true
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});