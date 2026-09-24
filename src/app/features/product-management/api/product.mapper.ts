import {
  CandidateStatus,
  DataSource,
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
import { joinCampaignTags, splitCampaignTags, WEATHER_REGION_LABEL } from '../../../core/domain/labels';
import {
  AiAnalysisResponsePayload,
  EvaluationResponsePayload,
  FestivalBoostResponsePayload,
  MatchedCampaignPayload,
  ProductCreateRequestPayload,
  ProductResponsePayload,
  TrendSnapshotPayload,
  WeightSnapshotPayload,
} from './product-api.contract';

/**
 * 後端 Payload ↔ 前端 View Model 的轉換。
 *
 * 全部寫成純函式（不是 class、不含 this、不依賴 HttpClient），
 * 單元測試不需要 TestBed 或 mock HttpClient：
 *   expect(toProductListItem(payload)).toEqual({ ... })
 *
 * ## 為什麼品項模組需要 mapper，而 settings／users 不需要
 *
 * 需要的判斷標準是「後端 DTO 的形狀跟畫面要的形狀有沒有實質差距」：
 * - campaignTags 是逗號字串，畫面要標籤陣列 → 需要轉換
 * - productTypeId 只有編號，畫面要中文名稱 → 需要外部對照表
 * - 按鈕啟用條件是多個欄位的組合判斷 → 集中在這裡才不會三個頁面各寫一份
 * - 詳情頁要合併三支 API 的結果 → 需要組裝函式
 *
 * settings 的 ProductTypeResponse（id/name/description/isActive）
 * 形狀跟畫面完全一致，硬加一層 mapper 只是把欄位抄一遍，
 * 那是過度工程，那些模組刻意只有 contract + service 兩層。
 */

/** 後端有欄位但值為 null、且畫面必須顯示點什麼時使用。 */
export const NOT_PROVIDED = '—';

// =========================================================================
// 清單頁
// =========================================================================

export interface ProductListItem {
  id: number;
  name: string;
  productTypeId: number | null;
  /** 由 productTypeId 對照 GET /api/settings/product-types 得來，後端不直接提供。 */
  productTypeName: string;
  pricingType: PricingType;
  supplierName: string;
  /**
   * 送審／建立者姓名。後端已批次查好，找不到時為 fallback 字串。
   * 此欄位對應 `GET /api/reviews/pending` 與 `GET /api/products` 兩支端點，
   * 因為兩者共用 ProductResponse。
   */
  createdByName: string;
  campaignTags: string[];
  /**
   * ⚠️ 後端這次補上：批次查詢 product_evaluations 後填入（見 ProductService.
   * resolveEvaluations()），不是逐筆呼叫 /evaluation。該商品若尚無評估紀錄，
   * 仍可能是 null——不是「後端沒提供」，是「這筆商品真的還沒有分數」。
   */
  finalScore: number | null;
  /** ⚠️ 後端這次補上，理由同上，跟 finalScore 來自同一筆評估紀錄。 */
  dataCompleteness: number | null;
  /**
   * 分數與完整度是否有資料。
   *
   * 這個欄位存在的理由很實際：樣板若直接寫 `dataCompleteness < 60`，
   * 在值為 null 時 `null < 60` 在 JavaScript 會是 **true**，
   * 於是每一列都會顯示「資料待補」——把「後端沒給這個欄位」誤報成
   * 「這個商品資料不完整」，是會誤導採購決策的假訊息。
   *
   * 樣板一律先判斷 hasScoreData，再判斷門檻。
   */
  hasScoreData: boolean;
  reviewStatus: ReviewStatus;
  itemStatus: ItemStatus;
  candidateStatus: CandidateStatus;
  pricingStatus: PricingStatus;
  submissionCount: number;
  updatedAt: string | null;
  /** 操作按鈕的啟用條件，集中在這裡算好，樣板不再重複判斷。 */
  actions: ProductActionAvailability;
  /**
   * 「為什麼被 AI 推薦」——只有 GET /api/products/ai-suggested 這支端點
   * 會有值，其餘端點固定是 undefined。原本這個概念完全沒有被計算或
   * 回傳過，AI 建議清單一直顯示不出「為什麼」。
   */
  suggestionReason?: string | null;
}

/**
 * 五個狀態轉換操作的前置條件。
 *
 * ⚠️ 每個條件都是「多個欄位同時成立」，逐一對照過 ProductService 的實際檢查：
 *
 * | 操作   | ProductService 拋 409 的條件                                    |
 * |--------|-----------------------------------------------------------------|
 * | 重審 | 非 REJECTED／已封存（"請先復用後再重審"）                    |
 * | 封存   | 非 APPROVED 也非 REJECTED／非 ACTIVE                            |
 * | 復用   | 非 APPROVED 也非 REJECTED／非 ARCHIVED                          |
 * | 加入候選 | 非 AI_SUGGESTED                                                |
 * | 刪除   | 非 PENDING 或 submissionCount > 1（1 起算，見下方 canDelete）  |
 *
 * ⚠️ 兩個最容易漏掉的條件：
 * 1. **PENDING 商品不能封存也不能復用**——必須先有審核結果
 * 2. **已封存商品不能直接重審**——要先復用回 ACTIVE
 *
 * ⚠️ restore 的條件是 APPROVED **或** REJECTED，不是只有 APPROVED。
 * 舊版前端寫成只有 APPROVED 可復用，會讓被拒絕又封存的商品永遠救不回來。
 */
export interface ProductActionAvailability {
  canResubmit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canPromote: boolean;
  canDelete: boolean;
  /** 核心資料是否鎖定；APPROVED 時後端會以 409 擋下修改。 */
  isCoreLocked: boolean;
}

export function toProductActionAvailability(
  payload: Pick<
    ProductResponsePayload,
    'reviewStatus' | 'itemStatus' | 'candidateStatus' | 'submissionCount'
  >,
): ProductActionAvailability {
  const hasReviewResult =
    payload.reviewStatus === 'APPROVED' || payload.reviewStatus === 'REJECTED';

  return {
    // 與後端 ProductService.resubmit() 的候選狀態檢查對稱：AI建議商品須先
    // 加入正式候選才能重新送審，即使 reviewStatus/itemStatus 條件都符合。
    canResubmit:
      payload.reviewStatus === 'REJECTED' &&
      payload.itemStatus === 'ACTIVE' &&
      payload.candidateStatus === 'CANDIDATE',
    canArchive: payload.itemStatus === 'ACTIVE' && hasReviewResult,
    canRestore: payload.itemStatus === 'ARCHIVED' && hasReviewResult,
    canPromote: payload.candidateStatus === 'AI_SUGGESTED',
    // 2026-09-24：submissionCount 改為 1 起算（建立商品即第 1 次送審），「PENDING 且第 1 次送審」
    // 才等於「從未被審核過」，與後端 ProductService.deleteProduct() 同步由 0 改為 1。
    canDelete: payload.reviewStatus === 'PENDING' && payload.submissionCount === 1,
    isCoreLocked: payload.reviewStatus === 'APPROVED',
  };
}

/**
 * 後端 ProductResponse → 清單列。
 *
 * productTypeName 由呼叫端傳入（通常來自 ProductTypeLookupService 的快取），
 * 不在這裡發請求——mapper 是純函式，一旦依賴 HttpClient 就測不動了。
 */
export function toProductListItem(
  payload: ProductResponsePayload,
  productTypeName: string = NOT_PROVIDED,
): ProductListItem {
  return {
    id: payload.id,
    name: payload.name,
    productTypeId: payload.productTypeId,
    productTypeName,
    pricingType: payload.pricingType,
    supplierName: payload.supplierName ?? NOT_PROVIDED,
    createdByName: payload.createdByName ?? NOT_PROVIDED,
    campaignTags: splitCampaignTags(payload.campaignTags),
    // 後端這次已在清單端點併帶這兩個欄位（批次查詢，不是逐筆呼叫 /evaluation）。
    // hasScoreData 只代表「後端有沒有提供欄位」，不代表「分數是否為 null」——
    // 一筆商品尚無評估紀錄時 finalScore/dataCompleteness 仍可能是 null，
    // 這裡照樣設成 true，因為欄位本身已經由後端提供，樣板的 hasScoreData
    // 判斷式不變，null 值自然會顯示成「—」。
    finalScore: payload.finalScore,
    dataCompleteness: payload.dataCompleteness,
    hasScoreData: true,
    reviewStatus: payload.reviewStatus,
    itemStatus: payload.itemStatus,
    candidateStatus: payload.candidateStatus,
    pricingStatus: payload.pricingStatus,
    submissionCount: payload.submissionCount,
    updatedAt: payload.updatedAt,
    actions: toProductActionAvailability(payload),
    suggestionReason: payload.suggestionReason,
  };
}

// =========================================================================
// 編輯表單
// =========================================================================

/**
 * 編輯表單的 View Model。
 *
 * 刻意把「一般基本資料」與「選品核心資料」分成兩組：
 * APPROVED 時只鎖核心那一組，基本資料仍可編輯（見企劃書第五節），
 * 分組之後 coreForm.disable() 這件事在型別上就有對應，
 * 不會出現「該鎖的沒鎖、不該鎖的鎖了」。
 */
export interface ProductFormModel {
  base: {
    name: string;
    description: string;
    imageUrl: string;
    supplierName: string;
  };
  core: {
    productTypeId: number | null;
    pricingType: PricingType | '';
    costPrice: number | null;
    salePrice: number | null;
    marketPrice: number | null;
    /** 表單以標籤陣列操作，送出前才 join 成逗號字串。 */
    campaignTags: string[];
    moq: number | null;
    /** ⚠️ 1–5 整數等級，非百分比或 0–5 分制小數，見 ScoreLevel。 */
    supplyStability: ScoreLevel | null;
    /** ⚠️ 1–5 整數等級，非百分比或 0–5 分制小數，見 ScoreLevel。 */
    priceCompetitiveness: ScoreLevel | null;
    targetCustomerDescription: string;
    /** ⚠️ 表單存 0–1 小數（與後端一致），顯示層才 ×100。 */
    estimatedPurchaseRate: number | null;
    /**
     * 僅 RESALE 商品可能有值。後端這次補上 GET 回傳這個欄位後，
     * 編輯模式才第一次能夠回填目前已設定的參考商品 id。
     */
    resaleReferenceProductId: number | null;
    /** 語意見 ProductResponsePayload 同名欄位註解，全部選填。 */
    temperatureZone: TemperatureZone | null;
    shelfLifeTier: ShelfLifeTier | null;
    supplierLeadTimeTier: SupplierLeadTimeTier | null;
    packageSizeTier: PackageSizeTier | null;
    packingType: PackingType | null;
    handlingFlags: string;
    certificationFlags: string;
    supplierMaxCapacity: number | null;
  };
  reviewStatus: ReviewStatus;
  itemStatus: ItemStatus;
  submissionCount: number;
  actions: ProductActionAvailability;
  /**
   * 自訂商品屬性（動態問卷）的答案：fieldCode → 值。獨立於 core 之外，
   * 不是 Reactive Form 的欄位（題目清單本身是動態的，型別無法在
   * FormGroup 宣告時就固定下來）——product-form.ts 用一個獨立的
   * signal 承接，不透過 this.form 讀寫。只有 GET /api/products/{id}
   * （單筆詳情）才會有值，新增模式恆為空物件。2026-09-20新增。
   */
  customFieldValues: Record<string, unknown>;
}

export function toProductFormModel(payload: ProductResponsePayload): ProductFormModel {
  return {
    base: {
      name: payload.name,
      description: payload.description ?? '',
      imageUrl: payload.imageUrl ?? '',
      supplierName: payload.supplierName ?? '',
    },
    core: {
      productTypeId: payload.productTypeId,
      pricingType: payload.pricingType,
      costPrice: payload.costPrice,
      salePrice: payload.salePrice,
      marketPrice: payload.marketPrice,
      campaignTags: splitCampaignTags(payload.campaignTags),
      moq: payload.moq,
      supplyStability: payload.supplyStability,
      priceCompetitiveness: payload.priceCompetitiveness,
      targetCustomerDescription: payload.targetCustomerDescription ?? '',
      estimatedPurchaseRate: payload.estimatedPurchaseRate,
      resaleReferenceProductId: payload.resaleReferenceProductId,
      temperatureZone: payload.temperatureZone,
      shelfLifeTier: payload.shelfLifeTier,
      supplierLeadTimeTier: payload.supplierLeadTimeTier,
      packageSizeTier: payload.packageSizeTier,
      packingType: payload.packingType,
      handlingFlags: payload.handlingFlags ?? '',
      certificationFlags: payload.certificationFlags ?? '',
      supplierMaxCapacity: payload.supplierMaxCapacity,
    },
    reviewStatus: payload.reviewStatus,
    itemStatus: payload.itemStatus,
    submissionCount: payload.submissionCount,
    actions: toProductActionAvailability(payload),
    customFieldValues: payload.customFieldValues ?? {},
  };
}

/**
 * 表單 → POST/PUT 的 body。
 *
 * ⚠️ PUT 是整份覆蓋，所以這裡把**所有**欄位都送出（包含使用者沒動的），
 * 不做「只送有變動的欄位」的最佳化——那會讓沒送的欄位在後端變成 null。
 *
 * ⚠️ marketPrice 只在 RESALE 時送。NEW 商品送了會被後端以 400 擋下
 * （"市售價格僅適用於再販售(RESALE)商品"），所以在這裡就過濾掉，
 * 而不是讓使用者送出後才看到錯誤。
 *
 * ⚠️ campaignTags 一律用半形逗號 join：ScoringService.splitTags()
 * 只吃 split(",")，用全形頓號會讓節慶比對整組失效且不會報錯。
 */
export function toProductRequestPayload(
  form: ProductFormModel,
): ProductCreateRequestPayload {
  if (form.core.productTypeId === null) {
    throw new Error('productTypeId 為必填，送出前應由表單驗證擋下');
  }
  if (form.core.pricingType === '') {
    throw new Error('pricingType 為必填，送出前應由表單驗證擋下');
  }

  const isResale = form.core.pricingType === 'RESALE';

  return {
    productTypeId: form.core.productTypeId,
    pricingType: form.core.pricingType,
    name: form.base.name.trim(),
    description: form.base.description.trim() || null,
    imageUrl: form.base.imageUrl.trim() || null,
    supplierName: form.base.supplierName.trim() || null,
    costPrice: form.core.costPrice,
    salePrice: form.core.salePrice,
    marketPrice: isResale ? form.core.marketPrice : null,
    campaignTags: joinCampaignTags(form.core.campaignTags) || null,
    moq: form.core.moq,
    supplyStability: form.core.supplyStability,
    priceCompetitiveness: form.core.priceCompetitiveness,
    targetCustomerDescription: form.core.targetCustomerDescription.trim() || null,
    estimatedPurchaseRate: form.core.estimatedPurchaseRate,
  };
}

// =========================================================================
// 詳情頁：合併四支 API
// =========================================================================

export interface MatchedCampaignModel {
  campaignId: number;
  campaignName: string;
  matchedTags: string[];
  matchWeight: number | null;
  urgencyFactor: number | null;
  /** 2026-09-24（V21）：命中期間與地域的顯示文字；舊快照沒有這些資訊時為 null。 */
  scopeText: string | null;
}

/**
 * 命中檔期的「期間＋地域」顯示文字，例：「2026-06-19 – 2026-06-21 · 南部」、「2026-02-17 · 全國（已覆寫）」。
 * 審核詳情與品項詳情共用。V21 之前的舊快照沒有期間資訊，回傳 null（畫面不顯示這一行）。
 */
export function describeMatchedCampaignScope(payload: MatchedCampaignPayload | null): string | null {
  if (!payload?.occurrenceStartDate) return null;
  const end = payload.occurrenceEndDate;
  const period =
    end && end !== payload.occurrenceStartDate
      ? `${payload.occurrenceStartDate} – ${end}`
      : payload.occurrenceStartDate;
  const regions = payload.regions ?? [];
  const regionText = regions.length === 0 ? '全國' : regions.map((r) => WEATHER_REGION_LABEL[r] ?? r).join('、');
  return `${period} · ${regionText}${payload.occurrenceOverridden ? '（已覆寫）' : ''}`;
}

export interface ProductDetailModel {
  // --- 基本資料（GET /api/products/{id}）---
  id: number;
  name: string;
  description: string;
  imageUrl: string | null;
  productTypeId: number | null;
  productTypeName: string;
  pricingType: PricingType;
  pricingStatus: PricingStatus;
  supplierName: string;
  costPrice: number | null;
  salePrice: number | null;
  marketPrice: number | null;
  campaignTags: string[];
  moq: number | null;
  supplyStability: number | null;
  priceCompetitiveness: number | null;
  targetCustomerDescription: string;
  estimatedPurchaseRate: number | null;
  reviewStatus: ReviewStatus;
  itemStatus: ItemStatus;
  candidateStatus: CandidateStatus;
  submissionCount: number;
  updatedAt: string | null;
  actions: ProductActionAvailability;

  // --- 評估（GET /api/products/{id}/evaluation），可能因單獨失敗而為 null ---
  hasEvaluation: boolean;
  dataSource: DataSource;
  evaluationModeName: string;
  evaluationModeVersion: number | null;
  weights: WeightSnapshotPayload | null;
  businessScore: number | null;
  audienceScore: number | null;
  historicalScore: number | null;
  purchaseScore: number | null;
  trendScore: number | null;
  forecastScore: number | null;
  /** Base Score。 */
  totalScore: number | null;
  dataCompleteness: number | null;
  festivalBoost: number | null;
  finalScore: number | null;

  // --- 節慶（GET /api/products/{id}/festival-boost）---
  matchedCampaign: MatchedCampaignModel | null;

  // --- 衍生的顯示判斷 ---
  /** marketPrice 只有 RESALE 才有值，比價區塊的顯示條件。 */
  showPriceComparison: boolean;
  /** 相對市價的折扣率（%），無市價時為 null。 */
  discountRate: number | null;
  /** 毛利率（%），成本或售價缺一即為 null。 */
  marginRate: number | null;
}

function toMatchedCampaignModel(
  payload: MatchedCampaignPayload | null,
): MatchedCampaignModel | null {
  if (!payload) return null;
  return {
    campaignId: payload.campaignId,
    campaignName: payload.campaignName,
    matchedTags: payload.matchedTags ?? [],
    matchWeight: payload.matchWeight,
    urgencyFactor: payload.urgencyFactor,
    scopeText: describeMatchedCampaignScope(payload),
  };
}

/**
 * 把三支 API 的結果組成同一個詳情 View Model。
 *
 * evaluation／festival 允許為 null：這兩個是可選區塊，
 * 呼叫端用 catchError(() => of(null)) 讓它們單獨失敗時降級，
 * 而不是讓整頁變成 error——商品基本資料還在，沒有理由整頁空白。
 *
 * ⚠️ 分數一律以 evaluation 為單一真實來源，festivalBoost 也讀 evaluation。
 * FestivalBoostResponse 雖然也有 festivalBoost／finalScore，但只取檔期明細，
 * 避免兩支 API 若不同步時畫面出現兩個互相矛盾的數字。
 */
export function toProductDetailModel(
  product: ProductResponsePayload,
  evaluation: EvaluationResponsePayload | null,
  festival: FestivalBoostResponsePayload | null,
  productTypeName: string = NOT_PROVIDED,
): ProductDetailModel {
  const isResale = product.pricingType === 'RESALE';
  const showPriceComparison = isResale && product.marketPrice !== null;

  const discountRate =
    product.marketPrice && product.salePrice
      ? Math.round((1 - product.salePrice / product.marketPrice) * 1000) / 10
      : null;

  const marginRate =
    product.salePrice && product.costPrice !== null && product.salePrice !== 0
      ? Math.round(((product.salePrice - product.costPrice) / product.salePrice) * 1000) / 10
      : null;

  return {
    id: product.id,
    name: product.name,
    description: product.description ?? '',
    imageUrl: product.imageUrl,
    productTypeId: product.productTypeId,
    productTypeName,
    pricingType: product.pricingType,
    pricingStatus: product.pricingStatus,
    supplierName: product.supplierName ?? NOT_PROVIDED,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    marketPrice: product.marketPrice,
    campaignTags: splitCampaignTags(product.campaignTags),
    moq: product.moq,
    supplyStability: product.supplyStability,
    priceCompetitiveness: product.priceCompetitiveness,
    targetCustomerDescription: product.targetCustomerDescription ?? '',
    estimatedPurchaseRate: product.estimatedPurchaseRate,
    reviewStatus: product.reviewStatus,
    itemStatus: product.itemStatus,
    candidateStatus: product.candidateStatus,
    submissionCount: product.submissionCount,
    updatedAt: product.updatedAt,
    actions: toProductActionAvailability(product),

    hasEvaluation: evaluation !== null,
    // 沒拿到 evaluation 時預設 LIVE，不要用 reviewStatus 反推 SNAPSHOT——
    // 那會在載入失敗時對使用者謊稱「這是已凍結的數字」。
    dataSource: evaluation?.dataSource ?? 'LIVE',
    evaluationModeName: evaluation?.evaluationModeName ?? NOT_PROVIDED,
    evaluationModeVersion: evaluation?.evaluationModeVersion ?? null,
    weights: evaluation?.weights ?? null,
    businessScore: evaluation?.businessScore ?? null,
    audienceScore: evaluation?.audienceScore ?? null,
    historicalScore: evaluation?.historicalScore ?? null,
    purchaseScore: evaluation?.purchaseScore ?? null,
    trendScore: evaluation?.trendScore ?? null,
    forecastScore: evaluation?.forecastScore ?? null,
    totalScore: evaluation?.totalScore ?? null,
    dataCompleteness: evaluation?.dataCompleteness ?? null,
    festivalBoost: evaluation?.festivalBoost ?? null,
    finalScore: evaluation?.finalScore ?? null,

    matchedCampaign: toMatchedCampaignModel(festival?.matchedCampaign ?? null),

    showPriceComparison,
    discountRate,
    marginRate,
  };
}

// =========================================================================
// AI 分析與趨勢
// =========================================================================

export interface AiAnalysisModel {
  /** false 代表後端回了空物件（尚未生成），要顯示 Empty 狀態而非錯誤。 */
  hasAnalysis: boolean;
  summary: string;
  recommendation: string;
  /** 後端存的是單一字串，不是陣列；要條列顯示得自己依換行拆。 */
  reasons: string;
  modelName: string | null;
  /** modelName 為 MOCK-LLM-v1 時為 true，畫面應標示「模擬資料」。 */
  isMockData: boolean;
  generatedAt: string | null;
}

const MOCK_MODEL_NAME = 'MOCK-LLM-v1';

export function toAiAnalysisModel(payload: AiAnalysisResponsePayload): AiAnalysisModel {
  // 判斷依據用 summary 而非整個物件是否存在：後端「無快取」時回的是
  // 200 + 全欄位 null 的物件，物件本身一定存在。
  const hasAnalysis = payload.summary !== null && payload.summary.trim() !== '';

  return {
    hasAnalysis,
    summary: payload.summary ?? '',
    recommendation: payload.recommendation ?? '',
    reasons: payload.reasons ?? '',
    modelName: payload.modelName,
    isMockData: payload.modelName === MOCK_MODEL_NAME,
    generatedAt: payload.generatedAt,
  };
}

export interface TrendModel {
  source: string | null;
  keyword: string | null;
  trendScore: number | null;
  popularityScore: number | null;
  trendDirection: TrendDirection;
  /** ⚠️ 後端型別是 String，格式類似 "2026-08-22T14:30:00"，要顯示得自己 parse。 */
  collectedAt: string | null;
}

export function toTrendModel(payload: TrendSnapshotPayload): TrendModel {
  return {
    source: payload.source,
    keyword: payload.keyword,
    trendScore: payload.trendScore,
    popularityScore: payload.popularityScore,
    trendDirection: payload.trendDirection ?? 'STABLE',
    collectedAt: payload.collectedAt,
  };
}
