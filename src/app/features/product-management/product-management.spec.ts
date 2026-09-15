/** 檔案用途：驗證品項篩選、60% 門檻、核准編輯邊界與條件式刪除等本地 Mock 規則。 */
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
    // 這份測試套件驗證的是篩選/操作可見性邏輯本身，不是「角色決定預設篩選值」
    // 這個新行為——後者屬於未登入測試環境下 isManager() 恆為 false 的副作用，
    // 這裡明確重設回中性的 'ALL'，避免測試環境的預設角色悄悄改變一整份
    // 既有測試套件的基準狀態。若要測角色差異的預設值，應另外寫專屬測試。
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
    expect(fixture.nativeElement.textContent).toContain('已通過選品審核');
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
    expect(rejectedAction.textContent).toContain('重新送審');
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
  };
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
    await TestBed.configureTestingModule({
      imports: [ProductManagement],
      providers: [
        provideRouter([]),
        { provide: ProductApiService, useValue: api },
        { provide: ProductTypeLookupService, useValue: productTypeLookup },
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
