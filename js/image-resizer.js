/**
 * 画像リサイズ・圧縮モジュール
 * Canvas API を使用してクライアントサイドで画像をリサイズ
 */
const ImageResizer = (() => {
    /**
     * 画像ファイルをリサイズ・圧縮して Base64 文字列を返す
     * @param {File} file - 画像ファイル
     * @param {Object} options - オプション
     * @param {number} options.maxSize - 最大幅/高さ (default: 1024)
     * @param {number} options.quality - JPEG品質 0-1 (default: 0.7)
     * @param {Function} options.onProgress - 進捗コールバック
     * @returns {Promise<{base64: string, width: number, height: number, size: number}>}
     */
    async function resize(file, options = {}) {
        const { maxSize = 1024, quality = 0.7, onProgress } = options;

        if (onProgress) onProgress(0.1, '画像を読み込み中...');

        // ファイルを読み込む
        const dataUrl = await readFileAsDataURL(file);

        if (onProgress) onProgress(0.3, 'リサイズ中...');

        // Image オブジェクトを作成
        const img = await loadImage(dataUrl);

        // リサイズ計算
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
            const ratio = Math.min(maxSize / width, maxSize / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }

        if (onProgress) onProgress(0.6, '圧縮中...');

        // Canvas でリサイズ
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // 高品質リサイズ
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // JPEG で圧縮
        const base64Full = canvas.toDataURL('image/jpeg', quality);
        // "data:image/jpeg;base64," プレフィックスを除去
        const base64 = base64Full.split(',')[1];

        if (onProgress) onProgress(1.0, '完了');

        // サイズ推定 (Base64 → バイト: 約3/4)
        const estimatedSize = Math.round(base64.length * 0.75);

        return {
            base64: base64,
            dataUrl: base64Full,
            width: width,
            height: height,
            size: estimatedSize,
            originalSize: file.size
        };
    }

    /**
     * File を DataURL として読み込む
     */
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * DataURL から Image を生成
     */
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /**
     * ファイルサイズを人間が読みやすい形式に変換
     */
    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    return { resize, formatSize };
})();
