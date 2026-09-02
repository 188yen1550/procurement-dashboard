/**
 * 檔案用途：驗證 Dashboard Mock 狀態、推薦與錯誤畫面；assertion 不涉及真實 API。
 *
 * ⚠️ 這次接上真實 API 後才發現：useMockData 目前是 false（見 app-config.ts），
 * 代表 ngOnInit() 一定會呼叫 DashboardApiService.loadAll()，需要 HttpClient；
 * 樣板也新增了 [routerLink]，需要 Router。跟 product-management.spec.ts
 * 用同一套既有慣例（真實 HttpClient、不用 HttpClientTestingModule）——
 * 測試環境沒有伺服器，請求會失敗但不會拋出同步例外，元件自己的
 * error 分支會接住，不影響這裡的 assertion（皆針對 Mock 資料與本地狀態）。
 */
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let component: Dashboard;
  let fixture: ComponentFixture<Dashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose ten mock recommendations', () => {
    expect(component.recommendations()).toHaveLength(10);
  });

  it('should lock recommendation actions in locked state', () => {
    component.setUiState('locked');
    expect(component.recommendations().every((item) => item.reviewStatus === 'APPROVED')).toBe(
      true,
    );
  });

  it('should expose the incomplete edge case below 60 percent', () => {
    expect(component.incompleteRecommendation.completeness).toBeLessThan(60);
  });

  it('should expose the selected UI state to assistive technology', () => {
    component.setUiState('edge');
    fixture.detectChanges();

    const selectedButton = fixture.nativeElement.querySelector(
      '[aria-label="切換至例外狀態"]',
    ) as HTMLButtonElement;

    expect(selectedButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a sticky action structure for every Top 10 row', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.recommendations-panel tbody tr');
    const actions = fixture.nativeElement.querySelectorAll(
      '.recommendations-panel tbody .actions-column',
    );
    expect(fixture.nativeElement.querySelector('thead .actions-column')).toBeTruthy();
    expect(rows.length).toBe(10);
    expect(actions.length).toBe(rows.length);
    actions.forEach((cell: HTMLElement) => {
      expect(cell.querySelector('button.table-action')).toBeTruthy();
    });
  });
});
