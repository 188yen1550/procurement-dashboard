import { Decimal } from '../../../core/api/api-envelope';

/**
 * 儀表板模組的 API contract，對應後端 DashboardController
 * （@RequestMapping("/api/dashboard")）。
 *
 * 四支都是 [操作+管理]，沒有 @PreAuthorize。
 *
 * ⚠️ 四支彼此獨立，應該**並行呼叫**，且任一支失敗只讓對應卡片降級，
 * 不要讓整頁空白。用 forkJoin 會讓任一支失敗就全部失敗，
 * 所以 DashboardApiService.loadAll() 對每一支各自 catchError。
 */

export const DASHBOARD_API = {
  statistics: '/api/dashboard/statistics',
  recommendations: '/api/dashboard/recommendations',
  riskAlerts: '/api/dashboard/risk-alerts',
  conversionRate: '/api/dashboard/conversion-rate',
} as const;

/**
 * 對應後端 DashboardStatisticsResponse.java。四個欄位都是 long，不會是 null。
 *
 * ⚠️ 四個數字**不會相加等於總數**：totalProducts 含所有狀態，
 * 三個狀態數字不含已封存等情況。畫面上不要做「總數 = 待審+通過+拒絕」的驗算，
 * 也不要用 totalProducts - pending - approved 去推算任何東西。
 */
export interface DashboardStatisticsResponsePayload {
  totalProducts: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}

/**
 * 對應後端 DashboardRecommendationItem.java（AI 推薦 Top 10）。
 *
 * ⚠️ reentryLabel 與 lastRejectionComment 只在 submissionCount > 1 時有值，
 * 首次送審是 null。前端要判斷有值才渲染標籤，不要顯示成空白標籤。
 */
export interface DashboardRecommendationResponsePayload {
  productId: number;
  productName: string;
  /** Final Score = Base + 節慶加成。 */
  finalScore: Decimal;
  submissionCount: number | null;
  /** 例「曾被拒絕．第2次送審」，可為 null。 */
  reentryLabel: string | null;
  /** 上次被拒的原因，可為 null。適合放 tooltip 或摺疊區。 */
  lastRejectionComment: string | null;
}

/**
 * 對應後端 DashboardRiskAlertItem.java。
 *
 * ⚠️ 這支**不限定審核狀態**——已核准、已拒絕的商品只要 AI 分析文字
 * 命中 risk_options.alert_keywords 都會出現。
 * 畫面標題不要寫成「待審核的高風險商品」，那是錯的。
 */
export interface DashboardRiskAlertResponsePayload {
  productId: number;
  productName: string;
  /** 命中的關鍵字，例 ["缺貨","斷貨"]，適合做成一顆顆標籤。 */
  matchedKeywords: string[] | null;
  /** AI 分析全文，較長，建議摺疊或截斷。 */
  aiReasons: string | null;
}

/**
 * 對應後端 DashboardConversionRateResponse.java。
 *
 * ⚠️ **ratePercentage 可能是 null**（分母為 0，代表還沒有任何商品送審過）。
 * 前端必須顯示「尚無資料」，**不能顯示成 0%**——
 * 「還沒開始」與「轉換率是 0%」是完全不同的意思，後者代表送審的全被拒絕。
 *
 * ⚠️ ratePercentage 已經是百分比數值（33.33 代表 33.33%），**不要再 ×100**。
 */
export interface DashboardConversionRateResponsePayload {
  /** 分子：目前 review_status = APPROVED 的不重複商品數。 */
  approvedCount: number;
  /** 分母：submission_count > 0（曾送審過）的不重複商品數。 */
  submittedCount: number;
  ratePercentage: Decimal;
}
