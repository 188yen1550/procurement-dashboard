/**
 * 檔案用途：Google 趨勢參考（SerpApi）的 API——品項詳情頁的單一商品查詢，
 * 以及系統設定「排程作業：Google 趨勢參考」控制面板。
 *
 * 對應後端 GoogleTrendController：
 * - GET  /api/products/{id}/google-trend          操作＋管理，唯讀、不花額度
 * - POST /api/products/{id}/google-trend/sync     限管理層，花 1 次額度
 * - GET／PUT enabled／POST sync-top /api/settings/google-trends  限管理層
 *
 * ⚠️ Google 趨勢只提供「方向與成長率」，是獨立參考資訊，不併入熱度分數：
 * Google 的 0～100 是相對於該次查詢峰值的縮放，不同商品之間不可比。
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiEnvelope } from '../../../core/api/api-envelope';
import { unwrapData } from '../../../core/api/unwrap';
import { TrendSyncRunStatus, TrendSyncTrigger } from './trend-crawler-api.service';

const SETTINGS_BASE = '/api/settings/google-trends';

export type GoogleTrendStatus = 'OK' | 'NO_DATA';
export type GoogleTrendDirection = 'UP' | 'DOWN' | 'STABLE';

/** 對應後端 GoogleTrendSignalResponse。數字欄位是 BigDecimal，JSON 為數字。 */
export interface GoogleTrendSignal {
  productId: number;
  keyword: string;
  status: GoogleTrendStatus;
  /** NO_DATA 時為 null。 */
  direction: GoogleTrendDirection | null;
  /** 近 7 天相對前 4 週的成長率（%）；基準期為 0 或 NO_DATA 時為 null。 */
  growthRate: number | null;
  recentAvg: number | null;
  baselineAvg: number | null;
  pointCount: number;
  collectedAt: string;
}

/** 精簡顯示用（熱度建議清單、熱度排行榜）：方向＋成長率一行字。 */
export interface GoogleTrendSummary {
  direction: GoogleTrendDirection | null;
  /** 例如「+25.7%」「搜尋量不足」「尚未查詢」。 */
  text: string;
}

/**
 * Google 趨勢 → 一行摘要。沒查過、查無資料都明講，不顯示成 0 或「持平」，
 * 避免把「沒有資料」誤看成「熱度沒變」。
 */
export function summarizeGoogleTrend(signal: GoogleTrendSignal | null | undefined): GoogleTrendSummary {
  if (!signal) return { direction: null, text: '尚未查詢' };
  if (signal.status === 'NO_DATA') return { direction: null, text: '搜尋量不足' };
  if (signal.growthRate === null) return { direction: signal.direction, text: '近期開始出現' };
  const rounded = roundGrowthRate(signal.growthRate);
  return { direction: signal.direction, text: `${rounded > 0 ? '+' : ''}${rounded}%` };
}

/**
 * 成長率四捨五入到一位。不能直接 Math.round：它對負數的 .5 會往 0 靠
 * （-13.85 → -13.8），跟後端 HALF_UP 與一般人的四捨五入不一致。
 */
export function roundGrowthRate(value: number): number {
  return (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
}

/** 對應後端 GoogleTrendRunResponse。 */
export interface GoogleTrendRun {
  id: number;
  triggerType: TrendSyncTrigger;
  status: TrendSyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  totalCount: number;
  okCount: number;
  noDataCount: number;
  failedCount: number;
  message: string | null;
  triggeredByName: string | null;
}

/** 對應後端 GoogleTrendStatusResponse。 */
export interface GoogleTrendsStatus {
  enabled: boolean;
  /** 後端是否已設定 SerpApi 金鑰（只有布林值，不會回傳金鑰）。 */
  keyConfigured: boolean;
  usedThisMonth: number;
  monthlyLimit: number;
  running: boolean;
  processedCount: number | null;
  totalCount: number | null;
  batchSize: number;
  schedule: string;
  recentRuns: GoogleTrendRun[];
}

@Injectable({ providedIn: 'root' })
export class GoogleTrendsApiService {
  private readonly http = inject(HttpClient);

  /** 最新一筆；尚未查詢過為 null。 */
  getLatest(productId: string | number): Observable<GoogleTrendSignal | null> {
    return this.http
      .get<ApiEnvelope<GoogleTrendSignal | null>>(`/api/products/${productId}/google-trend`)
      .pipe(unwrapData());
  }

  /** ⚠️ 花 1 次 SerpApi 額度；停用、無金鑰、額度用完回 409，SerpApi 失敗回 502。 */
  sync(productId: string | number): Observable<GoogleTrendSignal> {
    return this.http
      .post<ApiEnvelope<GoogleTrendSignal>>(`/api/products/${productId}/google-trend/sync`, {})
      .pipe(unwrapData());
  }

  getStatus(): Observable<GoogleTrendsStatus> {
    return this.http.get<ApiEnvelope<GoogleTrendsStatus>>(SETTINGS_BASE).pipe(unwrapData());
  }

  setEnabled(enabled: boolean): Observable<GoogleTrendsStatus> {
    return this.http
      .put<ApiEnvelope<GoogleTrendsStatus>>(`${SETTINGS_BASE}/enabled`, { enabled })
      .pipe(unwrapData());
  }

  /** 背景執行、立即回 202；進度請輪詢 getStatus()。 */
  syncTop(): Observable<GoogleTrendsStatus> {
    return this.http.post<ApiEnvelope<GoogleTrendsStatus>>(`${SETTINGS_BASE}/sync-top`, {}).pipe(unwrapData());
  }
}
