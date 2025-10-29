const CACHE_NAME = 'harunbe-cache-v1.1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/game.js',
    '/manifest.json',
    '/Assets/Player/128x128DefaultGorilla.png',
    '/Assets/Scenery/ClearSky.png',
    '/Assets/Scenery/StarryNight.png',
    '/Assets/Scenery/128x128DayCloud.png',
    '/Assets/Scenery/128x128NightCloud.png',
    '/Assets/Scenery/128x128Sun.png',
    '/Assets/Scenery/128x128Moon.png',
    '/Assets/Items/128x128Banana.png',
    '/Assets/Enemies/128x128Tiger.png',
    '/Assets/Enemies/128x128Hawk.png',
    '/Assets/Scenery/TitleScreen.jpg'
];

// Install event - cache assets
self.addEventListener('install', event => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Removing old cache:', key);
                        return caches.delete(key);
                    }
                })
            )
        )
    );
    self.clients.claim();
});

// Fetch event - respond with cache, fallback to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            return fetch(event.request)
                .then(response => {
                    // Optionally cache new requests
                    return caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, response.clone());
                        return response;
                    });
                })
                .catch(() => {
                    // Fallback if offline and resource not cached
                    if (event.request.destination === 'document') {
                        return caches.match('/index.html');
                    }
                });
        })
    );
});
