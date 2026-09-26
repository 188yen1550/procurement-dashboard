/**
 * 檔案用途：驗證審核表單的三條前端驗證規則與快照欄位轉換。
 *
 * 這三條規則後端**刻意不驗證**（ReviewSubmitRequest 的註解說明
 * 「通過且無風險」是合法結果），完全由前端把關。
 * 審核是本系統 human-in-the-loop 的核心，這裡出錯等於決策紀錄失去可追蹤性，
 * 所以值得測。
 */
import { RiskOptionResponsePayload } from '../../settings/api/settings-api.contract';
import { ReviewRecordResponsePayload } from './review-api.contract';
import {
  OTHER_RISK_OPTION_NAME,
  ReviewFormModel,
  toReviewRecordModel,
  toReviewSubmitPayload,
  validateReviewForm,
} from './review.mapper';

const RISK_OPTIONS: RiskOptionResponsePayload[] = [
  { id: 1, name: '實際供貨風險', description: null, isSystemDefault: true, alertKeywords: '缺貨、斷貨' },
  { id: 2, name: '商品品質與客訴風險', description: null, isSystemDefault: true, alertKeywords: '瑕疵、客訴' },
  {
    id: 9,
    name: OTHER_RISK_OPTION_NAME,
    description: null,
    isSystemDefault: true,
    alertKeywords: null,
    isFreeTextOption: true,
  },
];

function makeForm(overrides: Partial<ReviewFormModel> = {}): ReviewFormModel {
  return {
    productId: 102,
    decision: 'APPROVED',
    selectedRiskOptionIds: [],
    reviewComment: '節慶需求明確，確認冷鏈排程後通過。',
    otherNote: '',
    ...overrides,
  };
}

describe('validateReviewForm', () => {
  it('完整填寫時通過', () => {
    expect(validateReviewForm(makeForm(), RISK_OPTIONS).valid).toBe(true);
  });

  it('未選擇審核結果時不通過', () => {
    const result = validateReviewForm(makeForm({ decision: '' }), RISK_OPTIONS);

    // AI 只提供建議，最終核准一定要由人明確選擇，不能有預設值。
    expect(result.valid).toBe(false);
    expect(result.message).toContain('審核結果');
  });

  it('勾選「其他」卻未填備註時不通過', () => {
    const result = validateReviewForm(
      makeForm({ selectedRiskOptionIds: [9], otherNote: '   ' }),
      RISK_OPTIONS,
    );

    expect(result.valid).toBe(false);
    expect(result.message).toContain('其他');
  });

  it('勾選「其他」且已填備註時通過', () => {
    const result = validateReviewForm(
      makeForm({ selectedRiskOptionIds: [9], otherNote: '需確認冷鏈倉儲容量' }),
      RISK_OPTIONS,
    );

    expect(result.valid).toBe(true);
  });

  it('未填審核留言時不通過', () => {
    const result = validateReviewForm(makeForm({ reviewComment: '  ' }), RISK_OPTIONS);

    expect(result.valid).toBe(false);
    expect(result.message).toContain('留言');
  });

  it('通過且未勾選任何風險是合法的', () => {
    const result = validateReviewForm(
      makeForm({ selectedRiskOptionIds: [] }),
      RISK_OPTIONS,
    );

    // 後端刻意允許這種情況，前端不要多加一條「至少勾一個」的限制。
    expect(result.valid).toBe(true);
  });
});

describe('toReviewSubmitPayload', () => {
  it('未勾選風險時送空陣列而非 null', () => {
    const payload = toReviewSubmitPayload(makeForm());

    expect(payload.riskOptionIds).toEqual([]);
  });

  it('把「其他」的補充說明送到獨立的 otherRiskNote 欄位', () => {
    const payload = toReviewSubmitPayload(
      makeForm({ selectedRiskOptionIds: [9], otherNote: '需確認冷鏈倉儲容量' }),
    );

    // 2026-09-20修正：後端已補上獨立欄位，不再併入 reviewComment。
    expect(payload.otherRiskNote).toBe('需確認冷鏈倉儲容量');
    expect(payload.reviewComment).not.toContain('需確認冷鏈倉儲容量');
    expect(payload.reviewComment).not.toContain('【其他風險說明】');
  });

  it('沒有補充說明時 otherRiskNote 為 null', () => {
    const payload = toReviewSubmitPayload(makeForm());

    expect(payload.otherRiskNote).toBeNull();
  });

  it('未選擇結果時拋錯，避免送出一定會被 400 的請求', () => {
    expect(() => toReviewSubmitPayload(makeForm({ decision: '' }))).toThrow();
  });
});

describe('toReviewRecordModel', () => {
  function makeRecord(): ReviewRecordResponsePayload {
    return {
      id: 501,
      productId: 101,
      productName: '中秋炭烤海陸組合禮盒',
      reviewerId: 2,
      reviewerName: '審核人 A',
      submissionCount: 1,
      reviewStatus: 'APPROVED',
      reviewedAt: '2026-08-28T14:30:00',
      evaluationModeId: 1,
      evaluationModeName: '均衡模式',
      evaluationModeVersion: 1,
      businessScore: 88,
      audienceScore: 91,
      historicalScore: 84,
      purchaseScore: 86,
      trendScore: 90,
      forecastScore: 87,
      totalScore: 88.2,
      festivalBoostSnapshot: 4.2,
      matchedCampaignSnapshot: null,
      finalScoreSnapshot: 92.4,
      dataCompleteness: 96,
      weightSnapshot: null,
      productSnapshot: null,
      aiSummarySnapshot: null,
      trendSnapshot: null,
      reviewComment: '節慶需求明確。',
      riskOptionIds: [1, 2],
      otherRiskNote: null,
      createdAt: '2026-08-28T14:30:01',
      updatedAt: '2026-08-28T14:30:01',
    };
  }

  it('天氣加成快照：V26 前的紀錄為 null（不是 0），V26 後讀快照值', () => {
    expect(toReviewRecordModel(makeRecord()).weatherBoost).toBeNull();
    expect(toReviewRecordModel({ ...makeRecord(), weatherBoostSnapshot: 1.8 }).weatherBoost).toBe(1.8);
  });

  it('把 Snapshot 後綴的分數欄位統一成一般命名', () => {
    const model = toReviewRecordModel(makeRecord());

    // 後端只有這兩個欄位帶 Snapshot 後綴，其餘分數也是快照卻沒有後綴。
    // 統一命名後，「這些都是快照」由畫面文案說明，不靠欄位名暗示。
    expect(model.festivalBoost).toBe(4.2);
    expect(model.finalScore).toBe(92.4);
  });

  it('未提供對照表時 riskOptionNames 為空，但 ids 仍保留', () => {
    const model = toReviewRecordModel(makeRecord());

    expect(model.riskOptionIds).toEqual([1, 2]);
    expect(model.riskOptionNames).toEqual([]);
  });

  it('提供對照結果時填入風險名稱', () => {
    const model = toReviewRecordModel(makeRecord(), ['實際供貨風險', '商品品質與客訴風險']);

    expect(model.riskOptionNames).toEqual(['實際供貨風險', '商品品質與客訴風險']);
  });

  it('reviewerName 直接透傳後端批次解析好的姓名', () => {
    const model = toReviewRecordModel(makeRecord());

    // 2026-09-17修正：後端 ReviewService.resolveUserNames() 補上批次解析，
    // 不再是前端沒有資料來源的已知缺口，這裡改成驗證有正確透傳，
    // 不要再斷言為 null（那是舊 bug 被誤寫成預期行為）。
    expect(model.reviewerName).toBe('審核人 A');
  });

  it('後端沒有解析出姓名（reviewerName 為 null）時，原樣透傳，不擅自補預設值', () => {
    const model = toReviewRecordModel({ ...makeRecord(), reviewerName: null });

    expect(model.reviewerName).toBeNull();
  });

  it('otherRiskNote 直接透傳，未勾選「其他」時為 null', () => {
    const model = toReviewRecordModel(makeRecord());

    expect(model.otherRiskNote).toBeNull();
  });

  it('勾選「其他」時 otherRiskNote 透傳後端存的補充說明', () => {
    const model = toReviewRecordModel({ ...makeRecord(), otherRiskNote: '需確認冷鏈倉儲容量' });

    expect(model.otherRiskNote).toBe('需確認冷鏈倉儲容量');
  });
});
