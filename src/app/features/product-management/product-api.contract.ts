/**
 * 後端 API contract（來源：feature/product-management 分支）。
 * 這裡只放 endpoint 與 DTO 型別，不放任何 UI 邏輯。
 */

export const PRODUCT_API = {
  list: '/api/products',
  detail: (id: number | string) => `/api/products/${id}`,
  evaluation: (id: number | string) => `/api/products/${id}/evaluation`,
  festivalBoost: (id: number | string) => `/api/products/${id}/festival-boost`,
  resubmit: (id: number | string) => `/api/products/${id}/resubmit`,
  archive: (id: number | string) => `/api/products/${id}/archive`,
  restore: (id: number | string) => `/api/products/${id}/restore`,
  promote: (id: number | string) => `/api/products/${id}/promote-to-candidate`,
} as const;

export interface ProductDetailData {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  supplierName?: string;
  pricingType: 'NEW' | 'RESALE';
  costPrice?: number;
  salePrice?: number;
  completenessPercent: number;
  reviewStatus: string;
  itemStatus: string;
  candidateStatus: string;
  submissionCount: number;
}

export interface EvaluationData {
  dataSource: 'SNAPSHOT' | 'LIVE';
  evaluationModeName: string;
  businessScore: number;
  audienceScore: number;
  historicalScore: number;
  purchaseScore: number;
  trendScore: number;
  forecastScore: number;
  totalScore: number;
  dataCompleteness: number;
  festivalBoost: number;
  finalScore: number;
}

export interface MatchedCampaign {
  campaignId: number;
  campaignName: string;
  matchedTags: string[];
  matchWeight?: number;
  urgencyFactor?: number;
}

export interface FestivalBoostData {
  dataSource: 'SNAPSHOT' | 'LIVE';
  matchedCampaign: MatchedCampaign | null;
  festivalBoost: number;
  finalScore?: number;
}

export interface ProductListFilters {
  reviewStatus?: string;
  itemStatus?: string;
  candidateStatus?: string;
}
