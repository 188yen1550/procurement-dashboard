/** 檔案用途：驗證 Dashboard Mock 狀態、推薦與錯誤畫面；assertion 不涉及真實 API。 */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let component: Dashboard;
  let fixture: ComponentFixture<Dashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
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
});
