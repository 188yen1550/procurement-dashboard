/**
 * 檔案用途：設定 › 系統管理 › 排程與同步：「AI 商品雷達」面板（2026-09-29）。
 *
 * - 立即執行一次：後端背景執行、立即回 202，這裡每 5 秒輪詢狀態直到結束（整體需要數分鐘）。
 * - 顯示本月 AI 呼叫次數／上限（探索專用額度，不佔單一商品 AI 分析的額度）。
 * - 執行紀錄（2026-09-29 起每頁 10 筆可翻頁，見 shared/ui/run-history）：每一步的數量都列出來（掃到幾篇、送幾則給 AI、驗證丟棄幾筆、
 *   與既有商品相符幾筆、新增幾筆），結果不如預期時看得出卡在哪一步。
 * - 第二階段加上：與已略過項目相似而排除的筆數、完成適配評分與查詢 Google 趨勢的項目數。
 *
 * PTT 來源開關沿用「PTT 熱度同步」面板的開關，這裡不另外做一個。
 */
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, timer } from 'rxjs';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { RunHistory, RunHistoryPager } from '../../../../shared/ui/run-history';
import { DiscoveryApiService, DiscoveryRun, DiscoveryStatus } from '../../../discovery/api/discovery-api.service';
import { TrendSyncRunStatus } from '../../api/trend-crawler-api.service';

export const DISCOVERY_POLL_MS = 5_000;

const STATUS_LABEL: Record<TrendSyncRunStatus, string> = {
  RUNNING: '執行中',
  COMPLETED: '已完成',
  FAILED: '中斷',
  SKIPPED: '已略過',
};

const STATUS_BADGE: Record<TrendSyncRunStatus, string> = {
  RUNNING: 'badge--neutral',
  COMPLETED: 'badge--success',
  FAILED: 'badge--error',
  SKIPPED: 'badge--neutral',
};

@Component({
  selector: 'app-discovery-panel',
  imports: [DatePipe, RunHistoryPager],
  templateUrl: './discovery-panel.html',
  styleUrl: './discovery-panel.scss',
})
export class DiscoveryPanel implements OnInit {
  private readonly api = inject(DiscoveryApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  /** 執行紀錄分頁：第 1 頁用狀態 API 的 recentRuns（輪詢即時更新），其餘頁呼叫分頁 API。 */
  readonly history = new RunHistory<DiscoveryRun>((page) => this.api.getRuns(page), this.destroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly status = signal<DiscoveryStatus | null>(null);
  readonly loadError = signal('');
  readonly isSubmitting = signal(false);

  readonly running = computed(() => this.status()?.running ?? false);
  /** 不能執行的原因；null＝可以執行。按鈕停用時把原因寫在畫面上，不讓使用者猜。 */
  readonly blockedReason = computed(() => {
    const s = this.status();
    if (!s) return null;
    if (!s.pttEnabled) return 'PTT 來源已停用（在上方「PTT 熱度同步」面板啟用）。';
    if (!s.aiConfigured) return '尚未設定 Groq API 金鑰（GROQ_API_KEY），請聯絡維運人員。';
    if (s.aiCallsThisMonth >= s.aiMonthlyLimit) return '本月探索的 AI 呼叫次數已達上限。';
    return null;
  });
  readonly canRun = computed(
    () => !!this.status() && !this.running() && !this.isSubmitting() && this.blockedReason() === null,
  );

  private pollSubscription: Subscription | null = null;

  ngOnInit(): void {
    if (this.useMockData) return;
    this.load();
    this.history.refreshTotals();
  }

  statusLabel(status: TrendSyncRunStatus): string {
    return STATUS_LABEL[status] ?? status;
  }

  statusBadge(status: TrendSyncRunStatus): string {
    return STATUS_BADGE[status] ?? 'badge--neutral';
  }

  triggerLabel(run: DiscoveryRun): string {
    const label = run.triggerType === 'MANUAL' ? '手動觸發' : '每日排程';
    return run.triggeredByName ? `${label}（${run.triggeredByName}）` : label;
  }

  /** 已略過或尚未結束的紀錄沒有數字可看，統一顯示「—」。 */
  hasCounts(run: DiscoveryRun): boolean {
    return run.status !== 'SKIPPED' && run.status !== 'RUNNING';
  }

  run(): void {
    if (!this.canRun()) return;
    if (this.useMockData) {
      this.dialog.notify('info', '功能限制', ['Mock 模式不會呼叫後端，也不會實際搜尋 PTT。']).subscribe();
      return;
    }
    this.dialog
      .confirm(
        '要立即執行 AI 商品雷達嗎？',
        [
          '系統會讀取 PTT 7 個看板近 7 天的文章標題，交給 AI 找出商品，約需 5～30 分鐘（新標題越多越久）。',
          '每次執行會使用數次探索專用的 AI 額度（抽取商品＋評適配度，不影響單一商品的 AI 分析額度）。',
          '適配度最高的前幾項會查 Google 趨勢，使用與商品共用的 SerpApi 月額度；Google 趨勢停用時略過這一步。',
          '每日 01:30 已有自動排程，手動執行通常只在需要立即看到結果時使用。',
        ],
        '開始執行',
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.isSubmitting.set(true);
        this.api
          .run()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (status) => {
              this.isSubmitting.set(false);
              this.applyStatus(status);
              this.history.refreshTotals(); // 多了一筆執行中的紀錄，總筆數跟著更新
            },
            error: (err: unknown) => {
              this.isSubmitting.set(false);
              this.dialog.notify('error', '無法開始探索', [toApiError(err).message]).subscribe();
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

  private applyStatus(status: DiscoveryStatus): void {
    const wasRunning = this.status()?.running ?? false;
    this.status.set(status);
    if (wasRunning && !status.running) {
      this.history.refreshTotals(); // 執行剛結束：第 2 頁以後的內容與總筆數可能都變了
    }
    if (status.running) {
      this.stopPolling();
      this.pollSubscription = timer(DISCOVERY_POLL_MS)
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
}
