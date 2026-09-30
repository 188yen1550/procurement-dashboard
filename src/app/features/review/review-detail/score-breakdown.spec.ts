/**
 * 檔案用途：驗證審核詳情「因子明細」分組組裝——權重、無資料不計入、自訂因子、缺權重快照。
 */
import { WeightSnapshotPayload } from '../../product-management/api/product-api.contract';
import { ReviewScoreBreakdown } from '../api/review.mapper';
import { buildScoreGroups } from './score-breakdown';

const scores: ReviewScoreBreakdown = {
  businessScore: 60,
  audienceScore: 14.29,
  historicalScore: 75.95,
  purchaseScore: 50,
  trendScore: null,
  forecastScore: 50,
  totalScore: 49.8,
  festivalBoost: 0,
  weatherBoost: 0,
  finalScore: 49.8,
  dataCompleteness: 75,
  evaluationModeName: '均衡模式',
  evaluationModeVersion: 1,
};

const weights: WeightSnapshotPayload = {
  modeCode: 'BALANCED',
  modeName: '均衡模式',
  version: 1,
  factors: [
    { factorCode: 'MARGIN_RATE', factorName: '毛利率（已扣運費）', category: 'BUSINESS', weight: 10 },
    { factorCode: 'DISCOUNT_DEPTH', factorName: '折扣深度', category: 'BUSINESS', weight: 7.5 },
    { factorCode: 'SUPPLY_STABILITY', factorName: '供應穩定性', category: 'BUSINESS', weight: 7.5 },
    { factorCode: 'AUDIENCE_MATCH', factorName: '核心客群匹配度', category: 'AUDIENCE', weight: 25 },
    { factorCode: 'HISTORY_FULFILLMENT', factorName: '歷史成團率', category: 'HISTORY', weight: 25 },
    { factorCode: 'PURCHASE_RATE', factorName: '預估購買率', category: 'FORECAST', weight: 12.5 },
    { factorCode: 'TREND_HEAT', factorName: '市場趨勢熱度', category: 'FORECAST', weight: 12.5 },
  ],
};

describe('buildScoreGroups', () => {
  it('依分組彙總權重，四組合計 100%', () => {
    const groups = buildScoreGroups(scores, weights);
    expect(groups.map((g) => [g.label, g.weight])).toEqual([
      ['商業效益', 25],
      ['客群契合', 25],
      ['歷史表現', 25],
      ['需求預測', 25],
    ]);
  });

  it('商業效益組內因子沒有逐因子分數（以組分呈現），其他因子帶自己的分數', () => {
    const [business, , , forecast] = buildScoreGroups(scores, weights);
    expect(business.rows.every((r) => r.score === undefined)).toBe(true);
    expect(business.score).toBe(60);
    expect(forecast.rows.map((r) => [r.code, r.score, r.source])).toEqual([
      ['PURCHASE_RATE', 50, '人工'],
      ['TREND_HEAT', null, '外部數據'],
    ]);
  });

  it('分組分數為 null 時整組標記為不計入', () => {
    const groups = buildScoreGroups({ ...scores, businessScore: null }, weights);
    expect(groups[0].counted).toBe(false);
    expect(groups[1].counted).toBe(true);
  });

  it('權重為 0 的因子視為未啟用，不列出', () => {
    const zeroTrend: WeightSnapshotPayload = {
      ...weights,
      factors: weights.factors.map((f) => (f.factorCode === 'TREND_HEAT' ? { ...f, weight: 0 } : f)),
    };
    const forecast = buildScoreGroups(scores, zeroTrend).find((g) => g.key === 'FORECAST')!;
    expect(forecast.rows.map((r) => r.code)).toEqual(['PURCHASE_RATE']);
    expect(forecast.weight).toBe(12.5);
  });

  it('自訂因子另列一組，分數標記為此頁未提供', () => {
    const withCustom: WeightSnapshotPayload = {
      ...weights,
      factors: [...weights.factors, { factorCode: 'CUSTOM_1', factorName: '包裝精緻度', category: 'BUSINESS', weight: 5 }],
    };
    const custom = buildScoreGroups(scores, withCustom).at(-1)!;
    expect(custom.key).toBe('CUSTOM');
    expect(custom.rows).toEqual([
      expect.objectContaining({ code: 'CUSTOM_1', name: '包裝精緻度', source: '自訂', weight: 5, score: undefined }),
    ]);
  });

  it('沒有權重快照（尚未評估）時仍列出七個固定因子，權重顯示為 null', () => {
    const groups = buildScoreGroups(scores, null);
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.weight === null)).toBe(true);
    expect(groups.flatMap((g) => g.rows)).toHaveLength(7);
  });

  it('每個分組與因子都有 ? 說明文字', () => {
    const groups = buildScoreGroups(scores, weights);
    expect(groups.every((g) => g.hint.length > 0)).toBe(true);
    expect(groups.flatMap((g) => g.rows).every((r) => r.hint.length > 0)).toBe(true);
    expect(groups[0].hint).toContain('毛利率');
  });
});
