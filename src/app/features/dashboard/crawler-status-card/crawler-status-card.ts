/**
 * 檔案用途：儀表板（僅管理層）「PTT 熱度同步」狀態摘要卡。
 *
 * 配置（啟用／停用、立即同步全部商品）留在 設定 › 評分規則 › 演算法參數 的控制面板；
 * 這裡只回答「爬蟲還活著嗎、上次跑得順不順」，要操作就點「前往管理」。
 * 刻意不放「立即同步」按鈕：兩處都能觸發，就要兩處同步「是否執行中」的狀態。
 *
 * 資料直接重用控制面板的 GET /api/settings/trend-crawler，不另開後端端點。
 * 自己獨立載入、自己處理失敗：這張卡讀不到時只有它顯示降級訊息，不影響儀表板其他區塊。
 */
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import {
  TrendCrawlerApiService,
  TrendCrawlerStatus,
  TrendSyncRun,
} from '../../settings/api/trend-crawler-api.service';

/** 卡片整體狀態，決定左側色條與標籤。 */
export type CrawlerCardTone = 'ok' | 'warn' | 'error' | 'muted';

export interface CrawlerCardSummary {
  tone: CrawlerCardTone;
  label: string;
  /** 最近一次「有實際執行」的紀錄（略過的不算）；從未執行過為 null。 */
  lastRun: TrendSyncRun | null;
  /** 需要管理層注意的事項（模擬資料、失敗、中斷），沒有就是空陣列。 */
  warnings: string[];
}

/** 從控制面板的狀態整理出卡片要顯示的內容；抽成純函式方便測試。 */
export function summarizeCrawlerStatus(status: TrendCrawlerStatus): CrawlerCardSummary {
  const lastRun = status.recentRuns.find((run) => run.status !== 'SKIPPED' && run.status !== 'RUNNING') ?? null;
  const warnings: string[] = [];
  if (lastRun?.status === 'FAILED') {
    warnings.push(lastRun.message ? `上次同步中斷：${lastRun.message}` : '上次同步中斷');
  }
  if (lastRun && lastRun.fallbackCount > 0) {
    warnings.push(`${lastRun.fallbackCount} 個商品 PTT 抓不到，改用模擬資料`);
  }
  if (lastRun && lastRun.failedCount > 0) {
    warnings.push(`${lastRun.failedCount} 個商品同步失敗`);
  }

  if (status.running) {
    const progress =
      status.processedCount === null || status.totalCount === null
        ? '準備中'
        : `${status.processedCount}/${status.totalCount}`;
    return { tone: 'ok', label: `同步中 ${progress}`, lastRun, warnings };
  }
  if (!status.enabled) {
    return { tone: 'muted', label: '已停用', lastRun, warnings };
  }
  if (lastRun?.status === 'FAILED' || (lastRun && lastRun.failedCount > 0)) {
    return { tone: 'error', label: '需要注意', lastRun, warnings };
  }
  if (warnings.length > 0) {
    return { tone: 'warn', label: '部分模擬資料', lastRun, warnings };
  }
  return { tone: 'ok', label: '啟用中', lastRun, warnings };
}

@Component({
  selector: 'app-crawler-status-card',
  imports: [DatePipe, RouterLink],
  templateUrl: './crawler-status-card.html',
  styleUrl: './crawler-status-card.scss',
})
export class CrawlerStatusCard implements OnInit {
  private readonly api = inject(TrendCrawlerApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<TrendCrawlerStatus | null>(null);
  readonly loadError = signal('');
  readonly summary = computed(() => {
    const status = this.status();
    return status ? summarizeCrawlerStatus(status) : null;
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadError.set('');
    this.api
      .getStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => this.status.set(status),
        error: (err: unknown) => this.loadError.set(toApiError(err).message),
      });
  }
}
