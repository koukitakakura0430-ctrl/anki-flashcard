/**
 * HEIC/HEIF 画像変換モジュール
 * iPhoneで撮影したHEIC画像をJPEGに変換
 * heic2any ライブラリを使用
 */
const HeicConverter = (() => {

    /**
     * ファイルがHEIC/HEIF形式かどうかを判定
     * @param {File} file - チェック対象のファイル
     * @returns {boolean}
     */
    function isHeic(file) {
        if (!file) return false;

        // MIMEタイプで判定
        const mimeType = (file.type || '').toLowerCase();
        if (mimeType === 'image/heic' || mimeType === 'image/heif') {
            return true;
        }

        // 拡張子で判定（iOSではMIMEが空の場合がある）
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.heic') || name.endsWith('.heif')) {
            return true;
        }

        return false;
    }

    /**
     * HEICファイルをJPEG Blobに変換
     * @param {File|Blob} file - HEIC画像ファイル
     * @param {Object} options - オプション
     * @param {number} options.quality - JPEG品質 0-1 (default: 0.85)
     * @param {Function} options.onProgress - 進捗コールバック
     * @returns {Promise<File>} JPEG形式のFileオブジェクト
     */
    async function convert(file, options = {}) {
        const { quality = 0.85, onProgress } = options;

        if (onProgress) onProgress(0.1, 'HEIC形式を検出、変換中...');

        // heic2any が読み込まれているか確認
        if (typeof heic2any === 'undefined') {
            throw new Error('HEIC変換ライブラリが読み込まれていません。オンライン状態で再試行してください。');
        }

        try {
            if (onProgress) onProgress(0.3, 'HEIC → JPEG 変換中...');

            const jpegBlob = await heic2any({
                blob: file,
                toType: 'image/jpeg',
                quality: quality
            });

            if (onProgress) onProgress(0.8, '変換完了');

            // Blob を File オブジェクトに変換（元のファイル名を .jpg に変更）
            const originalName = file.name || 'image.heic';
            const newName = originalName.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');

            // heic2any が配列を返す場合がある
            const resultBlob = Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob;

            const convertedFile = new File([resultBlob], newName, {
                type: 'image/jpeg',
                lastModified: file.lastModified || Date.now()
            });

            if (onProgress) onProgress(1.0, '変換完了');

            console.log(`[HeicConverter] 変換完了: ${file.name} (${formatBytes(file.size)}) → ${newName} (${formatBytes(convertedFile.size)})`);

            return convertedFile;
        } catch (error) {
            console.error('[HeicConverter] 変換エラー:', error);
            throw new Error('HEIC画像の変換に失敗しました: ' + error.message);
        }
    }

    /**
     * 必要であればファイルを変換し、そうでなければそのまま返す
     * @param {File} file - 画像ファイル
     * @param {Object} options - オプション
     * @returns {Promise<File>} 変換済みまたはそのままのファイル
     */
    async function convertIfNeeded(file, options = {}) {
        if (isHeic(file)) {
            return convert(file, options);
        }
        return file;
    }

    /**
     * バイト数を読みやすい形式にフォーマット
     */
    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    return { isHeic, convert, convertIfNeeded };
})();
