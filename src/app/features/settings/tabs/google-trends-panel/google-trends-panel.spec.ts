/**
 * 檔案用途：驗證「Google 趨勢參考」控制面板：用量顯示、各種不能查詢的狀態（停用、無金鑰、額度用完）、
 * 立即查詢前二次確認並輪詢進度、執行紀錄。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { GoogleTrendsApiService, GoogleTrendsStatus } from '../../api/google-trends-api.service';
import { GOOGLE_TRENDS_POLL_MS, GoogleTrendsPanel } from './google-trends-panel';

function status(overrides: Partial<GoogleTrendsStatus> = {}): GoogleTrendsStatus {
  return {
    enabled: true,
    keyConfigured: true,
    usedThisMonth: 12,
    monthlyLimit: 200,
    running: false,
    processedCount: null,
    totalCount: null,
    batchSize: 40,
    schedule: '每週一 04:00（PTT 熱度同步 02:00 之後）',
    recentRuns: [
      {
        id: 1,
        triggerType: 'MANUAL',
        status: 'COMPLETED',
        startedAt: '2026-09-28T15:30:00',
        finishedAt: '2026-09-28T15:31:10',
        totalCount: 5,
        okCount: 4,
        noDataCount: 1,
        failedCount: 0,
        message: null,
        triggeredByName: '管理測試人員',
      },
    ],
    ...overrides,
  };
}

describe('GoogleTrendsPanel', () => {
  let fixture: ComponentFixture<GoogleTrendsPanel>;
  let component: GoogleTrendsPanel;
  let dialog: DialogService;
  const api = {
    getStatus: vi.fn(() => of(status())),
    setEnabled: vi.fn((enabled: boolean) => of(status({ enabled }))),
    syncTop: vi.fn(() => of(status({ running: true }))),
    // 2026-09-29：執行紀錄分頁；預設一頁，分頁列不顯示
    getRuns: vi.fn((page: number) =>
      of({ items: [], totalElements: 1, totalPages: 1, pageNumber: page, pageSize: 10 }),
    ),
  };

  async function create(): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [GoogleTrendsPanel],
      providers: [{ provide: GoogleTrendsApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(GoogleTrendsPanel);
    component = fixture.componentInstance;
    (component as unknown as { useMockData: boolean }).useMockData = false;
    dialog = TestBed.inject(DialogService);
    component.load();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    vi.useRealTimers();
    api.getStatus.mockReset().mockImplementation(() => of(status()));
    api.syncTop.mockClear();
  });

  it('顯示本月用量與剩餘次數、執行紀錄', async () => {
    const el = await create();
    expect(el.textContent).toContain('12 / 200');
    expect(el.textContent).toContain('剩餘 188 次');
    expect(el.textContent).toContain('手動觸發（管理測試人員）');
    expect(component.canSyncTop()).toBe(true);
  });

  it('無金鑰、停用或額度用完時不能查詢，並說明原因', async () => {
    api.getStatus.mockImplementation(() => of(status({ keyConfigured: false })));
    let el = await create();
    expect(component.canSyncTop()).toBe(false);
    expect(el.textContent).toContain('SERPAPI_API_KEY');

    api.getStatus.mockImplementation(() => of(status({ enabled: false })));
    component.load();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(component.canSyncTop()).toBe(false);
    expect(el.textContent).toContain('Google 趨勢來源已停用');

    api.getStatus.mockImplementation(() => of(status({ usedThisMonth: 200 })));
    component.load();
    fixture.detectChanges();
    expect(component.canSyncTop()).toBe(false);
    expect(el.textContent).toContain('本月額度已用完');
  });

  it('立即查詢前二次確認，說明會用掉的額度，確認後輪詢到結束', async () => {
    await create();
    vi.useFakeTimers();
    const confirm = vi.spyOn(dialog, 'confirm').mockReturnValue(of(true));

    component.syncTop();

    expect(confirm.mock.calls[0][1].join('')).toContain('本月剩餘 188 次');
    expect(api.syncTop).toHaveBeenCalledOnce();
    expect(component.running()).toBe(true);

    api.getStatus.mockImplementation(() => of(status({ usedThisMonth: 17 })));
    vi.advanceTimersByTime(GOOGLE_TRENDS_POLL_MS);
    expect(component.running()).toBe(false);
    expect(component.status()?.usedThisMonth).toBe(17);
  });

  it('取消確認時不呼叫後端', async () => {
    await create();
    vi.spyOn(dialog, 'confirm').mockReturnValue(of(false));
    component.syncTop();
    expect(api.syncTop).not.toHaveBeenCalled();
  });
});
