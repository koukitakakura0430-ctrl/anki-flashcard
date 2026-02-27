/**
 * フラッシュカード PWA - メインアプリケーション
 */
const App = (() => {
    // 状態管理
    let state = {
        currentScreen: 'home',
        frontImage: null,   // { base64, dataUrl, width, height }
        backImage: null,
        studyCards: [],
        studyIndex: 0,
        isFlipped: false,
        studiedToday: 0,
        folders: [],
        allCards: []
    };

    // PWA インストール
    let deferredInstallPrompt = null;
    // Wake Lock
    let wakeLock = null;

    // ===== 初期化 =====

    async function init() {
        try {
            // IndexedDB 初期化
            await DB.init();

            // 同期マネージャー初期化
            SyncManager.init();

            // Service Worker 登録
            registerServiceWorker();

            // データ読み込み
            await loadData();

            // ハッシュルーティング
            window.addEventListener('hashchange', onHashChange);
            onHashChange();

            // SW からのメッセージ受信
            navigator.serviceWorker?.addEventListener('message', event => {
                if (event.data?.type === 'trigger-sync') {
                    SyncManager.sync();
                }
            });

            // モバイル機能初期化
            initSwipeGestures();
            initInstallPrompt();

            console.log('App initialized');
        } catch (error) {
            console.error('App init error:', error);
            showToast('初期化エラー: ' + error.message, 'error');
        }
    }

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').then(reg => {
                console.log('SW registered:', reg.scope);

                // 新しいSWが見つかったら自動更新
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'activated') {
                            console.log('New SW activated, reloading...');
                            window.location.reload();
                        }
                    });
                });

                // 定期的に更新チェック（5分ごと）
                setInterval(() => reg.update(), 5 * 60 * 1000);
            }).catch(err => {
                console.warn('SW registration failed:', err);
            });
        }
    }

    // ===== データ読み込み =====

    async function loadData() {
        try {
            // カード一覧取得
            const cardsResult = await API.getCards();
            if (cardsResult.success) {
                state.allCards = cardsResult.cards;
            }

            // フォルダ一覧取得
            const foldersResult = await API.getFolders();
            if (foldersResult.success) {
                state.folders = foldersResult.folders || [];
            }

            updateHomeStats();
            updateFolderSelectors();
            renderFolderTree();
        } catch (error) {
            console.warn('Data load fallback to local:', error);
            state.allCards = await DB.getAllCards();
            state.folders = await DB.getAllFolders();
            updateHomeStats();
        }
    }

    // ===== 画面遷移 =====

    function showScreen(name) {
        window.location.hash = name;
    }

    function onHashChange() {
        const hash = window.location.hash.slice(1) || 'home';
        activateScreen(hash);
    }

    function activateScreen(name) {
        state.currentScreen = name;

        // 全画面非表示
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById('screen-' + name);
        if (screen) screen.classList.add('active');

        // ナビアクティブ状態
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.screen === name);
        });

        // 画面固有の処理
        if (name === 'home') {
            loadData();
        } else if (name === 'folders') {
            renderFolderTree();
        }
    }

    // ===== ホーム画面 =====

    function updateHomeStats() {
        const total = state.allCards.length;
        const dueCards = SM2.getDueCards(state.allCards);

        document.getElementById('total-cards').textContent = total;
        document.getElementById('due-cards').textContent = dueCards.length;
        document.getElementById('studied-today').textContent = state.studiedToday;
        document.getElementById('folder-count').textContent = state.folders.length;
    }

    // ===== 画像キャプチャ =====

    async function handleImageCapture(input, side) {
        const file = input.files[0];
        if (!file) return;

        try {
            showLoading('画像をリサイズ中...');

            const resized = await ImageResizer.resize(file, {
                maxSize: 1024,
                quality: 0.7,
                onProgress: (progress, text) => {
                    document.getElementById('loading-text').textContent = text;
                }
            });

            hideLoading();

            // クロッパーを開く
            let result;
            try {
                result = await ImageCropper.open(resized.dataUrl);
                result.originalSize = resized.originalSize;
            } catch (e) {
                // キャンセルされた場合は何もしない
                return;
            }

            // 状態保存
            if (side === 'front') {
                state.frontImage = result;
            } else {
                state.backImage = result;
            }

            // プレビュー表示
            const captureBox = document.getElementById(side + '-capture');
            captureBox.innerHTML = `
        <img src="${result.dataUrl}" alt="${side}">
        <input type="file" id="${side}-input" accept="image/*" capture="environment"
               onchange="App.handleImageCapture(this, '${side}')">
      `;
            captureBox.classList.add('has-image');

            // サイズ情報
            const infoEl = document.getElementById(side + '-info');
            infoEl.textContent = `${result.width}×${result.height}px | ${ImageResizer.formatSize(result.size)} (元: ${ImageResizer.formatSize(result.originalSize)})`;

            showToast(`${side === 'front' ? '表面' : '裏面'}の画像を取得しました`, 'success');
        } catch (error) {
            hideLoading();
            showToast('画像の処理に失敗しました: ' + error.message, 'error');
        }
    }

    // ===== カード保存 =====

    async function saveCard() {
        if (!state.frontImage || !state.backImage) {
            showToast('表面と裏面の両方の画像を撮影してください', 'error');
            return;
        }

        // フォルダパス取得
        const folderPath = getSelectedFolderPath();

        try {
            showLoading('カードをアップロード中...');
            const btn = document.getElementById('save-card-btn');
            btn.disabled = true;

            // 表面画像アップロード
            setProgress(20, '表面画像をアップロード中...');
            const frontResult = await API.uploadImage(
                state.frontImage.base64,
                'front_' + Date.now() + '.jpg',
                folderPath
            );

            // 裏面画像アップロード
            setProgress(50, '裏面画像をアップロード中...');
            const backResult = await API.uploadImage(
                state.backImage.base64,
                'back_' + Date.now() + '.jpg',
                folderPath
            );

            // カードデータ作成
            setProgress(80, 'カードを保存中...');
            const cardResult = await API.createCard({
                folder_path: folderPath,
                front_image_url: frontResult.url,
                back_image_url: backResult.url
            });

            // 画像をローカルにキャッシュ（学習画面での表示用）
            if (cardResult.success && cardResult.card) {
                const cardId = cardResult.card.id;
                await DB.cacheImage('front_' + cardId, state.frontImage.base64);
                await DB.cacheImage('back_' + cardId, state.backImage.base64);
            }

            setProgress(100, '完了！');

            if (cardResult.success) {
                showToast('カードを保存しました！', 'success');
                resetCreateForm();
                await loadData();
            }

            btn.disabled = false;
            hideLoading();
        } catch (error) {
            hideLoading();
            document.getElementById('save-card-btn').disabled = false;
            showToast('保存エラー: ' + error.message, 'error');
        }
    }

    function getSelectedFolderPath() {
        // 新規入力があればそちら優先
        const newFolder = document.getElementById('new-folder-input').value.trim();
        if (newFolder) return newFolder;

        const level1 = document.getElementById('folder-level1').value;
        const level2 = document.getElementById('folder-level2').value;
        const level3 = document.getElementById('folder-level3').value;

        const parts = [level1, level2, level3].filter(Boolean);
        return parts.join('/');
    }

    function resetCreateForm() {
        state.frontImage = null;
        state.backImage = null;

        ['front', 'back'].forEach(side => {
            const box = document.getElementById(side + '-capture');
            box.innerHTML = `
        <div class="capture-icon">📸</div>
        <div class="capture-label">${side === 'front' ? '表面（問題）' : '裏面（答え）'}をタップして撮影</div>
        <input type="file" id="${side}-input" accept="image/*" capture="environment"
               onchange="App.handleImageCapture(this, '${side}')">
      `;
            box.classList.remove('has-image');
            document.getElementById(side + '-info').textContent = '';
        });

        document.getElementById('new-folder-input').value = '';
        setProgress(0, '');
    }

    // ===== 学習セッション =====

    async function startStudy() {
        try {
            showLoading('復習カードを読み込み中...');

            const result = await API.getCards({ due_only: true });
            let dueCards = [];

            if (result.success) {
                dueCards = SM2.getDueCards(result.cards);
            } else {
                dueCards = await DB.getDueCards();
            }

            hideLoading();

            if (dueCards.length === 0) {
                showScreen('study');
                document.getElementById('study-card-container').classList.add('hidden');
                document.getElementById('tap-hint').classList.add('hidden');
                document.getElementById('rating-buttons').classList.add('hidden');
                document.getElementById('study-complete').classList.remove('hidden');
                document.getElementById('study-complete').querySelector('h2').textContent = '復習カードなし';
                document.getElementById('study-complete').querySelector('p').textContent = '現在復習が必要なカードはありません。新しいカードを作成しましょう！';
                return;
            }

            // シャッフル
            state.studyCards = shuffleArray(dueCards);
            state.studyIndex = 0;
            state.isFlipped = false;

            showScreen('study');
            document.getElementById('study-card-container').classList.remove('hidden');
            document.getElementById('tap-hint').classList.remove('hidden');
            document.getElementById('study-complete').classList.add('hidden');

            updateStudyProgress();
            showStudyCard();

            // 学習中はスリープ防止
            requestWakeLock();
        } catch (error) {
            hideLoading();
            showToast('学習データの読み込みに失敗しました', 'error');
        }
    }

    async function showStudyCard() {
        const card = state.studyCards[state.studyIndex];
        if (!card) return;

        state.isFlipped = false;
        document.getElementById('study-card').classList.remove('flipped');
        document.getElementById('rating-buttons').classList.remove('visible');
        document.getElementById('tap-hint').classList.remove('hidden');

        // 画像設定
        const frontImg = document.getElementById('study-front-img');
        const backImg = document.getElementById('study-back-img');

        // 画像ロード: ローカルキャッシュ優先 → URL フォールバック
        await loadCardImage(frontImg, card, 'front');
        await loadCardImage(backImg, card, 'back');

        // 評価ボタン生成
        renderRatingButtons();
    }

    /**
     * カード画像をロードする
     * 優先順位: 1. ローカルキャッシュ(by card id) → 2. オフラインキャッシュ → 3. URL直接表示
     */
    async function loadCardImage(imgEl, card, side) {
        const url = side === 'front' ? card.front_image_url : card.back_image_url;

        // 1. カードIDベースのローカルキャッシュを確認
        try {
            const cached = await DB.getCachedImage(side + '_' + card.id);
            if (cached && cached.base64) {
                imgEl.src = 'data:image/jpeg;base64,' + cached.base64;
                return;
            }
        } catch (e) {
            // キャッシュ取得失敗は無視
        }

        // 2. オフラインURL（offline://）の場合
        if (url?.startsWith('offline://')) {
            try {
                const cached = await DB.getCachedImage(url.replace('offline://', ''));
                if (cached && cached.base64) {
                    imgEl.src = 'data:image/jpeg;base64,' + cached.base64;
                    return;
                }
            } catch (e) {
                // フォールバック
            }
        }

        // 3. URL直接表示（Google Drive等）+ 取得できたらキャッシュ
        if (url && !url.startsWith('offline://')) {
            try {
                // fetchで画像を取得してキャッシュに保存
                const response = await fetch(url);
                if (response.ok) {
                    const blob = await response.blob();
                    const base64 = await blobToBase64(blob);
                    imgEl.src = 'data:image/jpeg;base64,' + base64;
                    // 次回用にキャッシュ
                    DB.cacheImage(side + '_' + card.id, base64).catch(() => { });
                    return;
                }
            } catch (e) {
                console.warn('画像fetch失敗、直接URLで試行:', url);
            }
            // fetchに失敗した場合はimg.srcに直接設定
            imgEl.src = url;
            imgEl.onerror = () => {
                console.warn('画像ロード失敗:', url);
                imgEl.alt = side === 'front' ? '問題画像を読み込めません' : '答え画像を読み込めません';
            };
        }
    }

    /**
     * BlobをBase64文字列に変換
     */
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                resolve(dataUrl.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    function flipCard() {
        if (state.studyCards.length === 0) return;

        state.isFlipped = !state.isFlipped;
        document.getElementById('study-card').classList.toggle('flipped', state.isFlipped);

        if (state.isFlipped) {
            document.getElementById('tap-hint').classList.add('hidden');
            document.getElementById('rating-buttons').classList.add('visible');
        } else {
            document.getElementById('rating-buttons').classList.remove('visible');
            document.getElementById('tap-hint').classList.remove('hidden');
        }
    }

    function renderRatingButtons() {
        const container = document.getElementById('rating-buttons');
        const buttons = SM2.getRatingButtons();

        container.innerHTML = buttons.map(btn => `
      <button class="rating-btn ${btn.className}" onclick="App.rateCard(${btn.quality})">
        <span class="emoji">${btn.emoji}</span>
        <span>${btn.label}</span>
      </button>
    `).join('');
    }

    async function rateCard(quality) {
        const card = state.studyCards[state.studyIndex];
        if (!card) return;

        // SM-2 計算
        const sm2Result = SM2.calculate(
            quality,
            card.repetition_count || 0,
            card.easiness_factor || 2.5,
            card.interval || 0
        );

        // カード更新
        try {
            await API.updateCard({
                id: card.id,
                easiness_factor: sm2Result.easinessFactor,
                interval: sm2Result.interval,
                repetition_count: sm2Result.repetitionCount,
                next_review_date: sm2Result.nextReviewDate
            });
        } catch (error) {
            console.warn('Card update failed, queued for sync:', error);
        }

        state.studiedToday++;

        // 次のカードへ
        state.studyIndex++;
        updateStudyProgress();

        if (state.studyIndex >= state.studyCards.length) {
            // 学習完了
            document.getElementById('study-card-container').classList.add('hidden');
            document.getElementById('tap-hint').classList.add('hidden');
            document.getElementById('rating-buttons').classList.remove('visible');
            document.getElementById('study-complete').classList.remove('hidden');
            // スリープ防止解除
            releaseWakeLock();
        } else {
            showStudyCard();
        }
    }

    function updateStudyProgress() {
        const current = state.studyIndex;
        const total = state.studyCards.length;
        const percent = total > 0 ? (current / total) * 100 : 0;

        document.getElementById('study-current').textContent = current;
        document.getElementById('study-total').textContent = total;
        document.getElementById('study-progress-fill').style.width = percent + '%';
    }

    // ===== フォルダ管理 =====

    function updateFolderSelectors() {
        const level1Set = new Set();
        const level2Map = {};
        const level3Map = {};

        state.folders.forEach(path => {
            const parts = path.split('/');
            if (parts[0]) level1Set.add(parts[0]);
            if (parts[1]) {
                if (!level2Map[parts[0]]) level2Map[parts[0]] = new Set();
                level2Map[parts[0]].add(parts[1]);
            }
            if (parts[2]) {
                const key = parts[0] + '/' + parts[1];
                if (!level3Map[key]) level3Map[key] = new Set();
                level3Map[key].add(parts[2]);
            }
        });

        // レベル1
        const sel1 = document.getElementById('folder-level1');
        sel1.innerHTML = '<option value="">-- レベル1 --</option>' +
            Array.from(level1Set).sort().map(f => `<option value="${f}">${f}</option>`).join('');

        // データ属性に保存
        sel1.dataset.level2Map = JSON.stringify(Object.fromEntries(
            Object.entries(level2Map).map(([k, v]) => [k, Array.from(v)])
        ));
        sel1.dataset.level3Map = JSON.stringify(Object.fromEntries(
            Object.entries(level3Map).map(([k, v]) => [k, Array.from(v)])
        ));
    }

    function onFolderChange(level) {
        const sel1 = document.getElementById('folder-level1');
        const sel2 = document.getElementById('folder-level2');
        const sel3 = document.getElementById('folder-level3');

        if (level === 1) {
            const val = sel1.value;
            const level2Map = JSON.parse(sel1.dataset.level2Map || '{}');
            const options = level2Map[val] || [];
            sel2.innerHTML = '<option value="">-- レベル2 --</option>' +
                options.sort().map(f => `<option value="${f}">${f}</option>`).join('');
            sel3.innerHTML = '<option value="">-- レベル3 --</option>';
        }

        if (level === 2) {
            const key = sel1.value + '/' + sel2.value;
            const level3Map = JSON.parse(sel1.dataset.level3Map || '{}');
            const options = level3Map[key] || [];
            sel3.innerHTML = '<option value="">-- レベル3 --</option>' +
                options.sort().map(f => `<option value="${f}">${f}</option>`).join('');
        }
    }

    function renderFolderTree() {
        const container = document.getElementById('folder-tree');
        if (state.folders.length === 0) {
            container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📁</div>
          <p>フォルダがありません<br>カードを作成するとフォルダが追加されます</p>
        </div>
      `;
            return;
        }

        // ツリー構造を構築
        const tree = {};
        state.folders.forEach(path => {
            const parts = path.split('/');
            let current = tree;
            for (const part of parts) {
                if (!current[part]) current[part] = {};
                current = current[part];
            }
        });

        container.innerHTML = buildTreeHTML(tree, '');
    }

    function buildTreeHTML(node, prefix) {
        let html = '';
        for (const [name, children] of Object.entries(node)) {
            const path = prefix ? prefix + '/' + name : name;
            const cardCount = state.allCards.filter(c => c.folder_path === path).length;
            const hasChildren = Object.keys(children).length > 0;
            const escapedPath = path.replace(/'/g, "\\'");

            html += `
        <li>
          <div class="folder-item">
            <span class="folder-icon" onclick="App.studyFolder('${escapedPath}')">${hasChildren ? '📂' : '📁'}</span>
            <span class="folder-name" onclick="App.studyFolder('${escapedPath}')">${name}</span>
            <span class="card-count">${cardCount}枚</span>
            <button class="folder-delete" onclick="event.stopPropagation(); App.deleteFolder('${escapedPath}')" title="削除">🗑️</button>
          </div>
          ${hasChildren ? '<ul class="folder-children">' + buildTreeHTML(children, path) + '</ul>' : ''}
        </li>
      `;
        }
        return html;
    }

    async function addFolder() {
        const input = document.getElementById('add-folder-input');
        const path = input.value.trim();
        if (!path) {
            showToast('フォルダパスを入力してください', 'error');
            return;
        }

        if (!state.folders.includes(path)) {
            state.folders.push(path);
            // 親フォルダも追加
            const parts = path.split('/');
            for (let i = 1; i < parts.length; i++) {
                const parentPath = parts.slice(0, i).join('/');
                if (!state.folders.includes(parentPath)) {
                    state.folders.push(parentPath);
                }
            }
            state.folders.sort();
            await DB.saveFolders(state.folders);
            updateFolderSelectors();
            renderFolderTree();
            showToast(`フォルダ「${path}」を追加しました`, 'success');
        } else {
            showToast('このフォルダは既に存在します', 'info');
        }

        input.value = '';
    }

    async function deleteFolder(path) {
        if (!confirm(`フォルダ「${path}」を削除しますか？\n※フォルダ内のカードも削除されます`)) {
            return;
        }

        try {
            showLoading('フォルダを削除中...');

            // フォルダ内のカードを削除
            const cardsToDelete = state.allCards.filter(c =>
                c.folder_path === path || c.folder_path.startsWith(path + '/')
            );

            for (const card of cardsToDelete) {
                try {
                    await API.deleteCard(card.id);
                } catch (e) {
                    console.warn('Card delete failed:', card.id, e);
                }
            }

            // フォルダをローカルから削除
            state.folders = state.folders.filter(f =>
                f !== path && !f.startsWith(path + '/')
            );
            await DB.saveFolders(state.folders);

            // データ再読み込み
            await loadData();
            renderFolderTree();
            updateFolderSelectors();

            hideLoading();
            showToast(`フォルダ「${path}」を削除しました`, 'success');
        } catch (error) {
            hideLoading();
            showToast('削除に失敗しました: ' + error.message, 'error');
        }
    }

    async function studyFolder(path) {
        try {
            showLoading('フォルダのカードを読み込み中...');
            const result = await API.getCards({ folder_path: path });
            hideLoading();

            let cards = result.success ? result.cards : await DB.getCardsByFolder(path);
            let dueCards = SM2.getDueCards(cards);

            if (dueCards.length === 0) {
                showToast(`「${path}」には復習カードがありません`, 'info');
                return;
            }

            state.studyCards = shuffleArray(dueCards);
            state.studyIndex = 0;
            state.isFlipped = false;

            showScreen('study');
            document.getElementById('study-card-container').classList.remove('hidden');
            document.getElementById('tap-hint').classList.remove('hidden');
            document.getElementById('study-complete').classList.add('hidden');
            updateStudyProgress();
            showStudyCard();
        } catch (error) {
            hideLoading();
            showToast('エラーが発生しました', 'error');
        }
    }

    // ===== UI ユーティリティ =====

    function showLoading(text) {
        document.getElementById('loading-text').textContent = text || '読み込み中...';
        document.getElementById('loading-overlay').classList.remove('hidden');
    }

    function hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    }

    function setProgress(percent, text) {
        const bar = document.getElementById('upload-progress');
        const fill = document.getElementById('upload-progress-fill');
        const textEl = document.getElementById('upload-progress-text');

        if (percent > 0) {
            bar.classList.add('active');
            fill.style.width = percent + '%';
            textEl.textContent = text;
        } else {
            bar.classList.remove('active');
            fill.style.width = '0%';
            textEl.textContent = '';
        }
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function shuffleArray(arr) {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // ===== スワイプジェスチャー =====

    function initSwipeGestures() {
        const cardContainer = document.getElementById('study-card-container');
        if (!cardContainer) return;

        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let isSwiping = false;

        cardContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
            isSwiping = false;
        }, { passive: true });

        cardContainer.addEventListener('touchmove', (e) => {
            const diffX = Math.abs(e.changedTouches[0].screenX - touchStartX);
            const diffY = Math.abs(e.changedTouches[0].screenY - touchStartY);
            // 横方向の動きが縦より大きければスワイプとみなす
            if (diffX > diffY && diffX > 30) {
                isSwiping = true;
            }
        }, { passive: true });

        cardContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const diffX = touchEndX - touchStartX;

            // カードがめくられていない場合はタップでめくる
            if (!isSwiping) return;

            // カードがめくられている場合のみスワイプ評価
            if (!state.isFlipped) return;

            const threshold = 80;
            const card = document.getElementById('study-card');

            if (diffX < -threshold) {
                // 左スワイプ = もう一度 (Again)
                card.classList.add('swiping-left');
                setTimeout(() => {
                    card.classList.remove('swiping-left');
                    rateCard(0);
                }, 350);
            } else if (diffX > threshold) {
                // 右スワイプ = 良い (Good)
                card.classList.add('swiping-right');
                setTimeout(() => {
                    card.classList.remove('swiping-right');
                    rateCard(4);
                }, 350);
            }
        }, { passive: true });
    }

    // ===== PWA インストール =====

    function initInstallPrompt() {
        // Android / Chrome: beforeinstallprompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            // 少し遅らせてバナー表示
            setTimeout(() => showInstallBanner(), 3000);
        });

        // 既にインストール済みかチェック
        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            hideInstallBanner();
            showToast('アプリをインストールしました！', 'success');
        });

        // iOS Safari判定: PWA未インストール時のみ表示
        if (isIOS() && !isStandalone()) {
            setTimeout(() => showIOSInstallGuide(), 5000);
        }
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
    }

    function showInstallBanner() {
        const banner = document.getElementById('install-banner');
        if (!banner || localStorage.getItem('install-dismissed')) return;
        banner.classList.add('visible');
    }

    function hideInstallBanner() {
        const banner = document.getElementById('install-banner');
        if (banner) banner.classList.remove('visible');
    }

    function showIOSInstallGuide() {
        if (localStorage.getItem('install-dismissed')) return;
        const desc = document.getElementById('install-desc');
        if (desc) {
            desc.innerHTML = '下の共有ボタン <strong>↑</strong> → 「ホーム画面に追加」';
        }
        const installBtn = document.getElementById('install-btn');
        if (installBtn) installBtn.style.display = 'none';
        showInstallBanner();
    }

    async function installPWA() {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const result = await deferredInstallPrompt.userChoice;
        if (result.outcome === 'accepted') {
            showToast('インストールありがとうございます！', 'success');
        }
        deferredInstallPrompt = null;
        hideInstallBanner();
    }

    function dismissInstall() {
        hideInstallBanner();
        localStorage.setItem('install-dismissed', 'true');
    }

    // ===== Wake Lock (学習中スリープ防止) =====

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    wakeLock = null;
                });
            }
        } catch (e) {
            console.warn('Wake Lock failed:', e);
        }
    }

    function releaseWakeLock() {
        if (wakeLock) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    // ===== GAS 接続テスト =====

    async function testConnection() {
        try {
            showLoading('GAS接続テスト中...');
            const result = await API.getCards();
            hideLoading();
            if (result.offline) {
                showToast('オフラインモードで動作中\nGASに接続できません', 'info');
            } else {
                showToast(`GAS接続 OK！ カード${result.cards?.length || 0}枚取得`, 'success');
            }
        } catch (e) {
            hideLoading();
            showToast('GAS接続エラー: ' + e.message, 'error');
        }
    }

    // ===== 公開API =====
    return {
        init,
        showScreen,
        handleImageCapture,
        saveCard,
        startStudy,
        flipCard,
        rateCard,
        onFolderChange,
        addFolder,
        deleteFolder,
        studyFolder,
        installPWA,
        dismissInstall,
        testConnection
    };
})();

// アプリ起動
document.addEventListener('DOMContentLoaded', App.init);
