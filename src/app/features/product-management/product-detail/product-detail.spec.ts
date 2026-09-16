/**
 * 檔案用途：驗證詳情頁 SNAPSHOT、60% 門檻、圖片替代、趨勢、封存／復用與 AI 分析規則。
 *
 * ⚠️ 這次接上 AI 分析後才發現：這支 spec 一直沒有提供 ProductTypeLookupService，
 * 而它內部會注入 SettingsApiService → 需要 HttpClient——之前只 mock 了
 * ProductApiService，這條依賴鏈其實會在建構元件時直接拋 NullInjectorError，
 * 只是 tsc/ngc 的型別檢查抓不到這種執行期 DI 錯誤。這次一併補上 mock。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { DialogService } from '../../../core/dialog/dialog.service';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import { ProductApiService } from '../api/product-api.service';
import { ProductDetail } from './product-detail';

describe('ProductDetail', () => {
  let fixture: ComponentFixture<ProductDetail>;
  let component: ProductDetail;
  let dialog: DialogService;
  const api = {
    getProduct: vi.fn(() => of({
      id: 101,
      name: '中秋炭烤海陸組合禮盒',
      description: '適合中秋家庭與企業團購的海陸烤肉組合。',
      imageUrl: 'data:image/png;base64,mock',
      supplierName: '潮港鮮物有限公司',
      pricingType: 'RESALE' as const,
      costPrice: 820,
      salePrice: 1190,
      completenessPercent: 96,
      reviewStatus: 'APPROVED',
      itemStatus: 'ACTIVE',
      candidateStatus: 'CANDIDATE',
      submissionCount: 1,
    })),
    getEvaluation: vi.fn(() => of({
      dataSource: 'SNAPSHOT' as const,
      evaluationModeName: '均衡模式 · Version 1',
      businessScore: 88,
      audienceScore: 91,
      historicalScore: 84,
      purchaseScore: 86,
      trendScore: 90,
      forecastScore: 88,
      totalScore: 88.2,
      dataCompleteness: 96,
      festivalBoost: 4.2,
      finalScore: 92.4,
    })),
    getFestivalBoost: vi.fn(() => of({
      dataSource: 'SNAPSHOT' as const,
      matchedCampaign: { campaignId: 1, campaignName: '中秋節', matchedTags: ['bbq', 'gift'] },
      festivalBoost: 4.2,
      finalScore: 92.4,
    })),
    // 預設回「尚未生成」的空物件，符合後端真實行為（不是回錯誤，是全欄位 null）。
    getAiAnalysis: vi.fn(() =>
      of({ hasAnalysis: false, summary: '', recommendation: '', reasons: '', modelName: null, isMockData: false, generatedAt: null }),
    ),
    // product-detail.ts 的 reload() 也會呼叫這支取得歷次審核紀錄——
    // 回空陣列即可，這份測試套件不驗證審核歷史區塊的內容。
    getReviewHistory: vi.fn(() => of([])),
    generateAiAnalysis: vi.fn(() =>
      of({
        hasAnalysis: true,
        summary: '節慶標籤與當前檔期高度吻合。',
        recommendation: '建議通過',
        reasons: '中秋烤肉需求與 bbq 標籤相符\n團購價較市價低 20%',
        modelName: 'gemini-3.6-flash',
        isMockData: false,
        generatedAt: '2026-09-02T10:00:00',
      }),
    ),
    archive: vi.fn(() => of({})),
    restore: vi.fn(() => of({})),
    syncTrend: vi.fn(() =>
      of({
        source: 'GOOGLE_TRENDS',
        keyword: '中秋烤肉',
        trendScore: 92,
        popularityScore: 88,
        trendDirection: 'UP' as const,
        collectedAt: '2026-09-02T10:00:00',
      }),
    ),
  };
  const productTypeLookup = {
    getName: vi.fn(() => of('食品／生鮮')),
    getNameMap: vi.fn(() => of(new Map([[1, '食品／生鮮']]))),
    invalidate: vi.fn(),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: ProductApiService, useValue: api },
        { provide: ProductTypeLookupService, useValue: productTypeLookup },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductDetail);
    component = fixture.componentInstance;
    dialog = TestBed.inject(DialogService);
    fixture.detectChanges();
  });
  it('renders a complete product evaluation', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('最終分數');
    expect(fixture.nativeElement.textContent).toContain('92.4');
    expect(fixture.nativeElement.textContent).toContain('節慶加成明細');
  });
  it('shows margin, evaluation references and snapshot source', () => {
    expect(fixture.nativeElement.textContent).toContain('毛利率');
    expect(fixture.nativeElement.textContent).toContain('31.1%');
    expect(fixture.nativeElement.textContent).toContain('參考項目');
    expect(fixture.nativeElement.textContent).toContain('SNAPSHOT');
  });
  it('explains approved scope and locked core data', () => {
    expect(component.isLocked()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('不代表已上架');
    expect(fixture.nativeElement.textContent).toContain('一般基本資料仍可編輯');
    expect(fixture.nativeElement.textContent).toContain('核心選品資料已鎖定');
  });
  it('allows approved products to enter edit mode for basic fields', () => {
    const link = fixture.nativeElement.querySelector('.header-actions a');
    expect(link).toBeTruthy();
    expect(link.textContent).toContain('編輯品項');
  });
  it('renders incomplete data without AI fabrication', () => {
    component.showIncomplete();
    fixture.detectChanges();
    expect(component.incomplete()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('不進入評估計分與 AI 推薦');
    expect(fixture.nativeElement.textContent).toContain('尚未產生 AI 分析');
  });
  it('syncs trend data via the real API in formal mode', () => {
    const response = { source: 'GOOGLE_TRENDS', keyword: '中秋烤肉', trendScore: 92, popularityScore: 88, trendDirection: 'UP' as const, collectedAt: '2026-09-02T10:00:00' };
    const pending = new Subject<typeof response>();
    api.syncTrend.mockReturnValueOnce(pending);
    component.syncTrend();
    expect(component.syncState()).toBe('syncing');
    // 這支 spec 沒有設定路由參數，productId 實際上是空字串（見同檔案
    // generateAiAnalysis 測試的說明），語意上跟其他測試保持一致。
    expect(api.syncTrend).toHaveBeenCalledWith('');
    pending.next(response);
    pending.complete();
    expect(component.syncState()).toBe('success');
    expect(component.product()?.trendDirection).toBe('UP');
    expect(component.product()?.trendScore).toBe(92);
  });

  it('shows the real error message when trend sync fails', () => {
    api.syncTrend.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502, error: { message: '外部趨勢資料源逾時' } })));
    component.syncTrend();
    fixture.detectChanges();
    expect(component.syncState()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('外部趨勢資料源逾時');
  });
  it('uses the master API service to archive and restore in formal mode', () => {
    component.toggleArchive();
    expect(api.archive).toHaveBeenCalledWith(101);
    component.product.update((product) =>
      product ? { ...product, itemStatus: 'ARCHIVED' } : product,
    );
    component.toggleArchive();
    expect(api.restore).toHaveBeenCalledWith(101);
  });
  it('renders loading empty and error recovery states', () => {
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入品項詳情');
    component.setState('empty');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('找不到品項資料');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('無法載入品項詳情');
  });
  it('renders the product image with useful alt text', () => {
    const image = fixture.nativeElement.querySelector('.product-media img');
    expect(image).toBeTruthy(); expect(image.alt).toContain(component.product()!.name);
  });
  it('shows fallback content when the product image fails', () => {
    component.handleImageError(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('商品圖片載入失敗'); expect(fixture.nativeElement.querySelector('.image-fallback').getAttribute('role')).toBe('alert'); expect(fixture.nativeElement.textContent).toContain('最終分數');
  });
  it('shows an empty image state when imageUrl is absent', () => {
    component.showIncomplete(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('尚無商品圖片');
  });
  it('shows the correct empty state for AI analysis, not conflated with data completeness', () => {
    // getAiAnalysis 預設 mock 回 hasAnalysis:false（尚未生成過），
    // 文案不應暗示是資料不足造成的——這兩件事互不相干。
    expect(component.product()?.aiSummary).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('尚未產生 AI 分析');
    expect(fixture.nativeElement.textContent).not.toContain('資料不足，未產生 AI 分析');
  });
  it('generates AI analysis on demand and updates the summary without re-fetching the whole page', () => {
    component.generateAiAnalysis();
    // 改用 DialogService 呈現確認對話框，取代原生 window.confirm()；
    // 模擬使用者按下「確定」。
    expect(dialog.state()?.variant).toBe('confirm');
    dialog.handleConfirm();
    // 這支測試沒有設定路由參數，route.snapshot.paramMap.get('id') 會是 null，
    // 元件內 `?? ''` 之後 productId 實際上是空字串。
    expect(api.generateAiAnalysis).toHaveBeenCalledWith('');
    expect(component.isGeneratingAi()).toBe(false);
    expect(component.product()?.aiSummary).toContain('節慶標籤與當前檔期高度吻合');
    // reasons 是後端單一字串，依換行拆成陣列顯示。
    expect(component.product()?.aiReasons).toEqual([
      '中秋烤肉需求與 bbq 標籤相符',
      '團購價較市價低 20%',
    ]);
    // ⚠️ 對應這次修正的重點：按鈕之前只存在於「尚未產生」的分支，
    // 產生成功後整顆按鈕連同分支一起消失，使用者無法再次觸發。
    // 現在有分析結果時也要能看到「重新產生」按鈕。
    fixture.detectChanges();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.panel.ai button'),
    ) as HTMLButtonElement[];
    expect(buttons.some((button) => button.textContent?.includes('重新產生 AI 分析'))).toBe(true);
  });
  it('allows regenerating AI analysis and warns that it will overwrite the existing result', () => {
    component.generateAiAnalysis();
    dialog.handleConfirm();

    component.generateAiAnalysis();
    expect(dialog.state()?.messages[0]).toContain('會覆蓋目前的分析結果');
    dialog.handleConfirm();

    expect(api.generateAiAnalysis).toHaveBeenCalledTimes(2);
  });
  it('does not call the LLM when the user cancels the confirmation dialog', () => {
    component.generateAiAnalysis();
    dialog.handleCancel();
    expect(api.generateAiAnalysis).not.toHaveBeenCalled();
  });
});
