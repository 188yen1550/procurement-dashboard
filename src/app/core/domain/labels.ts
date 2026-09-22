import {
  CandidateStatus,
  DataSource,
  FestiveCampaignStatus,
  FestiveCategory,
  GateCode,
  GateStatus,
  ItemStatus,
  PackageSizeTier,
  PackingType,
  PricingStatus,
  PricingType,
  PriceSensitivity,
  ReviewDecision,
  ReviewStatus,
  ScoreLevel,
  ShelfLifeTier,
  SupplierLeadTimeTier,
  TagMatchTier,
  TemperatureZone,
  TrendDirection,
  UserRole,
  WeatherForecastConfidence,
  WeatherSignalType,
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
  APPROVED: '審核通過',
  REJECTED: '審核拒絕',
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
  APPROVED: '審核通過',
  REJECTED: '審核拒絕',
};

export const FESTIVE_CATEGORY_LABEL: Record<FestiveCategory, string> = {
  FESTIVAL: '節慶型',
  SEASON: '季節型',
  WEATHER: '天氣型',
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
    // 表單接受使用者常輸入的半形逗號、全形逗號與頓號；送出時再由
    // joinCampaignTags() 統一組回後端唯一支援的半形逗號格式。
    .split(/[,，、]+/)
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

export const TEMPERATURE_ZONE_LABEL: Record<TemperatureZone, string> = {
  NORMAL: '常溫',
  CHILLED: '冷藏',
  FROZEN: '冷凍',
};

export const SHELF_LIFE_TIER_LABEL: Record<ShelfLifeTier, string> = {
  D7: '7天內',
  D8_30: '8-30天',
  D31_90: '31-90天',
  D90_PLUS: '90天以上',
  NA: '不適用',
};

export const SUPPLIER_LEAD_TIME_TIER_LABEL: Record<SupplierLeadTimeTier, string> = {
  D3: '3天內',
  D4_7: '4-7天',
  D8_14: '8-14天',
  D15_PLUS: '15天以上',
};

export const PACKAGE_SIZE_TIER_LABEL: Record<PackageSizeTier, string> = {
  XS: '極小（可放信封）',
  S: '小（單手可拿）',
  M: '中（一般紙箱）',
  L: '大（需兩人搬）',
};

export const PACKING_TYPE_LABEL: Record<PackingType, string> = {
  WHOLE_CARTON: '原箱直出',
  REPACK: '需拆箱分裝',
};

/**
 * Product.supplyStability 的等級文案。文字逐字對照後端 V6 migration
 * （V6__supply_price_tier_as_integer.sql）COMMENT 裡的敘述，未來要改文案
 * 時兩邊一起改，避免資料庫註解與畫面顯示各說各話。
 */
export const SUPPLY_STABILITY_LEVEL_LABEL: Record<ScoreLevel, string> = {
  1: '嚴重缺貨',
  2: '暫時缺貨',
  3: '供應普通',
  4: '供應穩定',
  5: '供應充足',
};

/** Product.priceCompetitiveness 的等級文案，來源同上（同一支 V6 migration）。 */
export const PRICE_COMPETITIVENESS_LEVEL_LABEL: Record<ScoreLevel, string> = {
  1: '價格缺乏競爭力',
  2: '價格偏高',
  3: '價格普通',
  4: '具價格競爭力',
  5: '高度具競爭力',
};

export const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  PASSED: '通過',
  FAILED: '不通過',
  INSUFFICIENT_DATA: '資料不足，無法判斷',
  NOT_APPLICABLE: '不適用',
};

/** 對應後端 GateEvaluationService 的五個 Gate，畫面顯示用名稱。 */
export const GATE_CODE_LABEL: Record<GateCode, string> = {
  GATE_MOQ_FEASIBILITY: '最低訂購量',
  GATE_LEAD_TIME: '備貨前置期',
  GATE_SHELF_LIFE: '效期門檻',
  GATE_TEMPERATURE_ZONE: '溫層支援',
  GATE_DATA_COMPLETENESS: '資料完整度',
};

/**
 * enums/WeatherSignalType.java 的顯示文案（2026-09-21新增）。
 * 直接沿用後端 enum 建構子裡的字串（比照 PRICE_SENSITIVITY_LABEL 的既有
 * 慣例：後端 enum 已經帶了正式中文，不要另外造一份）。
 */
export const WEATHER_SIGNAL_TYPE_LABEL: Record<WeatherSignalType, string> = {
  HOT: '炎熱',
  HUMID_HOT: '悶熱',
  HUMID: '潮濕',
  RAINY: '降雨',
  HEAVY_RAIN: '大雨',
  STRONG_WIND: '強風',
  COOL: '涼爽',
  COLD: '寒冷',
  DRY_COOL: '乾冷',
  NORMAL: '一般',
};

/**
 * enums/WeatherForecastConfidence.java 的顯示文案（2026-09-21新增）。
 * 後端這個 enum 只帶 confidenceFactor（計算用常數），沒有中文文案，這裡
 * 依後端類別註解的天數分級（0～7天／8～14天／15天以上）自訂 UI 文字。
 */
export const WEATHER_FORECAST_CONFIDENCE_LABEL: Record<WeatherForecastConfidence, string> = {
  HIGH: '高（短期）',
  MEDIUM: '中（中期）',
  LOW: '低（長期）',
};

/**
 * service/weather/WeatherRegionConfig.java 的區域代碼顯示文案（2026-09-21新增）。
 * 後端這裡是純字串常數（Map<String, List<City>> 的 key），不是 enum，沒有
 * 型別可以鏡射，這裡直接依代碼手動對照——新增區域時要記得同步這裡。
 */
export const WEATHER_REGION_LABEL: Record<string, string> = {
  NORTH: '北部',
  CENTRAL: '中部',
  SOUTH: '南部',
  EAST: '東部',
};
