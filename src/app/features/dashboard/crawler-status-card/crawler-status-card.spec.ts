/**
 * 檔案用途：驗證儀表板「PTT 熱度同步」狀態卡：各種狀態的標籤與警示、
 * 停用時顯示「已停用」而不是空白、「前往管理」連結、API 失敗只讓這張卡降級。
 */
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TrendCrawlerApiService, TrendCrawlerStatus, TrendSyncRun } from '../../settings/api/trend-crawler-api.service';
import { CrawlerStatusCard, summarizeCrawlerStatus } from './crawler-status-card';

function run(overrides: Partial<TrendSyncRun> = {}): TrendSyncRun {
  return {
    id: 1,
    triggerType: 'SCHEDULED',
    status: 'COMPLETED',
    startedAt: '2026-09-28T02:00:00',
    finishedAt: '2026-09-28T02:01:05',
    totalCount: 7,
    realCount: 7,
    fallbackCount: 0,
    failedCount: 0,
    message: null,
    triggeredByName: null,
    ...overrides,
  };
}

function status(overrides: Partial<TrendCrawlerStatus> = {}): TrendCrawlerStatus {
  return {
    enabled: true,
    running: false,
    processedCount: null,
    totalCount: null,
    schedule: '每天 02:00（早於 03:00 AI 主動選品批次）',
    recentRuns: [run()],
    ...overrides,
  };
}

describe('summarizeCrawlerStatus', () => {
  it('全部取得 PTT 資料時為正常「啟用中」、沒有警示', () => {
    const s = summarizeCrawlerStatus(status());
    expect(s.tone).toBe('ok');
    expect(s.label).toBe('啟用中');
    expect(s.warnings).toEqual([]);
    expect(s.lastRun?.realCount).toBe(7);
  });

  it('有模擬資料時標示為警示，並說明筆數', () => {
    const s = summarizeCrawlerStatus(status({ recentRuns: [run({ realCount: 5, fallbackCount: 2 })] }));
    expect(s.tone).toBe('warn');
    expect(s.warnings).toEqual(['2 個商品 PTT 抓不到，改用模擬資料']);
  });

  it('有失敗或中斷時標示為錯誤', () => {
    expect(summarizeCrawlerStatus(status({ recentRuns: [run({ failedCount: 1 })] })).tone).toBe('error');
    const interrupted = summarizeCrawlerStatus(
      status({ recentRuns: [run({ status: 'FAILED', message: '應用程式在同步途中關閉，本次未完成' })] }),
    );
    expect(interrupted.tone).toBe('error');
    expect(interrupted.warnings[0]).toContain('上次同步中斷');
  });

  it('停用時顯示「已停用」，最後同步略過「已略過」的排程紀錄', () => {
    const s = summarizeCrawlerStatus(
      status({
        enabled: false,
        recentRuns: [run({ id: 2, status: 'SKIPPED', totalCount: 0, realCount: 0 }), run({ id: 1 })],
      }),
    );
    expect(s.tone).toBe('muted');
    expect(s.label).toBe('已停用');
    expect(s.lastRun?.id).toBe(1);
  });

  it('執行中顯示進度', () => {
    expect(summarizeCrawlerStatus(status({ running: true, processedCount: 3, totalCount: 7 })).label).toBe(
      '同步中 3/7',
    );
    expect(summarizeCrawlerStatus(status({ running: true })).label).toBe('同步中 準備中');
  });

  it('從未執行過時沒有最後同步紀錄', () => {
    expect(summarizeCrawlerStatus(status({ recentRuns: [] })).lastRun).toBeNull();
  });
});

describe('CrawlerStatusCard', () => {
  let fixture: ComponentFixture<CrawlerStatusCard>;
  const api = { getStatus: vi.fn(() => of(status())) };

  async function create(): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [CrawlerStatusCard],
      providers: [provideRouter([]), { provide: TrendCrawlerApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(CrawlerStatusCard);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => api.getStatus.mockReset().mockImplementation(() => of(status())));

  it('顯示最後同步時間、筆數，以及前往設定頁排程與同步的連結', async () => {
    const el = await create();
    expect(el.textContent).toContain('09/28 02:01');
    expect(el.textContent).toContain('7/7 取得 PTT 資料');
    const link = el.querySelector('a.crawler-manage') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/settings/system?tab=jobs#trend-crawler');
  });

  it('API 失敗時只在卡片內顯示錯誤，可重新載入', async () => {
    api.getStatus.mockImplementation(() =>
      throwError(() => new HttpErrorResponse({ status: 500, error: { message: '伺服器錯誤' } })),
    );
    const el = await create();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('無法取得同步狀態');

    api.getStatus.mockImplementation(() => of(status()));
    (el.querySelector('button.text-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).toContain('啟用中');
  });
});
