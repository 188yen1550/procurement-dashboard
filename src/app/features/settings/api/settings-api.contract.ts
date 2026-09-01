import { IsoDate } from '../../../core/api/api-envelope';
import {
  FestiveCampaignStatus,
  FestiveCategory,
  PriceSensitivity,
  TagMatchTier,
} from '../../../core/domain/enums';
import { WeightSnapshotPayload } from '../../product-management/api/product-api.contract';

/**
 * 設定模組的 API contract，對應後端 SettingsController（@RequestMapping("/api/settings")）。
 *
 * ## 權限（逐一對照 @PreAuthorize 標註，不是猜的）
 *
 * 這三支**操作層也能呼叫**，沒有 @PreAuthorize：
 * - GET /api/settings/evaluation-mode/current（品項詳情頁要顯示目前模式）
 * - GET /api/settings/product-types（新增商品的類型下拉要用）
 * - GET /api/settings/festive-campaigns
 *
 * 其餘 13 支都是 @PreAuthorize("hasRole('MANAGER')")，
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
} as const;

// =========================================================================
// 評估模式
// =========================================================================

/**
 * 對應後端 EvaluationModeResponse.java。
 * ⚠️ 權重數值只能看不能改，後端沒有修改 API。畫面做成唯讀展示。
 */
export interface EvaluationModeResponsePayload {
  id: number;
  /** 例 'BALANCED'。 */
  modeCode: string;
  /** 例 '均衡模式'。 */
  modeName: string;
  version: number;
  description: string | null;
  isActive: boolean | null;
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

/** 對應後端 RiskOptionResponse.java。 */
export interface RiskOptionResponsePayload {
  id: number;
  name: string;
  description: string | null;
  isSystemDefault: boolean | null;
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
}

/** 對應後端 ProductTypeCreateRequest.java。 */
export interface ProductTypeCreateRequestPayload {
  name: string;
  description?: string | null;
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

/** 對應後端 FestiveCampaignResponse.java。 */
export interface FestiveCampaignResponsePayload {
  id: number;
  /** ⚠️ 只能新增時填，編輯時後端 DTO 沒有這個欄位、不可修改。 */
  campaignCode: string;
  campaignName: string;
  category: FestiveCategory;
  startDate: IsoDate;
  endDate: IsoDate;
  /** 備戰提前天數，未填時後端預設 30。 */
  preparationLeadDays: number | null;
  campaignStatus: FestiveCampaignStatus;
  /** ⚠️ true 代表狀態不再由系統自動判斷，建議用圖示提示。 */
  isManualOverride: boolean | null;
  tags: FestiveCampaignTagPayload[];
}

/**
 * 對應後端 FestiveCampaignCreateRequest.java。
 * 必填：campaignCode、campaignName、category、startDate、endDate。
 */
export interface FestiveCampaignCreateRequestPayload {
  campaignCode: string;
  campaignName: string;
  category: FestiveCategory;
  startDate: IsoDate;
  endDate: IsoDate;
  preparationLeadDays?: number | null;
  tags?: FestiveCampaignTagPayload[];
}

/**
 * 對應後端 FestiveCampaignUpdateRequest.java。
 *
 * ⚠️ **沒有 campaignCode**——這是刻意的，代碼不可修改。
 * 不要用 Omit<Create, never> 之類的寫法把它帶進來。
 *
 * ⚠️ tags 是**整份覆蓋**，送出的陣列會取代原本全部標籤，不是差異合併。
 * 編輯前必須先載入現有標籤，讓使用者在既有基礎上增刪；
 * 送空陣列等於刪光所有標籤，會讓該檔期永遠比不中任何商品。
 */
export interface FestiveCampaignUpdateRequestPayload {
  campaignName: string;
  category: FestiveCategory;
  startDate: IsoDate;
  endDate: IsoDate;
  preparationLeadDays?: number | null;
  tags?: FestiveCampaignTagPayload[];
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
