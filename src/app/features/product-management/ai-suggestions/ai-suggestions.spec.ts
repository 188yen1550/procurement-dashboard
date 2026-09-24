/**
 * 檔案用途：驗證 AI 建議搜尋、Empty 與人工加入候選流程。
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
    expect(fixture.nativeElement.textContent).toContain('AI 建議清單');
    expect(fixture.nativeElement.textContent).toContain('加入 CANDIDATE 候選');
  });

  it('renders disabled loading empty and error states', () => {
    component.setState('disabled');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('加入候選操作目前已停用');
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入 AI 建議');
    component.setState('empty');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('目前沒有 AI 建議品項');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
});
