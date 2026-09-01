import {
  CandidateStatus,
  DataSource,
  FestiveCampaignStatus,
  FestiveCategory,
  ItemStatus,
  PricingStatus,
  PricingType,
  PriceSensitivity,
  ReviewDecision,
  ReviewStatus,
  TagMatchTier,
  TrendDirection,
  UserRole,
} from './enums';

/**
 * enum → 中文顯示文案。
 *
 * 後端刻意只回英文代碼、不做中文轉換（見 UserResponse.java 註解：
 * 「顯示名稱由前端自行轉譯」），所以這層一定要有，而且要集中在一個檔案——
 * 目前 product-management / product-detail / review 各自寫了一份
 * reviewStatusLabel()，三份文案已經不一致（例如 APPROVED 有「已通過選品審核」
 * 也有「已通過」）。集中之後改文案只要改一處。
 *
 * ⚠️ 文案刻意與後端 enum 建構子裡的中文不同步。後端 ProductReviewStatus
 * 寫的是「尚未審核／已審核拒絕／已審核通過」，那是給後端 log 用的；
 * 畫面文案屬於 UI 決策，由前端決定，不要為了「跟後端一致」而改這裡。
 */

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  PURCHASER: '操作人員',
  MANAGER: '管理人員',
};

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: '未審核',
  APPROVED: '已通過選品審核',
  REJECTED: '未通過',
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  ACTIVE: '使用中',
  ARCHIVED: '已封存',
};

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  CANDIDATE: '正式候選',
  AI_SUGGESTED: 'AI 建議',
};

export const PRICING_TYPE_LABEL: Record<PricingType, string> = {
  NEW: '新品',
  RESALE: '再販售',
};

export const PRICING_STATUS_LABEL: Record<PricingStatus, string> = {
  PENDING_PRICING: '待訂價',
  PRICED: '已訂價',
};

/**
 * 這裡的中文文案直接沿用後端 enum 建構子裡的字串
 * （"低－更重視品質" 等），而不是像其他 Label 常數那樣自訂——
 * 這三句已經是後端與畫面雙方都認可的正式文案，沒有理由另外造一份。
 */
export const PRICE_SENSITIVITY_LABEL: Record<PriceSensitivity, string> = {
  LOW: '低－更重視品質',
  MEDIUM: '中－價格與品質平衡',
  HIGH: '高－優先考量折扣',
};

export const REVIEW_DECISION_LABEL: Record<ReviewDecision, string> = {
  APPROVED: '通過',
  REJECTED: '不通過',
};

export const FESTIVE_CATEGORY_LABEL: Record<FestiveCategory, string> = {
  FESTIVAL: '節慶型',
  SEASON: '季節型',
};

export const FESTIVE_CAMPAIGN_STATUS_LABEL: Record<FestiveCampaignStatus, string> = {
  UPCOMING: '即將到來',
  PREPARING: '備戰期',
  ACTIVE: '進行中',
  EXPIRED: '已結束',
};

export const TAG_MATCH_TIER_LABEL: Record<TagMatchTier, string> = {
  CORE: '核心',
  GENERAL: '一般',
  WEAK: '弱',
};

export const TREND_DIRECTION_LABEL: Record<TrendDirection, string> = {
  UP: '上升',
  DOWN: '下滑',
  STABLE: '持平',
};

/**
 * dataSource 的畫面文案。
 * 建議顯示成小標籤放在分數區塊旁邊，讓使用者知道這組數字會不會再變動。
 */
export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  SNAPSHOT: '已凍結（審核當下）',
  LIVE: '即時計算',
};

// =========================================================================
// 業務門檻常數
// =========================================================================

/**
 * 資料完整度門檻。
 *
 * ⚠️ 後端 EvaluationResponse.dataCompleteness 只回傳數值、**不做門檻判斷**
 * （見前端 API 手冊第 17 支）。企劃書定義低於 60% 為「資料待補、不進入評分」，
 * 這個判斷完全由前端負責。寫成常數而不是散落的 magic number，
 * 是因為它同時出現在品項清單、詳情頁、審核頁三個地方。
 */
export const DATA_COMPLETENESS_THRESHOLD = 60;

export function isDataIncomplete(completeness: number | null): boolean {
  return completeness !== null && completeness < DATA_COMPLETENESS_THRESHOLD;
}

// =========================================================================
// 分隔符處理
// =========================================================================

/**
 * products.campaign_tags 的分隔符。
 *
 * ⚠️ 後端 ScoringService.splitTags() 用的是 `tags.split(",")`——**只吃半形逗號**。
 * 使用者若在表單輸入全形頓號「、」，後端會把整串當成單一標籤，
 * 節慶比對直接失效且不會報錯。前端送出前必須正規化成半形逗號。
 */
export function splitCampaignTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * 把標籤陣列組回後端要的格式。
 * 一律用半形逗號、不加空白，跟 ScoringService.splitTags() 的 trim() 行為對齊。
 */
export function joinCampaignTags(tags: readonly string[]): string {
  return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0).join(',');
}

/**
 * audience_profiles.keywords 與 risk_options.alert_keywords 的分隔符。
 *
 * 這兩個欄位後端用的是 `split("[,、\\s]+")`（客群）與 `split("[、,]")`（風險關鍵字），
 * **兩者都接受全形頓號**，與 campaignTags 不同。這個不一致是後端既有行為，
 * 前端照著處理即可，不要「順手統一」成同一個 split 函式——
 * 那會讓 campaignTags 誤以為也能用頓號。
 */
export function splitKeywords(keywords: string | null | undefined): string[] {
  if (!keywords) return [];
  return keywords
    .split(/[,、\s]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}
