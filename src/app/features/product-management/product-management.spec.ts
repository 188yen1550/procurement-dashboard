/** 檔案用途：驗證品項篩選、60% 門檻、核准編輯邊界與條件式刪除等本地 Mock 規則。 */
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { FileDownloadService } from '../../core/ui/file-download.service';
import { ProductManagement } from './product-management';
import { ProductApiService } from './api/product-api.service';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';

describe('ProductManagement', () => {
  let component: ProductManagement;
  let fixture: ComponentFixture<ProductManagement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProductManagement], providers: [provideHttpClient(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(ProductManagement);
    component = fixture.componentInstance;
    Object.defineProperty(component, 'useMockData', { value: true });
    // 這份測試套件驗證的是篩選/操作可見性邏輯本身，頁面預設只看待審核
    // （見 reviewFilter 註解），這裡明確重設回中性的 'ALL'，讓既有測試套件
    // 以「全部狀態」為基準。
    component.updateReviewFilter('ALL');
    fixture.detectChanges();
  });

  it('should create without a backend request', () => {
    expect(component).toBeTruthy();
    expect(component.pageState()).toBe('default');
  });

  it('shows only formal candidate mock products by default', () => {
    expect(component.candidateProducts().length).toBe(6);
    expect(component.filteredProducts().every((item) => item.candidateStatus === 'CANDIDATE')).toBe(true);
    expect(component.filteredProducts().some((item) => item.name.includes('旅行用全能'))).toBe(false);
  });

  // 2026-09-25 對齊現行畫面：表頭拆成「實際分類」（不排序）＋「新品／再販售」（pricingType 排序），
  // 「審核／品項狀態」表頭不提供排序，可排序表頭由 7 個變 6 個。
  it('sorts supplier, pricing type and completeness in both directions', () => {
    const base = component.products()[0];
    component.products.set([
      { ...base, id: 1, name: '商品10', supplierName: '供應商10', productTypeName: 'B', pricingType: 'RESALE', dataCompleteness: 100, reviewStatus: 'REJECTED', itemStatus: 'ACTIVE' },
      { ...base, id: 2, name: '商品2', supplierName: '供應商2', productTypeName: 'A', pricingType: 'NEW', dataCompleteness: 9, reviewStatus: 'APPROVED', itemStatus: 'ACTIVE' },
      { ...base, id: 3, name: '商品1', supplierName: '', productTypeName: 'C', pricingType: 'RESALE', dataCompleteness: null, reviewStatus: 'PENDING', itemStatus: 'ACTIVE' },
    ]);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('th[appSortHeader]')).toHaveLength(6);
    const assertSort = (key: string, ascending: number[], descending: number[]) => {
      const header = root.querySelector('th[appSortHeader="' + key + '"]')!;
      const button = header.querySelector('button')!;
      button.click();
      fixture.detectChanges();
      expect(component.sortedProducts().map(row => row.id)).toEqual(ascending);
      expect(header.getAttribute('aria-sort')).toBe('ascending');
      button.click();
      fixture.detectChanges();
      expect(component.sortedProducts().map(row => row.id)).toEqual(descending);
      expect(header.getAttribute('aria-sort')).toBe('descending');
    };
    assertSort('supplierName', [2, 1, 3], [1, 2, 3]);
    assertSort('pricingType', [2, 1, 3], [1, 3, 2]);
    assertSort('dataCompleteness', [2, 1, 3], [1, 2, 3]);
    const mobileSort = root.querySelector('.mobile-table-sort')!;
    const mobileCompleteness = Array.from(mobileSort.querySelectorAll('button'))
      .find(button => button.textContent?.includes('資料完整度'))!;
    mobileCompleteness.click();
    fixture.detectChanges();
    expect(component.sortedProducts().map(row => row.id)).toEqual([2, 1, 3]);
    expect(root.querySelector('th[appSortHeader="dataCompleteness"]')?.getAttribute('aria-sort')).toBe('ascending');
    component.updateSearch('商品2');
    fixture.detectChanges();
    expect(component.sortedProducts().map(row => row.id)).toEqual([2]);
    expect(component.products().map(row => row.id)).toEqual([1, 2, 3]);
  });

  it('filters by product or supplier name', () => {
    component.updateSearch('沐光科技');
    expect(component.filteredProducts().length).toBe(1);
    expect(component.filteredProducts()[0].name).toContain('電熱杯');
  });

  it('filters by review status', () => {
    component.updateReviewFilter('APPROVED');
    expect(component.filteredProducts().length).toBe(2);
    expect(component.filteredProducts().every((item) => item.reviewStatus === 'APPROVED')).toBe(true);
  });

  it('filters by item status and product type', () => {
    component.updateItemFilter('ARCHIVED');
    component.updateProductTypeFilter('美妝保養');
    expect(component.filteredProducts().map((item) => item.id)).toEqual([105]);
  });

  it('clears filters and restores the candidate list', () => {
    component.updateSearch('不存在');
    component.updateReviewFilter('REJECTED');
    component.clearFilters();
    expect(component.searchTerm()).toBe('');
    expect(component.reviewFilter()).toBe('ALL');
    expect(component.filteredProducts().length).toBe(6);
  });

  it('renders an empty state when search has no result', () => {
    component.updateSearch('絕對不存在的品項');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('找不到符合條件的品項');
  });

  it('marks products below 60 percent as incomplete', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('資料待補');
    expect(fixture.nativeElement.textContent).toContain('不進入評估計分與 AI 推薦');
  });

  it('locks approved product actions and explains approval scope', () => {
    fixture.detectChanges();
    const disabledButtons = fixture.nativeElement.querySelectorAll('button:disabled');
    expect(disabledButtons.length).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).toContain('核心選品資料已鎖定');
    // 審核狀態文案統一為「審核通過／審核拒絕」（2026-09 決議），不再有「已通過選品審核」。
    expect(fixture.nativeElement.textContent).toContain('審核通過');
  });

  it('keeps an accessible sticky action column for every product row', () => {
    const header = fixture.nativeElement.querySelector('thead .actions-column');
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    const actionCells = fixture.nativeElement.querySelectorAll('tbody .actions-column');
    expect(header).toBeTruthy();
    expect(actionCells.length).toBe(rows.length);
    actionCells.forEach((cell: HTMLElement) => {
      expect(cell.querySelector('.action-group')).toBeTruthy();
      expect(cell.querySelector('a, button')).toBeTruthy();
    });
  });

  it('preserves action availability for pending, approved and rejected rows', () => {
    const eligible = fixture.nativeElement.querySelector('button[aria-label^="刪除輕量智慧"]');
    const approved = fixture.nativeElement.querySelector('button[aria-label^="無法刪除中秋"]');
    const rejectedAction = fixture.nativeElement.querySelector('a.resubmit');
    expect(eligible.disabled).toBe(false);
    expect(approved.disabled).toBe(true);
    expect(rejectedAction.textContent).toContain('重審');
  });

  it('renders loading and error recovery states', () => {
    component.setPageState('loading'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入品項資料');
    component.setPageState('error'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('無法載入品項資料');
    expect(fixture.nativeElement.querySelector('.error-notice button').textContent).toContain('重試');
  });

  it('deletes only eligible products locally', () => {
    const eligible = component.products().find((item) => item.id === 102)!;
    const locked = component.products().find((item) => item.id === 101)!;
    // 刪除條件已從元件方法改為 mapper 計算好的 actions.canDelete，
    // 讓清單、詳情、編輯三頁共用同一份規則，不再各判一次。
    expect(eligible.actions.canDelete).toBe(true);
    expect(locked.actions.canDelete).toBe(false);
    component.requestDelete(eligible);
    component.confirmDelete();
    expect(component.products().some((item) => item.id === 102)).toBe(false);
  });
});

/**
 * ⚠️ 上面整份都是 Object.defineProperty 強制 useMockData=true 跑的，
 * 從來沒有測過真實模式的 load()——這次修正「商品實際分類」篩選在真實
 * 模式下完全沒有送給後端的 bug，剛好完全沒有測試覆蓋到，這裡補上。
 */
describe('ProductManagement (formal API mode)', () => {
  let component: ProductManagement;
  let fixture: ComponentFixture<ProductManagement>;
  const api = {
    list: vi.fn(),
    listSubmissionBatches: vi.fn(),
    exportApproved: vi.fn(),
  };
  const fileDownload = { save: vi.fn() };
  const productTypeLookup = {
    getNameMap: vi.fn(() =>
      of(
        new Map<number, string>([
          [1, '食品／生鮮'],
          [5, '美妝保養'],
        ]),
      ),
    ),
    // product-management.ts 的 loadProductTypes() 會呼叫這個方法取得依大類
    // 分組的篩選選項——跟 getNameMap 用同一組假資料，維持測試裡的 id
    // 對應關係一致（美妝保養＝5，用在下面「解析選中的分類名稱」測試）。
    getGroupedOptions: vi.fn(() =>
      of([
        {
          major: { id: 1, name: '食品' },
          minors: [{ id: 1, name: '食品／生鮮' }],
        },
        {
          major: { id: 5, name: '美妝' },
          minors: [{ id: 5, name: '美妝保養' }],
        },
      ]),
    ),
    // product-management.ts 的 loadProductTypes() 也會呼叫這個方法取得
    // 品類說明文字（供懸停提示用）——回傳空 Map 即可，這份測試套件不驗證
    // 提示框內容，只需要方法存在、不拋錯。
    getDescriptionMap: vi.fn(() => of(new Map<number, string>())),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    api.list.mockReturnValue(
      of({ items: [], totalElements: 0, totalPages: 0, pageNumber: 0, pageSize: 20 }),
    );
    api.listSubmissionBatches.mockReturnValue(
      of([
        { batchId: '2026-09-25_3', submittedDate: '2026-09-25', submitterId: 3, submitterName: '陳小姐', productCount: 4 },
        { batchId: 'NONE', submittedDate: null, submitterId: null, submitterName: null, productCount: 2 },
      ]),
    );
    api.exportApproved.mockReturnValue(of({ blob: new Blob(['csv']), rowCount: 3 }));
    await TestBed.configureTestingModule({
      imports: [ProductManagement],
      providers: [
        provideRouter([]),
        { provide: ProductApiService, useValue: api },
        { provide: ProductTypeLookupService, useValue: productTypeLookup },
        { provide: FileDownloadService, useValue: fileDownload },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductManagement);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('resolves the selected product type name to its id before calling the API', () => {
    component.updateProductTypeFilter('美妝保養');
    expect(productTypeLookup.getNameMap).toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledWith(
      expect.objectContaining({ productTypeId: 5 }),
    );
  });

  it('loads submission batches and labels the no-batch option (2026-09)', () => {
    expect(api.listSubmissionBatches).toHaveBeenCalled();
    const [batch, none] = component.submissionBatches();
    expect(component.batchOptionLabel(batch)).toBe('2026-09-25 陳小姐（4 筆）');
    expect(component.batchOptionLabel(none)).toContain('無批次資料');
  });

  it('sends submission batch, reviewed date and never-exported filters to the list API (2026-09)', () => {
    component.updateSubmissionBatchFilter('2026-09-25_3');
    component.updateReviewedFrom('2026-09-01');
    component.updateReviewedTo('2026-09-30');
    component.updateNeverExported(true);
    expect(api.list.mock.calls.at(-1)![0]).toEqual(
      expect.objectContaining({
        submissionBatch: '2026-09-25_3',
        reviewedFrom: '2026-09-01',
        reviewedTo: '2026-09-30',
        neverExported: true,
      }),
    );
    expect(component.hasActiveFilters()).toBe(true);

    // 起日晚於訖日：不送日期條件（後端會回 400），畫面提示使用者。
    component.updateReviewedFrom('2026-10-05');
    expect(component.reviewedDateRangeInvalid()).toBe(true);
    const lastCall = api.list.mock.calls.at(-1)![0];
    expect(lastCall.reviewedFrom).toBeUndefined();
    expect(lastCall.reviewedTo).toBeUndefined();

    component.clearFilters();
    const cleared = api.list.mock.calls.at(-1)![0];
    expect(cleared.submissionBatch).toBeUndefined();
    expect(cleared.neverExported).toBeUndefined();
  });

  it('keeps advanced filters collapsed and lists active ones as removable chips (2026-09-26)', () => {
    const root = fixture.nativeElement as HTMLElement;
    // 預設收合：第一列只剩常用條件
    expect(root.querySelector('#advanced-filters')).toBeNull();
    expect(root.querySelector('#batch-filter')).toBeNull();

    component.toggleAdvancedFilters();
    fixture.detectChanges();
    expect(root.querySelector('#batch-filter')).not.toBeNull();
    expect(root.querySelector('#updated-from')).not.toBeNull();

    component.updateReviewedFrom('2026-09-01');
    component.updateNeverExported(true);
    component.toggleAdvancedFilters();
    fixture.detectChanges();
    const chips = Array.from(root.querySelectorAll('.filter-chips li span')).map((el) => el.textContent?.trim());
    expect(chips).toEqual(['審核日期：2026-09-01 ～ 不限', '只看未曾匯出']);
    expect(root.querySelector('.advanced-count')?.textContent?.trim()).toBe('2');

    const callsBefore = api.list.mock.calls.length;
    component.clearAdvancedFilter('reviewed');
    expect(component.reviewedFromDraft()).toBe('');
    expect(api.list.mock.calls.length).toBe(callsBefore + 1);
    expect(component.advancedFilterChips().map((chip) => chip.key)).toEqual(['neverExported']);
  });

  it('blocks CSV export while the review filter is pending or rejected (2026-09)', () => {
    // 頁面預設只看「未審核」。
    expect(component.reviewFilter()).toBe('PENDING');
    expect(component.canExport()).toBe(false);
    component.exportCsv();
    expect(api.exportApproved).not.toHaveBeenCalled();

    component.updateReviewFilter('APPROVED');
    expect(component.canExport()).toBe(true);
  });

  it('exports the current filters without paging and downloads the file (2026-09)', () => {
    component.updateReviewFilter('ALL');
    component.updateProductTypeFilter('美妝保養');
    component.updateSubmissionBatchFilter('NONE');
    component.exportCsv();

    const body = api.exportApproved.mock.calls[0][0];
    expect(body).toEqual(expect.objectContaining({ productTypeId: 5, submissionBatch: 'NONE' }));
    // 審核狀態由後端固定為 APPROVED；分頁參數不送（後端全量匯出）。
    expect(body).not.toHaveProperty('reviewStatus');
    expect(body).not.toHaveProperty('page');
    expect(fileDownload.save).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^審核通過商品_\d{8}-\d{4}\.csv$/));
    expect(component.statusMessage()).toContain('已匯出 3 筆');
    expect(component.isExporting()).toBe(false);
  });

  it('does not download anything when no approved product matches (2026-09)', () => {
    api.exportApproved.mockReturnValue(of({ blob: new Blob(['']), rowCount: 0 }));
    component.updateReviewFilter('APPROVED');
    component.exportCsv();
    expect(fileDownload.save).not.toHaveBeenCalled();
    expect(component.statusMessage()).toContain('未產生檔案');
  });

  it('reloads the list after exporting while viewing never-exported products (2026-09)', () => {
    component.updateReviewFilter('APPROVED');
    component.updateNeverExported(true);
    const callsBefore = api.list.mock.calls.length;
    component.exportCsv();
    expect(api.list.mock.calls.length).toBe(callsBefore + 1);
  });

  it('shows the backend message when the export fails (2026-09)', () => {
    api.exportApproved.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { success: false, message: '超過單次匯出上限 5000 筆' },
          }),
      ),
    );
    component.updateReviewFilter('APPROVED');
    component.exportCsv();
    expect(fileDownload.save).not.toHaveBeenCalled();
    expect(component.statusMessage()).toContain('超過單次匯出上限');
    expect(component.isExporting()).toBe(false);
  });

  it('does not send productTypeId when the filter is ALL', () => {
    component.updateProductTypeFilter('食品／生鮮');
    component.updateProductTypeFilter('ALL');
    const lastCall = api.list.mock.calls.at(-1)![0];
    expect(lastCall.productTypeId).toBeUndefined();
  });

  it('shows an empty result instead of the unfiltered list when the product type has no matches', () => {
    // 對應這次要修正的具體症狀：選了確實存在、但目前完全沒有商品符合的
    // 分類，畫面應該顯示空結果，不能因為篩選失效而變成看起來跟沒篩選一樣。
    component.updateProductTypeFilter('美妝保養');
    fixture.detectChanges();
    expect(component.pageState()).toBe('empty');
    expect(component.products().length).toBe(0);
  });
});

/**
 * 2026-09-27：從儀表板統計卡點進來時帶 ?reviewStatus=，品項管理依卡片語意預先篩選。
 */
describe('ProductManagement (review filter from dashboard query param)', () => {
  const api = {
    list: vi.fn(() => of({ items: [], totalElements: 0, totalPages: 0, pageNumber: 0, pageSize: 20 })),
    listSubmissionBatches: vi.fn(() => of([])),
    exportApproved: vi.fn(),
  };
  const productTypeLookup = {
    getNameMap: vi.fn(() => of(new Map<number, string>())),
    getGroupedOptions: vi.fn(() => of([])),
    getDescriptionMap: vi.fn(() => of(new Map<number, string>())),
  };

  async function createWith(reviewStatus: string | null): Promise<ProductManagement> {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProductManagement],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(reviewStatus ? { reviewStatus } : {}) } },
        },
        { provide: ProductApiService, useValue: api },
        { provide: ProductTypeLookupService, useValue: productTypeLookup },
        { provide: FileDownloadService, useValue: { save: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductManagement);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it.each(['PENDING', 'APPROVED', 'REJECTED'] as const)('pre-filters by %s from the URL', async (status) => {
    const component = await createWith(status);
    expect(component.reviewFilter()).toBe(status);
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ reviewStatus: status }));
  });

  it('shows every review status for the total-products card (ALL)', async () => {
    const component = await createWith('ALL');
    expect(component.reviewFilter()).toBe('ALL');
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ reviewStatus: undefined }));
  });

  it.each([null, 'SOMETHING_ELSE'])('keeps the default PENDING filter when the parameter is %s', async (raw) => {
    const component = await createWith(raw);
    expect(component.reviewFilter()).toBe('PENDING');
  });
});
