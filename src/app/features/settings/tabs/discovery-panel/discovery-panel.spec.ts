/** 檔案用途：PTT 新品探索排程面板——無法執行的原因、確認後執行、執行紀錄數字。 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { DiscoveryApiService, DiscoveryStatus } from '../../../discovery/api/discovery-api.service';
import { DiscoveryPanel } from './discovery-panel';

function status(overrides: Partial<DiscoveryStatus> = {}): DiscoveryStatus {
  return {
    pttEnabled: true,
    aiConfigured: true,
    running: false,
    schedule: '每天 01:30（早於 02:00 熱度同步）',
    aiCallsThisMonth: 12,
    aiMonthlyLimit: 400,
    recentRuns: [
      {
        id: 1,
        triggerType: 'SCHEDULED',
        status: 'COMPLETED',
        startedAt: '2026-09-29T01:30:00',
        finishedAt: '2026-09-29T01:41:00',
        postCount: 812,
        titleCount: 640,
        aiCallCount: 5,
        extractedCount: 58,
        rejectedCount: 6,
        matchedExistingCount: 9,
        similarDismissedCount: 4,
        newCount: 31,
        updatedCount: 12,
        fitCount: 27,
        googleCount: 5,
        message: null,
        triggeredByName: null,
      },
    ],
    ...overrides,
  };
}

describe('DiscoveryPanel', () => {
  let fixture: ComponentFixture<DiscoveryPanel>;
  let component: DiscoveryPanel;
  let dialog: DialogService;
  const api = {
    getStatus: vi.fn(() => of(status())),
    run: vi.fn(() => of(status({ running: false }))),
    // 2026-09-29：執行紀錄分頁；預設一頁，分頁列不顯示
    getRuns: vi.fn((page: number) =>
      of({ items: [], totalElements: 1, totalPages: 1, pageNumber: page, pageSize: 10 }),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    api.getStatus.mockImplementation(() => of(status()));
    await TestBed.configureTestingModule({
      imports: [DiscoveryPanel],
      providers: [{ provide: DiscoveryApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(DiscoveryPanel);
    component = fixture.componentInstance;
    dialog = TestBed.inject(DialogService);
    fixture.detectChanges();
  });

  it('lists every pipeline count of recent runs and the monthly AI usage', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('812');
    expect(text).toContain('31');
    expect(text).toContain('58（6／9／4）');
    expect(text).toContain('27／5');
    expect(text).toContain('12 / 400');
  });

  // 2026-09-29：說明文字與紀錄欄位解釋收進可收合區塊（預設收合）；本月額度這類狀態留在外面
  it('keeps the explanation collapsed but the monthly AI usage visible', () => {
    const root = fixture.nativeElement as HTMLElement;
    const details = root.querySelector('details.config-panel-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('紀錄欄位');
    expect(details.textContent).toContain('Groq');
    const usage = Array.from(root.querySelectorAll('.helper')).find((el) => el.textContent?.includes('本月 AI 呼叫'));
    expect(usage?.closest('details')).toBeNull();
  });

  it('runs after confirmation', () => {
    component.run();
    dialog.handleConfirm();
    expect(api.run).toHaveBeenCalled();
  });

  it('explains why it cannot run when the Groq key is missing', () => {
    api.getStatus.mockImplementation(() => of(status({ aiConfigured: false })));
    component.load();
    fixture.detectChanges();
    expect(component.canRun()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('GROQ_API_KEY');
    component.run();
    expect(api.run).not.toHaveBeenCalled();
  });

  it('cannot run while PTT is disabled or the monthly quota is used up', () => {
    api.getStatus.mockImplementation(() => of(status({ pttEnabled: false })));
    component.load();
    expect(component.blockedReason()).toContain('PTT 來源已停用');
    api.getStatus.mockImplementation(() => of(status({ aiCallsThisMonth: 400 })));
    component.load();
    expect(component.blockedReason()).toContain('上限');
  });
});
