/**
 * 檔案用途：Dashboard 畫面模型。
 * 分類名稱由 productTypeId 對照取得；尚無評估紀錄時完整度可為 null。
 * 推薦清單只包含待審商品。
 */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type DashboardUiState = 'default' | 'locked' | 'loading' | 'edge';

export interface DashboardStatistics {
  totalProducts: number;
  pendingReviews: number;
  approvedProducts: number;
  rejectedProducts: number;
  /**
   * 2026-09-16修正：與 pendingReviews 互斥（不再是子集）——後端已改為
   * pendingReviews 只算已轉正候選（CANDIDATE）的商品，AI 建議尚未轉正的
   * 商品只計入這個欄位，兩者相加才等於全部 PENDING 商品數。
   */
  aiSuggestedPending: number;
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
  /**
   * ⚠️ 理論上 findTopRecommendations() 的 JOIN 條件（product_evaluations 對
   * product_id 有 UNIQUE 約束）保證清單裡每一筆都查得到評估資料，這裡維持
   * nullable 純粹是防禦性寫法：跟 completeness 用同一套「查不到就顯示
   * ―，不要偽裝成一個看起來合理的數字」原則，避免 0 分被誤讀成「這個
   * AI 推薦的商品分數是 0」。
   */
  finalScore: number | null;
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
