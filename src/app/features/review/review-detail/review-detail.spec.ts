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
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DialogService } from '../../../core/dialog/dialog.service';
import { ReviewApiService } from '../api/review-api.service';
import { ReviewDetail } from './review-detail';

describe('ReviewDetail', () => {
  let fixture: ComponentFixture<ReviewDetail>;
  let component: ReviewDetail;
  let router: Router;
  let dialog: DialogService;

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
    router = TestBed.inject(Router);
    dialog = TestBed.inject(DialogService);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
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
    // 驗證錯誤改用 DialogService 呈現，不再是 statusMessage 的行內文字。
    expect(dialog.state()?.variant).toBe('error');
    expect(dialog.state()?.messages[0]).toBe('請選擇審核結果（通過或不通過）。');
  });

  it('requires a note for other risk', () => {
    component.toggleRisk(9); // 其他
    component.decision.set('REJECTED');
    component.comment.set('測試');
    component.submit();
    expect(dialog.state()?.messages[0]).toContain('必須填寫補充說明');
  });

  it('submits a complete decision and returns to the review list only after closing the dialog', () => {
    component.toggleRisk(1); // 實際供貨風險
    component.decision.set('APPROVED');
    component.comment.set('確認供貨後通過');
    component.submit();
    fixture.detectChanges();

    // 核准／拒絕是不可逆決策，submit() 現在會先跳出確認對話框，不是
    // 按下就立刻送出——這裡先驗證確認框有正確覆誦這次的決定內容，
    // 而且此時 api.submit 還不應該被呼叫過。
    const confirmState = dialog.state();
    expect(confirmState?.variant).toBe('confirm');
    expect(confirmState?.messages[0]).toContain('通過選品審核');
    expect(api.submit).not.toHaveBeenCalled();

    dialog.handleConfirm();
    fixture.detectChanges();
    expect(api.submit).toHaveBeenCalled();
    expect(component.submitted()).toBe(true);
    // 送出成功一律用 DialogService 呈現，跟 product-form.ts「儲存並重新送審」
    // 同一套樣式與流程：dialog、按確定才導頁，不是送出當下就直接跳轉。
    const state = dialog.state();
    expect(state?.variant).toBe('success');
    expect(state?.messages[0]).toContain('不代表已銷售');
    expect(router.navigate).not.toHaveBeenCalled();

    dialog.handleConfirm();
    expect(dialog.state()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/review']);
  });

  it('does not submit the decision when the user cancels the confirmation dialog', () => {
    component.toggleRisk(1);
    component.decision.set('REJECTED');
    component.comment.set('待補齊資料');
    component.submit();
    fixture.detectChanges();
    expect(dialog.state()?.variant).toBe('confirm');

    dialog.handleCancel();
    fixture.detectChanges();

    // 使用者選擇「再檢查一次」：決策不應該被送出，表單維持可編輯狀態，
    // 讓使用者能回頭修改，不是被鎖死或已經送出去了。
    expect(api.submit).not.toHaveBeenCalled();
    expect(component.submitted()).toBe(false);
    expect(dialog.state()).toBeNull();
  });

  it('shows and closes simulated 409 conflict', () => {
    component.simulateConflict();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('409 Conflict');
    component.closeConflict();
    expect(component.conflictOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/review']);
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
