/**
 * GAS API 通信レイヤー
 * オンライン/オフライン対応
 */
const API = (() => {
    // GAS デプロイURL（デプロイ後にここを設定）
    const GAS_URL = 'https://script.google.com/macros/s/AKfycbxJwcjougrdfczMPepKkublFFLuNDzKMwP_oPAmN3KM2Afyvjmc7C_KYLTU4XaDDKS2/exec';

    /**
     * GAS API にリクエスト送信
     */
    async function request(data, retries = 3) {
        if (GAS_URL === '%%GAS_URL%%') {
            console.warn('GAS_URL が未設定です。オフラインモードで動作します。');
            throw new Error('GAS_URL not configured');
        }

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await fetch(GAS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify(data)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const result = await response.json();
                return result;
            } catch (error) {
                if (attempt === retries - 1) throw error;
                // 指数バックオフ
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
    }

    /**
     * 画像アップロード（オフライン対応）
     */
    async function uploadImage(base64, fileName, subFolder) {
        const payload = {
            action: 'uploadImage',
            base64,
            fileName,
            subFolder
        };

        if (!navigator.onLine) {
            // オフライン: ローカルに一時保存
            const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            await DB.cacheImage(tempId, base64);
            await DB.addToSyncQueue({ ...payload, tempId });
            return { success: true, url: 'offline://' + tempId, fileId: tempId, offline: true };
        }

        return request(payload);
    }

    /**
     * カード作成（オフライン対応）
     */
    async function createCard(cardData) {
        const payload = { action: 'createCard', ...cardData };

        if (!navigator.onLine) {
            // オフライン: ローカルIDで仮保存
            const tempId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const card = {
                id: tempId,
                folder_path: cardData.folder_path || '',
                front_image_url: cardData.front_image_url || '',
                back_image_url: cardData.back_image_url || '',
                easiness_factor: 2.5,
                interval: 0,
                repetition_count: 0,
                next_review_date: new Date().toISOString(),
                created_at: new Date().toISOString(),
                _offline: true
            };
            await DB.saveCard(card);
            await DB.addToSyncQueue(payload);
            return { success: true, card, offline: true };
        }

        const result = await request(payload);
        if (result.success && result.card) {
            await DB.saveCard(result.card);
        }
        return result;
    }

    /**
     * カード一覧取得
     */
    async function getCards(options = {}) {
        if (!navigator.onLine) {
            const cards = options.folder_path
                ? await DB.getCardsByFolder(options.folder_path)
                : await DB.getAllCards();
            return { success: true, cards, offline: true };
        }

        try {
            const result = await request({ action: 'getCards', ...options });
            if (result.success && result.cards) {
                // ローカルDBを更新
                for (const card of result.cards) {
                    await DB.saveCard(card);
                }
            }
            return result;
        } catch (error) {
            // APIエラー時はローカルDBから取得
            const cards = await DB.getAllCards();
            return { success: true, cards, offline: true };
        }
    }

    /**
     * カード更新（SM-2パラメータ等）
     */
    async function updateCard(cardData) {
        const payload = { action: 'updateCard', ...cardData };

        // ローカルDBも更新
        const existing = await DB.getCard(cardData.id);
        if (existing) {
            const updated = { ...existing, ...cardData };
            await DB.saveCard(updated);
        }

        if (!navigator.onLine) {
            await DB.addToSyncQueue(payload);
            return { success: true, offline: true };
        }

        return request(payload);
    }

    /**
     * カード削除
     */
    async function deleteCard(id) {
        await DB.deleteCard(id);

        if (!navigator.onLine) {
            await DB.addToSyncQueue({ action: 'deleteCard', id });
            return { success: true, offline: true };
        }

        return request({ action: 'deleteCard', id });
    }

    /**
     * フォルダ一覧取得
     */
    async function getFolders() {
        if (!navigator.onLine) {
            const folders = await DB.getAllFolders();
            return { success: true, folders, offline: true };
        }

        try {
            const result = await request({ action: 'getFolders' });
            if (result.success && result.folders) {
                await DB.saveFolders(result.folders);
            }
            return result;
        } catch (error) {
            const folders = await DB.getAllFolders();
            return { success: true, folders, offline: true };
        }
    }

    /**
     * GAS_URL が設定済みか確認
     */
    function isConfigured() {
        return GAS_URL !== '%%GAS_URL%%';
    }

    return {
        uploadImage, createCard, getCards, updateCard, deleteCard, getFolders, isConfigured, request
    };
})();
