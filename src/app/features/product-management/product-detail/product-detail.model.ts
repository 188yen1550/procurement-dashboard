/**
 * 檔案用途：品項詳情頁的 View Model 與轉換函式。
 *
 * ## 為什麼保留這個檔案，而不是改用 api/product.mapper.ts 的 ProductDetailModel
 *
 * 詳情頁樣板（233 行）依賴 DetailProduct 的 moq／supplyStability／audience／
 * historicalNote／trendDirection／aiReasons／risks 等欄位，那些是這一頁特有的
 * 展示需求。硬把它換成共用的 ProductDetailModel 會需要改整份樣板，
 * 而樣板本身沒有問題——為了「型別統一」去改一個能正常運作的頁面是過度工程。
 *
 * 兩者的分工：
 * - api/product.mapper.ts 的 ProductDetailModel：給之後新頁面用的通用模型
 * - 這裡的 DetailProduct：詳情頁專屬，欄位對齊既有樣板
 *
 * ## 這次的改動
 *
 * 只換 import 來源（product-api.contract → api/product-api.contract），
 * 並把原本因為舊 contract 缺欄位而填 0／NOT_PROVIDED 的欄位補成真實值——
 * 後端 ProductResponse 其實有 marketPrice／moq／supplyStability／
 * priceCompetitiveness／targetCustomerDescription，是舊 contract 沒定義而已。
 */
import {
  EvaluationResponsePayload,
  FestivalBoostResponsePayload,
  WeatherBoostDetailPayload,
  GateResultSummaryPayload,
  ProductResponsePayload,
} from '../api/product-api.contract';
import { describeMatchedCampaignScope } from '../api/product.mapper';
import {
  PackageSizeTier,
  PackingType,
  ScoreLevel,
  ShelfLifeTier,
  SupplierLeadTimeTier,
  TemperatureZone,
} from '../../../core/domain/enums';


/** 節慶加成上限改為可調（2026-09-29）之前寫死的值；舊快照沒有 boostCap 時沿用。 */
export const LEGACY_FESTIVAL_BOOST_CAP = 5;

export type DetailState = 'default' | 'locked' | 'loading' | 'empty' | 'error';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ItemStatus = 'ACTIVE' | 'ARCHIVED';

/** 詳情頁 View Model：樣板只認識這個型別，不認識後端 DTO。 */
export interface DetailProduct {
  id: number;
  name: string;
  category: string;
  pricingType: 'NEW' | 'RESALE';
  supplier: string;
  reviewStatus: ReviewStatus;
  itemStatus: ItemStatus;
  candidateStatus: string;
  submissionCount: number;
  dataSource: 'SNAPSHOT' | 'LIVE';
  evaluationModeName: string;
  completeness: number;
  baseScore: number | null;
  festivalBoost: number;
  /** V26 天氣加成；null＝V26 前核准、審核快照沒有這一項（畫面顯示「—」，不是 0）。 */
  weatherBoost: number | null;
  /** V26 天氣加成明細（festival-boost 端點附帶）；沒有時整個天氣區塊不顯示。 */
  weatherDetail: WeatherBoostDetailPayload | null;
  /**
   * ⚠️ 之前樣板把這兩個值寫死成 1.0／0.84，但後端 MatchedCampaignPayload
   * 其實有真實資料（見 api/product-api.contract.ts）。這裡補上正確欄位，
   * matchedCampaign 為 null（沒命中檔期）時兩者皆為 null。
   */
  matchWeight: number | null;
  urgencyFactor: number | null;
  /**
   * 2026-09-29：節慶加成上限（分），讀命中檔期快照記錄的值；舊快照或未命中時為 5
   * （上限改為可調之前寫死的值）。
   */
  festivalBoostCap: number;
  finalScore: number | null;
  campaign: string | null;
  /** 2026-09-24（V21）：命中期間與地域，例「2026-06-19 – 2026-06-21 · 南部」；舊快照為 null。 */
  campaignScope: string | null;
  matchedTags: string[];
  costPrice: number | null;
  salePrice: number | null;
  marketPrice: number | null;
  moq: number;
  /** ⚠️ 1–5 整數等級，非百分比。null 代表尚未設定，畫面顯示「未設定」。 */
  supplyStability: ScoreLevel | null;
  /** ⚠️ 1–5 整數等級，非百分比。null 代表尚未設定，畫面顯示「未設定」。 */
  priceCompetitiveness: ScoreLevel | null;
  audienceScore: number;
  audience: string;
  historicalScore: number;
  historicalNote: string;
  purchaseScore: number;
  trendScore: number;
  trendDirection: 'UP' | 'STABLE' | 'DOWN';
  lastSyncedAt: string;
  /** 最新一筆趨勢資料的來源：'PTT'（真實討論量）或 'SIMULATED'（PTT 取不到時的備援）；尚無資料為 null。 */
  trendSource: string | null;
  /** 實際拿去搜尋的關鍵字（商品名稱去掉規格字樣後）。 */
  trendKeyword: string | null;
  /** 熱度分數 0–100（熱度排行榜排序、評分因子）。 */
  popularityScore: number | null;
  aiSummary: string | null;
  aiReasons: string[];
  risks: string[];
  description: string;
  imageUrl: string | null;
  /**
   * 以下 9 個欄位供 Gate 判定使用，語意見 ProductResponsePayload 同名欄位
   * 的註解。詳情頁純顯示，不提供編輯——編輯要到品項編輯表單進行。
   */
  temperatureZone: TemperatureZone | null;
  shelfLifeTier: ShelfLifeTier | null;
  supplierLeadTimeTier: SupplierLeadTimeTier | null;
  packageSizeTier: PackageSizeTier | null;
  packingType: PackingType | null;
  handlingFlags: string | null;
  certificationFlags: string | null;
  supplierMaxCapacity: number | null;
  /**
   * ⚠️ 後端只有單筆詳情（GET /api/products/{id}）才會回傳，undefined 代表
   * 這個商品的 Gate 判定還沒被計算過（理論上不會發生，因為 detail 頁
   * 本身就是靠這支端點取得資料）——保留 undefined 分支純粹是型別上的
   * 防禦，畫面遇到時顯示「尚無 Gate 判定資料」而不是報錯。
   */
  gateResults: GateResultSummaryPayload | null;
}

/**
 * 後端目前確實無法提供的欄位一律用這個常數，不要用假資料填補。
 *
 * 對照後端原始碼後，剩下真正拿不到的只有三個：
 * - category：ProductResponse 只有 productTypeId，名稱要對照 GET /api/settings/product-types，
 *   由呼叫端傳入（見 toDetailProduct 的 productTypeName 參數）
 * - historicalNote：後端無此欄位，且 calculateHistoricalScore() 目前回固定值
 * - risks：風險是審核時由主管勾選 risk_options，不是商品屬性，商品 API 不會有
 */
export const NOT_PROVIDED = '（後端尚未提供）';

/** AI 分析與趨勢由 detail 頁另外呼叫，可為 null。 */
export interface DetailExtras {
  aiSummary: string | null;
  aiReasons: string[];
  trendDirection: 'UP' | 'STABLE' | 'DOWN';
  lastSyncedAt: string;
  trendSource: string | null;
  trendKeyword: string | null;
  popularityScore: number | null;
}

export function toDetailProduct(
  product: ProductResponsePayload,
  evaluation: EvaluationResponsePayload | null,
  festival: FestivalBoostResponsePayload | null,
  productTypeName: string = NOT_PROVIDED,
  extras?: Partial<DetailExtras>,
): DetailProduct {
  return {
    id: product.id,
    name: product.name,
    category: productTypeName,
    pricingType: product.pricingType,
    supplier: product.supplierName ?? NOT_PROVIDED,
    reviewStatus: product.reviewStatus,
    itemStatus: product.itemStatus,
    candidateStatus: product.candidateStatus,
    submissionCount: product.submissionCount,
    // 資料來源以後端回傳為準，不要用 reviewStatus 反推。
    dataSource: evaluation?.dataSource ?? 'LIVE',
    evaluationModeName: evaluation?.evaluationModeName ?? NOT_PROVIDED,
    // ⚠️ 完整度只在 evaluation。ProductResponse 沒有 completenessPercent 這個欄位
    //（舊 contract 誤以為有），evaluation 載入失敗時只能顯示 0。
    completeness: evaluation?.dataCompleteness ?? 0,
    baseScore: evaluation?.totalScore ?? null,
    // ⚠️ 2026-09-27 修正：節慶加成、天氣加成、最終分數改以 festival-boost 的回應為準。
    // 原本這三項讀 evaluation（上次重算時存下的值），急迫係數／命中度／天氣明細卻讀
    // festival-boost（LIVE 是即時計算），兩者不同步時會出現「急迫係數 100%、命中核心
    // 標籤，加成卻是 +4.9」這種明細算不回總數的畫面。festival-boost 的加成與急迫係數
    // 出自同一次計算（SNAPSHOT 則同一筆審核紀錄），最終分數也由後端用同一組加成組成。
    // festival-boost 載入失敗時才退回 evaluation 的存檔值。
    festivalBoost: festival ? (festival.festivalBoost ?? 0) : (evaluation?.festivalBoost ?? 0),
    weatherBoost: festival
      ? (festival.weatherBoost ?? null)
      : evaluation
        ? (evaluation.weatherBoost ?? null)
        : 0,
    weatherDetail: festival?.weatherBoostDetail ?? null,
    finalScore: festival ? (festival.finalScore ?? null) : (evaluation?.finalScore ?? null),
    campaign: festival?.matchedCampaign?.campaignName ?? null,
    campaignScope: describeMatchedCampaignScope(festival?.matchedCampaign ?? null),
    matchedTags: festival?.matchedCampaign?.matchedTags ?? [],
    matchWeight: festival?.matchedCampaign?.matchWeight ?? null,
    urgencyFactor: festival?.matchedCampaign?.urgencyFactor ?? null,
    festivalBoostCap: festival?.matchedCampaign?.boostCap ?? LEGACY_FESTIVAL_BOOST_CAP,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    // ⚠️ 僅 RESALE 有值；NEW 商品後端會拒絕寫入市價。
    marketPrice: product.marketPrice,
    moq: product.moq ?? 0,
    // ⚠️ 1–5 整數等級，不是百分比也不是 0–5 分制小數。這裡不補 0 這種
    // fallback——0 不是合法等級，跟「尚未設定」意義不同，null 直接
    // 原封傳給樣板，由樣板顯示「未設定」（見 product-detail.html）。
    supplyStability: product.supplyStability,
    priceCompetitiveness: product.priceCompetitiveness,
    audienceScore: evaluation?.audienceScore ?? 0,
    audience: product.targetCustomerDescription ?? NOT_PROVIDED,
    historicalScore: evaluation?.historicalScore ?? 0,
    historicalNote: NOT_PROVIDED,
    purchaseScore: evaluation?.purchaseScore ?? 0,
    trendScore: evaluation?.trendScore ?? 0,
    // 趨勢方向、來源與同步時間來自 GET /api/products/{id}/trend（唯讀，不觸發爬蟲）；
    // 尚無趨勢資料時預設 STABLE、lastSyncedAt 為空字串（畫面顯示「尚無趨勢資料」）。
    trendDirection: extras?.trendDirection ?? 'STABLE',
    lastSyncedAt: extras?.lastSyncedAt ?? '',
    trendSource: extras?.trendSource ?? null,
    trendKeyword: extras?.trendKeyword ?? null,
    popularityScore: extras?.popularityScore ?? null,
    aiSummary: extras?.aiSummary ?? null,
    aiReasons: extras?.aiReasons ?? [],
    // 風險是審核時由主管勾選 risk_options 的結果，不是商品屬性，
    // 商品相關 API 永遠不會有這個欄位。要顯示請改讀審核紀錄。
    risks: [],
    description: product.description ?? '',
    imageUrl: product.imageUrl,
    temperatureZone: product.temperatureZone,
    shelfLifeTier: product.shelfLifeTier,
    supplierLeadTimeTier: product.supplierLeadTimeTier,
    packageSizeTier: product.packageSizeTier,
    packingType: product.packingType,
    handlingFlags: product.handlingFlags,
    certificationFlags: product.certificationFlags,
    supplierMaxCapacity: product.supplierMaxCapacity,
    gateResults: product.gateResults ?? null,
  };
}
