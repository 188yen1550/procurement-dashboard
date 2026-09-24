import { Decimal, IsoDate, IsoDateTime } from '../../../core/api/api-envelope';
import {
  CampaignDateRuleType,
  CampaignStatusSource,
  FestiveCampaignStatus,
  FestiveCategory,
  ObservedHolidayRule,
  PriceSensitivity,
  SolarTerm,
  TagMatchTier,
  WeatherForecastConfidence,
  WeatherSignalType,
} from '../../../core/domain/enums';
import { WeightSnapshotPayload } from '../../product-management/api/product-api.contract';

/**
 * 設定模組的 API contract，對應後端 SettingsController（@RequestMapping("/api/settings")）。
 *
 * ## 權限（逐一對照 @PreAuthorize 標註，不是猜的）
 *
 * 這四支**操作層也能呼叫**，沒有 @PreAuthorize：
 * - GET /api/settings/evaluation-mode/current（品項詳情頁要顯示目前模式）
 * - GET /api/settings/product-types（新增商品的類型下拉要用）
 * - GET /api/settings/festive-campaigns
 * - GET /api/settings/weather-signal-tags/options（2026-09-23新增，商品表單
 *   「可選標籤」下拉要用；注意跟 GET /weather-signal-tags 本體不同，那支
 *   仍是僅管理）
 *
 * 其餘 14 支都是 @PreAuthorize("hasRole('MANAGER')")，
 * 操作層呼叫會收到 403（不是 401，不要導回登入頁）。
 *
 * ⚠️ 這代表 **GET /api/settings/risk-options 是僅管理**。
 * 審核頁要渲染風險勾選清單時，資料來源是 GET /api/reviews/{productId} 回應裡的
 * availableRiskOptions（只含啟用中的），不是這一支（含已停用的）。
 * 兩者用途不同，不要互用。
 */

export const SETTINGS_API = {
  evaluationModes: '/api/settings/evaluation-modes',
  evaluationModeFactors: (id: number | string) =>
    `/api/settings/evaluation-modes/${id}/factors`,
  currentEvaluationMode: '/api/settings/evaluation-mode/current',
  riskOptions: '/api/settings/risk-options',
  audienceProfile: '/api/settings/audience-profile',
  productTypes: '/api/settings/product-types',
  disableProductType: (id: number | string) => `/api/settings/product-types/${id}/disable`,
  deleteProductType: (id: number | string) => `/api/settings/product-types/${id}`,
  festiveCampaigns: '/api/settings/festive-campaigns',
  updateFestiveCampaign: (id: number | string) => `/api/settings/festive-campaigns/${id}`,
  festiveCampaignManualStatus: (id: number | string) =>
    `/api/settings/festive-campaigns/${id}/manual-status`,
  /** 2026-09-24（V21）：日期規則即時預覽（只試算不寫入）與逐年日期覆寫。 */
  festiveCampaignOccurrencePreview: '/api/settings/festive-campaigns/occurrence-preview',
  festiveCampaignOccurrenceOverrides: (id: number | string) =>
    `/api/settings/festive-campaigns/${id}/occurrence-overrides`,
  festiveCampaignOccurrenceOverride: (id: number | string, cycleYear: number) =>
    `/api/settings/festive-campaigns/${id}/occurrence-overrides/${cycleYear}`,
  // ... (保留原本的)
  userEnable: (id: number | string) => `/api/users/${id}/enable`,
  productTypeEnable: (id: number | string) => `/api/settings/product-types/${id}/enable`,
  riskOptionDisable: (id: number | string) => `/api/settings/risk-options/${id}/disable`,
  riskOptionEnable: (id: number | string) => `/api/settings/risk-options/${id}/enable`,
  productTypeUpdate: (id: number | string) => `/api/settings/product-types/${id}`,
  riskOptionUpdate: (id: number | string) => `/api/settings/risk-options/${id}`,
  /** GET/POST [僅管理]：自訂計分因子清單／新增（2026-09-20新增，方案B自訂因子）。 */
  factorDefinitions: '/api/settings/factor-definitions',
  /** PUT [僅管理]：編輯自訂計分因子（V14新增，新增版本+舊版本軟刪除）。 */
  updateFactorDefinition: (id: number | string) => `/api/settings/factor-definitions/${id}`,
  disableFactorDefinition: (id: number | string) => `/api/settings/factor-definitions/${id}/disable`,
  enableFactorDefinition: (id: number | string) => `/api/settings/factor-definitions/${id}/enable`,
  /** 自訂商品屬性（動態問卷，2026-09-20新增，Phase 1：僅題目管理）。 */
  customFieldDefinitions: '/api/settings/custom-field-definitions',
  /** PUT [僅管理]：編輯自訂商品屬性（V14新增，新增版本+舊版本軟刪除）。 */
  updateCustomFieldDefinition: (id: number | string) => `/api/settings/custom-field-definitions/${id}`,
  disableCustomFieldDefinition: (id: number | string) => `/api/settings/custom-field-definitions/${id}/disable`,
  enableCustomFieldDefinition: (id: number | string) => `/api/settings/custom-field-definitions/${id}/enable`,
  /** GET [操作+管理]：目標區間清單。注意讀取權限與其他 settings 端點不同。 */
  productTypeScoreBands: '/api/settings/product-type-score-bands',
  /** POST [僅管理]：新增品類專屬目標區間（只支援 MANUAL 模式建立）。 */
  createProductTypeScoreBand: '/api/settings/product-type-score-bands',
  /** PUT [僅管理]：更新單一目標區間。 */
  updateProductTypeScoreBand: (id: number | string) =>
    `/api/settings/product-type-score-bands/${id}`,
  /** GET [僅管理]：演算法參數清單（貝氏收縮 k 值、趨勢半衰期等）。 */
  systemSettings: '/api/settings/system-settings',
  /** PUT [僅管理]：更新單一演算法參數。key 是路徑參數，不是 body 欄位。 */
  updateSystemSetting: (key: string) =>
    `/api/settings/system-settings/${encodeURIComponent(key)}`,
  /**
   * WeatherController（非SettingsController，2026-09-21新增）的兩支維運端點。
   * URL沿用/api/settings命名空間是刻意的（跟festive-campaigns同屬「檔期」概念），
   * 但後端實際上是獨立的WeatherController類別，見該類別Javadoc。
   */
  weatherSync: '/api/settings/weather/sync',
  /** 2026-09-24：「天氣連動 › 目前的天氣檔期」[操作+管理]，唯讀；切換狀態沿用 festiveCampaignManualStatus。 */
  weatherCampaignsCurrent: '/api/settings/weather-campaigns/current',
  weatherSignalsPreview: '/api/settings/weather/signals/preview',
  /**
   * GET/POST [僅管理]：天氣訊號標籤對照清單／新增（2026-09-22新增，取代原本
   * 寫死在後端WeatherCampaignSyncService裡的WEATHER_TAG_MAPPING）。
   * 注意命名空間跟上面兩支不同：這兩支在SettingsController（一般設定
   * CRUD），不在WeatherController（維運觸發），路徑刻意不是
   * /api/settings/weather/...，避免跟WeatherController的路徑混淆。
   */
  weatherSignalTags: '/api/settings/weather-signal-tags',
  updateWeatherSignalTagMapping: (id: number | string) =>
    `/api/settings/weather-signal-tags/${id}`,
  disableWeatherSignalTagMapping: (id: number | string) =>
    `/api/settings/weather-signal-tags/${id}/disable`,
  enableWeatherSignalTagMapping: (id: number | string) =>
    `/api/settings/weather-signal-tags/${id}/enable`,
  /**
   * GET [操作+管理]（2026-09-23新增）：商品表單「可選標籤」下拉用，只回傳
   * isActive=true、精簡過的欄位，跟上面 weatherSignalTags（設定頁CRUD、
   * 僅管理）是分開的兩支端點，不要互用——理由同 festiveCampaigns 開放操作
   * 層查詢、riskOptions 僅管理查詢的既有分工。
   */
  weatherSignalTagOptions: '/api/settings/weather-signal-tags/options',
  /**
   * GET/PUT [僅管理]（2026-09-23新增，地域性影響評分方案B+D）：四區
   * （NORTH/CENTRAL/SOUTH/EAST）業務占比設定，WeatherCampaignSyncService
   * 同步天氣檔期時依此計算region_coverage_ratio。四區固定，PUT採整份覆蓋、
   * 加總須為100，語意比照evaluationModeFactors的因子權重編輯。
   */
  regionWeights: '/api/settings/region-weights',
} as const;

// =========================================================================
// 評估模式
// =========================================================================

/**
 *
 * 對應後端 EvaluationModeResponse.java。
 * ⚠️ 權重數值只能看不能改，後端沒有修改 API。畫面做成唯讀展示。
 */
export interface ProductTypeUpdatePayload {
  name: string;
  description?: string | null;
}

export interface RiskOptionUpdatePayload {
  name: string;
  description?: string | null;
  alertKeywords?: string | null;
}

export interface EvaluationModeResponsePayload {
  id: number;
  /** 例 'BALANCED'。 */
  modeCode: string;
  /** 例 '均衡模式'。 */
  modeName: string;
  version: number;
  description: string | null;
  isActive: boolean | null;
  /**
   * 是否允許調整權重。後端註解說明理由：只靠前端寫死 id 判斷會在換環境
   * 或重新匯入資料後失準，id 是流水號不是穩定識別。畫面上「編輯權重」
   * 按鈕只在這個欄位為 true 時顯示（目前只有 CUSTOM 模式）。
   */
  isEditable: boolean | null;
}

/** 對應後端 SwitchEvaluationModeRequest.java。 */
export interface SwitchEvaluationModeRequestPayload {
  evaluationModeId: number;
}

/**
 * GET /api/settings/evaluation-modes/{id}/factors 直接回 WeightSnapshot，
 * 與 EvaluationResponse.weights 是同一個型別，不重複定義。
 */
export type { WeightSnapshotPayload };

// =========================================================================
// 人工風險選項
// =========================================================================

/** 對應後端 RiskOptionResponse.java（審核頁用）／RiskOptionSettingResponse.java（設定頁用）共用的前端型別。 */
export interface RiskOptionResponsePayload {
  /** 管理清單的狀態；舊版未提供時視為啟用。 */
  isActive?: boolean | null;
  id: number;
  name: string;
  description: string | null;
  isSystemDefault: boolean | null;
  /**
   * 觸發 AI 風險提示用的關鍵字，逗號分隔。
   *
   * ⚠️ 只有設定頁的 GET /api/settings/risk-options（後端回傳
   * RiskOptionSettingResponse）會帶這個欄位；審核頁的
   * GET /api/reviews/pending 等端點（後端回傳 RiskOptionResponse）
   * 刻意不回傳——那是管理層勾選審核意見用的畫面，AI 比對用的關鍵字
   * 對審核當下的渲染沒有意義，後端特意不夾帶用不到的內部細節。
   * 兩種情境共用同一個前端型別，所以這裡標成選填，不是每個來源都有值。
   */
  alertKeywords?: string | null;
  /**
   * 此選項是否允許審核頁自由輸入補充文字，目前僅系統預設的「其他」為 true。
   * 2026-09-20新增，取代原本用 name === '其他' 猜測識別的做法——名稱只是
   * 顯示文字，被改名就會讓判斷失準，這個欄位才是穩定依據。兩端點都會回傳。
   */
  isFreeTextOption?: boolean | null;
}

// =========================================================================
// 自訂計分因子（2026-09-20新增，方案B：可選運算邏輯的自訂因子）
// =========================================================================

/**
 * 可選的運算邏輯代碼，對應後端 enums/FactorStrategyCode.java。
 * 目前只實作了這三種——HISTORY_FULFILLMENT 的貝氏收縮、TREND_HEAT 的
 * 指數衰減不開放給自訂因子選用，見後端類別註解。
 */
export type FactorStrategyCode = 'MANUAL_SCALE' | 'MANUAL_PERCENT' | 'TARGET_BAND_NORMALIZE';

/**
 * 可綁定的既有欄位代碼，對應後端 enums/FactorDataSource.java。
 * 2026-09-20新增 MOQ／SUPPLIER_MAX_CAPACITY 兩個候選——盤點既有欄位後
 * 發現這兩個也完全沒有被任何既有因子使用，且都是「原始數字，需要依品類
 * 設定合理區間」的形狀，剛好對上原本沒有資料源可綁的 TARGET_BAND_NORMALIZE。
 * 之後每多開放一個既有欄位可綁定，這裡就多一個值——不需要資料庫變更。
 */
export type FactorDataSource = 'PRICE_COMPETITIVENESS' | 'MOQ' | 'SUPPLIER_MAX_CAPACITY';

/** 對應後端 dto/response/FactorDefinitionResponse.java。 */
export interface FactorDefinitionResponsePayload {
  id: number;
  factorCode: string;
  factorName: string;
  category: string | null;
  strategyCode: FactorStrategyCode;
  dataSourceCode: FactorDataSource | null;
  /** 綁定的自訂商品屬性題目 id，跟 dataSourceCode 二選一，2026-09-20新增。 */
  customFieldDefinitionId: number | null;
  strategyParams: Record<string, number> | null;
  isActive: boolean;
  /** V14新增：編輯產生新版本時，指向被取代的舊版本id；null代表這是最初版本。 */
  previousVersionId: number | null;
  /** V14新增：這一列是否已被另一個版本取代——true時畫面應隱藏「啟用」按鈕。 */
  isSuperseded: boolean;
}

/**
 * 對應後端 dto/request/FactorDefinitionUpdateRequest.java（V14新增）。
 * 沒有factorCode欄位：代碼是穩定鍵，編輯不開放修改，見後端類別註解。
 * 其餘欄位與 FactorDefinitionCreateRequestPayload 相同，皆為完整覆蓋語意。
 */
export interface FactorDefinitionUpdateRequestPayload {
  factorName: string;
  category?: string | null;
  strategyCode: FactorStrategyCode;
  dataSourceCode?: FactorDataSource | null;
  customFieldDefinitionId?: number | null;
  strategyParams?: Record<string, number> | null;
}

/**
 * 對應後端 dto/request/FactorDefinitionCreateRequest.java。
 *
 * 新增後不會自動加進任何評估模式的權重配置——建立完這個因子之後，
 * 還要另外去「權重編輯」（PUT .../evaluation-modes/{id}/factors）把它
 * 加進某個自訂模式並分配權重，兩支端點刻意分開，見後端類別註解。
 */
/**
 * 對應後端 dto/request/FactorDefinitionCreateRequest.java。
 *
 * dataSourceCode／customFieldDefinitionId 二選一（2026-09-20新增後者）：
 * dataSourceCode 綁既有 Product 固定欄位，customFieldDefinitionId 綁自訂
 * 商品屬性（動態問卷）題目，兩者恰好擇一，見後端類別註解。
 */
export interface FactorDefinitionCreateRequestPayload {
  factorCode: string;
  factorName: string;
  category?: string | null;
  strategyCode: FactorStrategyCode;
  dataSourceCode?: FactorDataSource | null;
  customFieldDefinitionId?: number | null;
  strategyParams?: Record<string, number> | null;
}

// =========================================================================
// 自訂商品屬性（動態問卷，2026-09-20新增，Phase 1：僅題目管理）
// =========================================================================

/**
 * 欄位型態，對應後端 enums/CustomFieldType.java。前三種是數值類，之後
 * （Phase 4）可作為計分因子的資料源；TEXT 是純文字，不參與計分。
 */
export type CustomFieldType = 'SCALE_1_5' | 'PERCENT_0_1' | 'RAW_NUMBER' | 'TEXT';

/** 對應後端 dto/response/CustomFieldDefinitionResponse.java。 */
export interface CustomFieldDefinitionResponsePayload {
  id: number;
  fieldCode: string;
  fieldName: string;
  helpText: string | null;
  fieldType: CustomFieldType;
  isRequired: boolean;
  isActive: boolean;
  /** 空陣列＝適用全部品類，見後端 CustomFieldApplicableType 的類別註解。 */
  applicableRootProductTypeIds: number[];
  /**
   * V14新增：僅fieldType='SCALE_1_5'時可能有值，key為'1'~'5'（JSON物件key
   * 恆為字串），value為文字說明，例如 { "1": "非常不穩定", "5": "非常穩定" }。
   */
  scaleLabels: Record<string, string> | null;
  /** V14新增：編輯產生新版本時，指向被取代的舊版本id；null代表這是最初版本。 */
  previousVersionId: number | null;
  /** V14新增：這一列是否已被另一個版本取代——true時畫面應隱藏「啟用」按鈕。 */
  isSuperseded: boolean;
}

/**
 * 對應後端 dto/request/CustomFieldDefinitionCreateRequest.java。
 * applicableRootProductTypeIds 省略或傳空陣列＝適用全部品類；有傳值時，
 * 每個 id 都必須是大類（product_types.level=1），後端會驗證。
 */
export interface CustomFieldDefinitionCreateRequestPayload {
  fieldCode: string;
  fieldName: string;
  helpText?: string | null;
  fieldType: CustomFieldType;
  isRequired?: boolean;
  applicableRootProductTypeIds?: number[];
  /** V14新增：僅fieldType='SCALE_1_5'時可以提供，key必須落在1~5之間。 */
  scaleLabels?: Record<string, string> | null;
}

/**
 * 對應後端 dto/request/CustomFieldDefinitionUpdateRequest.java（V14新增）。
 * 沒有fieldCode欄位：代碼是穩定鍵，編輯不開放修改，見後端類別註解。
 * 其餘欄位與 CustomFieldDefinitionCreateRequestPayload 相同，皆為完整覆蓋語意。
 */
export interface CustomFieldDefinitionUpdateRequestPayload {
  fieldName: string;
  helpText?: string | null;
  fieldType: CustomFieldType;
  isRequired?: boolean;
  applicableRootProductTypeIds?: number[];
  scaleLabels?: Record<string, string> | null;
}

/**
 * 對應後端 RiskOptionCreateRequest.java。
 *
 * ⚠️ alertKeywords 會影響儀表板的「高風險示警」：填了之後，
 * AI 分析文字中出現這些詞的商品會被列入示警清單。
 * 這個因果關係建議在表單上寫清楚，讓使用者知道填了會發生什麼。
 *
 * ⚠️ 後端 DashboardService 用 `split("[、,]")` 拆這個欄位，
 * **全形頓號與半形逗號都接受**（與 campaignTags 只吃半形逗號不同）。
 *
 * ⚠️ 新增後立即生效，會馬上出現在審核頁的勾選清單。
 */
export interface RiskOptionCreateRequestPayload {
  name: string;
  description?: string | null;
  alertKeywords?: string | null;
}

// =========================================================================
// 核心客群
// =========================================================================

/**
 * 對應後端 AudienceProfileResponse.java。
 * ⚠️ 這裡沒有清單也沒有新增——永遠只有一筆「目前使用中」的設定，
 * 畫面做成單一表單頁即可，不要做列表頁。
 */
export interface AudienceProfileResponsePayload {
  id: number;
  name: string;
  ageMin: number | null;
  ageMax: number | null;
  /**
   * ⚠️ 這次後端異動：entity 從 String 改為
   * `@Enumerated(EnumType.STRING) PriceSensitivityStatus`，
   * 因此這裡也從自由文字改回三選一 enum。
   * 舊版曾記錄「已改為 free-text」，那是上一輪的狀態，這次被後端反向改回。
   * 畫面請改用 <select>，選項與文案見 core/domain/labels.ts 的
   * PRICE_SENSITIVITY_LABEL（直接沿用後端 enum 建構子裡的字串，未自創文案）。
   */
  priceSensitivity: PriceSensitivity | null;
  preferenceDescription: string | null;
  /** ⚠️ 分隔字串。後端 split("[,、\\s]+")，逗號、頓號、空白都接受。 */
  keywords: string | null;
}

/** 對應後端 AudienceProfileUpdateRequest.java。⚠️ PUT 是整份覆蓋，要送完整欄位。 */
export interface AudienceProfileUpdateRequestPayload {
  name: string;
  ageMin?: number | null;
  ageMax?: number | null;
  /** Request DTO 沒有 @NotNull，未選擇時可送 null，維持選填。 */
  priceSensitivity?: PriceSensitivity | null;
  preferenceDescription?: string | null;
  keywords?: string | null;
}

// =========================================================================
// 商品類型
// =========================================================================

/** 對應後端 ProductTypeResponse.java。 */
export interface ProductTypeResponsePayload {
  id: number;
  name: string;
  description: string | null;
  /** 系統預設的 9 類，建議畫面加鎖頭圖示區隔。 */
  isSystemDefault: boolean | null;
  /** 停用的要用灰階或標籤區隔。 */
  isActive: boolean | null;
  /**
   * 兩層階層：level=1 是大類（parentId 為 null）、level=2 是小類
   * （parentId 指向所屬大類的 id）。先前這兩欄完全沒有回傳過，畫面
   * 只能顯示扁平清單——這批補上，各處顯示商品分類的地方都應該依大類
   * 分組顯示小類，不要再攤平成一整條清單。
   */
  parentId: number | null;
  level: number | null;
  /**
   * 使用這個品類的商品數量，由後端 GROUP BY 統計算出，不再是先前的
   * 「後端沒有這個統計」恆為 null 的狀態。
   */
  usedCount: number;
}

/** 對應後端 ProductTypeCreateRequest.java。 */
export interface ProductTypeCreateRequestPayload {
  name: string;
  description?: string | null;
  /** 不填＝新增大類；有值＝新增小類，掛在這個 id 指定的大類底下。 */
  parentId?: number | null;
}

// =========================================================================
// 節慶檔期
// =========================================================================

/** 對應後端 FestiveCampaignTagView.java。 */
export interface FestiveCampaignTagPayload {
  tag: string;
  /** CORE=1.0／GENERAL=0.6／WEAK=0.3，數值由後端 enum 定義。 */
  matchTier: TagMatchTier;
}

/**
 * 對應後端 FestiveCampaignResponse.java。
 *
 * 2026-09-24（V21 檔期規則改版）：startDate／endDate／campaignStatus 欄位名稱不變，語意改為
 * 「目前或下一期」的起訖日與推算後的有效狀態（statusSource 說明來源）；節慶／季節型改用
 * 日期規則，另帶出規則欄位、區域、週期年、補假日與後端組好的中文規則描述。
 */
export interface FestiveCampaignResponsePayload {
  id: number;
  /** ⚠️ 只能新增時填，編輯時後端 DTO 沒有這個欄位、不可修改。 */
  campaignCode: string;
  campaignName: string;
  category: FestiveCategory;
  /** 目前或下一期的開始日；推算不出來（規則異常、超出 2000–2099）時為 null。 */
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  /** 備戰提前天數，未填時後端預設 30。 */
  preparationLeadDays: number | null;
  campaignStatus: FestiveCampaignStatus;
  statusSource: CampaignStatusSource | null;
  /** ⚠️ true 代表狀態不再由系統自動判斷；節慶／季節型只對 manualOverrideCycle 那一期有效。 */
  isManualOverride: boolean | null;
  manualOverrideCycle: number | null;
  /** 僅 WEATHER：命中區域代碼。節慶／季節型的區域見 regions。 */
  region: string | null;
  /** 僅 WEATHER：預報可信度（2026-09-24 新增）；其餘類別為 null。 */
  weatherConfidence: WeatherForecastConfidence | null;
  /** WEATHER 為同步凍結值；節慶／季節型依 regions 當下計算（0~1）。 */
  regionCoverageRatio: Decimal | null;
  tags: FestiveCampaignTagPayload[];
  dateRuleType: CampaignDateRuleType | null;
  ruleMonth: number | null;
  ruleDay: number | null;
  ruleWeekOrdinal: number | null;
  ruleWeekday: number | null;
  ruleSolarTerm: SolarTerm | null;
  ruleOffsetDays: number | null;
  durationDays: number | null;
  endMonth: number | null;
  endDay: number | null;
  observedHolidayRule: ObservedHolidayRule | null;
  expandLongWeekend: boolean | null;
  /** 季節型的受影響區域；空＝全國。節慶型一律為空（全國）。WEATHER 為 [region]。 */
  regions: string[] | null;
  cycleYear: number | null;
  occurrenceOverridden: boolean | null;
  observedHolidays: IsoDate[] | null;
  /** 例：「每年農曆 5 月 5 日起 3 天」。 */
  ruleDescription: string | null;
}

/**
 * 新增、修改、預覽三支 API 共用的日期規則欄位（對應後端 FestiveCampaignRuleFields.java）。
 * category 只接受 FESTIVAL／SEASON（WEATHER 由系統產生，後端回 400）。
 */
export interface FestiveCampaignRulePayload {
  category: Exclude<FestiveCategory, 'WEATHER'>;
  dateRuleType: CampaignDateRuleType;
  ruleMonth?: number | null;
  ruleDay?: number | null;
  ruleWeekOrdinal?: number | null;
  ruleWeekday?: number | null;
  ruleSolarTerm?: SolarTerm | null;
  ruleOffsetDays?: number | null;
  durationDays?: number | null;
  endMonth?: number | null;
  endDay?: number | null;
  observedHolidayRule?: ObservedHolidayRule | null;
  expandLongWeekend?: boolean | null;
  regions?: string[];
}

/**
 * 對應後端 FestiveCampaignCreateRequest.java。
 * 2026-09-24：移除 startDate／endDate，改帶日期規則；campaignCode 不可帶年份（例 DRAGON_BOAT）。
 */
export interface FestiveCampaignCreateRequestPayload extends FestiveCampaignRulePayload {
  campaignCode: string;
  campaignName: string;
  preparationLeadDays?: number | null;
  tags?: FestiveCampaignTagPayload[];
}

/**
 * 對應後端 FestiveCampaignUpdateRequest.java。
 *
 * ⚠️ **沒有 campaignCode**——代碼不可修改。
 * ⚠️ tags 與 regions 都是**整份覆蓋**：送出的陣列取代原本全部內容。
 */
export interface FestiveCampaignUpdateRequestPayload extends FestiveCampaignRulePayload {
  campaignName: string;
  preparationLeadDays?: number | null;
  tags?: FestiveCampaignTagPayload[];
}

/** POST /festive-campaigns/occurrence-preview 回傳的一期（只試算、不寫入）。 */
export interface FestiveCampaignOccurrencePreviewPayload {
  cycleYear: number;
  startDate: IsoDate;
  endDate: IsoDate;
  observedHolidays: IsoDate[];
  overridden: boolean;
}

/** 逐年日期覆寫的一列（GET／PUT .../occurrence-overrides）。 */
export interface FestiveCampaignOccurrenceOverridePayload {
  cycleYear: number;
  startDate: IsoDate;
  endDate: IsoDate;
  note: string | null;
  updatedAt: string | null;
}

/** PUT .../occurrence-overrides/{cycleYear} 的 body。 */
export interface FestiveCampaignOccurrenceOverrideRequestPayload {
  startDate: IsoDate;
  endDate: IsoDate;
  note?: string | null;
}

/**
 * 對應後端 FestiveCampaignManualStatusRequest.java，兩個欄位都是 @NotNull。
 *
 * ⚠️ 這支要跟「編輯」做成兩個獨立按鈕。編輯表單存檔**不會**連帶切換狀態，
 * 合併成一個按鈕會讓使用者誤以為改日期就會改狀態。
 */
export interface FestiveCampaignManualStatusRequestPayload {
  status: FestiveCampaignStatus;
  overrideEnabled: boolean;
}

/**
 * 對應後端 WeatherSyncResponse.java。POST /api/settings/weather/sync 的回應內容，
 * 不是festive_campaigns的資料本身——想看實際落地結果要另外呼叫getFestiveCampaigns()。
 */
export interface WeatherSyncResponsePayload {
  totalSignalCount: number;
  syncedCampaignCount: number;
  expiredCampaignCount: number;
}

/**
 * 對應後端 dto/weather/WeatherSignal.java。只有GET /signals/preview這支debug端點
 * 會回傳，不寫入資料庫，欄位形狀跟festive_campaigns完全無關，不要跟
 * FestiveCampaignResponsePayload搞混。
 */
export interface WeatherSignalPreviewPayload {
  /** WeatherRegionConfig.java的區域代碼（NORTH/CENTRAL/SOUTH/EAST），畫面顯示請查WEATHER_REGION_LABEL。 */
  region: string;
  type: WeatherSignalType;
  windowStart: IsoDate;
  windowEnd: IsoDate;
  confidence: WeatherForecastConfidence;
}

/**
 * 對應後端 dto/response/WeatherSignalTagMappingResponse.java（2026-09-22新增）。
 * 這是「某種天氣訊號該對應哪些商品標籤」的可調整設定，不是某一筆已產生的
 * 天氣檔期——跟 WeatherSignalPreviewPayload 語意完全不同，不要搞混：這個
 * 型別是設定頁的規則清單，WeatherSignalPreviewPayload 是預覽端點回傳的
 * 「依目前規則會分類出的結果」。
 */
export interface WeatherSignalTagMappingResponsePayload {
  id: number;
  weatherSignalType: WeatherSignalType;
  tag: string;
  matchTier: TagMatchTier;
  isActive: boolean;
  /** 系統出廠內建的9筆預設對照（V19 migration）：可停用，後端不開放刪除。 */
  isSystemDefault: boolean;
}

/**
 * 對應後端 dto/request/WeatherSignalTagMappingCreateRequest.java。
 * ⚠️ weatherSignalType 不接受 'NORMAL'——一般天氣不該命中任何商品，後端
 * 會回400拒絕，畫面的天氣類型下拉不要把NORMAL列進選項。
 */
export interface WeatherSignalTagMappingCreateRequestPayload {
  weatherSignalType: WeatherSignalType;
  tag: string;
  matchTier: TagMatchTier;
}

/**
 * 對應後端 dto/request/WeatherSignalTagMappingUpdateRequest.java。
 * ⚠️ 只能改matchTier——weatherSignalType／tag合起來是這筆資料的身分，
 * 後端DTO沒有這兩個欄位，送了也不會被採用。要改對應的天氣類型或標籤，
 * 停用這筆、另外新增一筆。
 */
export interface WeatherSignalTagMappingUpdateRequestPayload {
  matchTier: TagMatchTier;
}

/**
 * 對應後端 dto/response/WeatherSignalTagOptionResponse.java（2026-09-23新增）。
 * 商品表單「可選標籤」下拉用，只有畫面需要的三個欄位——不含id／isSystemDefault，
 * 跟 WeatherSignalTagMappingResponsePayload（設定頁CRUD用）不是同一個型別，
 * 對應的端點權限也不同（見本檔案最上方權限說明）。
 */
export interface WeatherSignalTagOptionPayload {
  tag: string;
  weatherSignalType: WeatherSignalType;
  /** 後端算好的中文文案（WeatherSignalType.getLabel()），畫面不用再自己查表對照。 */
  weatherSignalTypeLabel: string;
}

/**
 * 對應後端 dto/response/RegionWeightResponse.java（2026-09-23新增，地域性
 * 影響評分方案B+D）。region 是 WEATHER_REGION_LABEL 的 key（NORTH/CENTRAL/
 * SOUTH/EAST），畫面顯示請查該常數，不要自己另外定一份文案。
 */
export interface RegionWeightPayload {
  region: string;
  weightPercentage: Decimal;
  updatedAt: IsoDateTime | null;
}

/**
 * 對應後端 dto/request/RegionWeightUpdateRequest.java。採整份覆蓋語意，
 * 必須送出全部四區，且加總須為100（後端驗證，前端可先在畫面上算好提示，
 * 但不要假設前端算的一定跟後端一致，仍以後端回應為準）。
 */
export interface RegionWeightUpdateRequestPayload {
  regionWeights: Array<{ region: string; weightPercentage: Decimal }>;
}

// =========================================================================
// 目標區間（product_type_score_bands）
// =========================================================================

/**
 * 目標區間的資料來源模式。對應後端 ScoreBandSourceMode enum。
 *
 * 兩者是**可互相切換的並存模式**，不是「先建議後確認」的兩階段流程：
 * - HISTORICAL：切換當下由後端從歷史開團紀錄算一次，並把結果**凍結**寫進
 *   lowerBound／upperBound。不是每次評分都重算——那會違反系統的可重現性約束。
 * - MANUAL：主管直接輸入固定數字。切到這個模式但沒給新數字時沿用目前值，不清空。
 *
 * ⚠️ 評分時 ScoreBandResolver **只讀 lowerBound／upperBound，完全不看 sourceMode**。
 * 這個欄位純粹是給畫面顯示「這組區間是算出來的還是手填的」。
 */
export type ScoreBandSourceMode = 'HISTORICAL' | 'MANUAL';

/**
 * 對應後端 ProductTypeScoreBandResponse.java。
 *
 * ⚠️ productTypeId 為 null 代表**全域預設區間**（套用到所有沒有專屬設定的品類）。
 * 目前資料庫只有兩筆全域列（MARGIN_RATE、DISCOUNT_DEPTH），畫面要能區分
 * 「全域」與「某品類專屬」，不要把 null 顯示成空白或 0。
 *
 * ⚠️ sampleSize／computedAt 只有 HISTORICAL 模式才有意義，MANUAL 模式下
 * 可能是舊值或 null。顯示時要依 sourceMode 決定要不要露出這兩欄，
 * 否則使用者會以為手動填的數字也是從 N 筆樣本算出來的。
 */
export interface ProductTypeScoreBandResponsePayload {
  id: number;
  /** null = 全域預設。 */
  productTypeId: number | null;
  factorCode: string;
  lowerBound: Decimal;
  upperBound: Decimal;
  version: number;
  sourceMode: ScoreBandSourceMode;
  /** 僅 HISTORICAL 有意義：算這組區間用了幾筆歷史紀錄。 */
  sampleSize: number | null;
  /** 僅 HISTORICAL 有意義：樣本是否含模擬資料。 */
  includesSimulated: boolean | null;
  /** 僅 HISTORICAL 有意義：這組區間是什麼時候算出來的。 */
  computedAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
}

/**
 * 對應後端 ProductTypeScoreBandUpdateRequest.java（PUT）。
 *
 * ⚠️ **必填欄位隨 sourceMode 改變**，這是後端 DTO 註解明寫的設計：
 * - MANUAL：lowerBound／upperBound 應該帶；沒帶的話後端沿用資料庫現值
 * - HISTORICAL：lowerBound／upperBound **一律被忽略**，即使有送也不採用
 *
 * 所以畫面在 HISTORICAL 模式下應該把上下界輸入框設為唯讀或直接隱藏，
 * 不要讓使用者填了一組數字、按下儲存卻發現沒有生效。
 *
 * 後端 DTO 刻意沒對這兩欄加 @NotNull，因為「某欄位必填與否取決於另一個
 * 欄位的值」屬於跨欄位條件式驗證，放 Service 層判斷。
 */
export interface ProductTypeScoreBandUpdateRequestPayload {
  sourceMode: ScoreBandSourceMode;
  lowerBound?: Decimal;
  upperBound?: Decimal;
}

/**
 * 對應後端 ProductTypeScoreBandCreateRequest.java（POST，新增品類專屬目標區間）。
 *
 * ⚠️ **只支援建立 MANUAL 模式**：後端 DTO 沒有 sourceMode 欄位，新建的列
 * 一律是 MANUAL。HISTORICAL 需要先有歷史開團紀錄樣本，新建立的品類覆寫
 * 通常還沒有樣本，建立時就選 HISTORICAL 會直接撞到「樣本不足」的錯誤；
 * 之後有足夠資料時，再透過既有的 PUT 端點切換成 HISTORICAL。
 *
 * ⚠️ 同一品類×因子若已存在生效中的列，後端會回 400（請改用編輯），
 * 不是靠前端先查一次避免——那樣會有競態條件（兩個分頁同時新增）。
 */
export interface ProductTypeScoreBandCreateRequestPayload {
  productTypeId: number;
  factorCode: string;
  lowerBound: Decimal;
  upperBound: Decimal;
}

// =========================================================================
// 評估權重編輯（僅自訂模式）
// =========================================================================

/**
 * 對應後端 EvaluationFactorUpdateRequest.java（PUT .../factors）。
 *
 * ⚠️ **整份覆蓋語意**：必須送出全部七個因子，不接受只送想改的那幾個。
 * 後端 DTO 註解說明理由——只送部分欄位的話，後端得把送來的值與資料庫
 * 現值混合後才能驗「加總為 100」，使用者看到的加總與實際生效的可能不一致。
 * 整份送出，畫面上算出來的加總就是後端會驗的加總。
 *
 * ⚠️ 用 factorCode 對應因子而非陣列索引，是刻意的：靠索引對應的話，
 * 前端少送一個或順序調換都會**安靜地把權重套錯因子**。
 *
 * ⚠️ **只有 isEditable = true 的模式可以改**。三套固定模式（均衡／衝量／
 * 高利潤）後端會拒絕。前端要隱藏編輯入口，但後端那道檢查才是真防線——
 * 有人直接打 API 就繞過前端了，而權重被改掉不會有錯誤訊息，
 * 只會讓所有商品的分數安靜地變成另一組數字。
 *
 * 單欄驗證：weight 需 0.00 ~ 100.00，整數 3 位、小數 2 位。
 * 「七項加總須為 100」是跨欄位規則，由 SettingsService 攔截。
 */
export interface EvaluationFactorUpdateRequestPayload {
  factors: EvaluationFactorWeightPayload[];
}

export interface EvaluationFactorWeightPayload {
  factorCode: string;
  /** 0.00 ~ 100.00。 */
  weight: Decimal;
}

/** 後端 SettingsService 驗證的權重加總。前端送出前先自行檢查，避免來回一趟。 */
export const FACTOR_WEIGHT_TOTAL = 100;

// =========================================================================
// 系統設定（演算法參數：貝氏收縮 k 值、趨勢半衰期等）
// =========================================================================

/**
 * 對應後端 SystemSettingRegistry.DataType。
 *
 * ⚠️ 這裡決定畫面該用什麼輸入元件：INTEGER/DECIMAL 用數字輸入框
 * （INTEGER 額外限制不可輸入小數點），STRING（目前只有
 * supported_temperature_zones 一項）用逗號分隔的多選標籤元件，
 * 不要用一般文字輸入框讓使用者手打逗號分隔字串，容易打錯格式。
 */
export type SystemSettingDataType = 'INTEGER' | 'DECIMAL' | 'STRING';

/**
 * 對應後端 SystemSettingResponse.java。
 *
 * ⚠️ hasStoredValue = false 代表資料庫其實沒有這筆紀錄，目前顯示的是
 * 後端登記表裡的預設值。畫面上可以用一個小標籤標示「預設值，尚未手動
 * 調整過」，但**不要**因為 hasStoredValue=false 就不讓使用者編輯——
 * 這只是顯示上的區別，不是權限限制。
 *
 * ⚠️ minValue／maxValue 在 dataType='STRING' 時為 null。
 */
export interface SystemSettingResponsePayload {
  key: string;
  /** 分組用，例如「貝氏收縮」「趨勢分析」「MOQ判定」，畫面依此分區塊顯示。 */
  category: string;
  displayName: string;
  description: string;
  dataType: SystemSettingDataType;
  minValue: Decimal | null;
  maxValue: Decimal | null;
  /** 例如「天」「次」「百分位」，顯示在輸入框旁邊。dataType='STRING' 時為 null。 */
  unit: string | null;
  /** 目前生效值，統一是字串，畫面依 dataType 決定要不要轉數字。 */
  value: string;
  hasStoredValue: boolean;
  updatedAt: IsoDateTime | null;
  updatedByName: string | null;
}

/**
 * 對應後端 SystemSettingUpdateRequest.java（PUT .../system-settings/{key}）。
 *
 * ⚠️ 後端會依 key 對照登記表做型別與範圍驗證，直接顯示後端回傳的錯誤
 * 訊息即可，不需要前端自己組一份錯誤文字。
 *
 * ⚠️ score_band_percentile_upper 必須大於 score_band_percentile_lower，
 * 這是跨兩個 key 的規則，後端**不會**在單一 key 的更新請求裡驗證這件事。
 * 畫面若讓使用者同時看到這兩個設定，建議在送出前端自行比較兩者目前值
 * 並提示，避免存了一組上下界相反的設定導致後端 HISTORICAL 模式計算
 * 結果錯亂。
 */
export interface SystemSettingUpdateRequestPayload {
  value: string;
}
