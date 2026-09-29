/**
 * 檔案用途：Dashboard 畫面模型。
 * 分類名稱由 productTypeId 對照取得；尚無評估紀錄時完整度可為 null。
 * 推薦清單只包含待審商品。
 */
import { GoogleTrendSignal } from '../settings/api/google-trends-api.service';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type DashboardUiState = 'default' | 'locked' | 'loading' | 'edge';

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
  /**
   * 轉換率的計算口徑（2026-09-23 分支整併）：PERSONAL＝只算目前登入者
   * 建立的商品（操作人員），COMPANY＝全公司（管理人員）。null 代表轉換率
   * API 載入失敗，文案退回中性說法。
   */
  conversionScope: 'PERSONAL' | 'COMPANY' | null;
  /**
   * 轉換率的分子／分母原始筆數，只有 conversionRate 非 null 時才有意義。
   * 光看百分比看不出樣本大小——63.7% 是「38 之中通過 24 件」還是「3 之中
   * 通過 2 件」，可信度差很多，畫面要把原始筆數一起顯示。
   */
  conversionApprovedCount: number;
  conversionSubmittedCount: number;
  /**
   * 統計卡（總數／待審／通過／拒絕）的計算口徑（2026-09-29）：PERSONAL＝只算目前登入者
   * 建立的商品（操作人員），COMPANY＝全公司（管理人員）。null 代表統計 API 載入失敗。
   */
  statisticsScope: 'PERSONAL' | 'COMPANY' | null;
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

/**
 * ⚠️ 2026-09-25 新增：跟 DashboardRecommendation（依綜合總分排序）刻意
 * 區隔，這是「只看趨勢單一因子」的排行榜，見 dashboard.mapper.ts 的
 * TrendLeaderboardItem 類別註解。
 */
export interface DashboardTrendLeaderboardEntry {
  id: number;
  rank: number;
  name: string;
  popularityScore: number | null;
  trendDirection: 'UP' | 'DOWN' | 'STABLE' | null;
  /** false 代表這筆是當次抓不到、退回的模擬資料，樣板用橘色字標示。 */
  isRealSource: boolean;
  keyword: string;
  /** 2026-09-28：Google 趨勢參考（方向＋成長率）；沒查過為 null。 */
  googleTrend: GoogleTrendSignal | null;
  /** 2026-09-29：最近 3 次同步都上升，顯示「連續上升」標記（取代熱度規則選品）。 */
  consecutiveRise: boolean;
}

export interface DashboardMockData {
  generatedAt: string;
  statistics: DashboardStatistics;
  recommendations: readonly DashboardRecommendation[];
  riskAlerts: readonly DashboardRiskAlert[];
  trendLeaderboard: readonly DashboardTrendLeaderboardEntry[];
}
