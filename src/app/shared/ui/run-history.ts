/**
 * 檔案用途：排程作業面板「執行紀錄」的分頁（2026-09-29），AI 商品雷達／PTT 熱度同步／Google 趨勢三個面板共用。
 *
 * 資料來源刻意分兩段，避免輪詢時多打一支 API：
 * - 第 1 頁：直接用狀態 API 的 recentRuns（最近 10 筆，面板本來就在輪詢，執行中的那筆會即時更新）。
 * - 第 2 頁以後：呼叫分頁 API（GET …/runs?page=&size=10）。不自動刷新——翻到舊紀錄時畫面不該自己跳動。
 * 分頁 API 的總筆數／總頁數只用來顯示頁碼；有新的執行完成（或剛手動觸發）時呼叫 refreshTotals() 更新。
 */
import { ChangeDetectionStrategy, Component, DestroyRef, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { toApiError } from '../../core/api/api-error';
import { PagedResult } from '../../core/api/unwrap';

/** 執行紀錄每頁筆數；與後端 RunHistoryPaging.DEFAULT_SIZE、狀態 API 的 recentRuns 筆數一致。 */
export const RUN_HISTORY_PAGE_SIZE = 10;

export class RunHistory<T> {
  /** 目前頁碼，從 0 開始。 */
  readonly pageNumber = signal(0);
  readonly totalPages = signal(0);
  readonly totalElements = signal(0);
  /** 第 2 頁以後的資料；第 1 頁不使用（改用狀態 API 的 recentRuns）。 */
  readonly olderRuns = signal<readonly T[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(
    private readonly fetchPage: (page: number) => Observable<PagedResult<T>>,
    private readonly destroyRef: DestroyRef,
  ) {}

  /** 畫面要顯示的紀錄：第 1 頁用傳入的 recentRuns，其餘頁用分頁 API 的結果。 */
  rows(recentRuns: readonly T[]): readonly T[] {
    return this.pageNumber() === 0 ? recentRuns : this.olderRuns();
  }

  /** 只更新總筆數／總頁數（留在目前頁）；第 2 頁以後同時重新載入該頁內容。 */
  refreshTotals(): void {
    this.fetch(this.pageNumber());
  }

  goTo(page: number): void {
    if (page < 0 || (this.totalPages() > 0 && page >= this.totalPages()) || this.loading()) return;
    this.fetch(page);
  }

  private fetch(page: number): void {
    this.loading.set(true);
    this.fetchPage(page)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.loading.set(false);
          this.error.set('');
          this.pageNumber.set(result.pageNumber);
          this.totalPages.set(result.totalPages);
          this.totalElements.set(result.totalElements);
          this.olderRuns.set(result.items);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          // 留在原本的頁面；錯誤訊息顯示在分頁列旁，第 1 頁的即時資料不受影響
          this.error.set(toApiError(err).message);
        },
      });
  }
}

/** 執行紀錄表格下方的「上一頁／下一頁」。只有一頁時不顯示。 */
@Component({
  selector: 'app-run-history-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1 || error()) {
      <nav class="run-history-pager" [attr.aria-label]="label() + '分頁'">
        <button type="button" class="btn" [disabled]="loading() || pageNumber() <= 0" (click)="pageChange.emit(pageNumber() - 1)">
          上一頁
        </button>
        <span aria-live="polite">
          @if (totalPages() > 0) {
            第 {{ pageNumber() + 1 }} / {{ totalPages() }} 頁，共 {{ totalElements() }} 筆
          }
          @if (loading()) {
            （載入中…）
          }
        </span>
        <button type="button" class="btn" [disabled]="loading() || pageNumber() + 1 >= totalPages()" (click)="pageChange.emit(pageNumber() + 1)">
          下一頁
        </button>
        @if (error()) {
          <span class="run-history-pager-error" role="alert">無法載入：{{ error() }}</span>
        }
      </nav>
    }
  `,
  styles: `
    .run-history-pager {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
      margin-top: 0.75rem;
      font-size: var(--t-sm);
      color: var(--c-ink-soft);
    }
    .run-history-pager-error {
      color: var(--c-danger);
    }
  `,
})
export class RunHistoryPager {
  readonly label = input('執行紀錄');
  readonly pageNumber = input(0);
  readonly totalPages = input(0);
  readonly totalElements = input(0);
  readonly loading = input(false);
  readonly error = input('');
  readonly pageChange = output<number>();
}
