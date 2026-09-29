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
import { of, Subject, throwError, TimeoutError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../../../core/auth/auth';
import { DialogService } from '../../../core/dialog/dialog.service';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import {
  GoogleTrendCoverage,
  GoogleTrendSignal,
  GoogleTrendsApiService,
} from '../../settings/api/google-trends-api.service';
import { ProductApiService } from '../api/product-api.service';
import { ReviewRecordModel } from '../../review/api/review.mapper';
import { ProductDetail } from './product-detail';

/** 預設的評估回應（APPROVED 商品的 SNAPSHOT）；個別測試可展開後覆寫欄位。 */
function evaluationPayload() {
  return {
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
  };
}

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
    getEvaluation: vi.fn(() => of(evaluationPayload())),
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
    // 頁面載入時讀取最新一筆趨勢（唯讀，不觸發爬蟲）。
    getLatestTrend: vi.fn(() =>
      of({
        source: 'PTT',
        keyword: '中秋炭烤海陸組合禮盒',
        trendScore: 56,
        popularityScore: 63.37,
        trendDirection: 'UP' as const,
        collectedAt: '2026-09-25T02:00:00',
      }),
    ),
    // ⚠️ 2026-09-25 新增：熱度趨勢圖用，跟 getLatestTrend 是各自獨立的
    // 查詢。回傳 2 筆，讓測試涵蓋「有足夠資料畫圖」這個分支——沒有這支
    // mock 的話，元件呼叫這個不存在的方法會直接同步拋出 TypeError，
    // 連 catchError 都攔不到（不是 Observable 錯誤，是呼叫本身就失敗），
    // 導致整個 forkJoin 出錯、頁面顯示「載入失敗」。
    getTrendHistory: vi.fn(() =>
      of([
        {
          collectedAt: '2026-09-23T02:00:00',
          popularityScore: 58.2,
          trendDirection: 'UP' as const,
        },
        {
          collectedAt: '2026-09-24T02:00:00',
          popularityScore: 63.37,
          trendDirection: 'UP' as const,
        },
      ]),
    ),
    syncTrend: vi.fn(() =>
      of({
        source: 'GOOGLE_TRENDS',
        keyword: '中秋烤肉',
        trendScore: 92,
        popularityScore: 88,
        trendDirection: 'UP' as 'UP' | 'STABLE' | 'DOWN',
        collectedAt: '2026-09-02T10:00:00',
      }),
    ),
  };
  // 2026-09-28：Google 趨勢參考（獨立服務）。預設回「尚未查詢」，個別測試再覆寫。
  const googleTrendsApi = {
    getLatest: vi.fn(() => of<GoogleTrendSignal | null>(null)),
    // 2026-09-30：尚未查詢時的批次涵蓋說明。預設回「待審優先」，個別測試再覆寫。
    getCoverage: vi.fn(() =>
      of<GoogleTrendCoverage>({
        willBeQueried: true,
        reason: 'PENDING_PRIORITY',
        message: '待審商品，下次批次（每週一 04:00）會優先查詢。',
      }),
    ),
    sync: vi.fn(() =>
      of<GoogleTrendSignal>({
        productId: 101,
        keyword: '中秋炭烤海陸組合禮盒',
        status: 'OK',
        direction: 'UP',
        growthRate: 23.5,
        recentAvg: 52,
        baselineAvg: 42.1,
        pointCount: 92,
        collectedAt: '2026-09-28T15:40:00',
      }),
    ),
  };
  const auth = { isManager: vi.fn(() => false) };
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
        { provide: GoogleTrendsApiService, useValue: googleTrendsApi },
        // 2026-09-24：品項詳情依角色決定是否唯讀，預設以操作層身分測既有行為。
        { provide: Auth, useValue: auth },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductDetail);
    component = fixture.componentInstance;
    dialog = TestBed.inject(DialogService);
    fixture.detectChanges();
  });
  it('filters review history by result and reviewed date instead of sorting by them (2026-09)', () => {
    const history = [
      { id: 1, reviewStatus: 'REJECTED', reviewedAt: '2026-09-01T10:00:00', submissionCount: 1, reviewerName: '林經理' },
      { id: 2, reviewStatus: 'REJECTED', reviewedAt: '2026-09-10T09:00:00', submissionCount: 2, reviewerName: '林經理' },
      { id: 3, reviewStatus: 'APPROVED', reviewedAt: '2026-09-20T15:00:00', submissionCount: 3, reviewerName: '王經理' },
    ] as unknown as ReviewRecordModel[];
    component.reviewHistory.set(history);

    expect(component.historySortChoices.map((c) => c.key)).toEqual(['submissionCount', 'reviewerName']);

    component.historyResultFilter.set('REJECTED');
    expect(component.filteredReviewHistory().map((r) => r.id)).toEqual([1, 2]);

    component.historyReviewedFrom.set('2026-09-05');
    expect(component.filteredReviewHistory().map((r) => r.id)).toEqual([2]);

    // 起日晚於迄日：不套用日期篩選，只保留結果篩選。
    component.historyReviewedTo.set('2026-09-02');
    expect(component.historyDateRangeInvalid()).toBe(true);
    expect(component.filteredReviewHistory().map((r) => r.id)).toEqual([1, 2]);

    component.clearHistoryFilters();
    expect(component.filteredReviewHistory()).toHaveLength(3);
  });

  it('shows the weather boost card and its breakdown alongside the festival boost (V26)', () => {
    component.product.update((p) =>
      p
        ? {
            ...p,
            weatherBoost: 3,
            weatherDetail: {
              historyScore: 100,
              forecastScore: 0,
              combinedScore: 60,
              historyWeightPercentage: 60,
              forecastWeightPercentage: 40,
              boostCap: 5,
              weatherBoost: 3,
              matchedTags: ['涼感'],
              historyDays: 30,
              forecastDays: 14,
              historyFrom: '2026-08-26',
              forecastTo: '2026-10-08',
              dataUpdatedAt: '2026-09-25T05:00:00',
            },
          }
        : p,
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const card = Array.from(root.querySelectorAll('.score-grid article')).find((a) => a.textContent?.includes('天氣分數'));
    expect(card?.textContent).toContain('+3');
    expect(card?.textContent).toContain('涼感');
    const panel = root.querySelector('.weather-boost');
    expect(panel?.textContent).toContain('天氣加成明細');
    expect(panel?.textContent).toContain('2026-09-25 05:00');
    expect(component.weatherBoostCaption({ ...component.product()!.weatherDetail!, combinedScore: null })).toBe('尚無天氣資料');
  });

  it('shows a dash instead of zero when an approved snapshot predates the weather boost (V26)', () => {
    component.product.update((p) => (p ? { ...p, weatherBoost: null, weatherDetail: null } : p));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const card = Array.from(root.querySelectorAll('.score-grid article')).find((a) => a.textContent?.includes('天氣分數'));
    expect(card?.textContent).toContain('—');
    expect(root.querySelector('.weather-boost')).toBeNull();
  });

  it('renders a complete product evaluation', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('總分');
    expect(fixture.nativeElement.textContent).toContain('92.4');
    expect(fixture.nativeElement.textContent).toContain('節慶加成明細');
  });
  // 2026-09-27：「急迫係數 100%、命中核心標籤，加成卻是 +4.9」——加成原本讀 evaluation 存檔，
  // 急迫係數讀 festival-boost 即時計算，兩者不同步時明細算不回總數。改以 festival-boost 為準。
  it('uses the festival-boost response for boosts and final score so the breakdown adds up', () => {
    api.getEvaluation.mockReturnValueOnce(
      of({ ...evaluationPayload(), totalScore: 80, festivalBoost: 4.9, weatherBoost: 0, finalScore: 84.9 }) as ReturnType<
        typeof api.getEvaluation
      >,
    );
    api.getFestivalBoost.mockReturnValueOnce(
      of({
        dataSource: 'LIVE' as const,
        matchedCampaign: { campaignId: 1, campaignName: '中秋節', matchedTags: ['bbq'], matchWeight: 1, urgencyFactor: 1 },
        festivalBoost: 5,
        weatherBoost: 0,
        finalScore: 85,
      }) as unknown as ReturnType<typeof api.getFestivalBoost>,
    );
    component.reload();
    fixture.detectChanges();
    const p = component.product()!;
    expect(component.urgencyPercent(p.urgencyFactor)).toBe(100);
    expect(p.festivalBoost).toBe(5);
    expect(p.finalScore).toBe(85);
    expect(p.baseScore).toBe(80);
  });

  it('falls back to the stored evaluation when the festival-boost API fails', () => {
    api.getEvaluation.mockReturnValueOnce(
      of({ ...evaluationPayload(), totalScore: 80, festivalBoost: 4.9, weatherBoost: 0, finalScore: 84.9 }) as ReturnType<
        typeof api.getEvaluation
      >,
    );
    api.getFestivalBoost.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    component.reload();
    fixture.detectChanges();
    expect(component.product()!.festivalBoost).toBe(4.9);
    expect(component.product()!.finalScore).toBe(84.9);
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
  it('shows the latest trend and its source on page load without triggering a crawl', () => {
    expect(api.getLatestTrend).toHaveBeenCalled();
    expect(api.syncTrend).not.toHaveBeenCalled();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('資料來源：PTT 討論量');
    expect(text).toContain('熱度 63.37 分');
    expect(text).not.toContain('尚無趨勢資料');
  });
  // ⚠️ 2026-09-25 新增：熱度趨勢圖，跟上面「最新一筆」是各自獨立的查詢。
  it('loads trend history on page load without triggering a crawl, and renders the chart canvas', () => {
    expect(api.getTrendHistory).toHaveBeenCalled();
    expect(api.syncTrend).not.toHaveBeenCalled();
    expect(component.trendHistory().length).toBe(2);
    const canvas = fixture.nativeElement.querySelector('.trend-chart-wrap canvas');
    expect(canvas).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('歷史資料筆數還不夠');
  });
  // 2026-09-30：橫軸只顯示日期（MM-DD），不再帶 ISO 字串「T02:00」之後的時間
  it('labels the trend chart x-axis with the date only', () => {
    const chart = (component as unknown as { trendChart: { data: { labels: unknown[] } } | null }).trendChart;
    expect(chart).toBeTruthy();
    expect(chart!.data.labels).toEqual(['09-23', '09-24']);
  });
  // 2026-09-30：第一行核心客群／歷史銷售／預估購買；第二行 Google 趨勢（左）＋市場趨勢（右），兩者為同層級的獨立卡片
  it('lays out evaluation cards: three in the first row, then Google trend and market trend as sibling cards', () => {
    const metrics = fixture.nativeElement.querySelector('.evaluation-metrics') as HTMLElement;
    const items = Array.from(metrics.children) as HTMLElement[];
    expect(items.every((item) => item.classList.contains('evaluation-item'))).toBe(true);
    expect(items.map((item) => item.querySelector(':scope > header > h2')?.textContent?.trim().slice(0, 4))).toEqual([
      '核心客群', '歷史銷售', '預估購買', 'Goog', '市場趨勢',
    ]);
    expect(items[3].classList).toContain('google-trend');
    expect(items[4].classList).toContain('trend');
    // Google 趨勢不再嵌在市場趨勢卡片裡
    expect(items[4].querySelector('.google-trend')).toBeNull();
  });
  it('shows a hint instead of a chart when trend history has fewer than 2 points', () => {
    api.getTrendHistory.mockReturnValueOnce(
      of([{ collectedAt: '2026-09-24T02:00:00', popularityScore: 63.37, trendDirection: 'UP' as const }]),
    );
    component.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.trend-chart-wrap')).toBeFalsy();
    expect(fixture.nativeElement.textContent).toContain('歷史資料筆數還不夠');
  });

  it('syncs trend data via the real API in formal mode', () => {
    const response = { source: 'PTT', keyword: '中秋烤肉', trendScore: 12.58, popularityScore: 84.37, trendDirection: 'DOWN' as const, collectedAt: '2026-09-25T10:00:00' };
    const pending = new Subject<typeof response>();
    api.syncTrend.mockReturnValueOnce(pending);
    component.syncTrend();
    expect(component.syncState()).toBe('syncing');
    // 這支 spec 沒有設定路由參數，productId 實際上是空字串（見同檔案
    // generateAiAnalysis 測試的說明），語意上跟其他測試保持一致。
    expect(api.syncTrend).toHaveBeenCalledWith('');
    api.getEvaluation.mockClear();
    pending.next(response);
    pending.complete();
    expect(component.syncState()).toBe('success');
    expect(component.product()?.trendDirection).toBe('DOWN');
    expect(component.product()?.popularityScore).toBe(84.37);
    expect(component.product()?.trendSource).toBe('PTT');
    // 同步後重新讀取評估：畫面的趨勢分是評估重算後的分數（mock 為 90），
    // 不是 sync 回傳的 PTT 原始趨勢分 12.58。
    expect(api.getEvaluation).toHaveBeenCalledTimes(1);
    expect(component.product()?.trendScore).toBe(90);
  });

  // 2026-09-29：PTT 抓不到不再改用模擬資料；只有開發時改用模擬來源才會回 SIMULATED，仍需清楚標示
  it('clearly labels simulated data (developer stub source) after sync', () => {
    api.syncTrend.mockReturnValueOnce(
      of({ source: 'SIMULATED', keyword: '中秋烤肉', trendScore: 51, popularityScore: 49, trendDirection: 'UP' as const, collectedAt: '2026-09-25T10:00:00' }),
    );
    component.syncTrend();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('模擬資料');
    expect(text).toContain('不列入評分');
  });

  it('shows the backend message when PTT is unavailable (502), keeping the previous trend data', () => {
    const message = '暫時無法從 PTT 取得「中秋烤肉」的熱度，已保留上一筆熱度資料，請稍後再試';
    api.syncTrend.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 502, error: { success: false, message, data: null } })),
    );
    component.syncTrend();
    fixture.detectChanges();
    expect(component.syncState()).toBe('error');
    const section = fixture.nativeElement.querySelector('.evaluation-item.trend') as HTMLElement;
    expect(section.textContent).toContain('已保留上一筆熱度資料');
  });

  it('shows a readable timeout message for trend sync and lets the user retry', () => {
    api.syncTrend.mockReturnValueOnce(throwError(() => new TimeoutError()));
    component.syncTrend();
    fixture.detectChanges();
    expect(component.syncState()).toBe('error');
    const section = fixture.nativeElement.querySelector('.evaluation-item.trend') as HTMLElement;
    expect(section.textContent).toContain('PTT 搜尋超過 60 秒仍未完成');
    expect(section.textContent).not.toContain('TimeoutError');
    // 按鈕沒有被鎖住，文字改成「重試」
    const button = section.querySelector(':scope > button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('重試');

    // 重試：再按一次會重新呼叫 API，成功後錯誤訊息消失
    button.click();
    fixture.detectChanges();
    expect(api.syncTrend).toHaveBeenCalledTimes(2);
    expect(component.syncState()).toBe('success');
    expect(component.syncError()).toBe('');
    expect(section.textContent).not.toContain('PTT 搜尋超過');
  });

  it('shows a readable timeout message for AI analysis and keeps the button usable', () => {
    api.generateAiAnalysis.mockReturnValueOnce(throwError(() => new TimeoutError()));
    component.generateAiAnalysis();
    dialog.handleConfirm();
    fixture.detectChanges();
    expect(component.isGeneratingAi()).toBe(false);
    expect(component.aiError()).toContain('AI 分析超過 100 秒仍未回應');
    expect(component.aiError()).toContain('人工審核不受影響');
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.panel.ai button'),
    ) as HTMLButtonElement[];
    expect(buttons.some((b) => !b.disabled)).toBe(true);
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
    expect(fixture.nativeElement.textContent).toContain('商品圖片載入失敗'); expect(fixture.nativeElement.querySelector('.image-fallback').getAttribute('role')).toBe('alert'); expect(fixture.nativeElement.textContent).toContain('總分');
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

  it('renders a read-only view for managers without any write entry points', async () => {
    auth.isManager.mockReturnValue(true);
    const managerFixture = TestBed.createComponent(ProductDetail);
    managerFixture.detectChanges();
    await managerFixture.whenStable();
    managerFixture.detectChanges();
    const root = managerFixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('唯讀檢視');
    expect(root.querySelector('.header-actions')).toBeNull();
    expect(root.querySelector('.lifecycle')).toBeNull();
    expect(root.querySelector('a[href$="/edit"]')).toBeNull();
    const buttons = Array.from(root.querySelectorAll('button'), (b) => b.textContent ?? '');
    expect(buttons.some((text) => text.includes('AI 分析') || text.includes('立即更新'))).toBe(false);
    auth.isManager.mockReturnValue(false);
  });

  describe('Google 趨勢參考（2026-09-28）', () => {
    async function render(isManager: boolean): Promise<{ root: HTMLElement; instance: ProductDetail; fixture: ComponentFixture<ProductDetail> }> {
      auth.isManager.mockReturnValue(isManager);
      const f = TestBed.createComponent(ProductDetail);
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      auth.isManager.mockReturnValue(false);
      return { root: f.nativeElement as HTMLElement, instance: f.componentInstance, fixture: f };
    }

    it('操作層看得到結果（方向與成長率），但沒有查詢按鈕', async () => {
      googleTrendsApi.getLatest.mockReturnValueOnce(
        of<GoogleTrendSignal | null>({
          productId: 101, keyword: '中秋烤肉', status: 'OK', direction: 'DOWN', growthRate: -18.24,
          recentAvg: 30, baselineAvg: 36.7, pointCount: 92, collectedAt: '2026-09-28T04:00:00',
        }),
      );
      const { root } = await render(false);
      const block = root.querySelector('.google-trend')!;
      expect(block.textContent).toContain('下降');
      expect(block.textContent).toContain('近 7 天比前 4 週 -18.2%');
      expect(block.textContent).toContain('搜尋關鍵字「中秋烤肉」');
      // 2026-09-30：卡片標題右側只放成長率，依方向上色
      const headline = block.querySelector(':scope > header > strong')!;
      expect(headline.textContent?.trim()).toBe('-18.2%');
      expect(headline.getAttribute('data-direction')).toBe('DOWN');
      // 成長率計算依據
      const metrics = Array.from(block.querySelectorAll('.google-trend-metrics dd'), (dd) => dd.textContent?.trim());
      expect(metrics).toEqual(['30', '36.7', '92 筆']);
      // PTT 上升（fixture）vs Google 下降 → 方向相反，提示人工確認；相差 3 天不加註
      const compare = block.querySelector('.google-ptt-compare')!;
      expect(compare.getAttribute('data-state')).toBe('OPPOSITE');
      expect(compare.textContent).toContain('與 PTT 方向相反（Google 下降、PTT 上升），建議人工確認');
      expect(compare.textContent).not.toContain('相差');
      // 區塊內只剩說明提示（info-tip）的按鈕，沒有會花額度的查詢按鈕
      const buttons = Array.from(block.querySelectorAll('button'), (b) => b.textContent ?? '');
      expect(buttons.some((text) => text.includes('查詢 Google 趨勢'))).toBe(false);
    });

    it('查無資料時說明搜尋量不足，而不是顯示 0 或下降', async () => {
      googleTrendsApi.getLatest.mockReturnValueOnce(
        of<GoogleTrendSignal | null>({
          productId: 101, keyword: '中秋炭烤海陸組合禮盒', status: 'NO_DATA', direction: null, growthRate: null,
          recentAvg: null, baselineAvg: null, pointCount: 0, collectedAt: '2026-09-28T04:00:00',
        }),
      );
      const { root } = await render(false);
      expect(root.querySelector('.google-trend')!.textContent).toContain('Google 搜尋量不足，無法判斷趨勢');
      expect(root.querySelector('.google-trend > header > strong')!.textContent?.trim()).toBe('—');
      expect(root.querySelector('.google-trend-metrics')).toBeNull();
      expect(root.querySelector('.google-ptt-compare')).toBeNull();
    });

    // 2026-09-30：與 PTT 方向比對（PTT fixture：上升、2026-09-25 同步）
    describe('與 PTT 方向比對', () => {
      function okSignal(direction: 'UP' | 'DOWN' | 'STABLE', collectedAt = '2026-09-28T04:00:00'): GoogleTrendSignal {
        return {
          productId: 101, keyword: '中秋烤肉', status: 'OK', direction, growthRate: 12,
          recentAvg: 40, baselineAvg: 35.7, pointCount: 92, collectedAt,
        };
      }

      it('方向相同顯示一致', async () => {
        googleTrendsApi.getLatest.mockReturnValueOnce(of<GoogleTrendSignal | null>(okSignal('UP')));
        const { root } = await render(false);
        const compare = root.querySelector('.google-ptt-compare')!;
        expect(compare.getAttribute('data-state')).toBe('MATCH');
        expect(compare.textContent?.trim()).toBe('與 PTT 方向一致（皆上升）');
      });

      it('一方持平、一方有升降時顯示方向不同、僅供參考', async () => {
        googleTrendsApi.getLatest.mockReturnValueOnce(of<GoogleTrendSignal | null>(okSignal('STABLE')));
        const { root } = await render(false);
        const compare = root.querySelector('.google-ptt-compare')!;
        expect(compare.getAttribute('data-state')).toBe('DIFFERENT');
        expect(compare.textContent).toContain('與 PTT 方向不同（Google 持平、PTT 上升），僅供參考');
      });

      it('兩者資料時間相差超過 7 天時註明天數', async () => {
        googleTrendsApi.getLatest.mockReturnValueOnce(of<GoogleTrendSignal | null>(okSignal('UP', '2026-10-10T02:00:00')));
        const { root } = await render(false);
        expect(root.querySelector('.google-ptt-compare')!.textContent).toContain('兩者資料時間相差 15 天');
      });

      it('剛好 7 天不加註', async () => {
        googleTrendsApi.getLatest.mockReturnValueOnce(of<GoogleTrendSignal | null>(okSignal('UP', '2026-10-02T02:00:00')));
        const { root } = await render(false);
        expect(root.querySelector('.google-ptt-compare')!.textContent).not.toContain('相差');
      });

      it('PTT 尚無熱度資料時說明無法比對', async () => {
        api.getLatestTrend.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
        googleTrendsApi.getLatest.mockReturnValueOnce(of<GoogleTrendSignal | null>(okSignal('UP')));
        const { root } = await render(false);
        const compare = root.querySelector('.google-ptt-compare')!;
        expect(compare.getAttribute('data-state')).toBe('UNAVAILABLE');
        expect(compare.textContent).toContain('PTT 尚無熱度資料，無法比對');
      });

      it('PTT 為舊版模擬資料時不比對', async () => {
        api.getLatestTrend.mockReturnValueOnce(
          of({ source: 'SIMULATED', keyword: '中秋烤肉', trendScore: 51, popularityScore: 49, trendDirection: 'UP' as const, collectedAt: '2026-09-25T02:00:00' }),
        );
        googleTrendsApi.getLatest.mockReturnValueOnce(of<GoogleTrendSignal | null>(okSignal('UP')));
        const { root } = await render(false);
        expect(root.querySelector('.google-ptt-compare')!.textContent).toContain('PTT 為舊版模擬資料，無法比對');
      });

      it('Google 尚未查詢時不顯示比對', async () => {
        const { root } = await render(false);
        expect(root.querySelector('.google-ptt-compare')).toBeNull();
      });
    });

    it('尚未查詢時顯示後端的批次涵蓋說明，不再一律承諾每週自動查詢', async () => {
      googleTrendsApi.getCoverage.mockReturnValueOnce(
        of<GoogleTrendCoverage>({
          willBeQueried: false,
          reason: 'PTT_ZERO',
          message: '非待審商品，且 PTT 熱度為 0，每週批次不會查詢。',
        }),
      );
      const { root } = await render(true);
      const hint = root.querySelector('.google-trend [data-coverage]')!;
      expect(hint.getAttribute('data-coverage')).toBe('PTT_ZERO');
      expect(hint.textContent).toContain('PTT 熱度為 0，每週批次不會查詢');
      expect(hint.textContent).toContain('可以按下方按鈕單獨查詢');
      expect(hint.textContent).not.toContain('每週一會自動查詢');
    });

    it('已有查詢結果時不查批次涵蓋說明', async () => {
      googleTrendsApi.getCoverage.mockClear();
      googleTrendsApi.getLatest.mockReturnValueOnce(
        of<GoogleTrendSignal | null>({
          productId: 101, keyword: '中秋烤肉', status: 'OK', direction: 'UP', growthRate: 20,
          recentAvg: 30, baselineAvg: 25, pointCount: 92, collectedAt: '2026-09-28T04:00:00',
        }),
      );
      await render(false);
      expect(googleTrendsApi.getCoverage).not.toHaveBeenCalled();
    });

    it('批次涵蓋說明讀取失敗時退回通用說明（待審優先）', async () => {
      googleTrendsApi.getCoverage.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { root } = await render(false);
      expect(root.querySelector('.google-trend')!.textContent).toContain('尚未查詢。每週一 04:00 會自動查詢，待審商品優先');
    });

    it('讀取失敗只讓這一區顯示尚未查詢，不影響整頁', async () => {
      googleTrendsApi.getLatest.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { root } = await render(false);
      expect(root.textContent).toContain('總分');
      expect(root.querySelector('.google-trend')!.textContent).toContain('尚未查詢');
      expect(root.querySelector('.google-trend > header > strong')!.textContent?.trim()).toBe('—');
    });

    it('管理層按「查詢 Google 趨勢」會先確認會用掉額度，確認後顯示新結果', async () => {
      const { root, instance, fixture: f } = await render(true);
      const confirm = vi.spyOn(TestBed.inject(DialogService), 'confirm').mockReturnValue(of(true));
      const button = Array.from(root.querySelectorAll('.google-trend button')).find((b) =>
        b.textContent?.includes('查詢 Google 趨勢'),
      ) as HTMLButtonElement;

      button.click();
      f.detectChanges();

      expect(confirm.mock.calls[0][1].join('')).toContain('SerpApi 額度');
      expect(googleTrendsApi.sync).toHaveBeenCalledOnce();
      expect(instance.googleTrend()?.direction).toBe('UP');
      expect(root.querySelector('.google-trend')!.textContent).toContain('近 7 天比前 4 週 +23.5%');
    });

    it('查詢失敗（例如額度用完）只在這一區顯示後端訊息', async () => {
      googleTrendsApi.sync.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409, error: { message: '本月 Google 趨勢查詢次數已達上限（200 次）' } })),
      );
      const { root, instance, fixture: f } = await render(true);
      vi.spyOn(TestBed.inject(DialogService), 'confirm').mockReturnValue(of(true));

      instance.syncGoogleTrend();
      f.detectChanges();

      expect(root.querySelector('.google-trend [role="alert"]')?.textContent).toContain('已達上限');
    });
  });
});
