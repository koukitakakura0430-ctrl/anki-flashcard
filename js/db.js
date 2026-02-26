/**
 * IndexedDB 管理モジュール
 * オフラインデータ保存・同期キュー管理
 */
const DB = (() => {
    const DB_NAME = 'flashcard-db';
    const DB_VERSION = 1;
    let db = null;

    /**
     * データベース初期化
     */
    function init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const database = event.target.result;

                // カードストア
                if (!database.objectStoreNames.contains('cards')) {
                    const cardStore = database.createObjectStore('cards', { keyPath: 'id' });
                    cardStore.createIndex('folder_path', 'folder_path', { unique: false });
                    cardStore.createIndex('next_review_date', 'next_review_date', { unique: false });
                }

                // フォルダストア
                if (!database.objectStoreNames.contains('folders')) {
                    database.createObjectStore('folders', { keyPath: 'path' });
                }

                // 同期キュー
                if (!database.objectStoreNames.contains('syncQueue')) {
                    const syncStore = database.createObjectStore('syncQueue', { keyPath: 'opId', autoIncrement: true });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // 画像キャッシュ（オフライン用）
                if (!database.objectStoreNames.contains('imageCache')) {
                    database.createObjectStore('imageCache', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };

            request.onerror = (event) => {
                reject('IndexedDB error: ' + event.target.error);
            };
        });
    }

    // ===== 汎用 CRUD =====

    function getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function remove(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    function clear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ===== カード操作 =====

    async function getAllCards() {
        return getAll('cards');
    }

    async function getCard(id) {
        return get('cards', id);
    }

    async function saveCard(card) {
        return put('cards', card);
    }

    async function deleteCard(id) {
        return remove('cards', id);
    }

    async function getCardsByFolder(folderPath) {
        const cards = await getAllCards();
        if (!folderPath) return cards;
        return cards.filter(c =>
            c.folder_path === folderPath || c.folder_path.startsWith(folderPath + '/')
        );
    }

    async function getDueCards() {
        const cards = await getAllCards();
        return SM2.getDueCards(cards);
    }

    // ===== 同期キュー =====

    async function addToSyncQueue(operation) {
        const op = {
            ...operation,
            opId: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toISOString()
        };
        return put('syncQueue', op);
    }

    async function getSyncQueue() {
        return getAll('syncQueue');
    }

    async function clearSyncQueue() {
        return clear('syncQueue');
    }

    async function removeSyncItem(opId) {
        return remove('syncQueue', opId);
    }

    // ===== 画像キャッシュ =====

    async function cacheImage(id, base64) {
        return put('imageCache', { id, base64, cachedAt: new Date().toISOString() });
    }

    async function getCachedImage(id) {
        return get('imageCache', id);
    }

    // ===== フォルダ =====

    async function saveFolders(paths) {
        const tx = db.transaction('folders', 'readwrite');
        const store = tx.objectStore('folders');
        store.clear();
        for (const path of paths) {
            store.put({ path });
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    async function getAllFolders() {
        const folders = await getAll('folders');
        return folders.map(f => f.path);
    }

    return {
        init,
        getAllCards, getCard, saveCard, deleteCard, getCardsByFolder, getDueCards,
        addToSyncQueue, getSyncQueue, clearSyncQueue, removeSyncItem,
        cacheImage, getCachedImage,
        saveFolders, getAllFolders
    };
})();
