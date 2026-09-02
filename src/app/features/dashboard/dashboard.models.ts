/**
 * 檔案用途：Dashboard 畫面模型。
 * PENDING 是未審核、APPROVED 僅代表選品審核通過、REJECTED 是未通過；APPROVED 不等於已銷售。
 *
 * ⚠️ 接上真實 API 的過程中，Top10 項目的欄位可用性分成三種情況，不要混為一談：
 *
 * - `category`：後端這次補上 productTypeId，前端對照 GET /api/settings/product-types
 *   取得分類名稱；對照不到才顯示「—」
 * - `completeness`：後端這次補上，來自與 finalScore 同一次查出的 ProductEvaluation；
 *   該商品若尚無評估紀錄，仍可能是 null
 * - `reviewStatus`：**不是**後端欄位，是前端固定寫死 'PENDING'——
 *   因為後端 `DashboardService.getRecommendations()` 呼叫查詢時
 *   reviewStatus 參數本來就寫死傳入 PENDING，這份清單裡的每一筆
 *   審核狀態保證恆為 PENDING，不是「後端提供了這個值」
 *
 * `DashboardRiskAlert.level`（風險嚴重度）目前仍然沒有對應後端欄位，
 * 後端只有命中關鍵字陣列與 AI 分析全文，HIGH/MEDIUM 是 Mock 自行假設的分類，
 * 真實模式維持 null。
 *
 * Mock 資料（dashboard.mock-data.ts）完全不受影響——本來就都填了值，
 * 只是型別放寬不影響既有資料。
 */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type DashboardUiState = 'default' | 'locked' | 'loading' | 'edge';
export type RiskLevel = 'HIGH' | 'MEDIUM';

export interface DashboardStatistics {
  totalProducts: number;
  pendingReviews: number;
  approvedProducts: number;
  rejectedProducts: number;
  /**
   * ⚠️ 可能為 null：後端分母（曾送審過的不重複商品數）為 0 時
   * （系統剛啟用、還沒有任何商品送審過）回傳 null，代表「尚無資料」，
   * 不是「轉換率 0%」。這兩者意義完全不同，樣板必須分開處理，
   * 不能直接顯示 `{{ conversionRate }}%`（會顯示成 "null%"）。
   */
  conversionRate: number | null;
}

export interface DashboardRecommendation {
  id: number;
  rank: number;
  name: string;
  category: string;
  finalScore: number;
  /** ⚠️ 前端固定寫死 'PENDING'，理由見檔頭說明。不是後端回傳的值。 */
  reviewStatus: ReviewStatus | null;
  /** 該商品若尚無評估紀錄則為 null。 */
  completeness: number | null;
  aiReason: string;
  submissionCount: number;
  previousRejectionSummary?: string;
}

export interface DashboardRiskAlert {
  id: number;
  productName: string;
  /** ⚠️ 真實模式恆為 null：後端沒有風險嚴重度分級概念。 */
  level: RiskLevel | null;
  message: string;
  /** 真實模式可能同時命中多個關鍵字，已用頓號合併成單一字串顯示。 */
  detectedKeyword: string;
}

export interface DashboardMockData {
  generatedAt: string;
  statistics: DashboardStatistics;
  recommendations: readonly DashboardRecommendation[];
  riskAlerts: readonly DashboardRiskAlert[];
}
