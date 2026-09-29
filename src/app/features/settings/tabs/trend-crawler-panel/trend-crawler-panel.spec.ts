/**
 * 檔案用途：驗證「PTT 熱度同步」控制面板：狀態與執行紀錄顯示、按鈕防呆、
 * 立即同步後輪詢進度直到結束、開關切換前二次確認、409 時顯示後端訊息。
 */
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { PagedResult } from '../../../../core/api/unwrap';
import { TrendCrawlerApiService, TrendCrawlerStatus, TrendSyncRun } from '../../api/trend-crawler-api.service';
import { TREND_CRAWLER_POLL_MS, TrendCrawlerPanel } from './trend-crawler-panel';

const COMPLETED_RUN: TrendSyncRun = {
  id: 2,
  triggerType: 'MANUAL',
  status: 'COMPLETED',
  startedAt: '2026-09-25T10:00:00',
  finishedAt: '2026-09-25T10:01:05',
  totalCount: 8,
  realCount: 7,
  fallbackCount: 1,
  failedCount: 0,
  message: null,
  triggeredByName: '管理測試人員',
};

const SKIPPED_RUN: TrendSyncRun = {
  id: 1,
  triggerType: 'SCHEDULED',
  status: 'SKIPPED',
  startedAt: '2026-09-25T02:00:00',
  finishedAt: '2026-09-25T02:00:00',
  totalCount: 0,
  realCount: 0,
  fallbackCount: 0,
  failedCount: 0,
  message: 'PTT 來源已停用，本次排程未執行',
  triggeredByName: null,
};

function status(overrides: Partial<TrendCrawlerStatus> = {}): TrendCrawlerStatus {
  return {
    enabled: true,
    running: false,
    processedCount: null,
    totalCount: null,
    schedule: '每天 02:00',
    recentRuns: [COMPLETED_RUN, SKIPPED_RUN],
    ...overrides,
  };
}

/** 分頁 API 的回應（2026-09-29）。預設只有一頁、兩筆，分頁列不顯示。 */
function runsPage(pageNumber = 0, totalElements = 2, items: TrendSyncRun[] = [COMPLETED_RUN, SKIPPED_RUN]): PagedResult<TrendSyncRun> {
  return { items, totalElements, totalPages: Math.ceil(totalElements / 10), pageNumber, pageSize: 10 };
}

describe('TrendCrawlerPanel', () => {
  let fixture: ComponentFixture<TrendCrawlerPanel>;
  let component: TrendCrawlerPanel;
  let dialog: DialogService;
  const api = {
    getStatus: vi.fn(() => of(status())),
    setEnabled: vi.fn((enabled: boolean) => of(status({ enabled }))),
    // 後端剛開始時進度是 null（背景執行緒還沒讀完商品清單），照真實回應寫
    syncAll: vi.fn(() => of(status({ running: true, processedCount: null, totalCount: null }))),
    getRuns: vi.fn((page: number) => of(runsPage(page))),
  };

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TrendCrawlerPanel],
      providers: [provideRouter([]), { provide: TrendCrawlerApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(TrendCrawlerPanel);
    component = fixture.componentInstance;
    dialog = TestBed.inject(DialogService);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) =>
      b.textContent?.includes(label),
    );
    if (!found) throw new Error(`找不到按鈕：${label}`);
    return found;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    api.getStatus.mockImplementation(() => of(status()));
    api.getRuns.mockImplementation((page: number) => of(runsPage(page)));
  });

  afterEach(() => vi.useRealTimers());

  // 2026-09-29：說明文字可收合，預設收合；摘要與狀態訊息永遠看得到
  it('collapses the long description by default and keeps the one-line summary visible', async () => {
    await create();
    const details = (fixture.nativeElement as HTMLElement).querySelector('details.config-panel-details') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toContain('運作方式');
    expect(text()).toContain('更新所有未封存商品的 PTT 熱度分數');
    expect(text()).not.toContain('熱度規則選品');
  });

  it('keeps the disabled-source notice outside the collapsible description', async () => {
    api.getStatus.mockImplementation(() => of(status({ enabled: false })));
    await create();
    const notice = (fixture.nativeElement as HTMLElement).querySelector('.notice');
    expect(notice?.textContent).toContain('PTT 熱度來源已停用');
    expect(notice?.closest('details')).toBeNull();
  });

  // 2026-09-29：執行紀錄每頁 10 筆；第 1 頁用狀態 API 的 recentRuns，其餘頁呼叫分頁 API
  it('hides the pager when all runs fit on one page', async () => {
    await create();
    expect(api.getRuns).toHaveBeenCalledWith(0);
    expect((fixture.nativeElement as HTMLElement).querySelector('.run-history-pager')).toBeNull();
  });

  it('pages through older runs ten at a time', async () => {
    const older: TrendSyncRun = { ...SKIPPED_RUN, id: 99, message: '第二頁的舊紀錄' };
    api.getRuns.mockImplementation((page: number) =>
      of(page === 0 ? runsPage(0, 23) : runsPage(page, 23, [older])),
    );
    await create();
    expect(text()).toContain('第 1 / 3 頁，共 23 筆');
    expect(button('上一頁').disabled).toBe(true);
    // 第 1 頁顯示狀態 API 的最近紀錄
    expect(text()).toContain('手動觸發（管理測試人員）');

    button('下一頁').click();
    fixture.detectChanges();
    expect(api.getRuns).toHaveBeenLastCalledWith(1);
    expect(text()).toContain('第 2 / 3 頁，共 23 筆');
    expect(text()).toContain('第二頁的舊紀錄');
    expect(text()).not.toContain('手動觸發（管理測試人員）');
    expect(button('上一頁').disabled).toBe(false);

    button('上一頁').click();
    fixture.detectChanges();
    expect(text()).toContain('第 1 / 3 頁');
    expect(text()).toContain('手動觸發（管理測試人員）');
  });

  it('keeps the current page and shows an error when an older page cannot be loaded', async () => {
    api.getRuns.mockImplementation((page: number) =>
      page === 0 ? of(runsPage(0, 23)) : throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );
    await create();
    button('下一頁').click();
    fixture.detectChanges();
    expect(text()).toContain('第 1 / 3 頁');
    expect((fixture.nativeElement as HTMLElement).querySelector('.run-history-pager-error')).toBeTruthy();
  });

  it('shows the source switch state and recent runs', async () => {
    await create();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(text()).toContain('來源啟用中');
    expect(text()).toContain('手動觸發（管理測試人員）');
    expect(text()).toContain('已完成');
    expect(text()).toContain('1 分 5 秒');
    // 已略過的紀錄不顯示筆數，但要看得到原因
    expect(text()).toContain('已略過');
    expect(text()).toContain('PTT 來源已停用，本次排程未執行');
    expect(button('立即同步全部商品').disabled).toBe(false);
  });

  it('disables sync-all while the PTT source is disabled and explains why', async () => {
    api.getStatus.mockImplementation(() => of(status({ enabled: false })));
    await create();
    expect(text()).toContain('來源已停用');
    expect(text()).toContain('每日排程會略過不執行');
    expect(button('立即同步全部商品').disabled).toBe(true);
    expect(button('啟用 PTT 來源').disabled).toBe(false);
  });

  it('asks for confirmation, starts the sync, polls progress and stops polling when finished', async () => {
    vi.useFakeTimers();
    await create();

    button('立即同步全部商品').click();
    expect(dialog.state()?.variant).toBe('confirm');
    expect(api.syncAll).not.toHaveBeenCalled();
    dialog.handleConfirm();
    fixture.detectChanges();

    expect(api.syncAll).toHaveBeenCalledTimes(1);
    expect(component.running()).toBe(true);
    expect(text()).toContain('同步執行中：正在準備商品清單');
    expect(button('同步中').disabled).toBe(true);
    // 執行中不能切換開關
    expect(button('停用 PTT 來源').disabled).toBe(true);

    // 第一次輪詢：仍在執行，顯示進度
    api.getStatus.mockImplementation(() => of(status({ running: true, processedCount: 3, totalCount: 8 })));
    vi.advanceTimersByTime(TREND_CRAWLER_POLL_MS);
    fixture.detectChanges();
    expect(text()).toContain('已處理 3 / 8 個商品');
    expect(text()).toContain('離開這個頁面不會中斷同步');

    // 第二次輪詢：已完成，停止輪詢
    api.getStatus.mockImplementation(() => of(status()));
    vi.advanceTimersByTime(TREND_CRAWLER_POLL_MS);
    fixture.detectChanges();
    expect(component.running()).toBe(false);
    const callsAfterFinish = api.getStatus.mock.calls.length;
    vi.advanceTimersByTime(TREND_CRAWLER_POLL_MS * 3);
    expect(api.getStatus.mock.calls.length).toBe(callsAfterFinish);
    expect(button('立即同步全部商品').disabled).toBe(false);
  });

  it('does nothing when the user cancels the sync confirmation', async () => {
    await create();
    button('立即同步全部商品').click();
    dialog.handleCancel();
    expect(api.syncAll).not.toHaveBeenCalled();
  });

  it('shows the backend message when sync-all is rejected with 409, then reloads the status', async () => {
    await create();
    api.syncAll.mockReturnValueOnce(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { message: '已有全商品同步正在執行中，請等目前這次完成後再試' } }),
      ),
    );
    button('立即同步全部商品').click();
    dialog.handleConfirm();
    fixture.detectChanges();
    expect(dialog.state()?.variant).toBe('error');
    expect(dialog.state()?.messages).toContain('已有全商品同步正在執行中，請等目前這次完成後再試');
    expect(api.getStatus).toHaveBeenCalledTimes(2);
  });

  it('confirms before disabling the PTT source and explains the consequences', async () => {
    await create();
    button('停用 PTT 來源').click();
    expect(dialog.state()?.variant).toBe('confirm');
    expect(dialog.state()?.messages.join('')).toContain('不會改用模擬資料');
    dialog.handleConfirm();
    fixture.detectChanges();
    expect(api.setEnabled).toHaveBeenCalledWith(false);
    expect(text()).toContain('來源已停用');
  });

  it('shows a retryable error when the status cannot be loaded', async () => {
    api.getStatus.mockImplementation(() =>
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: '權限不足' } })),
    );
    await create();
    expect(text()).toContain('無法載入同步狀態：權限不足');
    api.getStatus.mockImplementation(() => of(status()));
    button('重新載入').click();
    fixture.detectChanges();
    expect(text()).toContain('來源啟用中');
  });
});
