/**
 * MervyPlayer — Service Worker (PWA)
 *
 * Met en cache le « shell » de l'app (HTML, CSS, JS, icônes) pour un
 * chargement rapide et un accès partiel hors-ligne à l'interface.
 * Les fichiers audio ne sont PAS mis en cache ici (stockés dans IndexedDB).
 */
const CACHE_NAME = 'mervyplayer-cache-v15';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/jszip.min.js',
    '/manifest.json',
    '/icon-180.png',
    '/icon-192.png',
    '/icon-512.png'
];

// Install Event - Pre-cache App Shell
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('[Service Worker] Caching App Shell...');
            await Promise.allSettled(
                ASSETS.map((asset) => cache.add(asset).catch((err) => {
                    console.warn('[Service Worker] Failed to cache:', asset, err);
                }))
            );
        }).then(() => self.skipWaiting())
    );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[Service Worker] Removing old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - Serve Cache-First, fall back to network
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    
    // Do not intercept API requests (search, download, stream, etc.)
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // If resource not in cache, fetch it from network
            return fetch(e.request).then((response) => {
                // If response is valid, cache it dynamically for future use (like custom web fonts)
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseToCache);
                    });
                }
                return response;
            }).catch(() => {
                // Fallback offline behavior
                if (e.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
