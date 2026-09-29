/**
 * 檔案用途：驗證 熱度建議搜尋、Empty 與人工加入候選流程。
 *
 * ⚠️ 這次接上真實 API 後才發現：useMockData 目前是 false（見 app-config.ts），
 * 代表 ngOnInit() 一定會呼叫 ProductApiService.listAiSuggested()。
 * 跟 product-detail.spec.ts 用同一套策略：整個 mock 掉 ProductApiService，
 * 用三筆假資料模擬跟舊測試相同的搜尋／促銷情境，不依賴全域設定值。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { toProductListItem } from '../api/product.mapper';
import { ProductResponsePayload } from '../api/product-api.contract';
import { ProductApiService } from '../api/product-api.service';
import { AiSuggestions } from './ai-suggestions';

function makeAiSuggestedPayload(
  overrides: Partial<ProductResponsePayload>,
): ProductResponsePayload {
  return {
    id: 0,
    productTypeId: null,
    pricingType: 'NEW',
    name: '',
    description: null,
    imageUrl: null,
    supplierName: null,
    costPrice: null,
    salePrice: null,
    marketPrice: null,
    campaignTags: null,
    moq: null,
    supplyStability: null,
    priceCompetitiveness: null,
    targetCustomerDescription: null,
    estimatedPurchaseRate: null,
    resaleReferenceProductId: null,
    temperatureZone: null,
    shelfLifeTier: null,
    supplierLeadTimeTier: null,
    packageSizeTier: null,
    packingType: null,
    handlingFlags: null,
    certificationFlags: null,
    supplierMaxCapacity: null,
    reviewStatus: 'PENDING',
    candidateStatus: 'AI_SUGGESTED',
    pricingStatus: 'PENDING_PRICING',
    itemStatus: 'ACTIVE',
    submissionCount: 1,
    createdBy: null,
    createdByName: null,
    finalScore: null,
    dataCompleteness: null,
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
    submittedAt: null,
    submittedBy: null,
    submittedByName: null,
    ...overrides,
  };
}

const AI_SUGGESTED_ITEMS = [
  toProductListItem(
    makeAiSuggestedPayload({ id: 201, name: '旅行用全能轉接充電器', supplierName: '沐光科技' }),
    '3C／家電',
  ),
  toProductListItem(
    makeAiSuggestedPayload({ id: 202, name: '超輕量防曬折疊傘', supplierName: '晴日生活' }),
    '生活雜貨',
  ),
  toProductListItem(
    makeAiSuggestedPayload({ id: 203, name: '親子野餐防水地墊', supplierName: '戶外樂園' }),
    '寢具家用',
  ),
];

describe('AiSuggestions', () => {
  let fixture: ComponentFixture<AiSuggestions>;
  let component: AiSuggestions;

  const api = {
    listAiSuggested: vi.fn(() =>
      of({
        items: AI_SUGGESTED_ITEMS.map((i) => ({ ...i })),
        totalElements: AI_SUGGESTED_ITEMS.length,
        totalPages: 1,
        pageNumber: 0,
        pageSize: 50,
      }),
    ),
    promoteToCandidate: vi.fn(() => of(undefined)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    api.listAiSuggested.mockReturnValue(
      of({
        items: AI_SUGGESTED_ITEMS.map((i) => ({ ...i })),
        totalElements: AI_SUGGESTED_ITEMS.length,
        totalPages: 1,
        pageNumber: 0,
        pageSize: 50,
      }),
    );
    api.promoteToCandidate.mockReturnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [AiSuggestions],
      providers: [provideRouter([]), { provide: ProductApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(AiSuggestions);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows AI_SUGGESTED items separately', () => {
    expect(component.items().length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('AI_SUGGESTED');
    expect(fixture.nativeElement.textContent).toContain('加入 CANDIDATE 候選');
  });

  it('filters suggestions locally', () => {
    component.query.set('沐光');
    expect(component.filtered().length).toBe(1);
  });

  it('promotes one item via the API', () => {
    component.promote(201);
    expect(api.promoteToCandidate).toHaveBeenCalledWith(201);
    expect(component.items().some((i) => i.id === 201)).toBe(false);
    expect(component.statusMessage()).toContain('CANDIDATE');
  });

  it('promotes selected items in a batch', () => {
    component.toggle(202);
    component.promoteSelected();
    expect(api.promoteToCandidate).toHaveBeenCalledWith(202);
    expect(component.items().some((i) => i.id === 202)).toBe(false);
  });

  it('explains that suggestions must be promoted before scoring and review', () => {
    expect(fixture.nativeElement.textContent).toContain('熱度建議清單');
    expect(fixture.nativeElement.textContent).toContain('加入 CANDIDATE 候選');
  });

  describe('推薦依據（趨勢說明，2026-09-28）', () => {
    function render(payload: Partial<ProductResponsePayload>): HTMLElement {
      api.listAiSuggested.mockReturnValue(
        of({
          items: [toProductListItem(makeAiSuggestedPayload({ id: 3, name: '蛋捲', ...payload }), '常溫食品')],
          totalElements: 1,
          totalPages: 1,
          pageNumber: 0,
          pageSize: 50,
        }),
      );
      component.load();
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('.suggestion-grid article') as HTMLElement;
    }

    it('顯示熱度分數、近 3 次方向（舊到新）、Google 趨勢與綜合分數', () => {
      const card = render({
        trendScore: 79.54,
        trendDirection: 'UP',
        trendSource: 'PTT',
        // 後端是新到舊
        recentTrendDirections: ['UP', 'UP', 'STABLE'],
        finalScore: 54.2,
        googleTrend: {
          productId: 3, keyword: '蛋捲', status: 'OK', direction: 'UP', growthRate: 25.71,
          recentAvg: 42.29, baselineAvg: 33.64, pointCount: 92, collectedAt: '2026-09-28T15:24:46',
        },
      });
      const basis = card.querySelector('.trend-basis')!.textContent!;
      expect(basis).toContain('79.54 分（PTT 討論量）');
      expect(basis).toContain('超過 70 分門檻');
      expect(Array.from(card.querySelectorAll('.direction-steps span'), (s) => s.textContent)).toEqual(['→', '↗', '↗']);
      expect(basis).not.toContain('連續 3 次上升');
      expect(basis).toContain('↗ 上升');
      expect(basis).toContain('+25.7%');
      expect(basis).toContain('54.2');
      expect(card.querySelector('a.trend-link')?.getAttribute('href')).toBe('/products/3');
    });

    it('連續 3 次上升時標出符合條件；模擬資料要講明', () => {
      const card = render({
        trendScore: 62,
        trendDirection: 'UP',
        trendSource: 'SIMULATED',
        recentTrendDirections: ['UP', 'UP', 'UP'],
        googleTrend: null,
      });
      const basis = card.querySelector('.trend-basis')!.textContent!;
      expect(basis).toContain('連續 3 次上升');
      expect(basis).toContain('模擬資料');
      expect(basis).not.toContain('超過 70 分門檻');
      expect(basis).toContain('尚未查詢');
      expect(card.querySelector('.trend')!.textContent).toContain('連續上升');
    });

    it('Google 查無資料時說搜尋量不足，而不是持平', () => {
      const card = render({
        trendScore: 75,
        trendDirection: 'STABLE',
        trendSource: 'PTT',
        recentTrendDirections: ['STABLE'],
        googleTrend: {
          productId: 3, keyword: '蛋捲', status: 'NO_DATA', direction: null, growthRate: null,
          recentAvg: null, baselineAvg: null, pointCount: 0, collectedAt: '2026-09-28T15:24:46',
        },
      });
      const googleRow = Array.from(card.querySelectorAll('.trend-basis div')).find((d) =>
        d.textContent?.includes('Google 趨勢'),
      )!;
      expect(googleRow.textContent).toContain('搜尋量不足');
      expect(googleRow.textContent).not.toContain('持平');
    });

    it('頁首有使用說明（怎麼產生、怎麼使用）', () => {
      const guide = fixture.nativeElement.querySelector('details.ai-guide') as HTMLElement;
      expect(guide.textContent).toContain('最新熱度超過 70 分');
      expect(guide.textContent).toContain('加入已選候選');
    });
  });

  it('renders disabled loading empty and error states', () => {
    component.setState('disabled');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('加入候選操作目前已停用');
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入 熱度建議');
    component.setState('empty');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('目前沒有 熱度建議品項');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
});
