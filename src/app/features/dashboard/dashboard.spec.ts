import { APP_RUNTIME_CONFIG } from '../../core/config/app-config';
/**
 * 檔案用途：驗證 Dashboard Mock 狀態、推薦與錯誤畫面；assertion 不涉及真實 API。
 *
 * 正式執行設定目前使用真實 API，但這組測試專門驗證 Mock 畫面；因此會在
 * 第一次 detectChanges（也就是 ngOnInit）之前明確切換元件模式，避免測試
 * 意外送出 HTTP 請求，也避免測試結果依賴全域 APP_CONFIG。
 * 元件仍會注入 HttpClient，樣板也使用 RouterLink，所以保留兩者的測試 provider。
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
      providers: [
        { provide: APP_RUNTIME_CONFIG, useValue: { useMockData: false } },provideHttpClient(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    (component as unknown as { useMockData: boolean }).useMockData = true;
    fixture.detectChanges();
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

  it('keeps a sticky action structure and the correct action type for every Top 10 row', () => {
    const rows = fixture.nativeElement.querySelectorAll('.recommendations-panel tbody tr');
    const actions = fixture.nativeElement.querySelectorAll(
      '.recommendations-panel tbody .actions-column',
    );
    expect(fixture.nativeElement.querySelector('thead .actions-column')).toBeTruthy();
    expect(rows.length).toBe(10);
    expect(actions.length).toBe(rows.length);
    actions.forEach((cell: HTMLElement) => {
      expect(cell.querySelector('a.table-action, button.table-action:disabled')).toBeTruthy();
    });
    expect(fixture.nativeElement.querySelector('a.table-action')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button.table-action:disabled')).toBeTruthy();
  });
});
