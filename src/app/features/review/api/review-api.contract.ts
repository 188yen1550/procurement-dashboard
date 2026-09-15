import { Decimal, IsoDateTime } from '../../../core/api/api-envelope';
import { PageQuery } from '../../../core/api/unwrap';
import { ReviewDecision, ScoreLevel } from '../../../core/domain/enums';
import {
  MatchedCampaignPayload,
  ProductResponsePayload,
  TrendSnapshotPayload,
  WeightSnapshotPayload,
} from '../../product-management/api/product-api.contract';
import { RiskOptionResponsePayload } from '../../settings/api/settings-api.contract';

/**
 * 選品審核模組的 API contract，對應後端 ReviewController。
 *
 * ⚠️ ReviewController 沒有類別層級 @RequestMapping，四支端點在 /api/reviews/*、
 * 一支在 /api/products/{id}/reviews。路徑不是統一前綴，不要自己組。
 *
 * ## 權限
 * - /api/reviews/pending、/{productId}、POST /api/reviews、/decision-records
 *   → @PreAuthorize("hasRole('MANAGER')")，操作層呼叫收 403
 * - GET /api/products/{id}/reviews
 *   → **沒有** @PreAuthorize，操作層也能看，放在品項詳情頁沒問題
 *   （這支定義在 product-api.contract.ts，因為路徑屬於 /api/products）
 */

export const REVIEW_API = {
  pending: '/api/reviews/pending',
  detail: (productId: number | string) => `/api/reviews/${productId}`,
  submit: '/api/reviews',
  decisionRecords: '/api/reviews/decision-records',
} as const;

/** GET /api/reviews/pending 的查詢參數。後端只吃 Pageable，沒有其他篩選。 */
export type PendingReviewQuery = PageQuery;

/**
 * 對應後端 ReviewDetailResponse.java。
 *
 * 這是全專案唯一「一支 API 回傳整頁所需資料」的端點——
 * 審核頁不需要另外呼叫 evaluation／festival-boost／ai-analysis 去拼湊。
 * 前端不要為了「統一」而改用多支組合，那會多打三個請求且可能取到
 * 與審核當下不一致的資料。
 */
export interface ReviewDetailResponsePayload {
  /** 完整的 ProductResponse，不是精簡版。 */
  product: ProductResponsePayload;
  /** ⚠️ > 1 時要提示「這是第 N 次送審」。 */
  submissionCount: number;
  dataCompleteness: Decimal;

  evaluationModeId: number | null;
  evaluationModeName: string | null;
  evaluationModeVersion: number | null;
  weights: WeightSnapshotPayload | null;

  businessScore: Decimal;
  audienceScore: Decimal;
  historicalScore: Decimal;
  purchaseScore: Decimal;
  trendScore: Decimal;
  forecastScore: Decimal;
  /** Base Score。 */
  totalScore: Decimal;

  festivalBoost: Decimal;
  /** 可為 null（未命中檔期），整個節慶區塊不顯示。 */
  matchedCampaign: MatchedCampaignPayload | null;
  finalScore: Decimal;

  /** 三個 AI 欄位都可能為 null（尚未生成分析）。 */
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiReasons: string | null;

  /**
   * ⚠️ 給使用者勾選的風險選項清單，**只含目前啟用中的**。
   * 不要改用 GET /api/settings/risk-options（那份含已停用）。
   * 勾選後把 id 收集起來，送出時放進 riskOptionIds。
   */
  availableRiskOptions: RiskOptionResponsePayload[];
}

/**
 * 對應後端 ReviewSubmitRequest.java。
 *
 * 必填（@NotNull）：productId、reviewStatus。
 * riskOptionIds／reviewComment 後端刻意不加 @NotEmpty／@NotBlank——
 * 「通過且無風險」是合法的審核結果。
 *
 * ⚠️ 但企劃書要求「選擇其他風險時必須填備註」「必須填審核留言」，
 * 這兩條是**前端驗證**，後端不擋。不要因為後端沒擋就省略前端驗證。
 *
 * ⚠️ reviewStatus 用的是 ReviewRecordReviewStatus（只有 APPROVED／REJECTED），
 * 不是 ProductReviewStatus（含 PENDING）。送 PENDING 會被 enum 轉換擋成 400。
 */
export interface ReviewSubmitRequestPayload {
  productId: number;
  reviewStatus: ReviewDecision;
  /** 沒勾就送空陣列，不要送 null 或省略。 */
  riskOptionIds: number[];
  reviewComment?: string | null;
}

/**
 * 對應後端 json/ProductSnapshot.java。
 * 審核當下的商品資料凍結值，與商品「現在」的資料可能不同。
 */
export interface ProductSnapshotPayload {
  name: string | null;
  pricingType: string | null;
  costPrice: Decimal;
  salePrice: Decimal;
  campaignTags: string | null;
  moq: number | null;
  /** ⚠️ 後端 V6 migration 已改成 1–5 整數等級，不再是 0–5 分制小數。 */
  supplyStability: ScoreLevel | null;
  /** ⚠️ 後端 V6 migration 已改成 1–5 整數等級，不再是 0–5 分制小數。 */
  priceCompetitiveness: ScoreLevel | null;
  targetCustomerDescription: string | null;
  estimatedPurchaseRate: Decimal;
}

/**
 * 對應後端 ReviewRecordResponse.java。
 * GET /api/reviews/decision-records（Page）與
 * GET /api/products/{id}/reviews（List）共用同一個 DTO。
 *
 * ## ⚠️ 欄位命名的兩套規則，容易誤用
 *
 * 分數欄位有兩種命名，代表的意義**相同**（都是審核當下的快照），
 * 但後端沒有統一命名：
 * - businessScore ~ totalScore：**沒有** Snapshot 後綴，但仍是快照
 * - festivalBoostSnapshot／finalScoreSnapshot：有後綴
 *
 * 不要因為 totalScore 沒有後綴就以為它是即時值。整個 ReviewRecordResponse
 * 都是審核當下的凍結資料，畫面上建議統一標示「此為審核當下的數據」。
 *
 * ## ⚠️ reviewerId 顯示不了
 * 只有編號沒有姓名，且後端沒有「以 id 查使用者」的端點
 * （GET /api/users 是僅管理且回全部帳號，不是為此設計的）。
 * 決策紀錄目前無法顯示「誰審的」，這是已知缺口，需與後端討論補欄位。
 */
export interface ReviewRecordResponsePayload {
  id: number;
  productId: number;
  /** 來自快照，是審核當下的商品名稱，可能與現在不同。 */
  productName: string | null;
  reviewerId: number | null;
  submissionCount: number | null;
  reviewStatus: ReviewDecision;
  reviewedAt: IsoDateTime | null;

  evaluationModeId: number | null;
  evaluationModeName: string | null;
  evaluationModeVersion: number | null;

  businessScore: Decimal;
  audienceScore: Decimal;
  historicalScore: Decimal;
  purchaseScore: Decimal;
  trendScore: Decimal;
  forecastScore: Decimal;
  totalScore: Decimal;

  festivalBoostSnapshot: Decimal;
  matchedCampaignSnapshot: MatchedCampaignPayload | null;
  finalScoreSnapshot: Decimal;
  dataCompleteness: Decimal;

  weightSnapshot: WeightSnapshotPayload | null;
  productSnapshot: ProductSnapshotPayload | null;
  /** 後端把 summary/recommendation/reasons 合併成一段文字。 */
  aiSummarySnapshot: string | null;
  trendSnapshot: TrendSnapshotPayload | null;

  reviewComment: string | null;
  /** ⚠️ 只有 id，要顯示名稱得用 RiskOptionLookupService 對照。 */
  riskOptionIds: number[] | null;

  /** ⚠️ 紀錄本身的建立時間，與 reviewedAt 語意不同，畫面通常用 reviewedAt。 */
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
}

export type DecisionRecordQuery = PageQuery;
