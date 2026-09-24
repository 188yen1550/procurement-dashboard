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
  /**
   * 2026-09-16修正：與 pendingCount 互斥（不再是子集）——candidate_status=
   * AI_SUGGESTED 且 review_status=PENDING 的商品數，pendingCount 已改為
   * 只算 candidate_status=CANDIDATE 的部分。
   */
  aiSuggestedPendingCount: number;
}

/**
 * 對應後端 DashboardRecommendationItem.java（推薦 Top 10）。
 *
 * ⚠️ reentryLabel 與 lastRejectionComment 只在 submissionCount > 1 時有值，
 * 首次送審是 null。前端要判斷有值才渲染標籤，不要顯示成空白標籤。
 */
export interface DashboardRecommendationResponsePayload {
  productId: number;
  productName: string;
  /**
   * ⚠️ 後端這次補上：product 物件本來就在記憶體裡，不需要額外查詢。
   * 前端拿這個 id 對照 GET /api/settings/product-types 顯示分類名稱。
   */
  productTypeId: number | null;
  /** Final Score = Base + 節慶加成。 */
  finalScore: Decimal;
  /**
   * ⚠️ 後端這次補上：跟 finalScore 來自同一個已查出的 ProductEvaluation，
   * 沒有額外查詢成本。找不到對應評估時仍可能是 null（該商品尚無評估紀錄）。
   */
  dataCompleteness: Decimal;
  submissionCount: number | null;
  /** 例「曾被拒絕．第2次送審」，可為 null。 */
  reentryLabel: string | null;
  /** 上次被拒的原因，可為 null。適合放 tooltip 或摺疊區。 */
  lastRejectionComment: string | null;
  /**
   * ⚠️ 後端這次補上：來自 ai_analyses 既有的 recommendation 欄位（跟審核
   * 詳情頁「AI 推薦摘要」同一份資料），不是虛構文案。該商品還沒有 AI
   * 分析紀錄時為 null。
   */
  recommendationReason: string | null;
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
 * ⚠️ 2026-09-23起依登入者角色切換口徑，由 scope 告訴前端這次算的是哪一種：
 * - PERSONAL（操作人員）：只計 createdBy = 目前登入者的商品。同一支 API、
 *   不同帳號呼叫會拿到不同的數字，這是後端刻意的設計（供選品人員自我檢視），
 *   不是快取或計算錯誤；畫面文案要寫「我的」，避免誤以為在看公司整體表現。
 * - COMPANY（管理人員）：全公司口徑。
 * 文案一律依 scope 決定，不要在前端用角色自行推導一次，避免前後端規則分歧。
 *
 * ⚠️ **ratePercentage 可能是 null**（分母為 0，代表這個口徑下還沒有任何商品送審過）。
 * 前端必須顯示「尚無資料」，**不能顯示成 0%**——
 * 「還沒開始」與「轉換率是 0%」是完全不同的意思，後者代表送審的全被拒絕。
 *
 * ⚠️ ratePercentage 已經是百分比數值（33.33 代表 33.33%），**不要再 ×100**。
 */
export interface DashboardConversionRateResponsePayload {
  /** 計算口徑，見上方說明。 */
  scope: ConversionRateScope;
  /** 分子：此口徑下目前 review_status = APPROVED 的不重複商品數。 */
  approvedCount: number;
  /** 分母：此口徑下 submission_count > 0（曾送審過）的不重複商品數。 */
  submittedCount: number;
  ratePercentage: Decimal;
}

/** 對應後端 DashboardConversionRateResponse.SCOPE_PERSONAL／SCOPE_COMPANY。 */
export type ConversionRateScope = 'PERSONAL' | 'COMPANY';
