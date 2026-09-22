import { Decimal, IsoDateTime } from '../../../core/api/api-envelope';
import { PageQuery } from '../../../core/api/unwrap';
import {
  CandidateStatus,
  DataSource,
  GateCode,
  GateStatus,
  ItemStatus,
  PackageSizeTier,
  PackingType,
  PricingStatus,
  PricingType,
  ReviewStatus,
  ScoreLevel,
  ShelfLifeTier,
  SupplierLeadTimeTier,
  TemperatureZone,
  TrendDirection,
} from '../../../core/domain/enums';

/**
 * 品項模組的 API contract。只放 endpoint 與後端 DTO 的形狀，不放 View Model、不放 UI 邏輯。
 *
 * 端點來源逐一對照過後端原始碼：
 * - ProductController（/api/products/**）
 * - ScoringController（evaluation、festival-boost，路徑掛在 /api/products 下但屬不同 Controller）
 * - TrendController（trend/sync）
 * - AiSelectionController（ai-analysis、ai-analysis/generate）
 * - ReviewController.getProductReviewHistory（/api/products/{id}/reviews）
 *
 * 命名規則：後端→前端以 ResponsePayload 結尾，前端→後端以 RequestPayload 結尾。
 */

export const PRODUCT_API = {
  list: '/api/products',
  aiSuggested: '/api/products/ai-suggested',
  create: '/api/products',
  batchCreate: '/api/products/batch',
  detail: (id: number | string) => `/api/products/${id}`,
  image: (id: number | string) => `/api/products/${id}/image`,
  evaluation: (id: number | string) => `/api/products/${id}/evaluation`,
  festivalBoost: (id: number | string) => `/api/products/${id}/festival-boost`,
  aiAnalysis: (id: number | string) => `/api/products/${id}/ai-analysis`,
  aiAnalysisGenerate: (id: number | string) => `/api/products/${id}/ai-analysis/generate`,
  trendSync: (id: number | string) => `/api/products/${id}/trend/sync`,
  reviewHistory: (id: number | string) => `/api/products/${id}/reviews`,
  resubmit: (id: number | string) => `/api/products/${id}/resubmit`,
  archive: (id: number | string) => `/api/products/${id}/archive`,
  restore: (id: number | string) => `/api/products/${id}/restore`,
  promote: (id: number | string) => `/api/products/${id}/promote-to-candidate`,
  /** GET：RESALE 商品搜尋相似參考商品。唯讀查詢，不會修改任何資料。
   * ⚠️ 品項表單已改用逐層過濾（resaleReferenceSuppliers／resaleReferenceProducts），
   * 這支端點保留在後端但目前沒有畫面呼叫，見團隊決議。 */
  similarCandidates: '/api/products/similar-candidates',
  /** GET：RESALE 逐層過濾參考商品第一層，列出指定品類下有供貨紀錄的供應商。 */
  resaleReferenceSuppliers: '/api/products/resale-reference/suppliers',
  /** GET：逐層過濾參考商品第二層，列出指定品類＋供應商下可選的商品。 */
  resaleReferenceProducts: '/api/products/resale-reference/products',
  /** POST [僅管理]：手動觸發 AI 主動選品批次。 */
  aiSuggestedBatchGenerate: '/api/products/ai-suggested/batch-generate',
  /** GET：依 productTypeId 取得自訂商品屬性（動態問卷）題目清單，2026-09-20新增。 */
  customFieldSchema: '/api/products/custom-field-schema',
} as const;

// =========================================================================
// Response Payload
// =========================================================================

/**
 * 對應後端 ProductResponse.java，逐欄核對過。
 * GET /api/products（清單）與 GET /api/products/{id}（詳情）回傳同一個 DTO，
 * 清單不會少欄位，所以前端不需要為兩者分開定義型別。
 *
 * ⚠️ finalScore／dataCompleteness 是這個 DTO 唯一越界的兩個欄位。
 * ProductResponse.java 類別註解說明「只回傳 products 表本身的欄位，
 * 評估分數／趨勢／AI 屬於其他 Service 的職責」，但清單頁需要顯示分數，
 * 後端改用跟 createdByName 一樣的批次查詢手法補上（見
 * ProductService.resolveEvaluations()），不是逐筆呼叫 /evaluation，
 * 也沒有在查詢裡新增 JOIN。該商品若尚無評估紀錄，兩個欄位皆為 null，
 * 畫面顯示「—」，不要顯示成 0（0 分跟「還沒有分數」意義不同）。
 */
export interface ProductResponsePayload {
  id: number;
  productTypeId: number | null;
  pricingType: PricingType;
  name: string;
  description: string | null;
  /** 例 "/images/products/xxx.jpg"，可為 null（選填欄位）。 */
  imageUrl: string | null;
  supplierName: string | null;
  costPrice: Decimal;
  salePrice: Decimal;
  /** ⚠️ 僅 RESALE 有值，NEW 商品後端會拒絕寫入。 */
  marketPrice: Decimal;
  /** ⚠️ 半形逗號分隔字串，非陣列。用 splitCampaignTags() 處理。 */
  campaignTags: string | null;
  moq: number | null;
  /** ⚠️ 後端 V6 migration 已改成 1–5 整數等級，不再是 0–5 分制小數。null 代表尚未設定。 */
  supplyStability: ScoreLevel | null;
  /** ⚠️ 後端 V6 migration 已改成 1–5 整數等級，不再是 0–5 分制小數。null 代表尚未設定。 */
  priceCompetitiveness: ScoreLevel | null;
  targetCustomerDescription: string | null;
  /** ⚠️ 0–1 的小數（0.8 代表 80%），顯示時要 ×100。 */
  estimatedPurchaseRate: Decimal;
  /**
   * 僅 RESALE 商品可能有值，NEW 商品恆為 null。
   *
   * 後端這次補上的欄位（原本 GET 端點不回傳，只有 Create／Update 能寫入，
   * 編輯既有 RESALE 商品時完全看不到目前設定的參考商品）。有這個欄位後，
   * 商品表單編輯模式應該用它預先標示目前選定的參考商品，不必再顯示
   * 「無法顯示」的提示文字。
   */
  resaleReferenceProductId: number | null;

  /**
   * 以下 9 個欄位是 Gate 判定（GateEvaluationService）用來讀取的商品層
   * 屬性——先前這 9 欄完全沒有被任何 API 回傳過，商品詳情頁看不到、
   * 建立／編輯表單也填不了。這批新增之後才第一次真正串起來。
   *
   * ⚠️ 全部選填。商品層沒填時，Gate 判定會依三層繼承規則往上查品類的
   * 預設屬性——留空不代表 Gate 判定失效，只是改用品類層的值。畫面上
   * 不需要因為這些欄位是 null 就顯示錯誤或警告。
   */
  temperatureZone: TemperatureZone | null;
  shelfLifeTier: ShelfLifeTier | null;
  supplierLeadTimeTier: SupplierLeadTimeTier | null;
  /** 供運費估算查表使用，非 Gate 判定輸入。 */
  packageSizeTier: PackageSizeTier | null;
  /** 純 Signal 顯示用，不參與任何判定或計分。 */
  packingType: PackingType | null;
  /** 逗號分隔的自由文字標籤（例：FRAGILE,UPRIGHT），非固定選項集。 */
  handlingFlags: string | null;
  /** 逗號分隔的自由文字標籤，目前沒有任何 Gate 或計分邏輯讀取這個欄位。 */
  certificationFlags: string | null;
  supplierMaxCapacity: number | null;

  /**
   * Gate 判定結果彙總。⚠️ 只有 GET /api/products/{id}（單筆詳情）才會有值，
   * 清單／搜尋端點恆為 undefined——一次回傳多筆時重算五個 Gate 成本太高，
   * 後端只在看單一商品詳情時才計算。畫面不要假設清單頁的每一筆都有這個欄位。
   */
  gateResults?: GateResultSummaryPayload;

  /**
   * 自訂商品屬性（動態問卷）的答案：fieldCode → 值。語意同 gateResults——
   * 只有 GET /api/products/{id}（單筆詳情）才會有值，清單／搜尋端點恆為
   * undefined。2026-09-20新增，「開新計分因子資料源」Phase 2。
   */
  customFieldValues?: Record<string, unknown>;

  reviewStatus: ReviewStatus;
  candidateStatus: CandidateStatus;
  pricingStatus: PricingStatus;
  itemStatus: ItemStatus;
  submissionCount: number;
  /** ⚠️ 只有使用者編號、沒有姓名，且後端沒有以 id 查姓名的 API。目前顯示不了「由誰建立」。 */
  createdBy: number | null;
  /**
   * ⚠️ 後端這次補上的欄位：由 ProductService／ReviewService 批次查詢
   * app_users 後填入，找不到對應帳號時為 null（極少見）。
   * 有這個欄位後，畫面應直接顯示它，不要再對 createdBy 做任何前端查詢或猜測。
   */
  createdByName: string | null;
  /** ⚠️ 後端這次補上：該商品若尚無評估紀錄則為 null，不是 0。 */
  finalScore: Decimal;
  /** ⚠️ 後端這次補上，跟 finalScore 來自同一筆 ProductEvaluation，理由同上。 */
  dataCompleteness: Decimal;
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
  updatedBy: number | null;
  /**
   * 「為什麼被 AI 推薦」的說明文字。只有 GET /api/products/ai-suggested
   * 這支端點會有值，其餘所有回傳這個型別的端點一律是 null——原本這個
   * 概念完全沒有被計算或回傳過，AI 建議清單想知道「為什麼」只能自己猜。
   */
  suggestionReason?: string | null;
}

/** 對應後端 json/WeightFactorSnapshot.java。 */
export interface WeightFactorPayload {
  factorCode: string;
  factorName: string;
  category: string;
  weight: Decimal;
  /**
   * 這個因子當時採用的運算邏輯代碼（2026-09-20新增，見 FactorStrategyCode）。
   * 既有七個固定因子沒有對應的 FactorDefinition，恆為 null；只有自訂因子有值。
   * 目前前端沒有畫面在用這個欄位，先透傳以符合後端型別，之後若設定頁要顯示
   * 「這個因子用的是哪種運算邏輯」可以直接讀這裡，不需要再跟後端要新欄位。
   */
  strategyCode?: string | null;
  /** 同上，該策略當時的參數快照（例如 MANUAL_SCALE 的 scale 倍率）。 */
  strategyParams?: Record<string, number> | null;
}

/** 對應後端 json/WeightSnapshot.java。權重是唯讀展示，後端沒有修改 API。 */
export interface WeightSnapshotPayload {
  modeCode: string;
  modeName: string;
  version: number;
  factors: WeightFactorPayload[];
}

/** 對應後端 json/MatchedCampaignSnapshot.java。 */
export interface MatchedCampaignPayload {
  campaignId: number;
  campaignName: string;
  matchedTags: string[];
  /** 命中權重：CORE=1.0／GENERAL=0.6／WEAK=0.3。 */
  matchWeight: Decimal;
  /** 急迫係數，越接近檔期越高。 */
  urgencyFactor: Decimal;
}

/**
 * 對應後端 EvaluationResponse.java（GET /api/products/{id}/evaluation）。
 *
 * ⚠️ dataCompleteness 後端只回數值、不做門檻判斷。
 * 「低於 60% 為資料待補」是企劃書規則，由前端依 DATA_COMPLETENESS_THRESHOLD 自行判斷。
 */
export interface EvaluationResponsePayload {
  dataSource: DataSource;
  evaluationModeId: number | null;
  evaluationModeName: string | null;
  evaluationModeVersion: number | null;
  weights: WeightSnapshotPayload | null;
  businessScore: Decimal;
  audienceScore: Decimal;
  historicalScore: Decimal;
  purchaseScore: Decimal;
  trendScore: Decimal;
  forecastScore: Decimal;
  /** Base Score：六項加權後的總分。 */
  totalScore: Decimal;
  /** 百分比數值（0–100）。 */
  dataCompleteness: Decimal;
  festivalBoost: Decimal;
  /** finalScore = totalScore + festivalBoost。 */
  finalScore: Decimal;
}

/**
 * 對應後端 FestivalBoostResponse.java。
 * ⚠️ matchedCampaign 為 null 代表未命中任何檔期，整個節慶區塊不顯示
 * （不是顯示空白表格）。
 */
export interface FestivalBoostResponsePayload {
  dataSource: DataSource;
  matchedCampaign: MatchedCampaignPayload | null;
  festivalBoost: Decimal;
  finalScore: Decimal;
}

/**
 * 對應後端 AiAnalysisResponse.java。
 *
 * ⚠️ 沒有 AI 分析時，後端回的是 **200 + 全欄位 null 的物件**，不是 404
 * （見 AiSelectionService.getAiAnalysisResponse()）。
 * 前端要判斷 summary === null 顯示 Empty 狀態，不要當 API 錯誤處理。
 *
 * ⚠️ modelName 若為 "MOCK-LLM-v1" 代表是開發階段的模擬資料，
 * 內容會帶「【模擬資料】」字樣，畫面上建議標示出來避免誤導。
 */
export interface AiAnalysisResponsePayload {
  summary: string | null;
  recommendation: string | null;
  reasons: string | null;
  modelName: string | null;
  generatedAt: IsoDateTime | null;
}

/**
 * 對應後端 json/TrendSnapshot.java，POST /api/products/{id}/trend/sync 的回傳。
 * ⚠️ collectedAt 後端型別是 String 不是 LocalDateTime，需要自己 parse。
 */
export interface TrendSnapshotPayload {
  /** 目前固定 "SIMULATED"。 */
  source: string | null;
  keyword: string | null;
  trendScore: Decimal;
  popularityScore: Decimal;
  trendDirection: TrendDirection | null;
  collectedAt: string | null;
}

// =========================================================================
// Request Payload
// =========================================================================

/**
 * 對應後端 ProductCreateRequest.java。
 * 必填（@NotNull / @NotBlank）：productTypeId、pricingType、name。
 *
 * ⚠️ 不能送狀態欄位（reviewStatus / itemStatus / candidateStatus / submissionCount），
 * 由後端決定，送了也無效。
 *
 * ⚠️ marketPrice 只有 RESALE 能填，NEW 商品填了後端回 400
 * 「市售價格僅適用於再販售(RESALE)商品」。
 *
 * ⚠️ 後端不檢查商品名稱重複（同名可能合法），防止手滑送兩次是前端責任。
 */
export interface ProductCreateRequestPayload {
  productTypeId: number;
  pricingType: PricingType;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  supplierName?: string | null;
  costPrice?: number | null;
  salePrice?: number | null;
  marketPrice?: number | null;
  campaignTags?: string | null;
  moq?: number | null;
  /** ⚠️ 1–5 整數等級，送小數或超出範圍後端會以 400 擋下（@Min(1) @Max(5)）。 */
  supplyStability?: ScoreLevel | null;
  /** ⚠️ 1–5 整數等級，送小數或超出範圍後端會以 400 擋下（@Min(1) @Max(5)）。 */
  priceCompetitiveness?: ScoreLevel | null;
  targetCustomerDescription?: string | null;
  estimatedPurchaseRate?: number | null;
  /**
   * 僅 RESALE 商品使用。來自 GET /api/products/similar-candidates 的人工
   * 挑選結果，這支端點本身不會修改資料，選定的 id 要靠這裡送出才會生效。
   */
  resaleReferenceProductId?: number | null;

  /**
   * 以下 8 個欄位供 Gate 判定使用，語意見 ProductResponsePayload 同名欄位
   * 的註解。全部選填——留空時 Gate 判定會依三層繼承規則改用品類層的
   * 預設屬性，不是必填欄位。
   */
  temperatureZone?: TemperatureZone | null;
  shelfLifeTier?: ShelfLifeTier | null;
  supplierLeadTimeTier?: SupplierLeadTimeTier | null;
  packageSizeTier?: PackageSizeTier | null;
  packingType?: PackingType | null;
  handlingFlags?: string | null;
  certificationFlags?: string | null;
  supplierMaxCapacity?: number | null;

  /**
   * 自訂商品屬性（動態問卷）的答案：fieldCode → 值。省略或 null 等同
   * 「這次沒有填寫任何自訂屬性」。2026-09-20新增，「開新計分因子資料源」
   * Phase 2。整份覆蓋（PUT）時同樣適用：沒送的既有答案會被後端清除，
   * 要保留就要連同其他沒動過的欄位一起原封送回。
   */
  customFieldValues?: Record<string, unknown> | null;
}

/**
 * 對應後端 ProductUpdateRequest.java，欄位與 Create 完全相同。
 *
 * ⚠️ **整份覆蓋，不是部分更新**。沒送的欄位會變成 null。
 * 正確流程：先 GET /api/products/{id} → 改動使用者編輯的部分 → 整份送回。
 *
 * ⚠️ reviewStatus === 'APPROVED' 的商品若異動下列任一「選品核心資料」，後端回 409：
 * productTypeId／pricingType／costPrice／salePrice／campaignTags／moq／
 * supplyStability／priceCompetitiveness／targetCustomerDescription／
 * estimatedPurchaseRate，以及以下 8 個 Gate 判定屬性（併入同一組的原因見
 * ProductResponsePayload 同名欄位註解）：temperatureZone／shelfLifeTier／
 * supplierLeadTimeTier／packageSizeTier／packingType／handlingFlags／
 * certificationFlags／supplierMaxCapacity。
 * 前端應把這些欄位設為唯讀，而不是等使用者送出才吃 409。
 */
export type ProductUpdateRequestPayload = ProductCreateRequestPayload;

/**
 * POST /api/products/batch 的 items part 裡，陣列的單一元素。
 * 對應後端 ProductBatchItemRequest.java。
 *
 * ⚠️ product 底下的欄位規則與 ProductCreateRequestPayload 完全一致
 * （後端 @Valid 會連帶驗證），批次匯入不會因為是批次就放寬單筆新增
 * 既有的必填/格式規則。
 */
export interface ProductBatchItemRequestPayload {
  /** 對回原始 CSV/Excel 的資料列號（不含標題列，從 1 開始），純粹供結果回報使用。 */
  rowNumber: number;
  /**
   * 這一列要套用的圖片原始檔名，需與同一個 multipart 請求裡 images part
   * 夾帶的某個檔案 File.name 完全一致（含副檔名、大小寫相符）才會配對成功。
   * 留空代表這一列不上傳圖片。
   */
  imageFileName?: string | null;
  product: ProductCreateRequestPayload;
}

/** POST /api/products/batch 的 items part 本體。對應後端 ProductBatchCreateRequest.java。 */
export interface ProductBatchCreateRequestPayload {
  items: ProductBatchItemRequestPayload[];
}

/** POST /api/products/batch 回應陣列中的單一列結果。對應後端 ProductBatchItemResult.java。 */
export interface ProductBatchItemResultPayload {
  rowNumber: number | null;
  success: boolean;
  /** success===false 時才有值；success===true 時一定是 null。 */
  errorMessage: string | null;
  /** 與 success 無關；目前唯一情境：商品建立成功但找不到對應的圖片檔案。 */
  warningMessage: string | null;
  /** success===true 時才有值。 */
  product: ProductResponsePayload | null;
}

/**
 * POST /api/products/batch 的回應本體。對應後端 ProductBatchCreateResponse.java。
 *
 * ⚠️ 這支 API 只要 items 本身通過格式驗證就回 200——「這一列建立商品時
 * 失敗」是逐列結果的一部分，不代表整批請求失敗，畫面要依 results 逐列
 * 顯示成功／失敗，不能只看這支 API 有沒有回 2xx 就判斷整批成功。
 */
export interface ProductBatchCreateResponsePayload {
  totalCount: number;
  successCount: number;
  failCount: number;
  results: ProductBatchItemResultPayload[];
}

/**
 * GET /api/products 的查詢參數，逐一對照 ProductController.search()。
 *
 * ⚠️ candidateStatus 不帶時，ProductService 內部預設帶入 CANDIDATE。
 * 主清單不要主動送 AI_SUGGESTED——查看 AI 建議一律走獨立的
 * GET /api/products/ai-suggested，避免兩個入口重疊。
 *
 * ⚠️ 三種狀態是三個獨立維度，不是互斥選項。一個商品可以同時是
 * 「已通過 + 已封存 + 正式候選」，篩選 UI 要做成三個獨立下拉。
 */
export interface ProductListQuery extends PageQuery {
  keyword?: string;
  reviewStatus?: ReviewStatus;
  itemStatus?: ItemStatus;
  candidateStatus?: CandidateStatus;
  productTypeId?: number;
  /**
   * 依「商品修改時間」篩選（後端 Product.updatedAt），不是建立時間——
   * 新增當下兩者相同，之後每次編輯都會更新 updatedAt，篩選出來的才會是
   * 「最近有異動」的商品，不是「最早建立」的。ISO 8601 格式字串，
   * 例如 '2026-01-01T00:00:00'，兩者皆選填、可只帶一邊，皆為閉區間。
   */
  updatedFrom?: string;
  updatedTo?: string;
}

/**
 * GET /api/products/similar-candidates 的 query 參數。
 *
 * 對應 ProductController.findSimilarCandidates() 的四個 @RequestParam。
 * productTypeId 與 name 為必填（後端沒有 required = false），
 * 缺任一個會是 400 而不是空清單。
 *
 * excludeId 在「編輯既有商品」時要帶自己的 id，否則候選清單第一名
 * 一定是商品自己（名稱 100% 相同），使用者會看到自己參考自己。
 */
export interface SimilarCandidateQuery {
  productTypeId: number;
  name: string;
  supplierName?: string;
  excludeId?: number;
}

/**
 * GET /api/products/resale-reference/products 的 query 參數。
 * 對應 ProductController.listResaleReferenceProducts() 的三個 @RequestParam。
 */
export interface ResaleReferenceProductQuery {
  productTypeId: number;
  supplierName: string;
  excludeId?: number;
}

/**
 * 對應後端 ResaleReferenceOptionResponse.java。
 *
 * ⚠️ 刻意只有 id／name 兩個欄位——這一層只負責「列出可選項」，選定之後
 * 呼叫既有的 getProduct(id) 取得完整資料做表單預填，不要期待這裡有
 * description／campaignTags 等欄位。
 */
export interface ResaleReferenceOptionPayload {
  productId: number;
  name: string;
}

/**
 * 對應後端 SimilarProductCandidateResponse.java。
 *
 * ⚠️ 後端刻意回傳**分項相似度**而非只給綜合分數，DTO 註解寫明理由：
 * 只給一個 72 分，使用者無從判斷這個分數合不合理；附上分項才能核對
 * 系統的判斷依據。畫面上請把 nameSimilarity／supplierSimilarity 顯示出來，
 * 不要只顯示 combinedScore。
 *
 * ⚠️ supplierSimilarity **任一邊供應商名稱為空時是 null，不是 0**。
 * null 代表「無法比較」，顯示成 0% 會讓使用者以為供應商完全不像。
 *
 * 三個相似度都是 0~1 的小數（Jaro-Winkler），要顯示成百分比需自行 ×100。
 */
export interface SimilarProductCandidatePayload {
  productId: number;
  name: string;
  supplierName: string | null;
  pricingType: PricingType | null;
  /** 0~1。 */
  nameSimilarity: Decimal;
  /** 0~1；無法比較時為 null。 */
  supplierSimilarity: Decimal | null;
  /** 0~1，排序依據。 */
  combinedScore: Decimal;
}

/**
 * 對應後端 AiSuggestionBatchService.BatchResult（record）。
 *
 * checkedCount 是本次掃描過的商品數，suggestedCount 是實際新增的
 * AI_SUGGESTED 候選數。兩者相差很大是正常的——大部分商品不符合建議條件。
 */
export interface AiSuggestionBatchResultPayload {
  checkedCount: number;
  suggestedCount: number;
}

// =========================================================================
// Gate 判定結果
// =========================================================================

/**
 * 對應後端 GateResult record（service/gate/GateResult.java）。
 *
 * ⚠️ riskCategory 目前恆為 null——後端還沒把 Gate 結果對應到風險分類，
 * 這是刻意留給未來擴充的欄位，不是這次漏傳，畫面不要假設它一定有值。
 */
export interface GateResultPayload {
  gateCode: GateCode;
  status: GateStatus;
  /** 人類可讀的判定說明，直接顯示即可，不需要前端自己組文字。 */
  reason: string;
  riskCategory: string | null;
}

/**
 * 對應後端 GateResult.Summary record。
 *
 * ⚠️ 四態計數必須分開顯示，不要合併成「有問題／沒問題」兩種——
 * INSUFFICIENT_DATA（資料不足）與 NOT_APPLICABLE（不適用）都不是
 * FAILED（不通過），三者的後續處理完全不同：FAILED 需要主管決定要不要
 * 例外放行，INSUFFICIENT_DATA 該請採購回去補資料，NOT_APPLICABLE 則是
 * 這項檢查對這件商品本來就不適用，三者混在一起顯示會誤導使用者。
 */
export interface GateResultSummaryPayload {
  results: GateResultPayload[];
  passedCount: number;
  failedCount: number;
  insufficientDataCount: number;
  notApplicableCount: number;
}
