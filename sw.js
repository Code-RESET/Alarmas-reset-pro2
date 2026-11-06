const CACHE = 'app-v21';
const STATIC = [
  './',
  './index.html',
  './checklist.html',
  './manifest.json',
  './assets/logo-reset-compact.png',
  './assets/logo-reset-full.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-192-maskable.png',
  './assets/icon-512-maskable.png'
];

// ── Firebase Cloud Messaging ──
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
try {
  firebase.initializeApp({
    apiKey: "AIzaSyAOUGIWvrPtdKf9pnoYlh3NIHHiBO_R7mE",
    authDomain: "alarmas-reset-e3484.firebaseapp.com",
    projectId: "alarmas-reset-e3484",
    storageBucket: "alarmas-reset-e3484.firebasestorage.app",
    messagingSenderId: "1096561116547",
    appId: "1:1096561116547:web:b13df05c092785723aa2b6"
  });
  firebase.messaging();
} catch(e) {
  console.warn('FCM no disponible:', e);
}

// ── Install: pre-cache static shell ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches, take control immediately ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Message: allow page to trigger skipWaiting ──
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Fetch strategy ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle GET from same origin or our static hosts
  if (e.request.method !== 'GET') return;

  // Firebase/Firestore → Network Only (real-time data must be fresh)
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }

  // CDN scripts (gstatic, unpkg, cdnjs) → Cache First with network fallback
  const isCDN = url.hostname.includes('gstatic.com') ||
                url.hostname.includes('unpkg.com') ||
                url.hostname.includes('cdnjs.cloudflare.com') ||
                url.hostname.includes('fonts.googleapis.com') ||
                url.hostname.includes('fonts.gstatic.com');

  if (isCDN) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Same-origin assets → Cache First (fast loads)
  if (url.origin === self.location.origin) {
    const isHTML = e.request.headers.get('accept') &&
                   e.request.headers.get('accept').includes('text/html');

    if (isHTML) {
      // HTML → Network First so updates land quickly, fallback to cache
      e.respondWith(
        fetch(e.request)
          .then(res => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
          })
          .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
      );
    } else {
      // Static assets → Cache First
      e.respondWith(
        caches.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res && res.status === 200 && res.type === 'basic') {
              const clone = res.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
          }).catch(() => caches.match('./'));
        })
      );
    }
    return;
  }
});

// ── Push notification click ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
