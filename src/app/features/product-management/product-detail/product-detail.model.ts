import {
  EvaluationData,
  FestivalBoostData,
  ProductDetailData,
} from '../product-api.contract';

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
}

/**
 * 後端目前 DTO 尚未提供的欄位，一律用這個常數，不要用假資料填補。
 * TODO(backend): marketPrice / moq / supplyStability / priceCompetitiveness /
 * productTypeName / targetCustomerDescription / historicalNote /
 * trendDirection / lastSyncedAt / aiSummary / aiReasons / risks
 */
export const NOT_PROVIDED = '（後端尚未提供）';

export function toDetailProduct(
  product: ProductDetailData,
  evaluation: EvaluationData | null,
  festival: FestivalBoostData | null,
): DetailProduct {
  return {
    id: product.id,
    name: product.name,
    category: NOT_PROVIDED,
    pricingType: product.pricingType,
    supplier: product.supplierName ?? NOT_PROVIDED,
    reviewStatus: product.reviewStatus as ReviewStatus,
    itemStatus: product.itemStatus as ItemStatus,
    candidateStatus: product.candidateStatus,
    submissionCount: product.submissionCount,
    // 資料來源以後端回傳為準，不要用 reviewStatus 反推。
    dataSource: evaluation?.dataSource ?? 'LIVE',
    evaluationModeName: evaluation?.evaluationModeName ?? NOT_PROVIDED,
    completeness: evaluation?.dataCompleteness ?? product.completenessPercent,
    baseScore: evaluation?.totalScore ?? null,
    // 分數一律以 evaluation 為單一真實來源；festival-boost 只取檔期明細。
    festivalBoost: evaluation?.festivalBoost ?? 0,
    finalScore: evaluation?.finalScore ?? null,
    campaign: festival?.matchedCampaign?.campaignName ?? null,
    matchedTags: festival?.matchedCampaign?.matchedTags ?? [],
    costPrice: product.costPrice ?? null,
    salePrice: product.salePrice ?? null,
    marketPrice: null,
    moq: 0,
    supplyStability: 0,
    priceCompetitiveness: 0,
    audienceScore: evaluation?.audienceScore ?? 0,
    audience: NOT_PROVIDED,
    historicalScore: evaluation?.historicalScore ?? 0,
    historicalNote: NOT_PROVIDED,
    purchaseScore: evaluation?.purchaseScore ?? 0,
    trendScore: evaluation?.trendScore ?? 0,
    trendDirection: 'STABLE',
    lastSyncedAt: '',
    aiSummary: null,
    aiReasons: [],
    risks: [],
    description: product.description ?? '',
  };
}
