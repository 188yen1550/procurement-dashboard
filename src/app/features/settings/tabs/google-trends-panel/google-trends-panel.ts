/**
 * 檔案用途：設定 › 評分規則 › 演算法參數 › 排程作業：「Google 趨勢參考」控制面板。
 *
 * - 來源開關：預設停用（要花 SerpApi 額度的外部服務，不能自己開始呼叫）
 * - 本月用量／上限：SerpApi 免費方案每月 250 次，系統上限預設 200；「查無資料」也計費
 * - 立即查詢熱度前 N 名：只查最新一筆 PTT 熱度 > 0 的商品，後端背景執行，這裡輪詢進度
 * - 最近 10 次執行紀錄
 *
 * Google 趨勢是獨立參考資訊（方向與成長率），不併入熱度分數、不影響 AI 主動選品門檻。
 * 結構比照旁邊的 TrendCrawlerPanel。
 */
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, timer } from 'rxjs';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { GoogleTrendRun, GoogleTrendsApiService, GoogleTrendsStatus } from '../../api/google-trends-api.service';
import { TrendSyncRunStatus } from '../../api/trend-crawler-api.service';

export const GOOGLE_TRENDS_POLL_MS = 3_000;

const STATUS_LABEL: Record<TrendSyncRunStatus, string> = {
  RUNNING: '執行中',
  COMPLETED: '已完成',
  FAILED: '中斷',
  SKIPPED: '已略過',
};

const STATUS_BADGE: Record<TrendSyncRunStatus, string> = {
  RUNNING: 'badge-muted',
  COMPLETED: 'badge-success',
  FAILED: 'badge-error',
  SKIPPED: 'badge-muted',
};

@Component({
  selector: 'app-google-trends-panel',
  imports: [DatePipe],
  templateUrl: './google-trends-panel.html',
})
export class GoogleTrendsPanel implements OnInit {
  private readonly api = inject(GoogleTrendsApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly status = signal<GoogleTrendsStatus | null>(null);
  readonly loadError = signal('');
  readonly isSubmitting = signal(false);

  readonly running = computed(() => this.status()?.running ?? false);
  readonly enabled = computed(() => this.status()?.enabled ?? false);
  readonly remaining = computed(() => {
    const s = this.status();
    return s ? Math.max(0, s.monthlyLimit - s.usedThisMonth) : 0;
  });
  readonly usagePercent = computed(() => {
    const s = this.status();
    return s && s.monthlyLimit > 0 ? Math.min(100, Math.round((s.usedThisMonth / s.monthlyLimit) * 100)) : 0;
  });
  readonly canSyncTop = computed(() => {
    const s = this.status();
    return !!s && s.enabled && s.keyConfigured && this.remaining() > 0 && !s.running && !this.isSubmitting();
  });
  readonly progressText = computed(() => {
    const s = this.status();
    if (!s?.running) return '';
    if (s.totalCount === null || s.processedCount === null) return '正在挑選商品';
    return `已查詢 ${s.processedCount} / ${s.totalCount} 個商品`;
  });

  private pollSubscription: Subscription | null = null;

  ngOnInit(): void {
    if (!this.useMockData) this.load();
  }

  statusLabel(status: TrendSyncRunStatus): string {
    return STATUS_LABEL[status] ?? status;
  }

  statusBadge(status: TrendSyncRunStatus): string {
    return STATUS_BADGE[status] ?? 'badge-muted';
  }

  triggerLabel(run: GoogleTrendRun): string {
    const label = run.triggerType === 'SCHEDULED' ? '每週排程' : '手動觸發';
    return run.triggeredByName ? `${label}（${run.triggeredByName}）` : label;
  }

  toggleEnabled(): void {
    if (this.isSubmitting() || !this.status()) return;
    if (this.useMockData) {
      this.notifyMock();
      return;
    }
    const enable = !this.enabled();
    const lines = enable
      ? [
          '啟用後，每週一 04:00 會自動查詢 PTT 熱度前幾名商品的 Google 搜尋趨勢，管理層也可以在品項詳情頁手動查詢單一商品。',
          '每次查詢都會用掉 1 次 SerpApi 額度（含「查無資料」），到達本月上限後自動停止。',
          'Google 趨勢只作為參考資訊，不會改變熱度分數與 AI 主動選品結果。',
        ]
      : ['停用後不會再呼叫 SerpApi，既有的 Google 趨勢資料會保留。'];
    this.dialog
      .confirm(enable ? '要啟用 Google 趨勢來源嗎？' : '要停用 Google 趨勢來源嗎？', lines, enable ? '啟用' : '停用')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.isSubmitting.set(true);
        this.api
          .setEnabled(enable)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (status) => {
              this.isSubmitting.set(false);
              this.applyStatus(status);
            },
            error: (err: unknown) => {
              this.isSubmitting.set(false);
              this.dialog.notify('error', '切換失敗', [toApiError(err).message]).subscribe();
            },
          });
      });
  }

  syncTop(): void {
    const s = this.status();
    if (!s || !this.canSyncTop()) return;
    if (this.useMockData) {
      this.notifyMock();
      return;
    }
    const expected = Math.min(s.batchSize, this.remaining());
    this.dialog
      .confirm(
        `要立即查詢熱度前 ${s.batchSize} 名的 Google 趨勢嗎？`,
        [
          `只查詢最新一筆 PTT 熱度大於 0 的商品，最多 ${expected} 個，每個商品用掉 1 次額度（本月剩餘 ${this.remaining()} 次）。`,
          '每個商品約需 10 秒，在背景執行，離開這個頁面不會中斷。',
          '每週一 04:00 已有自動排程，手動查詢通常只在需要立即看到結果時使用。',
        ],
        '開始查詢',
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.isSubmitting.set(true);
        this.api
          .syncTop()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (status) => {
              this.isSubmitting.set(false);
              this.applyStatus(status);
            },
            error: (err: unknown) => {
              this.isSubmitting.set(false);
              this.dialog.notify('error', '無法開始查詢', [toApiError(err).message]).subscribe();
              this.load();
            },
          });
      });
  }

  load(): void {
    this.api
      .getStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.loadError.set('');
          this.applyStatus(status);
        },
        error: (err: unknown) => {
          this.loadError.set(toApiError(err).message);
          this.stopPolling();
        },
      });
  }

  private applyStatus(status: GoogleTrendsStatus): void {
    this.status.set(status);
    if (status.running) {
      this.stopPolling();
      this.pollSubscription = timer(GOOGLE_TRENDS_POLL_MS)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.load());
    } else {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  private notifyMock(): void {
    this.dialog.notify('info', '功能限制', ['Mock 模式不會呼叫後端，也不會實際查詢 Google 趨勢。']).subscribe();
  }
}
