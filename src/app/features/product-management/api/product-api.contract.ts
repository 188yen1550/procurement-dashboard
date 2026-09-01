import { Decimal, IsoDateTime } from '../../../core/api/api-envelope';
import { PageQuery } from '../../../core/api/unwrap';
import {
  CandidateStatus,
  DataSource,
  ItemStatus,
  PricingStatus,
  PricingType,
  ReviewStatus,
  TrendDirection,
} from '../../../core/domain/enums';

/**
 * 品項模組的 API contract。只放 endpoint 與後端 DTO 的形狀，不放 View Model、不放 UI 邏輯。
 *
 * 端點來源逐一對照過後端原始碼：
 * - ProductController（/api/products/**）
 * - ScoringController（evaluation、festival-boost，路徑掛在 /api/products 下但屬不同 Controller）
 * - TrendController（trend/sync）
 * - AiSelectionController（ai-analysis、ai-analysis/generate）
 * - ReviewController.getProductReviewHistory（/api/products/{id}/reviews）
 *
 * 命名規則：後端→前端以 ResponsePayload 結尾，前端→後端以 RequestPayload 結尾。
 */

export const PRODUCT_API = {
  list: '/api/products',
  aiSuggested: '/api/products/ai-suggested',
  create: '/api/products',
  detail: (id: number | string) => `/api/products/${id}`,
  image: (id: number | string) => `/api/products/${id}/image`,
  evaluation: (id: number | string) => `/api/products/${id}/evaluation`,
  festivalBoost: (id: number | string) => `/api/products/${id}/festival-boost`,
  aiAnalysis: (id: number | string) => `/api/products/${id}/ai-analysis`,
  aiAnalysisGenerate: (id: number | string) => `/api/products/${id}/ai-analysis/generate`,
  trendSync: (id: number | string) => `/api/products/${id}/trend/sync`,
  reviewHistory: (id: number | string) => `/api/products/${id}/reviews`,
  resubmit: (id: number | string) => `/api/products/${id}/resubmit`,
  archive: (id: number | string) => `/api/products/${id}/archive`,
  restore: (id: number | string) => `/api/products/${id}/restore`,
  promote: (id: number | string) => `/api/products/${id}/promote-to-candidate`,
} as const;

// =========================================================================
// Response Payload
// =========================================================================

/**
 * 對應後端 ProductResponse.java，逐欄核對過。
 * GET /api/products（清單）與 GET /api/products/{id}（詳情）回傳同一個 DTO，
 * 清單不會少欄位，所以前端不需要為兩者分開定義型別。
 *
 * ⚠️ 這個 DTO **不含分數**。ProductResponse.java 類別註解明確寫著
 * 「只回傳 products 表本身的欄位，評估分數／趨勢／AI 屬於其他 Service 的職責」。
 * 清單頁若要顯示 finalScore，只能：
 *   (a) 請後端在清單端點併帶，或
 *   (b) 改成不顯示分數
 * **絕對不要**逐筆呼叫 /evaluation ——20 筆就是 20 個請求的 N+1。
 */
export interface ProductResponsePayload {
  id: number;
  productTypeId: number | null;
  pricingType: PricingType;
  name: string;
  description: string | null;
  /** 例 "/images/products/xxx.jpg"，可為 null（選填欄位）。 */
  imageUrl: string | null;
  supplierName: string | null;
  costPrice: Decimal;
  salePrice: Decimal;
  /** ⚠️ 僅 RESALE 有值，NEW 商品後端會拒絕寫入。 */
  marketPrice: Decimal;
  /** ⚠️ 半形逗號分隔字串，非陣列。用 splitCampaignTags() 處理。 */
  campaignTags: string | null;
  moq: number | null;
  /** 0–5 的評分，不是百分比。 */
  supplyStability: Decimal;
  /** 0–5 的評分，不是百分比。 */
  priceCompetitiveness: Decimal;
  targetCustomerDescription: string | null;
  /** ⚠️ 0–1 的小數（0.8 代表 80%），顯示時要 ×100。 */
  estimatedPurchaseRate: Decimal;
  reviewStatus: ReviewStatus;
  candidateStatus: CandidateStatus;
  pricingStatus: PricingStatus;
  itemStatus: ItemStatus;
  submissionCount: number;
  /** ⚠️ 只有使用者編號、沒有姓名，且後端沒有以 id 查姓名的 API。目前顯示不了「由誰建立」。 */
  createdBy: number | null;
  /**
   * ⚠️ 後端這次補上的欄位：由 ProductService／ReviewService 批次查詢
   * app_users 後填入，找不到對應帳號時為 null（極少見）。
   * 有這個欄位後，畫面應直接顯示它，不要再對 createdBy 做任何前端查詢或猜測。
   */
  createdByName: string | null;
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
  updatedBy: number | null;
}

/** 對應後端 json/WeightFactorSnapshot.java。 */
export interface WeightFactorPayload {
  factorCode: string;
  factorName: string;
  category: string;
  weight: Decimal;
}

/** 對應後端 json/WeightSnapshot.java。權重是唯讀展示，後端沒有修改 API。 */
export interface WeightSnapshotPayload {
  modeCode: string;
  modeName: string;
  version: number;
  factors: WeightFactorPayload[];
}

/** 對應後端 json/MatchedCampaignSnapshot.java。 */
export interface MatchedCampaignPayload {
  campaignId: number;
  campaignName: string;
  matchedTags: string[];
  /** 命中權重：CORE=1.0／GENERAL=0.6／WEAK=0.3。 */
  matchWeight: Decimal;
  /** 急迫係數，越接近檔期越高。 */
  urgencyFactor: Decimal;
}

/**
 * 對應後端 EvaluationResponse.java（GET /api/products/{id}/evaluation）。
 *
 * ⚠️ dataCompleteness 後端只回數值、不做門檻判斷。
 * 「低於 60% 為資料待補」是企劃書規則，由前端依 DATA_COMPLETENESS_THRESHOLD 自行判斷。
 */
export interface EvaluationResponsePayload {
  dataSource: DataSource;
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
  /** Base Score：六項加權後的總分。 */
  totalScore: Decimal;
  /** 百分比數值（0–100）。 */
  dataCompleteness: Decimal;
  festivalBoost: Decimal;
  /** finalScore = totalScore + festivalBoost。 */
  finalScore: Decimal;
}

/**
 * 對應後端 FestivalBoostResponse.java。
 * ⚠️ matchedCampaign 為 null 代表未命中任何檔期，整個節慶區塊不顯示
 * （不是顯示空白表格）。
 */
export interface FestivalBoostResponsePayload {
  dataSource: DataSource;
  matchedCampaign: MatchedCampaignPayload | null;
  festivalBoost: Decimal;
  finalScore: Decimal;
}

/**
 * 對應後端 AiAnalysisResponse.java。
 *
 * ⚠️ 沒有 AI 分析時，後端回的是 **200 + 全欄位 null 的物件**，不是 404
 * （見 AiSelectionService.getAiAnalysisResponse()）。
 * 前端要判斷 summary === null 顯示 Empty 狀態，不要當 API 錯誤處理。
 *
 * ⚠️ modelName 若為 "MOCK-LLM-v1" 代表是開發階段的模擬資料，
 * 內容會帶「【模擬資料】」字樣，畫面上建議標示出來避免誤導。
 */
export interface AiAnalysisResponsePayload {
  summary: string | null;
  recommendation: string | null;
  reasons: string | null;
  modelName: string | null;
  generatedAt: IsoDateTime | null;
}

/**
 * 對應後端 json/TrendSnapshot.java，POST /api/products/{id}/trend/sync 的回傳。
 * ⚠️ collectedAt 後端型別是 String 不是 LocalDateTime，需要自己 parse。
 */
export interface TrendSnapshotPayload {
  /** 目前固定 "SIMULATED"。 */
  source: string | null;
  keyword: string | null;
  trendScore: Decimal;
  popularityScore: Decimal;
  trendDirection: TrendDirection | null;
  collectedAt: string | null;
}

// =========================================================================
// Request Payload
// =========================================================================

/**
 * 對應後端 ProductCreateRequest.java。
 * 必填（@NotNull / @NotBlank）：productTypeId、pricingType、name。
 *
 * ⚠️ 不能送狀態欄位（reviewStatus / itemStatus / candidateStatus / submissionCount），
 * 由後端決定，送了也無效。
 *
 * ⚠️ marketPrice 只有 RESALE 能填，NEW 商品填了後端回 400
 * 「市售價格僅適用於再販售(RESALE)商品」。
 *
 * ⚠️ 後端不檢查商品名稱重複（同名可能合法），防止手滑送兩次是前端責任。
 */
export interface ProductCreateRequestPayload {
  productTypeId: number;
  pricingType: PricingType;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  supplierName?: string | null;
  costPrice?: number | null;
  salePrice?: number | null;
  marketPrice?: number | null;
  campaignTags?: string | null;
  moq?: number | null;
  supplyStability?: number | null;
  priceCompetitiveness?: number | null;
  targetCustomerDescription?: string | null;
  estimatedPurchaseRate?: number | null;
}

/**
 * 對應後端 ProductUpdateRequest.java，欄位與 Create 完全相同。
 *
 * ⚠️ **整份覆蓋，不是部分更新**。沒送的欄位會變成 null。
 * 正確流程：先 GET /api/products/{id} → 改動使用者編輯的部分 → 整份送回。
 *
 * ⚠️ reviewStatus === 'APPROVED' 的商品若異動下列任一「選品核心資料」，後端回 409：
 * productTypeId／pricingType／costPrice／salePrice／campaignTags／moq／
 * supplyStability／priceCompetitiveness／targetCustomerDescription／estimatedPurchaseRate
 * 前端應把這些欄位設為唯讀，而不是等使用者送出才吃 409。
 */
export type ProductUpdateRequestPayload = ProductCreateRequestPayload;

/**
 * GET /api/products 的查詢參數，逐一對照 ProductController.search()。
 *
 * ⚠️ candidateStatus 不帶時，ProductService 內部預設帶入 CANDIDATE。
 * 主清單不要主動送 AI_SUGGESTED——查看 AI 建議一律走獨立的
 * GET /api/products/ai-suggested，避免兩個入口重疊。
 *
 * ⚠️ 三種狀態是三個獨立維度，不是互斥選項。一個商品可以同時是
 * 「已通過 + 已封存 + 正式候選」，篩選 UI 要做成三個獨立下拉。
 */
export interface ProductListQuery extends PageQuery {
  keyword?: string;
  reviewStatus?: ReviewStatus;
  itemStatus?: ItemStatus;
  candidateStatus?: CandidateStatus;
  productTypeId?: number;
}
