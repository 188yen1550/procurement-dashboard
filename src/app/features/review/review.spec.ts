/** 檔案用途：驗證待審預設範圍、決策紀錄與 Loading／Empty／Error 本地狀態。 */
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ReviewApiService } from './api/review-api.service';
import { Review } from './review';
describe('Review', () => {
  let fixture: ComponentFixture<Review>;
  let component: Review;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Review],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Review);
    component = fixture.componentInstance;
    // 本檔驗證的是元件內建的完整 Demo 資料與各種 Mock UI 狀態。
    // 全域設定目前使用真實 API，因此必須在第一次 change detection（ngOnInit）前
    // 明確切回 Mock 模式，避免測試誤送 HTTP 並只得到空清單。
    Object.defineProperty(component, 'useMockData', { value: true });
    fixture.detectChanges();
  });
  it('creates with default pending and active filters', () => {
    expect(component).toBeTruthy();
    expect(component.items().length).toBe(4);
    expect(component.filtered().length).toBe(3);
    expect(component.reviewFilter()).toBe('PENDING');
    expect(component.itemFilter()).toBe('ACTIVE');
    expect(fixture.nativeElement.textContent).toContain('選品審核');
  });
  it('filters by review and item status', () => {
    component.reviewFilter.set('REJECTED');
    component.itemFilter.set('ARCHIVED');
    expect(component.filtered().map((item) => item.id)).toEqual([109]);
  });
  it('shows resubmission context', () => {
    expect(fixture.nativeElement.textContent).toContain('第 2 次送審');
  });
  it('shows decision records', () => {
    component.view.set('records');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('保留每次送審快照');
    expect(fixture.nativeElement.textContent).toContain('節慶需求明確');
  });
  it('renders disabled loading empty and error states', () => {
    component.setState('disabled');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('審核停用');
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入待審核');
    component.setState('empty');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('目前沒有審核品項');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
});

/**
 * 2026-09-24：待審排序選項精簡、決策紀錄改為後端篩選／排序（Mock 模式本地對齊）。
 * 仍在 Mock 模式下驗證本地行為。
 */
describe('Review（Mock）篩選與排序', () => {
  let fixture: ComponentFixture<Review>;
  let component: Review;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Review],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Review);
    component = fixture.componentInstance;
    Object.defineProperty(component, 'useMockData', { value: true });
    fixture.detectChanges();
  });

  it('pending sort only offers numeric fields', () => {
    expect(component.pendingSortChoices.map((c) => c.key)).toEqual([
      'finalScore',
      'completeness',
      'submissionCount',
    ]);
  });

  it('pending toolbar renders two-row grid fields with short labels', () => {
    const toolbar: HTMLElement = fixture.nativeElement.querySelector('.pending-filters');
    const labels = Array.from(toolbar.querySelectorAll('.field-label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['搜尋', '審核狀態', '品項狀態', '分類', '送審日期']);
    expect(toolbar.querySelector('.toolbar-actions button')?.textContent).toContain('恢復預設');
  });

  it('records default to newest review first', () => {
    expect(component.recordTableSort.state()).toEqual({ key: 'reviewedAt', direction: 'desc' });
    expect(component.filteredRecords().map((r) => r.id)).toEqual([501, 502]);
  });

  it('records filter by result, date range and keyword', () => {
    component.updateRecordResultFilter('REJECTED');
    expect(component.filteredRecords().map((r) => r.id)).toEqual([502]);
    component.updateRecordResultFilter('ALL');

    component.updateRecordReviewedFrom('2026-08-25');
    expect(component.filteredRecords().map((r) => r.id)).toEqual([501]);
    component.updateRecordReviewedFrom('');
    component.updateRecordReviewedTo('2026-08-24');
    expect(component.filteredRecords().map((r) => r.id)).toEqual([502]);
    component.updateRecordReviewedTo('');

    component.updateRecordSearch('涼感');
    expect(component.filteredRecords().map((r) => r.id)).toEqual([502]);
  });

  it('records sort by score via table header state', () => {
    component.recordTableSort.toggle('finalScore');
    expect(component.recordTableSort.state()).toEqual({ key: 'finalScore', direction: 'asc' });
    expect(component.filteredRecords().map((r) => r.id)).toEqual([502, 501]);
  });

  it('only submission count and final score headers are sortable', () => {
    component.view.set('records');
    fixture.detectChanges();
    const sortable = Array.from(
      fixture.nativeElement.querySelectorAll('.records th .list-sort-header'),
    ).map((el) => (el as HTMLElement).textContent?.replace(/[↕↑↓]/g, '').trim());
    expect(sortable).toEqual(['送審次數', '最終分數']);
  });

  it('flags an inverted review date range', () => {
    component.updateRecordReviewedFrom('2026-08-30');
    component.updateRecordReviewedTo('2026-08-01');
    expect(component.recordDateRangeInvalid()).toBe(true);
    component.view.set('records');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('審核日期起日不可晚於迄日');
  });

  it('clearRecordFilters restores defaults', () => {
    component.updateRecordSearch('禮盒');
    component.updateRecordResultFilter('APPROVED');
    component.recordTableSort.toggle('submissionCount');
    component.clearRecordFilters();
    expect(component.recordSearch()).toBe('');
    expect(component.recordResultFilter()).toBe('ALL');
    expect(component.recordTableSort.state()).toEqual({ key: 'reviewedAt', direction: 'desc' });
  });
});

/** 真實模式：確認查詢條件與排序都送到後端，而不是只在前端處理當頁資料。 */
describe('Review（真實模式）決策紀錄查詢', () => {
  const emptyPage = { items: [], totalElements: 0, totalPages: 0, pageNumber: 0, pageSize: 20 };
  const recordPage = { ...emptyPage, totalElements: 57, totalPages: 3 };
  const pendingPage = { ...emptyPage, totalElements: 4, totalPages: 1 };
  const api = {
    listPending: vi.fn(() => of(pendingPage)),
    listDecisionRecords: vi.fn(() => of(recordPage)),
  };
  let fixture: ComponentFixture<Review>;
  let component: Review;

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [Review],
      providers: [provideRouter([]), { provide: ReviewApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(Review);
    component = fixture.componentInstance;
    Object.defineProperty(component, 'useMockData', { value: false });
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  const lastQuery = () => api.listDecisionRecords.mock.calls.at(-1)?.at(0) as unknown as Record<string, unknown>;

  it('loads with default server-side sort', () => {
    expect(lastQuery()).toEqual({ page: 0, size: 20, sort: 'reviewedAt,desc' });
  });

  it('keeps pending and record totals separate', () => {
    expect(component.totalElements()).toBe(4);
    expect(component.recordTotalElements()).toBe(57);
  });

  it('sends result, date range and sort to backend and resets page', () => {
    component.recordPageNumber.set(2);
    component.updateRecordResultFilter('APPROVED');
    component.updateRecordReviewedFrom('2026-09-01');
    component.updateRecordReviewedTo('2026-09-24');
    component.recordTableSort.toggle('finalScore');
    component.recordTableSort.toggle('finalScore');
    expect(lastQuery()).toEqual({
      page: 0,
      size: 20,
      sort: 'finalScore,desc',
      reviewResult: 'APPROVED',
      reviewedFrom: '2026-09-01',
      reviewedTo: '2026-09-24',
    });
  });

  it('debounces keyword search before querying backend', () => {
    vi.useFakeTimers();
    const before = api.listDecisionRecords.mock.calls.length;
    component.updateRecordSearch('禮');
    component.updateRecordSearch('禮盒 ');
    expect(api.listDecisionRecords.mock.calls.length).toBe(before);
    vi.advanceTimersByTime(300);
    expect(api.listDecisionRecords.mock.calls.length).toBe(before + 1);
    expect(lastQuery()['keyword']).toBe('禮盒');
  });

  it('does not query backend with an inverted date range', () => {
    component.updateRecordReviewedFrom('2026-09-24');
    const before = api.listDecisionRecords.mock.calls.length;
    component.updateRecordReviewedTo('2026-09-01');
    expect(api.listDecisionRecords.mock.calls.length).toBe(before);
  });

  it('shows a message when records fail to load', () => {
    api.listDecisionRecords.mockReturnValueOnce(throwError(() => ({ status: 500 })) as never);
    component.loadDecisionRecords();
    expect(component.records()).toEqual([]);
    expect(component.statusMessage()).toContain('決策紀錄載入失敗');
  });
});
