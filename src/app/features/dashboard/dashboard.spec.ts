/**
 * 檔案用途：驗證 Dashboard Mock 狀態、推薦與錯誤畫面；assertion 不涉及真實 API。
 *
 * 正式執行設定目前使用真實 API，但這組測試專門驗證 Mock 畫面；因此會在
 * 第一次 detectChanges（也就是 ngOnInit）之前明確切換元件模式，避免測試
 * 意外送出 HTTP 請求，也避免測試結果依賴全域 APP_CONFIG。
 * 元件仍會注入 HttpClient，樣板也使用 RouterLink，所以保留兩者的測試 provider。
 */
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth';
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

  // ⚠️ 2026-09-25 新增：跟推薦 Top 10 刻意區隔的熱度排行榜，見
  // dashboard.mapper.ts 的 TrendLeaderboardItem 類別註解。2026-09-29：5 → 10 筆（與 Top 10 同一張卡片的頁籤）。
  it('exposes ten trend leaderboard entries from mock data', () => {
    expect(component.data().trendLeaderboard).toHaveLength(10);
  });

  it('marks simulated trend data with the is-simulated class, not real PTT data', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.trend-leaderboard .score');
    // Mock 資料第 4 筆（機能防曬外套）isRealSource 為 false，其餘為 true。
    const simulatedRows = Array.from(rows).filter((el) =>
      (el as HTMLElement).classList.contains('is-simulated'),
    );
    expect(simulatedRows).toHaveLength(1);
  });

  // 2026-09-29：推薦 Top 10 與熱度排行改成同一張卡片的兩個頁籤（取代 2026-09-28 的「排行榜獨立一列」）。
  // 熱度排行放在排行卡片「裡面」，不是 .content-grid 的另一個 flex 成員（避免 09-28 那次把 Top 10 擠成 0 寬的問題）。
  it('puts Top 10 and the trend leaderboard in one tabbed card, Top 10 selected by default', () => {
    const root = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.ranking-tabs [role="tab"]'));
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['推薦 Top 10', '熱度排行']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1']);
    expect(root.querySelector('.rankings-panel .trend-leaderboard')).not.toBeNull();
    expect(root.querySelector('.content-grid > .trend-leaderboard')).toBeNull();
    expect(root.querySelector('#ranking-panel-trend')?.classList).toContain('is-inactive');
    expect(root.querySelector('#ranking-panel-recommendations')?.classList).not.toContain('is-inactive');
  });

  it('switches ranking tabs by click and by arrow keys, moving focus to the new tab', () => {
    const root = fixture.nativeElement as HTMLElement;
    const [top10Tab, trendTab] = Array.from(root.querySelectorAll<HTMLButtonElement>('.ranking-tabs [role="tab"]'));

    trendTab.click();
    fixture.detectChanges();
    expect(component.rankingTab()).toBe('trend');
    expect(trendTab.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('#ranking-panel-trend')?.classList).not.toContain('is-inactive');
    expect(root.querySelector('#ranking-panel-recommendations')?.classList).toContain('is-inactive');

    trendTab.focus();
    trendTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(component.rankingTab()).toBe('recommendations');
    expect(document.activeElement).toBe(top10Tab);

    top10Tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(component.rankingTab()).toBe('trend');
  });

  it('shows the consecutive-rise badge only for entries the backend marked', () => {
    const badges = (fixture.nativeElement as HTMLElement).querySelectorAll('.trend-leaderboard .badge-rise');
    // Mock：只有第 1 筆（磁吸快充行動電源）consecutiveRise 為 true
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('連續上升');
  });

  it('shows a Google trend column in the leaderboard, with explicit text for missing data', () => {
    fixture.detectChanges();
    const cells = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.trend-leaderboard td.lb-google'),
      (td) => td.textContent?.trim().replace(/\s+/g, ' '),
    );
    // Mock：持平 -8.6%、上升 +25.7%、下降 -18.2%、尚未查詢、查無資料，第 6～10 筆都尚未查詢
    expect(cells.slice(0, 5)).toEqual(['持平 -8.6%', '上升 +25.7%', '下降 -18.2%', '尚未查詢', '搜尋量不足']);
    expect(cells.slice(5)).toEqual(['尚未查詢', '尚未查詢', '尚未查詢', '尚未查詢', '尚未查詢']);
  });

  // 2026-09-29：熱度建議待確認移除，狀態分布只剩三種審核狀態；Mock 的合計仍刻意與總數不一致，驗證提示。
  it('shows three review states in the chart breakdown and exposes inconsistent totals', () => {
    expect(component.statusBreakdown().map((item) => item.count)).toEqual([18, 72, 14]);
    expect(component.statusTotal()).toBe(104);
    const rows = fixture.nativeElement.querySelectorAll('.status-breakdown li');
    expect(rows).toHaveLength(3);
    expect(fixture.nativeElement.textContent).not.toContain('熱度建議');
    expect(fixture.nativeElement.querySelector('.status-note').textContent).toContain('128');
  });

  // 2026-09-27：統計卡帶上審核狀態，品項管理依卡片語意預先篩選（候選商品總數＝全部）。
  it('links the four product cards to management with the matching review filter', () => {
    const links = fixture.nativeElement.querySelectorAll('.stat-card-link');
    expect(Array.from(links, (link) => (link as HTMLAnchorElement).getAttribute('href'))).toEqual([
      '/products?reviewStatus=ALL',
      '/products?reviewStatus=PENDING',
      '/products?reviewStatus=APPROVED',
      '/products?reviewStatus=REJECTED',
    ]);
  });

  // 2026-09-23 分支整併：轉換率依後端 scope 切換文案，並顯示分子／分母原始筆數。
  it('shows conversion sample size and company scope wording', () => {
    const text = fixture.nativeElement.querySelector('.conversion-panel').textContent;
    expect(text).toContain('送審過的 122 件商品中，78 件審核通過');
    expect(text).toContain('全公司口徑');
    expect(text).not.toContain('我的選品轉換率');
  });

  it('uses personal wording when scope is PERSONAL', () => {
    // 個人口徑只會來自真實 API：另建一個真實模式的元件。data 是 computed，
    // 第一次讀取時就決定了模式與相依，所以要在第一次 detectChanges 前切模式；
    // ngOnInit 發出的 API 請求在測試環境不會同步回來，這裡直接覆寫成
    // 「已載入完成」的狀態再重新渲染。
    const mock = component.data();
    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    (component as unknown as { useMockData: boolean }).useMockData = false;
    fixture.detectChanges();
    component.realData.set({
      ...mock,
      statistics: { ...mock.statistics, conversionScope: 'PERSONAL', conversionRate: null },
    });
    component.realLoadState.set('loaded');
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('.conversion-panel').textContent;
    expect(text).toContain('我的選品轉換率');
    expect(text).toContain('你建立的選品目前尚未送審過');
  });

  // 2026-09-29：操作層統計卡是個人口徑，連結帶 createdByMe=true，清單筆數才會與卡片一致。
  it('adds createdByMe to operator stat card links when statistics scope is PERSONAL', () => {
    const mock = component.data();
    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    (component as unknown as { useMockData: boolean }).useMockData = false;
    fixture.detectChanges();
    component.realData.set({ ...mock, statistics: { ...mock.statistics, statisticsScope: 'PERSONAL' } });
    component.realLoadState.set('loaded');
    fixture.detectChanges();
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.stat-card-link'),
      (link) => (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links).toEqual([
      '/products?reviewStatus=ALL&createdByMe=true',
      '/products?reviewStatus=PENDING&createdByMe=true',
      '/products?reviewStatus=APPROVED&createdByMe=true',
      '/products?reviewStatus=REJECTED&createdByMe=true',
    ]);
    expect(fixture.nativeElement.textContent).toContain('以下統計只計算你建立的商品');
  });

  it('keeps operator stat card links unfiltered when scope is COMPANY (mock)', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.stat-card-link'),
      (link) => (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links[0]).toBe('/products?reviewStatus=ALL');
  });

  it('splits risk messages into points', () => {
    expect(component.riskMessagePoints('1. 認證未確認 2. 電池安全資訊不足')).toEqual([
      '1. 認證未確認',
      '2. 電池安全資訊不足',
    ]);
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
    // 2026-09-29：Top 10 與熱度排行同在一張卡片，限定在 Top 10 的頁籤面板內計算
    const rows = fixture.nativeElement.querySelectorAll('#ranking-panel-recommendations tbody tr');
    const actions = fixture.nativeElement.querySelectorAll(
      '#ranking-panel-recommendations tbody .actions-column',
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

  it('lets the Top 10 panel take the full row for operators (no empty side column)', () => {
    expect(fixture.nativeElement.querySelector('.side-column')).toBeNull();
    expect(fixture.nativeElement.querySelector('.content-grid.operator-view .recommendations-panel')).toBeTruthy();
  });
});

/**
 * 2026-09-24 職責分離：同一份 Mock 資料，管理層統計卡改連到審核頁，待審的 Top 10 直接進審核詳情。
 */
describe('Dashboard (manager view)', () => {
  let component: Dashboard;
  let fixture: ComponentFixture<Dashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: AuthService, useValue: { isManager: () => true, isLoggedIn: () => true } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    (component as unknown as { useMockData: boolean }).useMockData = true;
    fixture.detectChanges();
    await fixture.whenStable();
  });


  // 2026-09-27：高風險提示的商品名稱可點擊，前往品項詳情（管理層進入為唯讀模式）。
  it('links each risk alert to the product detail page', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.risk-item strong a'),
      (link) => (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links).toContain('/products/1');
    expect(links).toContain('/products/2');
  });
  it('uses the same three review states and the full total as the operator view', () => {
    expect(fixture.nativeElement.textContent).not.toContain('熱度建議待確認');
    expect(component.statusBreakdown().map((item) => item.label)).toEqual(['待人工審核', '審核通過', '審核拒絕']);
    expect(component.scopeTotal()).toBe(component.data().statistics.totalProducts);
  });

  it('keeps the risk side column next to the tabbed ranking card', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.content-grid > .rankings-panel')).toBeTruthy();
    expect(root.querySelector('.content-grid > .side-column .risk-panel')).toBeTruthy();
  });

  it('links stat cards to the review page instead of product management', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.stat-card-link'),
      (link) => (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links).toEqual([
      '/review',
      '/review?tab=records&reviewStatus=APPROVED',
      '/review?tab=records&reviewStatus=REJECTED',
    ]);
    expect(fixture.nativeElement.querySelector('a[href^="/products"].stat-card-link')).toBeNull();
  });

  it('keeps the risk side column for managers', () => {
    expect(fixture.nativeElement.querySelector('.side-column .risk-panel')).toBeTruthy();
  });

  it('sends pending Top 10 items straight to the review detail', () => {
    const pending = component.recommendations().find((item) => item.reviewStatus === 'PENDING');
    if (!pending) return;
    const link = fixture.nativeElement.querySelector(`a[href="/review/${pending.id}"]`);
    expect(link?.textContent).toContain('開始審核');
  });
});

// 2026-09-30：熱度排行只列 PTT 有討論的商品（後端排除熱度 0），不足 10 名時說明原因，並顯示最近一次同步時間。
// 用真實 API 模式：HttpTestingController 讓元件自己的請求保持 pending，畫面資料由測試直接寫入 realData。
describe('Dashboard trend leaderboard (real API mode)', () => {
  let component: Dashboard;
  let fixture: ComponentFixture<Dashboard>;

  const entry = (id: number, collectedAt: string | null) => ({
    id,
    rank: id,
    name: `商品 ${id}`,
    popularityScore: 60 - id,
    trendDirection: 'STABLE' as const,
    isRealSource: true,
    keyword: `商品 ${id}`,
    googleTrend: null,
    consecutiveRise: false,
    collectedAt,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    (component as unknown as { useMockData: boolean }).useMockData = false;
    fixture.detectChanges();
  });

  function render(entries: ReturnType<typeof entry>[]): HTMLElement {
    component.realData.update((data) => ({ ...data, trendLeaderboard: entries }));
    component.realLoadState.set('loaded');
    component.rankingTab.set('trend');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the latest sync time and explains why fewer than 10 entries are listed', () => {
    const root = render([entry(1, '2026-09-30T02:00:41'), entry(2, '2026-09-30T02:03:10')]);
    const panel = root.querySelector('.trend-leaderboard')!;
    expect(component.trendLeaderboardSyncedAt()).toBe('2026-09-30T02:03:10');
    expect(panel.textContent).toContain('最近一次同步：2026/09/30 02:03');
    expect(panel.textContent).toContain('其餘商品在 PTT 近 90 天沒有討論或尚未同步熱度，未列入排行');
    expect(panel.textContent).toContain('PTT 熱度同步');
  });

  it('does not show the fewer-than-10 note when the list is full, nor a sync time when none is known', () => {
    const root = render(Array.from({ length: 10 }, (_, i) => entry(i + 1, null)));
    const panel = root.querySelector('.trend-leaderboard')!;
    expect(component.trendLeaderboardSyncedAt()).toBeNull();
    expect(panel.textContent).not.toContain('最近一次同步');
    expect(panel.textContent).not.toContain('未列入排行');
  });

  it('explains the empty state (no discussion or not yet synced)', () => {
    const root = render([]);
    expect(root.querySelector('.trend-leaderboard')!.textContent).toContain(
      '目前沒有商品在 PTT 近 90 天有討論，或尚未執行 PTT 熱度同步',
    );
  });
});
