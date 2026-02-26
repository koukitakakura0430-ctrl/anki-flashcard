/**
 * SM-2 (SuperMemo-2) アルゴリズム
 * 忘却曲線に基づく間隔反復学習
 */
const SM2 = (() => {
  /**
   * 次回復習パラメータを計算
   * @param {number} quality - 評価値 (0-5)
   *   0: 完全に忘れた
   *   1: 間違えた
   *   2: 間違えたがすぐ思い出した
   *   3: 思い出すのに時間がかかった
   *   4: 少し迷ったが正解
   *   5: 完璧に覚えていた
   * @param {number} repetitionCount - 連続正解回数
   * @param {number} easinessFactor - 容易度 (最小 1.3)
   * @param {number} interval - 現在の間隔 (日数)
   * @returns {Object} { repetitionCount, easinessFactor, interval, nextReviewDate }
   */
  function calculate(quality, repetitionCount = 0, easinessFactor = 2.5, interval = 0) {
    quality = Math.max(0, Math.min(5, Math.round(quality)));

    let newEF = easinessFactor;
    let newInterval = interval;
    let newRepCount = repetitionCount;

    if (quality >= 3) {
      // 正解
      newRepCount += 1;

      if (newRepCount === 1) {
        newInterval = 1;
      } else if (newRepCount === 2) {
        newInterval = 6;
      } else {
        newInterval = Math.round(interval * easinessFactor);
      }

      // EF更新
      newEF = easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    } else {
      // 不正解 → リセット
      newRepCount = 0;
      newInterval = 1;
    }

    // EFの下限
    newEF = Math.max(1.3, newEF);

    // 次回復習日を計算
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + newInterval);
    const nextReviewDate = nextDate.toISOString();

    return {
      repetitionCount: newRepCount,
      easinessFactor: Math.round(newEF * 100) / 100,
      interval: newInterval,
      nextReviewDate: nextReviewDate
    };
  }

  /**
   * カードリストから今日復習すべきカードを抽出
   * @param {Array} cards - カード配列
   * @returns {Array} 復習対象カード
   */
  function getDueCards(cards) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return cards.filter(card => {
      if (!card.next_review_date) return true;
      const reviewDate = new Date(card.next_review_date);
      return reviewDate <= now;
    });
  }

  /**
   * 評価ボタンのラベルと色を返す
   * @returns {Array} ボタン情報配列
   */
  function getRatingButtons() {
    return [
      { quality: 1, label: 'もう一度', emoji: '😣', className: 'rating-again' },
      { quality: 3, label: '難しい', emoji: '😐', className: 'rating-hard' },
      { quality: 4, label: '普通', emoji: '😊', className: 'rating-good' },
      { quality: 5, label: '簡単', emoji: '😎', className: 'rating-easy' }
    ];
  }

  return { calculate, getDueCards, getRatingButtons };
})();
