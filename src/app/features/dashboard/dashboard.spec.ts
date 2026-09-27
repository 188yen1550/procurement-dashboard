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
  // dashboard.mapper.ts 的 TrendLeaderboardItem 類別註解。
  it('exposes five trend leaderboard entries from mock data', () => {
    expect(component.data().trendLeaderboard).toHaveLength(5);
  });

  it('marks simulated trend data with the is-simulated class, not real PTT data', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.trend-leaderboard-panel .score');
    // Mock 資料第 4 筆（機能防曬外套）isRealSource 為 false，其餘為 true。
    const simulatedRows = Array.from(rows).filter((el) =>
      (el as HTMLElement).classList.contains('is-simulated'),
    );
    expect(simulatedRows).toHaveLength(1);
  });

  it('includes AI suggestions in the chart breakdown and exposes inconsistent totals', () => {
    expect(component.statusBreakdown().map((item) => item.count)).toEqual([18, 72, 14, 5]);
    expect(component.statusTotal()).toBe(109);
    const rows = fixture.nativeElement.querySelectorAll('.status-breakdown li');
    expect(rows).toHaveLength(4);
    expect(rows[3].textContent).toContain('AI 建議待確認');
    expect(fixture.nativeElement.querySelector('.status-note').textContent).toContain('128');
  });

  // 2026-09-27：統計卡帶上審核狀態，品項管理依卡片語意預先篩選（候選商品總數＝全部）。
  it('links the four product cards to management with the matching review filter and keeps the AI suggestion destination', () => {
    const links = fixture.nativeElement.querySelectorAll('.stat-card-link');
    expect(Array.from(links, (link) => (link as HTMLAnchorElement).getAttribute('href'))).toEqual([
      '/products?reviewStatus=ALL',
      '/products?reviewStatus=PENDING',
      '/products?reviewStatus=APPROVED',
      '/products?reviewStatus=REJECTED',
      '/products/ai-suggestions',
    ]);
  });

  // 2026-09-23 分支整併：轉換率依後端 scope 切換文案，並顯示分子／分母原始筆數。
  it('shows conversion sample size and company scope wording', () => {
    const text = fixture.nativeElement.querySelector('.conversion-panel').textContent;
    expect(text).toContain('送審過的 122 件商品中，78 件審核通過');
    expect(text).toContain('全公司口徑');
    // 2026-09-24：管理層口徑剔除 AI 建議商品，文案需讓主管知道分母範圍。
    expect(text).toContain('不含尚未轉正的 AI 建議商品');
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

  it('lets the Top 10 panel take the full row for operators (no empty side column)', () => {
    expect(fixture.nativeElement.querySelector('.side-column')).toBeNull();
    expect(fixture.nativeElement.querySelector('.content-grid.operator-view .recommendations-panel')).toBeTruthy();
  });
});

/**
 * 2026-09-24 職責分離：同一份 Mock 資料，管理層畫面不呈現沒有對應頁面的資訊
 * （AI 建議待確認），統計卡改連到審核頁，待審的 Top 10 直接進審核詳情。
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
  it('hides the AI suggestion card and chart slice, and adjusts the total accordingly', () => {
    expect(fixture.nativeElement.textContent).not.toContain('AI 建議待確認');
    expect(component.statusBreakdown().map((item) => item.label)).toEqual(['待人工審核', '審核通過', '審核拒絕']);
    const stats = component.data().statistics;
    expect(component.scopeTotal()).toBe(stats.totalProducts - stats.aiSuggestedPending);
  });

  it('links stat cards to the review page instead of product management', () => {
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.stat-card-link'),
      (link) => (link as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links).toEqual(['/review', '/review?tab=records', '/review?tab=records']);
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

