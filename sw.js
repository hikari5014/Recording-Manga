// 離線與更新。快取名稱跟著版本號走，version.js 一改就會裝新版。
importScripts('version.js');

const CACHE = 'frame-sheet-' + self.APP_VERSION;
const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'version.js',
  'manifest.webmanifest',
  'vendor/jszip.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // 不自動 skipWaiting：等使用者按「立即更新」才換版
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('frame-sheet-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 檢查更新用的 version.js?t=... 一律走網路
  if (url.pathname.endsWith('/version.js') && url.search) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html', { cacheName: CACHE }).then((res) => res || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((res) => res || fetch(req))
  );
});
