/**
 * 檔案用途：設定 › 系統管理 › 排程與同步：「PTT 熱度同步」控制面板。
 *
 * - PTT 熱度來源開關：停用後每日 02:00 排程記錄為「已略過」，手動同步（單一商品或全部）
 *   也會被後端擋下。刻意不改用模擬資料替代——模擬資料是隨機漫步，每晚跑會讓
 *   熱度規則選品（原 AI 主動選品）被雜訊觸發（見後端 TrendCrawlerSettings 說明）。
 * - 立即同步全部商品：後端在背景執行、立即回應，這裡每 3 秒輪詢一次進度，
 *   直到結束。離開頁面不會中斷同步。
 * - 最近 10 次執行紀錄：排程與手動觸發都會留紀錄。
 *
 * 跟「熱度規則選品」面板放在一起：兩者是同一條每日排程鏈（02:00 熱度同步 →
 * 03:00 熱度建議批次），管理者要一起看才看得出順序。
 */
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import {
  TrendCrawlerApiService,
  TrendCrawlerStatus,
  TrendSyncRun,
  TrendSyncRunStatus,
  TrendSyncTrigger,
} from '../../api/trend-crawler-api.service';

/** 執行中輪詢進度的間隔。 */
export const TREND_CRAWLER_POLL_MS = 3_000;

/** 單一商品平均同步時間（實測約 8 秒），只用來估算剩餘時間。 */
const SECONDS_PER_PRODUCT = 8;

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

const TRIGGER_LABEL: Record<TrendSyncTrigger, string> = {
  SCHEDULED: '每日排程',
  MANUAL: '手動觸發',
};

@Component({
  selector: 'app-trend-crawler-panel',
  imports: [DatePipe],
  templateUrl: './trend-crawler-panel.html',
})
export class TrendCrawlerPanel implements OnInit {
  private readonly api = inject(TrendCrawlerApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** 儀表板「前往管理」帶 #trend-crawler 過來時，第一次載入完捲到這個面板。 */
  private pendingScroll = this.route.snapshot.fragment === 'trend-crawler';

  readonly useMockData = APP_CONFIG.useMockData;
  readonly status = signal<TrendCrawlerStatus | null>(null);
  readonly loadError = signal('');
  /** 正在送出開關或同步請求，避免連點。 */
  readonly isSubmitting = signal(false);

  readonly running = computed(() => this.status()?.running ?? false);
  readonly enabled = computed(() => this.status()?.enabled ?? false);
  readonly canSyncAll = computed(
    () => !!this.status() && this.enabled() && !this.running() && !this.isSubmitting(),
  );
  readonly progressText = computed(() => {
    const s = this.status();
    if (!s?.running) return '';
    // 剛按下時背景執行緒還沒讀完商品清單，後端尚未回報進度
    if (s.totalCount === null || s.processedCount === null) return '正在準備商品清單';
    const remaining = Math.max(s.totalCount - s.processedCount, 0);
    const minutes = Math.ceil((remaining * SECONDS_PER_PRODUCT) / 60);
    return `已處理 ${s.processedCount} / ${s.totalCount} 個商品` + (remaining > 0 ? `，預估還需約 ${minutes} 分鐘` : '');
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

  triggerLabel(run: TrendSyncRun): string {
    const label = TRIGGER_LABEL[run.triggerType] ?? run.triggerType;
    return run.triggeredByName ? `${label}（${run.triggeredByName}）` : label;
  }

  /** 耗時；未結束或已略過顯示「—」。 */
  duration(run: TrendSyncRun): string {
    if (!run.finishedAt || run.status === 'SKIPPED') return '—';
    const seconds = Math.max(
      0,
      Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000),
    );
    return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
  }

  toggleEnabled(): void {
    if (this.isSubmitting() || !this.status()) return;
    if (this.useMockData) {
      this.notifyMock();
      return;
    }
    const enable = !this.enabled();
    const lines = enable
      ? ['啟用後，每日 02:00 會自動搜尋 PTT 更新所有未封存商品的熱度，品項詳情頁的「立即更新」也會恢復可用。']
      : [
          '停用後，每日 02:00 的熱度同步與 01:30 的新品探索會略過不執行，品項詳情頁的「立即更新」也會暫停使用。',
          '既有的熱度資料會保留，但不會再更新；時間越久，趨勢分數會依時效衰減逐漸回到中性值。',
          '停用期間不會改用模擬資料替代，避免隨機數字觸發熱度規則選品；PTT 新品探索也會一併暫停。',
        ];
    this.dialog
      .confirm(enable ? '要啟用 PTT 熱度來源嗎？' : '要停用 PTT 熱度來源嗎？', lines, enable ? '啟用' : '停用')
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

  syncAll(): void {
    if (!this.canSyncAll()) return;
    if (this.useMockData) {
      this.notifyMock();
      return;
    }
    this.dialog
      .confirm(
        '要立即同步全部商品的 PTT 熱度嗎？',
        [
          '系統會依序搜尋所有未封存商品的 PTT 討論，每個商品約需 8 秒，商品多時需要數分鐘。',
          '同步在背景執行，離開這個頁面不會中斷；完成後分數會自動重算。',
          '每日 02:00 已有自動排程，手動同步通常只在需要立即看到最新熱度時使用。',
        ],
        '開始同步',
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.isSubmitting.set(true);
        this.api
          .syncAll()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (status) => {
              this.isSubmitting.set(false);
              this.applyStatus(status);
            },
            error: (err: unknown) => {
              this.isSubmitting.set(false);
              this.dialog.notify('error', '無法開始同步', [toApiError(err).message]).subscribe();
              // 409 通常是狀態已經變了（別人剛按下、或剛被停用），重新讀一次讓畫面跟上
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
          this.scrollIntoViewOnce();
        },
        error: (err: unknown) => {
          this.loadError.set(toApiError(err).message);
          this.stopPolling();
        },
      });
  }

  /** 執行中就排下一次輪詢；結束就停止。 */
  private applyStatus(status: TrendCrawlerStatus): void {
    this.status.set(status);
    if (status.running) {
      this.schedulePoll();
    } else {
      this.stopPolling();
    }
  }

  /**
   * 路由沒開 anchorScrolling，而且面板內容要等 API 回來才撐開高度，
   * 所以在第一次載入完、畫面渲染之後自己捲過去。
   */
  private scrollIntoViewOnce(): void {
    if (!this.pendingScroll) return;
    this.pendingScroll = false;
    afterNextRender(
      () => this.host.nativeElement.querySelector('#trend-crawler')?.scrollIntoView({ block: 'start' }),
      { injector: this.injector },
    );
  }

  private schedulePoll(): void {
    this.stopPolling();
    this.pollSubscription = timer(TREND_CRAWLER_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  private notifyMock(): void {
    this.dialog.notify('info', '功能限制', ['Mock 模式不會呼叫後端，也不會實際搜尋 PTT。']).subscribe();
  }
}
