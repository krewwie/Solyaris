const CACHE_NAME = 'solaris-v2';
const URLS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './site.webmanifest',
    './favicon.ico',
    './favicon.svg',
    './favicon-96x96.png',
    './apple-touch-icon.png',
    './web-app-manifest-192x192.png',
    './web-app-manifest-512x512.png',
    './translations/ru.js',
    './translations/en.js',
    './translations/cn.js',
    './translations/ar.js',
    './translations/ja.js',
    './data/teachers.js',
    './data/schedule.js',
    './data/students.js',
    './data/textbooks.js',
    './data/books.js',
    './data/oge.js',
    './images/Exclude.png',
    './images/Solarislogoorig.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    event.respondWith(
        caches.match(req).then(cached => {
            const networkFetch = fetch(req).then(res => {
                // Обновляем кэш для same-origin
                if (res && res.status === 200 && req.url.startsWith(self.location.origin)) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
                }
                return res;
            }).catch(() => {
                if (req.mode === 'navigate') return caches.match('./index.html');
                return cached;
            });
            return cached || networkFetch;
        })
    );
});