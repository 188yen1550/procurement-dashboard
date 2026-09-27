/**
 * 檔案用途：系統設定 › 爬蟲排程控制（PTT 熱度來源開關、立即同步全部商品、執行紀錄）的 API。
 *
 * 對應後端 TrendCrawlerController（/api/settings/trend-crawler，三支都限定 MANAGER）。
 * 獨立成一個 service，不併入 settings-api.service.ts：這組端點只有這個面板用到。
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiEnvelope } from '../../../core/api/api-envelope';
import { unwrapData } from '../../../core/api/unwrap';

const BASE = '/api/settings/trend-crawler';

export type TrendSyncTrigger = 'SCHEDULED' | 'MANUAL';
export type TrendSyncRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

/** 對應後端 TrendSyncRunResponse。時間是不帶時區的 LocalDateTime 字串。 */
export interface TrendSyncRun {
  id: number;
  triggerType: TrendSyncTrigger;
  status: TrendSyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  totalCount: number;
  realCount: number;
  fallbackCount: number;
  failedCount: number;
  message: string | null;
  /** 手動觸發的管理者名稱；排程觸發為 null。 */
  triggeredByName: string | null;
}

/** 對應後端 TrendCrawlerStatusResponse。 */
export interface TrendCrawlerStatus {
  enabled: boolean;
  running: boolean;
  /** 執行中時已處理的商品數；未執行時為 null。 */
  processedCount: number | null;
  totalCount: number | null;
  schedule: string;
  /** 最近 10 次，新到舊。 */
  recentRuns: TrendSyncRun[];
}

@Injectable({ providedIn: 'root' })
export class TrendCrawlerApiService {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<TrendCrawlerStatus> {
    return this.http.get<ApiEnvelope<TrendCrawlerStatus>>(BASE).pipe(unwrapData());
  }

  setEnabled(enabled: boolean): Observable<TrendCrawlerStatus> {
    return this.http
      .put<ApiEnvelope<TrendCrawlerStatus>>(`${BASE}/enabled`, { enabled })
      .pipe(unwrapData());
  }

  /**
   * 後端建立執行紀錄後立即回 202，同步在背景進行；進度請輪詢 getStatus()。
   * ⚠️ PTT 來源停用中、或已有同步在執行時回 409。
   */
  syncAll(): Observable<TrendCrawlerStatus> {
    return this.http.post<ApiEnvelope<TrendCrawlerStatus>>(`${BASE}/sync-all`, {}).pipe(unwrapData());
  }
}
