/**
 * 檔案用途：驗證審核表單必填、其他風險備註、提交、衝突與狀態畫面。
 *
 * ⚠️ 這次接上真實 API 後才發現：useMockData 目前是 false（見 app-config.ts），
 * 代表 ngOnInit() 一定會走 ReviewApiService.getDetailWithTypeName()，
 * 不會用元件內建的 mockDetail()。跟 product-detail.spec.ts 用同一套策略：
 * 整個 mock 掉 ReviewApiService，讓測試不依賴全域設定值，也不需要真的打網路。
 *
 * 風險選項改用 id 而非名稱字串（toggleRisk(id: number)），對應下方
 * mock 資料裡的 availableRiskOptions：1=實際供貨風險、9=其他。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ReviewApiService } from '../api/review-api.service';
import { ReviewDetail } from './review-detail';

describe('ReviewDetail', () => {
  let fixture: ComponentFixture<ReviewDetail>;
  let component: ReviewDetail;

  const mockDetail = {
    productId: 102,
    productName: '輕量智慧溫控電熱杯',
    productTypeId: 2,
    productTypeName: '3C／家電',
    pricingType: 'NEW' as const,
    supplierName: '沐光科技',
    campaignTags: [],
    submissionCount: 1,
    isResubmission: false,
    scores: {
      businessScore: 79,
      audienceScore: 84,
      historicalScore: 76,
      purchaseScore: 77,
      trendScore: 86,
      forecastScore: 80,
      totalScore: 78.4,
      festivalBoost: 3.3,
      finalScore: 81.7,
      dataCompleteness: 78,
      evaluationModeName: '均衡模式',
      evaluationModeVersion: 1,
    },
    matchedCampaign: null,
    ai: {
      hasAnalysis: true,
      summary: '市場熱度與核心客群具中高度匹配，但仍需人工確認供貨穩定性與實際商業條件。',
      recommendation: '建議通過',
      reasons: '',
    },
    availableRiskOptions: [
      { id: 1, name: '實際供貨風險', description: null, isSystemDefault: true },
      { id: 9, name: '其他', description: null, isSystemDefault: true },
    ],
  };

  const api = {
    getDetailWithTypeName: vi.fn(() => of(mockDetail)),
    submit: vi.fn(() => of({})),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [ReviewDetail],
      providers: [provideRouter([]), { provide: ReviewApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ReviewDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates with product snapshot and AI disclaimer', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('商品與評估快照');
    expect(fixture.nativeElement.textContent).toContain('AI 不會自動核准');
  });

  it('requires a decision', () => {
    component.comment.set('測試留言');
    component.submit();
    expect(component.submitted()).toBe(false);
    expect(component.statusMessage()).toContain('請選擇核准結果');
  });

  it('requires a note for other risk', () => {
    component.toggleRisk(9); // 其他
    component.decision.set('REJECTED');
    component.comment.set('測試');
    component.submit();
    expect(component.statusMessage()).toContain('必須填寫補充說明');
  });

  it('submits a complete decision', () => {
    component.toggleRisk(1); // 實際供貨風險
    component.decision.set('APPROVED');
    component.comment.set('確認供貨後通過');
    component.submit();
    fixture.detectChanges();
    expect(api.submit).toHaveBeenCalled();
    expect(component.submitted()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('不代表已銷售');
  });

  it('shows and closes simulated 409 conflict', () => {
    component.simulateConflict();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('409 Conflict');
    component.closeConflict();
    expect(component.conflictOpen()).toBe(false);
  });

  it('renders disabled loading and error states', () => {
    component.setState('disabled');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBe(true);
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入審核快照');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('無法載入審核資料');
  });
});
