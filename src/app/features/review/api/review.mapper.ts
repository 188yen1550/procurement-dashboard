import { ReviewDecision } from '../../../core/domain/enums';
import { splitCampaignTags } from '../../../core/domain/labels';
import {
  MatchedCampaignPayload,
  WeatherBoostDetailPayload,
} from '../../product-management/api/product-api.contract';
import {
  NOT_PROVIDED,
  ProductListItem,
  toProductListItem,
} from '../../product-management/api/product.mapper';
import { RiskOptionResponsePayload } from '../../settings/api/settings-api.contract';
import {
  ReviewDetailResponsePayload,
  ReviewRecordResponsePayload,
  ReviewSubmitRequestPayload,
} from './review-api.contract';

/**
 * 審核模組的 payload ↔ View Model 轉換。純函式，可直接單元測試。
 *
 * 這個模組需要 mapper 的實質理由：
 * 1. ReviewDetailResponse 是扁平的 30 個欄位，畫面是分區塊的（商品／分數／AI／風險）
 * 2. ReviewRecordResponse 的 snapshot 欄位命名不一致，需要在這裡統一
 * 3. riskOptionIds → 名稱需要外部對照
 */

// =========================================================================
// 待審清單
// =========================================================================

/**
 * GET /api/reviews/pending 回的是 ProductResponse，
 * 與品項清單同一個 DTO，所以直接沿用 ProductListItem，不另外定義型別。
 *
 * ⚠️ 舊版前端自訂的 ReviewItem 有四個後端根本沒有的欄位：
 * finalScore（在 evaluation 端點）、completeness（同上）、
 * submittedBy（只有 createdBy 編號、無姓名 API）、riskLevel（後端完全沒有）。
 * 那個型別是憑空設計的，不要再用。待審清單能顯示的就是 ProductResponse 有的欄位。
 */
export type PendingReviewItem = ProductListItem;

export const toPendingReviewItem = toProductListItem;

// =========================================================================
// 審核詳情
// =========================================================================

export interface ReviewScoreBreakdown {
  businessScore: number | null;
  audienceScore: number | null;
  historicalScore: number | null;
  purchaseScore: number | null;
  trendScore: number | null;
  forecastScore: number | null;
  /** Base Score。 */
  totalScore: number | null;
  festivalBoost: number | null;
  /** V26 天氣加成；null＝V26 前或尚未計算。 */
  weatherBoost: number | null;
  finalScore: number | null;
  dataCompleteness: number | null;
  evaluationModeName: string;
  evaluationModeVersion: number | null;
}

export interface ReviewAiSection {
  /** false 時顯示 Empty 狀態，不是錯誤。 */
  hasAnalysis: boolean;
  summary: string;
  recommendation: string;
  reasons: string;
}

export interface ReviewDetailModel {
  productId: number;
  productName: string;
  productTypeId: number | null;
  productTypeName: string;
  pricingType: string;
  supplierName: string;
  campaignTags: string[];
  /** ⚠️ > 1 時畫面要提示「這是第 N 次送審」。 */
  submissionCount: number;
  isResubmission: boolean;

  scores: ReviewScoreBreakdown;
  matchedCampaign: MatchedCampaignPayload | null;
  /** V26：審核頁即時計算的天氣加成明細；沒有時不顯示天氣區塊。 */
  weatherDetail: WeatherBoostDetailPayload | null;
  ai: ReviewAiSection;

  /** ⚠️ 只含啟用中的選項，直接用這份渲染勾選清單。 */
  availableRiskOptions: RiskOptionResponsePayload[];
}

export function toReviewDetailModel(
  payload: ReviewDetailResponsePayload,
  productTypeName: string = NOT_PROVIDED,
): ReviewDetailModel {
  const hasAnalysis =
    (payload.aiSummary ?? '').trim() !== '' ||
    (payload.aiRecommendation ?? '').trim() !== '' ||
    (payload.aiReasons ?? '').trim() !== '';

  return {
    productId: payload.product.id,
    productName: payload.product.name,
    productTypeId: payload.product.productTypeId,
    productTypeName,
    pricingType: payload.product.pricingType,
    supplierName: payload.product.supplierName ?? NOT_PROVIDED,
    campaignTags: splitCampaignTags(payload.product.campaignTags),
    submissionCount: payload.submissionCount,
    isResubmission: payload.submissionCount > 1,

    scores: {
      businessScore: payload.businessScore,
      audienceScore: payload.audienceScore,
      historicalScore: payload.historicalScore,
      purchaseScore: payload.purchaseScore,
      trendScore: payload.trendScore,
      forecastScore: payload.forecastScore,
      totalScore: payload.totalScore,
      festivalBoost: payload.festivalBoost,
      weatherBoost: payload.weatherBoost ?? null,
      finalScore: payload.finalScore,
      dataCompleteness: payload.dataCompleteness,
      evaluationModeName: payload.evaluationModeName ?? NOT_PROVIDED,
      evaluationModeVersion: payload.evaluationModeVersion,
    },

    matchedCampaign: payload.matchedCampaign,
    weatherDetail: payload.weatherBoostDetail ?? null,

    ai: {
      hasAnalysis,
      summary: payload.aiSummary ?? '',
      recommendation: payload.aiRecommendation ?? '',
      reasons: payload.aiReasons ?? '',
    },

    availableRiskOptions: payload.availableRiskOptions ?? [],
  };
}

// =========================================================================
// 提交審核
// =========================================================================

/** 審核表單的狀態。decision 用空字串代表尚未選擇，對應「必須明確選擇」的規則。 */
export interface ReviewFormModel {
  productId: number;
  decision: ReviewDecision | '';
  selectedRiskOptionIds: number[];
  reviewComment: string;
  /**
   * 勾選「其他」時的補充說明。2026-09-20起送到後端獨立欄位 otherRiskNote，
   * 不再併入 reviewComment（見 toReviewSubmitPayload()）。
   */
  otherNote: string;
}

/**
 * 系統預設「其他」選項目前的顯示名稱，僅供 mock 資料與測試 fixture 使用。
 * ⚠️ 2026-09-20起，是否為「其他」改用 RiskOptionResponsePayload.isFreeTextOption
 * 欄位識別（見 validateReviewForm()），不再靠這個名稱字串比對——名稱只是
 * 畫面顯示文字，管理層在設定頁把選項改名不應該影響邏輯判斷。
 */
export const OTHER_RISK_OPTION_NAME = '其他';

export interface ReviewFormValidationResult {
  valid: boolean;
  /** 第一個未通過的規則訊息，null 代表通過。 */
  message: string | null;
}

/**
 * 送出前的前端驗證。
 *
 * ⚠️ 後端 ReviewSubmitRequest 對 riskOptionIds／reviewComment **刻意不加驗證**
 * （DTO 註解說明「通過且無風險」是合法結果）。下列三條規則來自企劃書，
 * 完全由前端負責，後端不會擋：
 *
 * 1. 必須明確選擇 APPROVED 或 REJECTED（human-in-the-loop 的核心）
 * 2. 勾選「其他」風險時必須填備註
 * 3. 必須填寫審核留言（決策依據要可追蹤）
 *
 * 寫成獨立純函式而非塞在元件裡，是為了讓這三條規則能被單元測試涵蓋——
 * 這是審核流程的把關點，值得測。
 */
export function validateReviewForm(
  form: ReviewFormModel,
  availableRiskOptions: readonly RiskOptionResponsePayload[],
): ReviewFormValidationResult {
  if (form.decision === '') {
    return { valid: false, message: '請選擇審核結果（通過或不通過）。' };
  }

  // 2026-09-20改用 isFreeTextOption 欄位識別，取代原本的 name === '其他'
  // 名稱比對——名稱只是顯示文字，被改名就會讓判斷失準，見後端 V9 migration
  // 與 RiskOption.isFreeTextOption 的類別註解。
  const otherOption = availableRiskOptions.find((option) => option.isFreeTextOption === true);
  const hasOtherSelected =
    otherOption !== undefined && form.selectedRiskOptionIds.includes(otherOption.id);

  if (hasOtherSelected && form.otherNote.trim() === '') {
    return { valid: false, message: '勾選「其他」風險時必須填寫補充說明。' };
  }

  if (form.reviewComment.trim() === '') {
    return { valid: false, message: '請填寫本次審核留言與決策依據。' };
  }

  return { valid: true, message: null };
}

/**
 * 表單 → POST /api/reviews 的 body。
 *
 * 2026-09-20修正：otherNote 現在直接送到後端的獨立欄位 otherRiskNote
 * （見 ReviewSubmitRequest.java），不再併入 reviewComment。舊版因為後端
 * 沒有獨立欄位存它，必須用固定前綴字串拼接才能保留使用者填的內容；
 * 後端補上欄位後這裡的 workaround 就可以拿掉，reviewComment 恢復成
 * 單純的審核留言，不再夾帶其他風險的說明。
 */
export function toReviewSubmitPayload(form: ReviewFormModel): ReviewSubmitRequestPayload {
  if (form.decision === '') {
    throw new Error('decision 未選擇，送出前應由 validateReviewForm() 擋下');
  }

  return {
    productId: form.productId,
    reviewStatus: form.decision,
    // 沒勾就送空陣列，不要送 null——後端 List<Long> 收 null 雖然不會爆，
    // 但語意上「沒有勾選」與「欄位缺漏」應該區分。
    riskOptionIds: [...form.selectedRiskOptionIds],
    reviewComment: form.reviewComment.trim() || null,
    otherRiskNote: form.otherNote.trim() || null,
  };
}

// =========================================================================
// 決策紀錄
// =========================================================================

export interface ReviewRecordModel {
  id: number;
  productId: number;
  /** 來自快照，是審核當下的名稱。 */
  productName: string;
  reviewerId: number | null;
  /** 2026-09-17後端補上 reviewerName，見 review-api.contract.ts 的類別註解。 */
  reviewerName: string | null;
  submissionCount: number | null;
  reviewStatus: ReviewDecision;
  reviewedAt: string | null;
  reviewComment: string;
  /**
   * 勾選「其他」風險選項時的補充說明（2026-09-20新增）。未勾選「其他」時為 null，
   * 不再是併入 reviewComment 的固定前綴字串，見 toReviewRecordModel()。
   */
  otherRiskNote: string | null;

  /** 全部是審核當下的凍結值，畫面建議統一標示「此為審核當下的數據」。 */
  businessScore: number | null;
  audienceScore: number | null;
  historicalScore: number | null;
  purchaseScore: number | null;
  trendScore: number | null;
  forecastScore: number | null;
  totalScore: number | null;
  festivalBoost: number | null;
  /** V26：審核當時的天氣加成；V26 前的紀錄為 null。 */
  weatherBoost: number | null;
  finalScore: number | null;
  dataCompleteness: number | null;

  evaluationModeName: string;
  matchedCampaign: MatchedCampaignPayload | null;
  aiSummary: string;
  riskOptionIds: number[];
  /** 由 RiskOptionLookupService 對照後填入；未對照時為空陣列。 */
  riskOptionNames: string[];
}

/**
 * 後端 ReviewRecordResponse → 決策紀錄列。
 *
 * 這裡把 festivalBoostSnapshot／finalScoreSnapshot 的 Snapshot 後綴**拿掉**，
 * 統一成 festivalBoost／finalScore。理由：整個 DTO 都是快照，
 * 只有兩個欄位帶後綴反而讓人誤以為其他欄位是即時值。
 * 「這些是快照」用畫面標示說明，不靠欄位名稱。
 */
export function toReviewRecordModel(
  payload: ReviewRecordResponsePayload,
  riskOptionNames: string[] = [],
): ReviewRecordModel {
  return {
    id: payload.id,
    productId: payload.productId,
    productName: payload.productName ?? NOT_PROVIDED,
    reviewerId: payload.reviewerId,
    reviewerName: payload.reviewerName,
    submissionCount: payload.submissionCount,
    reviewStatus: payload.reviewStatus,
    reviewedAt: payload.reviewedAt,
    reviewComment: payload.reviewComment ?? '',
    otherRiskNote: payload.otherRiskNote ?? null,

    businessScore: payload.businessScore,
    audienceScore: payload.audienceScore,
    historicalScore: payload.historicalScore,
    purchaseScore: payload.purchaseScore,
    trendScore: payload.trendScore,
    forecastScore: payload.forecastScore,
    totalScore: payload.totalScore,
    festivalBoost: payload.festivalBoostSnapshot,
    weatherBoost: payload.weatherBoostSnapshot ?? null,
    finalScore: payload.finalScoreSnapshot,
    dataCompleteness: payload.dataCompleteness,

    evaluationModeName: payload.evaluationModeName ?? NOT_PROVIDED,
    matchedCampaign: payload.matchedCampaignSnapshot,
    aiSummary: payload.aiSummarySnapshot ?? '',
    riskOptionIds: payload.riskOptionIds ?? [],
    riskOptionNames,
  };
}
