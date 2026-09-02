/** 檔案用途：驗證品項篩選、60% 門檻、核准編輯邊界與條件式刪除等本地 Mock 規則。 */
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProductManagement } from './product-management';

describe('ProductManagement', () => {
  let component: ProductManagement;
  let fixture: ComponentFixture<ProductManagement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProductManagement], providers: [provideHttpClient(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(ProductManagement);
    component = fixture.componentInstance;
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
    expect(fixture.nativeElement.textContent).toContain('非已上架或已銷售');
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
    expect(rejectedAction.textContent).toContain('編輯並重新送審');
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
    expect(component.canDelete(eligible)).toBe(true);
    expect(component.canDelete(locked)).toBe(false);
    component.requestDelete(eligible);
    component.confirmDelete();
    expect(component.products().some((item) => item.id === 102)).toBe(false);
  });
});
