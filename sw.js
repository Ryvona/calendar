// ひびカレンダー service worker: app shell offline + Web Push (cal-push Edge Function) + notification clicks
try { importScripts('./sw-widgets.js'); } catch (e) { } // Windows 11 widgets (sw-widgets.js)
const CACHE = 'hibi-cal-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hibi-cal-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // network first so updates show up; fall back to the cached page offline
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); }
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; });
    return hit ? (net.catch(() => { }), hit) : net;
  }));
});
// Web Push from the cal-push Edge Function: payload {t: title, b: body, d: 'YYYY-MM-DD', tag}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { b: e.data ? e.data.text() : '' }; }
  const day = /^\d{4}-\d\d-\d\d$/.test(d.d || '') ? d.d : '';
  e.waitUntil(self.registration.showNotification(String(d.t || 'ひびカレンダー').slice(0, 120), {
    body: String(d.b || '').slice(0, 200), tag: d.tag ? String(d.tag).slice(0, 120) : undefined,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { day }
  }));
});
// open the app on that day (focus an open window and tell it, or open ./?d=YYYY-MM-DD)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const day = e.notification.data && e.notification.data.day || '';
  const url = day ? './?d=' + day : './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) { if (day) c.postMessage({ type: 'goDay', day }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
