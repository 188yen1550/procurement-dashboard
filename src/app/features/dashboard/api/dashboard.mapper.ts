import {
  DashboardConversionRateResponsePayload,
  DashboardRecommendationResponsePayload,
  DashboardRiskAlertResponsePayload,
} from './dashboard-api.contract';

/**
 * 儀表板的 payload → View Model 轉換。
 *
 * statistics 沒有 mapper：四個 number 欄位形狀就是畫面要的，
 * 抄一遍沒有價值。另外三支有實質轉換需求，說明見各函式。
 */

// =========================================================================
// AI 推薦 Top 10
// =========================================================================

export interface RecommendationItem {
  productId: number;
  productName: string;
  productTypeId: number | null;
  finalScore: number | null;
  dataCompleteness: number | null;
  submissionCount: number;
  /** true 時渲染「曾被拒絕」標籤區塊；false 時整個標籤不渲染。 */
  isReentry: boolean;
  reentryLabel: string;
  lastRejectionComment: string;
  /** 該商品尚無 AI 分析紀錄時為空字串，畫面顯示「—」。 */
  recommendationReason: string;
}

/**
 * ⚠️ 為什麼需要 isReentry 這個衍生欄位：
 *
 * 樣板若寫 `@if (item.reentryLabel)`，空字串與 null 都是 falsy 沒問題，
 * 但一旦後端哪天回了空白字串 " "，標籤就會渲染成一個空盒子。
 * 在 mapper 統一判斷後，樣板只認 boolean，不需要知道「什麼樣的值算沒有」。
 */
export function toRecommendationItem(
  payload: DashboardRecommendationResponsePayload,
): RecommendationItem {
  const reentryLabel = payload.reentryLabel?.trim() ?? '';
  return {
    productId: payload.productId,
    productName: payload.productName,
    productTypeId: payload.productTypeId,
    finalScore: payload.finalScore,
    dataCompleteness: payload.dataCompleteness,
    submissionCount: payload.submissionCount ?? 0,
    isReentry: reentryLabel !== '',
    reentryLabel,
    lastRejectionComment: payload.lastRejectionComment?.trim() ?? '',
    recommendationReason: payload.recommendationReason?.trim() ?? '',
  };
}

// =========================================================================
// 高風險示警
// =========================================================================

export interface RiskAlertItem {
  productId: number;
  productName: string;
  matchedKeywords: string[];
  aiReasons: string;
}

export function toRiskAlertItem(
  payload: DashboardRiskAlertResponsePayload,
): RiskAlertItem {
  return {
    productId: payload.productId,
    productName: payload.productName,
    // null → 空陣列，讓樣板可以直接 @for 不用先判斷。
    matchedKeywords: payload.matchedKeywords ?? [],
    aiReasons: payload.aiReasons ?? '',
  };
}

// =========================================================================
// 選品轉換率
// =========================================================================

export interface ConversionRateModel {
  /**
   * ⚠️ false 代表**還沒有任何商品送審過**（分母 0），畫面要顯示「尚無資料」。
   * 這與「轉換率 0%」（有送審但全被拒）是兩件事，
   * 混在一起會讓管理層對選品成效做出完全錯誤的判讀。
   */
  hasData: boolean;
  /** 已是百分比數值（33.33 代表 33.33%），⚠️ 不要再 ×100。 */
  ratePercentage: number | null;
  approvedCount: number;
  submittedCount: number;
}

export function toConversionRateModel(
  payload: DashboardConversionRateResponsePayload,
): ConversionRateModel {
  return {
    // 同時檢查 ratePercentage 與 submittedCount：後端在分母為 0 時回 null，
    // 但雙重判斷可以擋掉「後端改成回 0」時前端誤顯示 0% 的情況。
    hasData: payload.ratePercentage !== null && payload.submittedCount > 0,
    ratePercentage: payload.ratePercentage,
    approvedCount: payload.approvedCount,
    submittedCount: payload.submittedCount,
  };
}
