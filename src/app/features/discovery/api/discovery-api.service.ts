/**
 * 檔案用途：PTT 新品探索（2026-09-29，第一階段）的 API 與型別。
 *
 * 對應後端 DiscoveryController：
 * - GET  /api/discoveries                  探索結果清單（兩個角色都可讀）
 * - POST /api/discoveries/{id}/dismiss     略過（僅操作層）
 * - POST /api/discoveries/{id}/restore     移回待處理（僅操作層）
 * - GET  /api/settings/discovery           排程狀態與執行紀錄（僅管理層）
 * - POST /api/settings/discovery/run       立即執行一次（僅管理層，202 後輪詢 GET）
 *
 * 「建立商品」沒有獨立端點：走既有 POST /api/products，body 帶 discoveredItemId
 * （見 ProductCreateRequestPayload.discoveredItemId），後端在同一個交易裡標記成已建立商品。
 *
 * ⚠️ 熱度與提及篇數都是「PTT 討論量」，不是銷量，畫面文案不可寫成銷售預測。
 *
 * 第二階段（2026-09-29）：
 * - 適配評分＝AI 分數（fitScore＋理由＋疑慮）與規則判定的溫層（temperatureGate）並列，刻意不合成加權總分。
 * - 略過必須選原因代碼（dismissReasonCode），會回饋到下一次探索。
 * - Google 趨勢交叉驗證：每次只查適配分最高的前幾項，其餘為 null＝未查。
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiEnvelope, Decimal, PageEnvelope } from '../../../core/api/api-envelope';
import { buildParams } from '../../../core/api/http-params';
import { PagedResult, unwrapData, unwrapPage } from '../../../core/api/unwrap';
import { GateStatus, TemperatureZone } from '../../../core/domain/enums';
import { TrendSyncRunStatus, TrendSyncTrigger } from '../../settings/api/trend-crawler-api.service';

export type DiscoveredItemStatus = 'NEW' | 'DISMISSED' | 'CONVERTED';
export type DiscoveryTrendDirection = 'UP' | 'DOWN' | 'STABLE';
/** 對應後端 DiscoveredItemService.Sort。 */
export type DiscoverySort = 'FIT' | 'BUZZ' | 'RECENT';
/** 對應後端 enums/DiscoveryDismissReason。 */
export type DiscoveryDismissReason = 'NOT_A_PRODUCT' | 'NOT_FOR_GROUP_BUY' | 'OUT_OF_SCOPE' | 'SIMILAR_EXISTS' | 'OTHER';
/** 對應後端 GoogleTrendStatus（探索只會出現這兩種；未查為 null）。 */
export type DiscoveryGoogleStatus = 'OK' | 'NO_DATA';

/**
 * 略過原因，順序即畫面選項順序（「其他」固定最後）。
 * hint 說明這個原因會怎麼回饋到下一次探索，讓操作人員知道選哪個有差別。
 */
export const DISCOVERY_DISMISS_REASONS: readonly { code: DiscoveryDismissReason; label: string; hint: string }[] = [
  { code: 'NOT_A_PRODUCT', label: '不是實體商品', hint: 'AI 之後不會再從標題抽出類似的名稱。' },
  { code: 'NOT_FOR_GROUP_BUY', label: '不適合團購', hint: '之後 AI 評適配分時會把它當作反例。' },
  { code: 'OUT_OF_SCOPE', label: '超出經營品類', hint: '之後 AI 評適配分時會把它當作反例。' },
  { code: 'SIMILAR_EXISTS', label: '已有類似商品', hint: '之後 AI 評適配分時會把它當作反例。' },
  { code: 'OTHER', label: '其他', hint: '請在補充說明寫下原因；之後 AI 評適配分時會把它當作反例。' },
];

export const DISCOVERY_DISMISS_REASON_LABEL: Record<DiscoveryDismissReason, string> = Object.fromEntries(
  DISCOVERY_DISMISS_REASONS.map((reason) => [reason.code, reason.label]),
) as Record<DiscoveryDismissReason, string>;

/** 對應後端 DiscoveredItemResponse.Evidence。url 是完整 PTT 網址。 */
export interface DiscoveryEvidence {
  board: string;
  url: string;
  title: string;
  pushVolume: number;
  postedAt: string;
}

/** 對應後端 DiscoveredItemResponse。 */
export interface DiscoveredItem {
  id: number;
  displayName: string;
  /** 標題裡最常出現的寫法，查 PTT 熱度時用這個關鍵字（建立商品時帶入的是 displayName）。 */
  searchKeyword: string;
  /** AI 猜測的品類（「大類/小類」），僅供參考；對不上現有品類時為 null。 */
  categoryHint: string | null;
  productTypeId: number | null;
  status: DiscoveredItemStatus;
  /** 最近一次探索時，近 7 天提及的文章數。 */
  mentionCount: number;
  pushVolume: number;
  /** 90 天 PTT 熱度（與商品熱度同一套換算）；只有當次前幾名才會查，其餘為 null＝未查。 */
  popularityScore: Decimal;
  trendScore: Decimal;
  trendDirection: DiscoveryTrendDirection | null;
  windowVolume: number | null;
  buzzCheckedAt: string | null;
  /** AI 適配分 0~100（依目前啟用的核心客群與團購通路條件）；未評分為 null。這是 AI 的意見，必附理由。 */
  fitScore: Decimal;
  fitReason: string | null;
  /** AI 列出的疑慮，最多 3 項；沒有為空陣列。 */
  fitConcerns: string[];
  fitEvaluatedAt: string | null;
  /** 品類預設溫層；品類未判定為 null。 */
  temperatureZone: TemperatureZone | null;
  /**
   * 通路是否支援此溫層（規則判定，不是 AI）。FAILED＝確定不能出貨；
   * INSUFFICIENT_DATA＝品類沒判定出來、無法判斷，兩者不可混為一談。
   */
  temperatureGate: GateStatus | null;
  /** Google 趨勢交叉驗證；未查為 null。 */
  googleStatus: DiscoveryGoogleStatus | null;
  googleDirection: DiscoveryTrendDirection | null;
  /** 近期相對基準期成長率（%）。 */
  googleGrowthRate: Decimal;
  googleCheckedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  convertedProductId: number | null;
  /** 第二階段之前的略過紀錄沒有代碼，為 null（只顯示 dismissReason 原文）。 */
  dismissReasonCode: DiscoveryDismissReason | null;
  dismissReason: string | null;
  handledByName: string | null;
  handledAt: string | null;
  /** 佐證文章，新到舊，最多 5 篇。 */
  evidence: DiscoveryEvidence[];
}

export interface DiscoveryListQuery {
  status?: DiscoveredItemStatus;
  /** 只看最近幾天內仍被提及的項目；不帶時 NEW 預設 14 天、其餘不限；0＝不限。 */
  recentDays?: number;
  /** 不帶時後端預設 FIT。 */
  sort?: DiscoverySort;
  page?: number;
  size?: number;
}

/** 對應後端 DiscoveryRunResponse。 */
export interface DiscoveryRun {
  id: number;
  triggerType: TrendSyncTrigger;
  status: TrendSyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  postCount: number;
  titleCount: number;
  aiCallCount: number;
  extractedCount: number;
  rejectedCount: number;
  matchedExistingCount: number;
  /** 與已略過項目名稱非常相似而排除的筆數。 */
  similarDismissedCount: number;
  newCount: number;
  updatedCount: number;
  /** 本次完成 AI 適配評分的項目數。 */
  fitCount: number;
  /** 本次查詢 Google 趨勢的項目數。 */
  googleCount: number;
  message: string | null;
  triggeredByName: string | null;
}

/** 對應後端 DiscoveryStatusResponse。 */
export interface DiscoveryStatus {
  pttEnabled: boolean;
  /** 是否已設定探索用的 AI 金鑰（GROQ_API_KEY）。2026-09-29 由 geminiConfigured 改名：探索改用 Groq。 */
  aiConfigured: boolean;
  running: boolean;
  schedule: string;
  aiCallsThisMonth: number;
  aiMonthlyLimit: number;
  recentRuns: DiscoveryRun[];
}

@Injectable({ providedIn: 'root' })
export class DiscoveryApiService {
  private readonly http = inject(HttpClient);

  list(query: DiscoveryListQuery = {}): Observable<PagedResult<DiscoveredItem>> {
    return this.http
      .get<ApiEnvelope<PageEnvelope<DiscoveredItem>>>('/api/discoveries', { params: buildParams(query) })
      .pipe(unwrapPage((item: DiscoveredItem) => item));
  }

  /** reason 是選填的補充說明；空白不送。 */
  dismiss(id: number, reasonCode: DiscoveryDismissReason, reason?: string): Observable<DiscoveredItem> {
    const trimmed = reason?.trim();
    return this.http
      .post<ApiEnvelope<DiscoveredItem>>(
        `/api/discoveries/${id}/dismiss`,
        trimmed ? { reasonCode, reason: trimmed } : { reasonCode },
      )
      .pipe(unwrapData());
  }

  restore(id: number): Observable<DiscoveredItem> {
    return this.http.post<ApiEnvelope<DiscoveredItem>>(`/api/discoveries/${id}/restore`, {}).pipe(unwrapData());
  }

  getStatus(): Observable<DiscoveryStatus> {
    return this.http.get<ApiEnvelope<DiscoveryStatus>>('/api/settings/discovery').pipe(unwrapData());
  }

  /** ⚠️ PTT 停用、未設定 AI 金鑰或已在執行時回 409。 */
  run(): Observable<DiscoveryStatus> {
    return this.http.post<ApiEnvelope<DiscoveryStatus>>('/api/settings/discovery/run', {}).pipe(unwrapData());
  }
}
