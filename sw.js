/*
 * HaRUNbe service worker.
 *
 * - Everything the game needs is precached on install, so it runs fully offline.
 * - Code and pages (HTML/JS/CSS/manifest) are network-first with a short timeout, so a
 *   deployed update is picked up on the next launch instead of being stuck behind the cache.
 * - Images are cache-first (they rarely change and are the bulk of the download).
 * - Bump VERSION whenever any file changes; old caches are deleted on activation.
 */
const VERSION = '3.13.2';
const CACHE = 'harunbe-' + VERSION;

importScripts('./skins.js'); // skin images are precached straight from the catalog

const CORE = [
    './',
    './index.html',
    './style.css',
    './engine.js',
    './skins.js',
    './powerups.js',
    './game.js',
    './manifest.json'
];

const ASSETS = [
    './Assets/Player/256x256DefaultGorilla.png',
    './Assets/Enemies/256x256Tiger.png',
    './Assets/Enemies/256x256Hawk.png',
    './Assets/Items/256x256Banana.png',
    './Assets/Scenery/256x256Sun.png',
    './Assets/Scenery/256x256Moon.png',
    './Assets/Scenery/256x256DayCloud.png',
    './Assets/Scenery/256x256NightCloud.png',
    './Assets/Scenery/ClearSky.jpg',
    './Assets/Scenery/StarryNight.jpg',
    './Assets/Scenery/TitleScreen.jpg',
    './Assets/Icon/favicon.ico',
    './Assets/Icon/icon-72.png',
    './Assets/Icon/icon-96.png',
    './Assets/Icon/icon-128.png',
    './Assets/Icon/icon-192.png',
    './Assets/Icon/icon-256.png',
    './Assets/Icon/icon-512.png'
];
for (const skin of self.HarunbeSkins) {
    const url = './' + skin.image;
    if (!ASSETS.includes(url)) ASSETS.push(url);
}

const NETWORK_TIMEOUT_MS = 3500;

// The code files must all be cached or the install fails (the game can't run without them).
// Images are cached one by one: a single missing image (e.g. a typo in a new skin's path)
// is just skipped and fetched later, instead of breaking offline play for everyone.
// cache: 'reload' bypasses the HTTP cache so a new version never precaches stale files.
self.addEventListener('install', (event) => {
    const fresh = (url) => new Request(url, { cache: 'reload' });
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(CORE.map(fresh))
                .then(() => Promise.all(ASSETS.map((url) => cache.add(fresh(url)).catch(() => { /* fetched on demand */ })))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key.startsWith('harunbe-') && key !== CACHE)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

function isCode(request, url) {
    return request.mode === 'navigate' || /\.(?:html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/');
}

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
            const shell = await cache.match('./index.html');
            if (shell) return shell;
        }
        throw err;
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
}

function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(request).then(
            (response) => { clearTimeout(timer); resolve(response); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    event.respondWith(isCode(request, url) ? networkFirst(request) : cacheFirst(request));
});
