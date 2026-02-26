/**
 * オフライン同期マネージャー
 * オンライン復帰時に保留中の操作をGASに送信
 */
const SyncManager = (() => {
    let isSyncing = false;
    let listeners = [];

    /**
     * 初期化: オンライン/オフラインイベント監視
     */
    function init() {
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);

        // 初期状態チェック
        updateStatus();
    }

    function onOnline() {
        updateStatus();
        // オンライン復帰時に自動同期
        sync();
    }

    function onOffline() {
        updateStatus();
    }

    /**
     * 接続状態UI更新
     */
    function updateStatus() {
        const indicator = document.getElementById('connection-status');
        if (!indicator) return;

        if (navigator.onLine) {
            indicator.textContent = 'オンライン';
            indicator.className = 'connection-badge online';
        } else {
            indicator.textContent = 'オフライン';
            indicator.className = 'connection-badge offline';
        }
    }

    /**
     * 同期実行
     */
    async function sync() {
        if (isSyncing || !navigator.onLine || !API.isConfigured()) return;

        const queue = await DB.getSyncQueue();
        if (queue.length === 0) return;

        isSyncing = true;
        notify('sync-start', { count: queue.length });

        try {
            // 一括同期
            const result = await API.request({
                action: 'syncBatch',
                operations: queue
            });

            if (result.success) {
                // 成功した操作をキューから削除
                for (const res of result.results) {
                    if (res.success) {
                        await DB.removeSyncItem(res.opId);
                    }
                }

                // ローカルデータをサーバーと同期
                await refreshLocalData();

                notify('sync-complete', { results: result.results });
            }
        } catch (error) {
            console.error('Sync failed:', error);
            notify('sync-error', { error: error.message });
        } finally {
            isSyncing = false;
        }
    }

    /**
     * サーバーからデータを再取得してローカルDBを更新
     */
    async function refreshLocalData() {
        try {
            const [cardsResult, foldersResult] = await Promise.all([
                API.getCards(),
                API.getFolders()
            ]);

            if (cardsResult.success) {
                for (const card of cardsResult.cards) {
                    await DB.saveCard(card);
                }
            }
        } catch (e) {
            console.warn('Failed to refresh local data:', e);
        }
    }

    /**
     * 同期キューの件数取得
     */
    async function getPendingCount() {
        const queue = await DB.getSyncQueue();
        return queue.length;
    }

    /**
     * イベントリスナー
     */
    function on(event, callback) {
        listeners.push({ event, callback });
    }

    function notify(event, data) {
        listeners
            .filter(l => l.event === event)
            .forEach(l => l.callback(data));
    }

    return { init, sync, getPendingCount, on };
})();
