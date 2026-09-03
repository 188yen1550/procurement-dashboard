/**
 * 檔案用途：品項詳情頁的 View Model 與轉換函式。
 *
 * ## 為什麼保留這個檔案，而不是改用 api/product.mapper.ts 的 ProductDetailModel
 *
 * 詳情頁樣板（233 行）依賴 DetailProduct 的 moq／supplyStability／audience／
 * historicalNote／trendDirection／aiReasons／risks 等欄位，那些是這一頁特有的
 * 展示需求。硬把它換成共用的 ProductDetailModel 會需要改整份樣板，
 * 而樣板本身沒有問題——為了「型別統一」去改一個能正常運作的頁面是過度工程。
 *
 * 兩者的分工：
 * - api/product.mapper.ts 的 ProductDetailModel：給之後新頁面用的通用模型
 * - 這裡的 DetailProduct：詳情頁專屬，欄位對齊既有樣板
 *
 * ## 這次的改動
 *
 * 只換 import 來源（product-api.contract → api/product-api.contract），
 * 並把原本因為舊 contract 缺欄位而填 0／NOT_PROVIDED 的欄位補成真實值——
 * 後端 ProductResponse 其實有 marketPrice／moq／supplyStability／
 * priceCompetitiveness／targetCustomerDescription，是舊 contract 沒定義而已。
 */
import {
  EvaluationResponsePayload,
  FestivalBoostResponsePayload,
  ProductResponsePayload,
} from '../api/product-api.contract';

export type DetailState = 'default' | 'locked' | 'loading' | 'empty' | 'error';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ItemStatus = 'ACTIVE' | 'ARCHIVED';

/** 詳情頁 View Model：樣板只認識這個型別，不認識後端 DTO。 */
export interface DetailProduct {
  id: number;
  name: string;
  category: string;
  pricingType: 'NEW' | 'RESALE';
  supplier: string;
  reviewStatus: ReviewStatus;
  itemStatus: ItemStatus;
  candidateStatus: string;
  submissionCount: number;
  dataSource: 'SNAPSHOT' | 'LIVE';
  evaluationModeName: string;
  completeness: number;
  baseScore: number | null;
  festivalBoost: number;
  /**
   * ⚠️ 之前樣板把這兩個值寫死成 1.0／0.84，但後端 MatchedCampaignPayload
   * 其實有真實資料（見 api/product-api.contract.ts）。這裡補上正確欄位，
   * matchedCampaign 為 null（沒命中檔期）時兩者皆為 null。
   */
  matchWeight: number | null;
  urgencyFactor: number | null;
  finalScore: number | null;
  campaign: string | null;
  matchedTags: string[];
  costPrice: number | null;
  salePrice: number | null;
  marketPrice: number | null;
  moq: number;
  supplyStability: number;
  priceCompetitiveness: number;
  audienceScore: number;
  audience: string;
  historicalScore: number;
  historicalNote: string;
  purchaseScore: number;
  trendScore: number;
  trendDirection: 'UP' | 'STABLE' | 'DOWN';
  lastSyncedAt: string;
  aiSummary: string | null;
  aiReasons: string[];
  risks: string[];
  description: string;
  imageUrl: string | null;
}

/**
 * 後端目前確實無法提供的欄位一律用這個常數，不要用假資料填補。
 *
 * 對照後端原始碼後，剩下真正拿不到的只有三個：
 * - category：ProductResponse 只有 productTypeId，名稱要對照 GET /api/settings/product-types，
 *   由呼叫端傳入（見 toDetailProduct 的 productTypeName 參數）
 * - historicalNote：後端無此欄位，且 calculateHistoricalScore() 目前回固定值
 * - risks：風險是審核時由主管勾選 risk_options，不是商品屬性，商品 API 不會有
 */
export const NOT_PROVIDED = '（後端尚未提供）';

/** AI 分析與趨勢由 detail 頁另外呼叫，可為 null。 */
export interface DetailExtras {
  aiSummary: string | null;
  aiReasons: string[];
  trendDirection: 'UP' | 'STABLE' | 'DOWN';
  lastSyncedAt: string;
}

export function toDetailProduct(
  product: ProductResponsePayload,
  evaluation: EvaluationResponsePayload | null,
  festival: FestivalBoostResponsePayload | null,
  productTypeName: string = NOT_PROVIDED,
  extras?: Partial<DetailExtras>,
): DetailProduct {
  return {
    id: product.id,
    name: product.name,
    category: productTypeName,
    pricingType: product.pricingType,
    supplier: product.supplierName ?? NOT_PROVIDED,
    reviewStatus: product.reviewStatus,
    itemStatus: product.itemStatus,
    candidateStatus: product.candidateStatus,
    submissionCount: product.submissionCount,
    // 資料來源以後端回傳為準，不要用 reviewStatus 反推。
    dataSource: evaluation?.dataSource ?? 'LIVE',
    evaluationModeName: evaluation?.evaluationModeName ?? NOT_PROVIDED,
    // ⚠️ 完整度只在 evaluation。ProductResponse 沒有 completenessPercent 這個欄位
    //（舊 contract 誤以為有），evaluation 載入失敗時只能顯示 0。
    completeness: evaluation?.dataCompleteness ?? 0,
    baseScore: evaluation?.totalScore ?? null,
    // 分數一律以 evaluation 為單一真實來源；festival-boost 只取檔期明細，
    // 避免兩支 API 不同步時畫面出現互相矛盾的數字。
    festivalBoost: evaluation?.festivalBoost ?? 0,
    finalScore: evaluation?.finalScore ?? null,
    campaign: festival?.matchedCampaign?.campaignName ?? null,
    matchedTags: festival?.matchedCampaign?.matchedTags ?? [],
    matchWeight: festival?.matchedCampaign?.matchWeight ?? null,
    urgencyFactor: festival?.matchedCampaign?.urgencyFactor ?? null,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    // ⚠️ 僅 RESALE 有值；NEW 商品後端會拒絕寫入市價。
    marketPrice: product.marketPrice,
    moq: product.moq ?? 0,
    // ⚠️ 0–5 分制，不是百分比。樣板若當成 % 顯示會變成「5%」這種錯誤數字。
    supplyStability: product.supplyStability ?? 0,
    priceCompetitiveness: product.priceCompetitiveness ?? 0,
    audienceScore: evaluation?.audienceScore ?? 0,
    audience: product.targetCustomerDescription ?? NOT_PROVIDED,
    historicalScore: evaluation?.historicalScore ?? 0,
    historicalNote: NOT_PROVIDED,
    purchaseScore: evaluation?.purchaseScore ?? 0,
    trendScore: evaluation?.trendScore ?? 0,
    // 趨勢方向與同步時間來自 POST /api/products/{id}/trend/sync，
    // 那支有外部呼叫成本，不在頁面載入時觸發，所以預設 STABLE。
    trendDirection: extras?.trendDirection ?? 'STABLE',
    lastSyncedAt: extras?.lastSyncedAt ?? '',
    aiSummary: extras?.aiSummary ?? null,
    aiReasons: extras?.aiReasons ?? [],
    // 風險是審核時由主管勾選 risk_options 的結果，不是商品屬性，
    // 商品相關 API 永遠不會有這個欄位。要顯示請改讀審核紀錄。
    risks: [],
    description: product.description ?? '',
    imageUrl: product.imageUrl,
  };
}
