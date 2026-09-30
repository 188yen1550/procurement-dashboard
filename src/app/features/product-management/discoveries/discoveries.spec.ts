/**
 * 檔案用途：AI 商品雷達清單——載入、分頁籤、排序、建立商品連結、適配評分／溫層／Google 趨勢顯示、
 * 略過（必選原因）／移回與錯誤狀態。
 * DiscoveryApiService 整個 mock 掉，不依賴後端與全域 useMockData。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { DiscoveredItem, DiscoveryApiService, DiscoveryDismissReason } from '../../discovery/api/discovery-api.service';
import { Discoveries } from './discoveries';

function item(overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
  return {
    id: 7,
    displayName: '義美小泡芙',
    searchKeyword: '義美小泡芙',
    categoryHint: '食品/零食',
    productTypeId: 2,
    status: 'NEW',
    mentionCount: 3,
    pushVolume: 42,
    popularityScore: 71.5,
    trendScore: 62,
    trendDirection: 'UP',
    windowVolume: 180,
    buzzCheckedAt: '2026-09-29T01:40:00',
    fitScore: 82,
    fitReason: '小家庭常備零食，單價低、適合湊團',
    fitConcerns: ['同類競品多', '保存期限需確認'],
    fitEvaluatedAt: '2026-09-29T01:45:00',
    temperatureZone: 'NORMAL',
    temperatureGate: 'PASSED',
    googleStatus: 'OK',
    googleDirection: 'UP',
    googleGrowthRate: 35.4,
    googleCheckedAt: '2026-09-29T01:50:00',
    firstSeenAt: '2026-09-27T01:35:00',
    lastSeenAt: '2026-09-29T01:35:00',
    convertedProductId: null,
    dismissReasonCode: null,
    dismissReason: null,
    handledByName: null,
    handledAt: null,
    evidence: [
      {
        board: 'Lifeismoney',
        url: 'https://www.ptt.cc/bbs/Lifeismoney/M.1790000000.A.1AB.html',
        title: '[情報] 全聯 義美小泡芙 買一送一',
        pushVolume: 12,
        postedAt: '2026-09-28T10:00:00',
      },
    ],
    ...overrides,
  };
}

function page(items: DiscoveredItem[]) {
  return of({ items, totalElements: items.length, totalPages: items.length ? 1 : 0, pageNumber: 0, pageSize: 20 });
}

describe('Discoveries', () => {
  let fixture: ComponentFixture<Discoveries>;
  let component: Discoveries;

  const api = {
    list: vi.fn((_query: unknown) => page([item()])),
    dismiss: vi.fn((_id: number, _code: DiscoveryDismissReason, _reason?: string) => of(item({ status: 'DISMISSED' }))),
    restore: vi.fn((_id: number) => of(item())),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    api.list.mockImplementation(() => page([item()]));
    await TestBed.configureTestingModule({
      imports: [Discoveries],
      providers: [provideRouter([]), { provide: DiscoveryApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(Discoveries);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads pending items sorted by fit with metrics and PTT evidence links opening in a new tab', () => {
    expect(api.list).toHaveBeenCalledWith({ status: 'NEW', sort: 'FIT', page: 0, size: 20 });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('義美小泡芙');
    expect(text).toContain('近 7 天提及');
    expect(text).toContain('71.5');
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.evidence a');
    expect(link.getAttribute('href')).toBe('https://www.ptt.cc/bbs/Lifeismoney/M.1790000000.A.1AB.html');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('links 建立商品 to the product form with discoveryId, name and productTypeId', () => {
    const create: HTMLAnchorElement = fixture.nativeElement.querySelector('.actions a.btn-primary');
    const href = create.getAttribute('href') ?? '';
    expect(href).toContain('/products/new');
    expect(href).toContain('discoveryId=7');
    expect(href).toContain('productTypeId=2');
    expect(decodeURIComponent(href)).toContain('name=義美小泡芙');
    // 2026-09-30：AI 抽出的搜尋關鍵字一併帶去新增表單
    expect(decodeURIComponent(href)).toContain('keyword=義美小泡芙');
  });

  it('omits productTypeId when the category could not be matched', () => {
    expect(component.createQueryParams(item({ productTypeId: null }))).toEqual({
      discoveryId: 7,
      name: '義美小泡芙',
      keyword: '義美小泡芙',
    });
  });

  it('omits keyword when the discovery has no search keyword', () => {
    expect(component.createQueryParams(item({ searchKeyword: '' }))).not.toHaveProperty('keyword');
  });

  it('shows the AI fit score with its reason and concerns, and Google trend growth', () => {
    const card: HTMLElement = fixture.nativeElement.querySelector('.discovery-card');
    expect(card.querySelector('.fit strong')?.textContent).toContain('82');
    expect(card.textContent).toContain('小家庭常備零食');
    const concerns = Array.from(card.querySelectorAll('.concerns li')).map((li) => li.textContent?.trim());
    expect(concerns).toEqual(['同類競品多', '保存期限需確認']);
    expect(card.textContent).toContain('上升 +35%');
  });

  it('shows 未查 instead of zero scores when buzz, fit and Google were not checked', () => {
    api.list.mockImplementation(() =>
      page([
        item({
          popularityScore: null,
          trendDirection: null,
          fitScore: null,
          fitReason: null,
          fitConcerns: [],
          googleStatus: null,
          googleDirection: null,
          googleGrowthRate: null,
        }),
      ]),
    );
    component.load();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('未評適配度');
    expect(text).not.toContain('AI 評估');
    expect(component.googleText(component.items()[0])).toBe('未查');
    expect(fixture.nativeElement.querySelectorAll('dd.unchecked')).toHaveLength(2);
  });

  it('distinguishes Google 查無資料 from 未查', () => {
    expect(component.googleText(item({ googleStatus: 'NO_DATA', googleDirection: null, googleGrowthRate: null }))).toBe('查無資料');
    expect(component.googleText(item({ googleDirection: 'DOWN', googleGrowthRate: -12.6 }))).toBe('下滑 -13%');
  });

  it('falls back to the free-text reason for dismissals recorded before reason codes existed', () => {
    expect(component.dismissedReasonText(item({ dismissReasonCode: null, dismissReason: '重複' }))).toBe('重複');
    expect(component.dismissedReasonText(item({ dismissReasonCode: 'NOT_A_PRODUCT', dismissReason: null }))).toBe('不是實體商品');
    expect(component.dismissedReasonText(item({ dismissReasonCode: null, dismissReason: null }))).toBe('');
  });

  it('keeps an unsupported temperature zone distinct from an undetermined one', () => {
    expect(component.temperatureBadge(item())).toEqual(expect.objectContaining({ text: '常溫', tone: 'ok' }));
    expect(component.temperatureBadge(item({ temperatureZone: 'FROZEN', temperatureGate: 'FAILED' }))).toEqual(
      expect.objectContaining({ text: '冷凍・通路不支援', tone: 'error' }),
    );
    expect(component.temperatureBadge(item({ temperatureZone: null, temperatureGate: 'INSUFFICIENT_DATA' }))).toEqual(
      expect.objectContaining({ text: '溫層未判定', tone: 'warn' }),
    );
    // 第二階段之前的資料沒有判定過，不顯示徽章（不能當成通過或不通過）
    expect(component.temperatureBadge(item({ temperatureZone: null, temperatureGate: null }))).toBeNull();
  });

  it('reloads from the first page when the sort changes', () => {
    component.pageNumber.set(2);
    component.selectSort('BUZZ');
    expect(api.list).toHaveBeenLastCalledWith({ status: 'NEW', sort: 'BUZZ', page: 0, size: 20 });
    api.list.mockClear();
    component.selectSort('BUZZ');
    component.selectSort('NOT_A_SORT');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('requires a reason before dismissing and sends the code with the note', () => {
    component.startDismiss(component.items()[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dismiss-form')).toBeTruthy();
    expect(component.canSubmitDismiss()).toBe(false);

    component.selectDismissCode('NOT_FOR_GROUP_BUY');
    component.updateDismissNote('  單價太高  ');
    expect(component.canSubmitDismiss()).toBe(true);
    component.submitDismiss(component.items()[0]);
    fixture.detectChanges();

    expect(api.dismiss).toHaveBeenCalledWith(7, 'NOT_FOR_GROUP_BUY', '  單價太高  ');
    expect(component.items()).toHaveLength(0);
    expect(component.totalElements()).toBe(0);
    expect(component.dismissingId()).toBeNull();
  });

  it('requires a note when the reason is 其他', () => {
    component.startDismiss(component.items()[0]);
    component.selectDismissCode('OTHER');
    expect(component.canSubmitDismiss()).toBe(false);
    component.submitDismiss(component.items()[0]);
    expect(api.dismiss).not.toHaveBeenCalled();
    component.updateDismissNote('供應商已停產');
    expect(component.canSubmitDismiss()).toBe(true);
  });

  it('does not dismiss when the form is cancelled', () => {
    component.startDismiss(component.items()[0]);
    component.selectDismissCode('NOT_A_PRODUCT');
    component.cancelDismiss();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dismiss-form')).toBeNull();
    component.submitDismiss(component.items()[0]);
    expect(api.dismiss).not.toHaveBeenCalled();
  });

  it('switches tabs, shows the dismiss reason label and restores dismissed items', () => {
    api.list.mockImplementation(() =>
      page([
        item({
          status: 'DISMISSED',
          handledByName: '陳小姐',
          handledAt: '2026-09-29T09:00:00',
          dismissReasonCode: 'OUT_OF_SCOPE',
          dismissReason: '3C 不做',
        }),
      ]),
    );
    component.selectTab('DISMISSED');
    fixture.detectChanges();
    expect(api.list).toHaveBeenLastCalledWith({ status: 'DISMISSED', sort: 'FIT', page: 0, size: 20 });
    expect(fixture.nativeElement.textContent).toContain('陳小姐');
    expect(fixture.nativeElement.textContent).toContain('略過：超出經營品類（3C 不做）');

    component.restore(component.items()[0]);
    expect(api.restore).toHaveBeenCalledWith(7);
    expect(component.items()).toHaveLength(0);
  });

  it('shows an empty state explaining the daily schedule', () => {
    api.list.mockImplementation(() => page([]));
    component.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('每天 01:30');
  });

  it('shows the API error with a retry action', () => {
    api.list.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 500, error: { message: '伺服器錯誤' } })));
    component.load();
    fixture.detectChanges();
    expect(component.pageState()).toBe('error');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });
});
