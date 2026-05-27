const CACHE_NAME = 'ssn-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/css/app.css',
    '/manifest.json',
    '/js/app.js',
    '/js/supabase.js',
    '/js/auth.js',
    '/js/db.js',
    '/js/notes.js',
    '/js/voice.js',
    '/js/ui.js',
    '/js/calendar.js',
    '/js/offline.js',
    '/js/audio-player.js',
    '/js/wizard.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Skip Supabase API calls
    if (event.request.url.includes('supabase.co') || event.request.url.includes('esm.sh')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
                if (response.ok && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
