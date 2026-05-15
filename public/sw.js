// Service Worker — xử lý Web Push khi app không mở

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch {}
  const text = data.text || 'Giao dịch mới';

  e.waitUntil(
    self.registration.showNotification('Bank Loa 🏦', {
      body: text,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: 'bank-transaction',
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) return c.focus();
      }
      return clients.openWindow('/');
    })
  );
});
