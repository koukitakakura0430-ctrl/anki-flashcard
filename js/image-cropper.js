/**
 * 画像クロッパーモジュール
 * タッチ操作で画像の重要部分をトリミング
 */
const ImageCropper = (() => {
    let canvas, ctx;
    let img = null;
    let cropState = {
        // 画像の表示位置・スケール
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        minScale: 0.5,
        maxScale: 3,
        // クロップ領域（canvas座標）
        cropX: 0,
        cropY: 0,
        cropW: 0,
        cropH: 0,
        // ドラッグ
        isDragging: false,
        lastTouchX: 0,
        lastTouchY: 0,
        // ピンチ
        lastPinchDist: 0,
        // モード: 'move' (画像移動) or 'crop' (選択範囲)
        mode: 'crop',
        // 選択中
        isSelecting: false,
        selectStartX: 0,
        selectStartY: 0
    };
    let resolveCallback = null;
    let rejectCallback = null;

    /**
     * クロッパーを開く
     * @param {string} dataUrl - 画像のDataURL
     * @returns {Promise<{base64, dataUrl, width, height}>}
     */
    function open(dataUrl) {
        return new Promise((resolve, reject) => {
            resolveCallback = resolve;
            rejectCallback = reject;

            const modal = document.getElementById('crop-modal');
            canvas = document.getElementById('crop-canvas');
            ctx = canvas.getContext('2d');

            modal.classList.remove('hidden');

            img = new Image();
            img.onload = () => {
                resizeCanvas();
                resetView();
                draw();
                setupTouchHandlers();
            };
            img.onerror = () => {
                close();
                reject(new Error('画像の読み込みに失敗'));
            };
            img.src = dataUrl;
        });
    }

    function resizeCanvas() {
        const container = document.getElementById('crop-container');
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }

    function resetView() {
        if (!img) return;
        // 画像を画面にフィット
        const scaleX = canvas.width / img.width;
        const scaleY = canvas.height / img.height;
        cropState.scale = Math.min(scaleX, scaleY) * 0.9;
        cropState.minScale = cropState.scale * 0.5;
        cropState.maxScale = cropState.scale * 4;

        cropState.offsetX = (canvas.width - img.width * cropState.scale) / 2;
        cropState.offsetY = (canvas.height - img.height * cropState.scale) / 2;

        // クロップ領域リセット
        cropState.cropX = 0;
        cropState.cropY = 0;
        cropState.cropW = 0;
        cropState.cropH = 0;
    }

    function draw() {
        if (!ctx || !img) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 背景
        ctx.fillStyle = '#0f0f1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 画像描画
        ctx.drawImage(
            img,
            cropState.offsetX,
            cropState.offsetY,
            img.width * cropState.scale,
            img.height * cropState.scale
        );

        // クロップ領域がある場合
        if (cropState.cropW > 10 && cropState.cropH > 10) {
            // 暗くする（選択範囲外）
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 選択範囲を切り抜き表示
            ctx.save();
            ctx.beginPath();
            ctx.rect(cropState.cropX, cropState.cropY, cropState.cropW, cropState.cropH);
            ctx.clip();
            ctx.drawImage(
                img,
                cropState.offsetX,
                cropState.offsetY,
                img.width * cropState.scale,
                img.height * cropState.scale
            );
            ctx.restore();

            // 選択範囲の枠線
            ctx.strokeStyle = '#6c5ce7';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(cropState.cropX, cropState.cropY, cropState.cropW, cropState.cropH);
            ctx.setLineDash([]);

            // 角のハンドル
            drawCornerHandles();
        }
    }

    function drawCornerHandles() {
        const size = 12;
        const { cropX, cropY, cropW, cropH } = cropState;
        ctx.fillStyle = '#6c5ce7';

        const corners = [
            [cropX, cropY],
            [cropX + cropW, cropY],
            [cropX, cropY + cropH],
            [cropX + cropW, cropY + cropH]
        ];

        for (const [cx, cy] of corners) {
            ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
        }
    }

    function setupTouchHandlers() {
        // 既存ハンドラ削除
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mouseup', onMouseUp);

        // タッチイベント
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });

        // マウスイベント（PC用）
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
    }

    // タッチハンドラ
    function onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            startSelect(x, y);
        } else if (e.touches.length === 2) {
            // ピンチ開始
            cropState.lastPinchDist = getPinchDist(e.touches);
        }
    }

    function onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && cropState.isSelecting) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            moveSelect(x, y);
        } else if (e.touches.length === 2) {
            // ピンチズーム
            const dist = getPinchDist(e.touches);
            if (cropState.lastPinchDist > 0) {
                const delta = dist / cropState.lastPinchDist;
                const newScale = cropState.scale * delta;
                if (newScale >= cropState.minScale && newScale <= cropState.maxScale) {
                    // ズーム中心をピンチの中心に
                    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - canvas.getBoundingClientRect().left;
                    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - canvas.getBoundingClientRect().top;

                    cropState.offsetX = cx - (cx - cropState.offsetX) * delta;
                    cropState.offsetY = cy - (cy - cropState.offsetY) * delta;
                    cropState.scale = newScale;

                    // クロップ範囲リセット
                    cropState.cropW = 0;
                    cropState.cropH = 0;
                    draw();
                }
            }
            cropState.lastPinchDist = dist;
        }
    }

    function onTouchEnd(e) {
        e.preventDefault();
        endSelect();
        cropState.lastPinchDist = 0;
    }

    // マウスハンドラ
    function onMouseDown(e) {
        const rect = canvas.getBoundingClientRect();
        startSelect(e.clientX - rect.left, e.clientY - rect.top);
    }

    function onMouseMove(e) {
        if (!cropState.isSelecting) return;
        const rect = canvas.getBoundingClientRect();
        moveSelect(e.clientX - rect.left, e.clientY - rect.top);
    }

    function onMouseUp() {
        endSelect();
    }

    // 選択操作
    function startSelect(x, y) {
        cropState.isSelecting = true;
        cropState.selectStartX = x;
        cropState.selectStartY = y;
        cropState.cropX = x;
        cropState.cropY = y;
        cropState.cropW = 0;
        cropState.cropH = 0;
    }

    function moveSelect(x, y) {
        cropState.cropX = Math.min(cropState.selectStartX, x);
        cropState.cropY = Math.min(cropState.selectStartY, y);
        cropState.cropW = Math.abs(x - cropState.selectStartX);
        cropState.cropH = Math.abs(y - cropState.selectStartY);
        draw();
    }

    function endSelect() {
        cropState.isSelecting = false;
    }

    function getPinchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * クロップを確定して結果を返す
     */
    function confirmCrop() {
        if (!img) return;

        let sx, sy, sw, sh;

        if (cropState.cropW > 10 && cropState.cropH > 10) {
            // 選択範囲をソース画像の座標に変換
            sx = (cropState.cropX - cropState.offsetX) / cropState.scale;
            sy = (cropState.cropY - cropState.offsetY) / cropState.scale;
            sw = cropState.cropW / cropState.scale;
            sh = cropState.cropH / cropState.scale;

            // 画像境界にクリップ
            sx = Math.max(0, Math.min(sx, img.width));
            sy = Math.max(0, Math.min(sy, img.height));
            sw = Math.min(sw, img.width - sx);
            sh = Math.min(sh, img.height - sy);
        } else {
            // 選択がなければ画像全体
            sx = 0;
            sy = 0;
            sw = img.width;
            sh = img.height;
        }

        // 結果をCanvasに描画
        const outCanvas = document.createElement('canvas');
        outCanvas.width = Math.round(sw);
        outCanvas.height = Math.round(sh);
        const outCtx = outCanvas.getContext('2d');
        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = 'high';
        outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);

        const dataUrl = outCanvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        const estimatedSize = Math.round(base64.length * 0.75);

        close();

        if (resolveCallback) {
            resolveCallback({
                base64,
                dataUrl,
                width: outCanvas.width,
                height: outCanvas.height,
                size: estimatedSize,
                originalSize: estimatedSize
            });
        }
    }

    /**
     * クロップせず元画像のまま使う
     */
    function skipCrop() {
        if (!img) return;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = img.width;
        outCanvas.height = img.height;
        const outCtx = outCanvas.getContext('2d');
        outCtx.drawImage(img, 0, 0);

        const dataUrl = outCanvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        const estimatedSize = Math.round(base64.length * 0.75);

        close();

        if (resolveCallback) {
            resolveCallback({
                base64,
                dataUrl,
                width: img.width,
                height: img.height,
                size: estimatedSize,
                originalSize: estimatedSize
            });
        }
    }

    function close() {
        const modal = document.getElementById('crop-modal');
        if (modal) modal.classList.add('hidden');

        // ハンドラ除去
        if (canvas) {
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
            canvas.removeEventListener('mousedown', onMouseDown);
            canvas.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('mouseup', onMouseUp);
        }
        img = null;
    }

    function cancel() {
        close();
        if (rejectCallback) {
            rejectCallback(new Error('クロップがキャンセルされました'));
        }
    }

    return { open, confirmCrop, skipCrop, cancel };
})();
