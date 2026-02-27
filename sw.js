/**
 * Service Worker - フラッシュカード PWA
 * Cache-First (静的アセット) + Network-First (API)
 */

const CACHE_NAME = 'flashcard-v9';
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/sm2.js',
    './js/heic-converter.js',
    './js/image-resizer.js',
    './js/image-cropper.js',
    './js/db.js',
    './js/api.js',
    './js/sync.js',
    './manifest.json'
];

// インストール: 静的アセットをキャッシュ
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// アクティベート: 古いキャッシュを削除
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// クライアントからの強制更新メッセージ
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// フェッチ戦略
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // GAS APIリクエスト → Network-First
    if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Google Drive 画像 → Cache-First
    if (url.hostname === 'drive.google.com' || url.hostname === 'lh3.googleusercontent.com') {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // 静的アセット → Cache-First
    event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        return new Response('Offline', { status: 503 });
    }
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        return response;
    } catch (e) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ success: false, error: 'Offline' }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// バックグラウンド同期
self.addEventListener('sync', event => {
    if (event.tag === 'sync-cards') {
        event.waitUntil(
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'trigger-sync' });
                });
            })
        );
    }
});
