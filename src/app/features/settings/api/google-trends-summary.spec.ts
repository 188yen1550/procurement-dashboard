/**
 * 檔案用途：驗證 Google 趨勢一行摘要（AI 建議清單、熱度排行榜共用）：
 * 沒查過與查無資料都要明講，不能顯示成 0 或「持平」。
 */
import { GoogleTrendSignal, summarizeGoogleTrend } from './google-trends-api.service';

const BASE: GoogleTrendSignal = {
  productId: 1,
  keyword: '蛋捲',
  status: 'OK',
  direction: 'UP',
  growthRate: 25.71,
  recentAvg: 42.29,
  baselineAvg: 33.64,
  pointCount: 92,
  collectedAt: '2026-09-28T15:24:46',
};

describe('summarizeGoogleTrend', () => {
  it('有資料時顯示方向與四捨五入到一位的成長率（正數帶 +）', () => {
    expect(summarizeGoogleTrend(BASE)).toEqual({ direction: 'UP', text: '+25.7%' });
    expect(summarizeGoogleTrend({ ...BASE, direction: 'DOWN', growthRate: -13.85 })).toEqual({
      direction: 'DOWN',
      text: '-13.9%',
    });
  });

  it('沒查過、查無資料、基準期為 0 各有說法', () => {
    expect(summarizeGoogleTrend(null)).toEqual({ direction: null, text: '尚未查詢' });
    expect(summarizeGoogleTrend({ ...BASE, status: 'NO_DATA', direction: null, growthRate: null })).toEqual({
      direction: null,
      text: '搜尋量不足',
    });
    expect(summarizeGoogleTrend({ ...BASE, growthRate: null })).toEqual({ direction: 'UP', text: '近期開始出現' });
  });
});
