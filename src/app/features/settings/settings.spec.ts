/**
 * 檔案用途：驗證固定模式、9 類商品、條件式刪除、檔期入口與帳號停用等設定規則。
 *
 * ⚠️ 這次接上真實 API 後才發現：useMockData 目前是 false（見 app-config.ts），
 * 代表每個分頁第一次切換過去都會呼叫對應的真實 API service。跟其他元件
 * 用同一套策略：整個 mock 掉 SettingsApiService／UserApiService／兩個
 * Lookup 服務，讓測試不依賴全域設定值，也不需要真的打網路。
 *
 * 「刪除使用中商品類型」這條規則在真實模式下改變了驗證方式：
 * 後端 ProductTypeResponse 沒有「使用品項數」欄位，前端無從事先判斷，
 * 一律送出 DELETE 請求，由後端的 409 擋下——測試也跟著改成驗證這個流程，
 * 而不是驗證「前端本地判斷擋下」。
 */
import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { DialogService } from '../../core/dialog/dialog.service';
import { AuthService } from '../../core/auth/auth';
import { ProductTypeLookupService } from './api/product-type-lookup.service';
import { RiskOptionLookupService } from './api/risk-option-lookup.service';
import { SettingsApiService } from './api/settings-api.service';
import { UserApiService } from '../user-management/api/user-api.service';
import { Router, provideRouter } from '@angular/router';
import { ProductApiService } from '../product-management/api/product-api.service';
import { Settings } from './settings';
import { SETTINGS_GROUP_TITLE, SettingsGroup } from './settings-groups';

const MOCK_MODES = [
  { id: 1, modeCode: 'BALANCED', modeName: '均衡模式', version: 1, description: '商業條件、客群、歷史與預測各佔四分之一。', isActive: true },
  { id: 2, modeCode: 'VOLUME', modeName: '衝量模式', version: 1, description: '優先考量客群匹配與預測人氣。', isActive: false },
  { id: 3, modeCode: 'PROFIT', modeName: '高利潤模式', version: 1, description: '提高商業條件權重，同時保留人氣預測。', isActive: false },
];

function makeWeights(modeCode: string) {
  const table: Record<string, [number, number, number, number]> = {
    BALANCED: [25, 25, 25, 25],
    VOLUME: [15, 30, 15, 40],
    PROFIT: [45, 15, 15, 25],
  };
  const [business, audience, history, forecast] = table[modeCode] ?? [25, 25, 25, 25];
  return {
    modeCode,
    modeName: modeCode,
    version: 1,
    factors: [
      { factorCode: 'BUSINESS', factorName: '商業條件', category: 'BUSINESS', weight: business },
      { factorCode: 'AUDIENCE', factorName: '客群匹配', category: 'AUDIENCE', weight: audience },
      { factorCode: 'HISTORY', factorName: '歷史銷售', category: 'HISTORY', weight: history },
      { factorCode: 'FORECAST', factorName: '預測人氣', category: 'FORECAST', weight: forecast },
    ],
  };
}

const MOCK_RISK_OPTIONS = [
  { id: 1, name: '實際供貨風險', description: null, isSystemDefault: true, alertKeywords: '缺貨、斷貨' },
  { id: 2, name: '商品品質與客訴風險', description: null, isSystemDefault: true, alertKeywords: '瑕疵、客訴' },
];

const MOCK_AUDIENCE_PROFILE = {
  id: 1,
  name: '核心家庭團購客群',
  ageMin: 28,
  ageMax: 45,
  priceSensitivity: 'MEDIUM' as const,
  preferenceDescription: '重視實用性、安全性與團購價格優勢。',
  keywords: '家庭,實用,親子,團購優惠',
};

const MOCK_PRODUCT_TYPES = [
  '食品／生鮮', '日用品', '3C／家電', '生活雜貨', '美妝保養', '服飾配件', '寢具家用', '精品禮盒', '其他',
].map((name, index) => ({
  id: index + 1,
  name,
  description: null,
  isSystemDefault: true,
  isActive: true,
}));

const MOCK_CAMPAIGNS = [
  {
    id: 1,
    campaignCode: 'MOON2026',
    campaignName: '中秋節',
    category: 'FESTIVAL' as const,
    startDate: '2026-08-15',
    endDate: '2026-09-25',
    preparationLeadDays: 30,
    campaignStatus: 'ACTIVE' as const,
    isManualOverride: false,
    tags: [{ tag: 'bbq', matchTier: 'CORE' as const }],
  },
];

const MOCK_ACCOUNTS = [
  { id: 1, username: 'manager01', name: '林經理', role: 'MANAGER' as const, enabled: true, mustChangePassword: false, createdAt: null },
  { id: 2, username: 'buyer01', name: '陳小姐', role: 'PURCHASER' as const, enabled: true, mustChangePassword: false, passwordResetRequestedAt: '2026-09-26T09:00:00', createdAt: null },
  { id: 3, username: 'buyer02', name: '王先生', role: 'PURCHASER' as const, enabled: false, mustChangePassword: false, createdAt: null },
];

describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let component: Settings;
  let dialog: DialogService;

  const settingsApi = {
    getEvaluationModes: vi.fn((): unknown => of(MOCK_MODES.map((m) => ({ ...m })))),
    getEvaluationModeFactors: vi.fn((id: number): unknown =>
      of(makeWeights(MOCK_MODES.find((m) => m.id === id)?.modeCode ?? 'BALANCED')),
    ),
    getCurrentEvaluationMode: vi.fn(() => of({ ...MOCK_MODES[0] })),
    switchEvaluationMode: vi.fn((id: number) =>
      of({ ...MOCK_MODES.find((m) => m.id === id)! }),
    ),
    disableRiskOption: vi.fn(() => of({})),
    enableRiskOption: vi.fn(() => of({})),
    getRiskOptions: vi.fn(() => of(MOCK_RISK_OPTIONS.map((r) => ({ ...r })))),
    createRiskOption: vi.fn((body: { name: string; alertKeywords?: string | null }) =>
      of({ id: 99, name: body.name, description: null, isSystemDefault: false, alertKeywords: body.alertKeywords ?? null }),
    ),
    updateRiskOption: vi.fn((id: number, body: { name: string; alertKeywords?: string | null }) =>
      of({ id, name: body.name, description: null, isSystemDefault: false, alertKeywords: body.alertKeywords ?? null }),
    ),
    getAudienceProfile: vi.fn(() => of({ ...MOCK_AUDIENCE_PROFILE })),
    updateAudienceProfile: vi.fn((body: unknown) => of({ ...MOCK_AUDIENCE_PROFILE, ...(body as object) })),
    getProductTypes: vi.fn((): unknown => of(MOCK_PRODUCT_TYPES.map((p) => ({ ...p })))),
    createProductType: vi.fn((body: { name: string }) =>
      of({ id: 100, name: body.name, description: null, isSystemDefault: false, isActive: true }),
    ),
    disableProductType: vi.fn((id: number) =>
      of({ ...MOCK_PRODUCT_TYPES.find((p) => p.id === id)!, isActive: false }),
    ),
    restoreProductType: vi.fn((id: number) =>
      of({ ...MOCK_PRODUCT_TYPES.find((p) => p.id === id)!, isActive: true }),
    ),
    deleteProductType: vi.fn(() => of(undefined)),
    getFestiveCampaigns: vi.fn(() => of(MOCK_CAMPAIGNS.map((c) => ({ ...c })))),
    updateFestiveCampaign: vi.fn((id: number, body: unknown) =>
      of({ ...MOCK_CAMPAIGNS.find((c) => c.id === id)!, ...(body as object) }),
    ),
    switchFestiveCampaignStatus: vi.fn((id: number, body: { status: string }) =>
      of({ ...MOCK_CAMPAIGNS.find((c) => c.id === id)!, campaignStatus: body.status, isManualOverride: true }),
    ),
    // 2026-09-24：天氣三組 API 的 mock 隨功能移到 tabs/weather-linkage/weather-linkage.spec.ts。
    // 以下四支原本缺漏：評估模式分頁載入時會呼叫 getFactorDefinitions()，缺了就在
    // subscribe 時丟 TypeError，連帶讓同一個測試檔其他案例出現非預期錯誤。
    // 「天氣連動」分頁的子元件首次渲染會載入這兩支；詳細行為在子元件自己的 spec 驗證。
    getWeatherSignalTagMappings: vi.fn(() => of([])),
    getRegionWeights: vi.fn(() => of([])),
    // 2026-09-24：天氣連動分頁載入「目前的天氣檔期」
    // V26：「天氣連動」子元件載入天氣資料狀態與加成設定。
    getWeatherStatus: vi.fn(() =>
      of({ historyDays: 30, forecastDays: 14, coldStartThresholdDays: 27, lastFetchedAt: null, regions: [] }),
    ),
    getWeatherBoostSettings: vi.fn(() =>
      of({ historyWeightPercentage: 60, forecastWeightPercentage: 40, boostCap: 5, historyDays: 30, forecastDays: 14, updatedAt: null }),
    ),
    getFactorDefinitions: vi.fn((): unknown => of([])),
    updateEvaluationModeFactors: vi.fn((_id: number, _body: unknown): unknown => of(null)),
    getCustomFieldDefinitions: vi.fn(() => of([])),
    getProductTypeScoreBands: vi.fn((): unknown => of([])),
    getSystemSettings: vi.fn(() =>
      of([
        {
          key: 'shrinkage_k_category',
          category: '貝氏收縮',
          displayName: '品類層平滑常數 k',
          description: '控制品類自己的成團率要收斂到全體平均多快。',
          dataType: 'INTEGER',
          minValue: '1',
          maxValue: '100',
          unit: '次',
          value: '10',
          hasStoredValue: true,
          updatedAt: null,
          updatedByName: null,
        },
        {
          key: 'supported_temperature_zones',
          category: '溫層判定',
          displayName: '通路支援溫層',
          description: '',
          dataType: 'STRING',
          minValue: null,
          maxValue: null,
          unit: null,
          value: 'NORMAL,CHILLED,FROZEN',
          hasStoredValue: false,
          updatedAt: null,
          updatedByName: null,
        },
      ]),
    ),
  };

  const userApi = {
    list: vi.fn(() => of(MOCK_ACCOUNTS.map((a) => ({ ...a })))),
    create: vi.fn((body: { username: string; name: string; role: 'PURCHASER' | 'MANAGER' }) =>
      of({
        id: 4,
        username: body.username,
        name: body.name,
        role: body.role,
        enabled: true,
        mustChangePassword: true,
        createdAt: null,
      }),
    ),
    disable: vi.fn((id: number) =>
      of({ ...MOCK_ACCOUNTS.find((a) => a.id === id)!, enabled: false }),
    ),
    restore: vi.fn((id: number) =>
      of({ ...MOCK_ACCOUNTS.find((a) => a.id === id)!, enabled: true }),
    ),
    resetPassword: vi.fn((id: number, _body: { newPassword: string }) =>
      of({ ...MOCK_ACCOUNTS.find((a) => a.id === id)!, mustChangePassword: true, passwordResetRequestedAt: null }),
    ),
    rejectPasswordResetRequest: vi.fn((id: number) =>
      of({ ...MOCK_ACCOUNTS.find((a) => a.id === id)!, passwordResetRequestedAt: null }),
    ),
  };

  // 2026-09-29：熱度規則選品面板移除，設定頁已不呼叫 ProductApiService 的批次端點；保留空物件給 DI 使用。
  const productApi = {};
  const productTypeLookup = { invalidate: vi.fn(), getNameMap: vi.fn(), getName: vi.fn() };
  const riskOptionLookup = { invalidate: vi.fn(), getNameMap: vi.fn(), getNames: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    // 每個 mock 在 clearAllMocks 後要重新指定實作，否則下一個測試會拿到 undefined。
    settingsApi.getEvaluationModes.mockReturnValue(of(MOCK_MODES.map((m) => ({ ...m }))));
    settingsApi.getEvaluationModeFactors.mockImplementation((id: number) =>
      of(makeWeights(MOCK_MODES.find((m) => m.id === id)?.modeCode ?? 'BALANCED')),
    );
    settingsApi.getCurrentEvaluationMode.mockReturnValue(of({ ...MOCK_MODES[0] }));
    settingsApi.switchEvaluationMode.mockImplementation((id: number) =>
      of({ ...MOCK_MODES.find((m) => m.id === id)! }),
    );
    settingsApi.getRiskOptions.mockReturnValue(of(MOCK_RISK_OPTIONS.map((r) => ({ ...r }))));
    settingsApi.getAudienceProfile.mockReturnValue(of({ ...MOCK_AUDIENCE_PROFILE }));
    settingsApi.getProductTypes.mockReturnValue(of(MOCK_PRODUCT_TYPES.map((p) => ({ ...p }))));
    settingsApi.deleteProductType.mockReturnValue(of(undefined));
    settingsApi.getFestiveCampaigns.mockReturnValue(of(MOCK_CAMPAIGNS.map((c) => ({ ...c }))));
    settingsApi.getFactorDefinitions.mockReturnValue(of([]));
    settingsApi.getProductTypeScoreBands.mockReturnValue(of([]));
    userApi.list.mockReturnValue(of(MOCK_ACCOUNTS.map((a) => ({ ...a }))));
    // 目標區間分頁載入時會查品類名稱對照（?tab= 同步測試會切到這個分頁）。
    productTypeLookup.getNameMap.mockReturnValue(of(new Map()));

    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        { provide: SettingsApiService, useValue: settingsApi },
        { provide: UserApiService, useValue: userApi },
        { provide: ProductTypeLookupService, useValue: productTypeLookup },
        { provide: RiskOptionLookupService, useValue: riskOptionLookup },
        // 分頁同步到網址 ?tab= 需要路由；排程作業面板（排程與同步分頁）會注入 ProductApiService。
        provideRouter([]),
        { provide: ProductApiService, useValue: productApi },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    dialog = TestBed.inject(DialogService);
    fixture.detectChanges();
  });

  it('creates the complete management settings page', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('評估模式');
    expect(fixture.nativeElement.textContent).toContain('帳號管理');
    // 核心客群目前鎖住（component.audienceSettingsVisible = false），
    // 分頁按鈕跟內容都不應該渲染出來，不是「顯示但disabled」。
    expect(fixture.nativeElement.textContent).not.toContain('核心客群設定');
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.settings__tabs button')).some(
        (button: unknown) => (button as HTMLButtonElement).textContent?.includes('核心客群'),
      ),
    ).toBe(false);
  });

  it('計分與判定參數不列出只在目標區間 HISTORICAL 模式生效的三個參數（2026-09-30）', () => {
    const base = component.systemSettings()[0];
    component.systemSettings.set([
      { ...base, key: 'shrinkage_k_category', category: '貝氏收縮' },
      { ...base, key: 'score_band_min_sample_size', category: '目標區間' },
      { ...base, key: 'score_band_percentile_lower', category: '目標區間' },
      { ...base, key: 'score_band_percentile_upper', category: '目標區間' },
    ]);
    const groups = component.systemSettingsByCategory();
    expect(groups.map((g) => g.category)).toEqual(['貝氏收縮']);
    expect(groups.flatMap((g) => g.items.map((i) => i.key))).toEqual(['shrinkage_k_category']);
  });

  it('prevents normal navigation from entering the hidden audience tab', () => {
    component.setTab('audience');
    expect(component.activeTab()).toBe('modes');
    // 設定頁的錯誤改用 dialog 呈現（showAlert → DialogService.notify），不再走頁首 toast。
    expect(dialog.state()?.messages[0]).toContain('暫不開放');
    // 被攔下時不該連帶觸發真實模式的分頁載入（不打 GET /audience-profile）。
    expect(settingsApi.getAudienceProfile).not.toHaveBeenCalled();
  });

  it('validates audience age range', () => {
    component.form.patchValue({ ageMin: 50, ageMax: 30 });
    component.saveAudience();
    expect(component.saved()).toBe(false);
    expect(component.ageRangeInvalid()).toBe(true);
    expect(dialog.state()?.messages[0]).toContain('請修正客群設定欄位');
  });
  it('keeps the hidden audience settings logic connected to the API', () => {
    component.saveAudience();
    expect(settingsApi.updateAudienceProfile).toHaveBeenCalled();
    expect(component.saved()).toBe(true);
    expect(component.statusMessage()).toContain('核心客群已儲存');
  });

  it('disables controls with an explanation', () => {
    component.setState('disabled');
    expect(component.form.disabled).toBe(true);
    expect(component.statusMessage()).toContain('disabled');
  });

  it('shows risk, product type, campaign and account settings', () => {
    for (const tab of ['risks', 'productTypes', 'campaigns', 'accounts'] as const) {
      component.setTab(tab);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.data-table')).toBeTruthy();
    }
  });

  it('contains all nine default product types', () => {
    component.setTab('productTypes');
    expect(component.productTypes().filter((item) => item.system).length).toBe(9);
  });

  it('keeps a disabled risk visible and allows enabling it again', () => {
    vi.spyOn(dialog, 'confirm').mockReturnValue(of(true));
    component.setTab('risks');
    const item = component.riskOptions()[0];
    component.toggleRiskOptionActive(item);
    fixture.detectChanges();
    expect(settingsApi.disableRiskOption).toHaveBeenCalledWith(item.id);
    expect(component.riskOptions()).toHaveLength(MOCK_RISK_OPTIONS.length);
    expect(component.riskOptions()[0].active).toBe(false);
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('重新啟用'))!;
    expect(button).toBeTruthy();
    button.click();
    fixture.detectChanges();
    expect(settingsApi.enableRiskOption).toHaveBeenCalledWith(item.id);
    expect(component.riskOptions()[0].active).toBe(true);
    expect(riskOptionLookup.invalidate).toHaveBeenCalled();
  });

  it('loads disabled risks and preserves state when enabling fails', () => {
    settingsApi.getRiskOptions.mockReturnValue(of(MOCK_RISK_OPTIONS.map((r) => ({ ...r, isActive: false }))));
    settingsApi.enableRiskOption.mockReturnValueOnce(throwError(() => new Error('啟用失敗')));
    component.setTab('risks');
    component.toggleRiskOptionActive(component.riskOptions()[0]);
    fixture.detectChanges();
    expect(component.riskOptions()[0].active).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('已停用');
    expect(fixture.nativeElement.textContent).toContain('重新啟用');
  });

  it('leaves a risk enabled when disabling is cancelled or fails', () => {
    const confirm = vi.spyOn(dialog, 'confirm').mockReturnValue(of(false));
    component.setTab('risks');
    component.toggleRiskOptionActive(component.riskOptions()[0]);
    expect(settingsApi.disableRiskOption).not.toHaveBeenCalled();
    confirm.mockReturnValue(of(true));
    settingsApi.disableRiskOption.mockReturnValueOnce(throwError(() => new Error('停用失敗')));
    component.toggleRiskOptionActive(component.riskOptions()[0]);
    expect(component.riskOptions()[0].active).toBe(true);
    expect(component.riskOptions()).toHaveLength(MOCK_RISK_OPTIONS.length);
  });

  it('creates a risk option through modal state', () => {
    component.openModal('risk');
    component.draftName.set('測試風險');
    component.draftKeywordChips.set(['測試關鍵字']);
    component.saveModal();
    expect(settingsApi.createRiskOption).toHaveBeenCalledWith({
      name: '測試風險',
      alertKeywords: '測試關鍵字',
    });
    expect(component.riskOptions().some((item) => item.name === '測試風險')).toBe(true);
  });

  it('edits an existing risk option and calls update instead of create', () => {
    component.setTab('risks');
    const existing = component.riskOptions()[0];
    component.openRiskEditModal(existing);
    expect(component.draftName()).toBe(existing.name);
    component.draftName.set('改過的名稱');
    component.draftKeywordChips.set([...component.draftKeywordChips(), '新關鍵字']);
    component.saveModal();
    expect(settingsApi.updateRiskOption).toHaveBeenCalled();
    expect(settingsApi.createRiskOption).not.toHaveBeenCalled();
  });

  it('lets the backend 409 decide whether a product type is in use', () => {
    component.setTab('productTypes');
    settingsApi.deleteProductType.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { success: false, message: '此類型已被商品使用', data: null },
          }),
      ),
    );

    // ⚠️ 後端 ProductTypeResponse 沒有「使用品項數」欄位，前端無從事先判斷，
    // 一律送出刪除請求，由後端的 409 擋下——這是真實模式下唯一的判斷依據。
    //
    // 刪除是不可復原操作，現在會先跳確認框，這裡先驗證確認框正確覆誦了
    // 要刪除的品類名稱，且此時 API 還沒被呼叫，接著模擬使用者確認。
    component.removeProductType('食品／生鮮');
    const confirmState = dialog.state();
    expect(confirmState?.variant).toBe('confirm');
    expect(confirmState?.messages[0]).toContain('食品／生鮮');
    expect(settingsApi.deleteProductType).not.toHaveBeenCalled();

    dialog.handleConfirm();

    expect(settingsApi.deleteProductType).toHaveBeenCalled();
    expect(component.productTypes().some((item) => item.name === '食品／生鮮')).toBe(true);
    // 真實模式直接顯示後端 409 的訊息（toApiError），不另外改寫文案。
    expect(dialog.state()?.variant).toBe('error');
    expect(dialog.state()?.messages[0]).toContain('此類型已被商品使用');
  });

  it('disables accounts via the API and retains their records', () => {
    component.setTab('accounts');
    component.disableAccount('buyer01');
    expect(userApi.disable).toHaveBeenCalledWith(2);
    expect(component.accounts().find((item) => item.username === 'buyer01')?.active).toBe(false);
    expect(component.accounts().length).toBe(3);
  });

  it('shares the same button to toggle an account between disable and restore', () => {
    component.setTab('accounts');
    fixture.detectChanges();
    // 停用：2026-09-23起先跳確認對話框，取消時不呼叫 API。
    const confirm = vi.spyOn(dialog, 'confirm').mockReturnValue(of(false));
    component.toggleAccountActive('buyer01');
    expect(confirm).toHaveBeenCalled();
    expect(userApi.disable).not.toHaveBeenCalled();

    // 確認後才呼叫 disable，文字/顏色切換成「復用帳號」。
    confirm.mockReturnValue(of(true));
    component.toggleAccountActive('buyer01');
    expect(userApi.disable).toHaveBeenCalledWith(2);
    expect(component.accounts().find((item) => item.username === 'buyer01')?.active).toBe(false);
    fixture.detectChanges();
    const toggleButton = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>,
    ).find((el) => (el as HTMLElement).textContent?.includes('buyer01'))?.querySelector('button') as HTMLButtonElement;
    expect(toggleButton?.textContent).toContain('復用帳號');
    expect(toggleButton?.classList.contains('btn--restore')).toBe(true);

    // 復用：同一個方法，狀態反過來時改呼叫 restore；復用不需要確認。
    confirm.mockClear();
    component.toggleAccountActive('buyer01');
    expect(confirm).not.toHaveBeenCalled();
    expect(userApi.restore).toHaveBeenCalledWith(2);
    expect(component.accounts().find((item) => item.username === 'buyer01')?.active).toBe(true);
  });

  it('does not allow disabling the signed-in account', () => {
    // 必須在帳號分頁第一次渲染「之前」決定登入者：currentUser 被換成一般
    // 函式（不是 signal），事後才換不會讓已渲染的畫面標記為需要更新。
    // id 2 / buyer01 對應上方 userApi.list() 的測試資料。
    vi.spyOn(TestBed.inject(AuthService), 'currentUser').mockReturnValue({
      id: 2,
      username: 'buyer01',
      name: '陳小姐',
      role: 'PURCHASER',
      mustChangePassword: false,
    });
    const confirm = vi.spyOn(dialog, 'confirm');
    component.setTab('accounts');
    fixture.detectChanges();
    const buyer = component.accounts().find((item) => item.username === 'buyer01')!;
    expect(component.isSelfAccount(buyer)).toBe(true);
    const row = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>,
    ).find((el) => el.textContent?.includes('buyer01'))!;
    expect((row.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('（本人）');
    component.toggleAccountActive('buyer01');
    expect(confirm).not.toHaveBeenCalled();
    expect(userApi.disable).not.toHaveBeenCalled();
  });

  it('resets another account password and marks it as pending change (V24)', () => {
    component.setTab('accounts');
    fixture.detectChanges();
    const buyer = component.accounts().find((item) => item.username === 'buyer01')!;
    component.openResetPasswordModal(buyer);
    expect(component.modal()).toBe('resetPassword');

    // 未滿 8 碼不送出。
    component.draftPassword.set('short');
    component.saveModal();
    expect(userApi.resetPassword).not.toHaveBeenCalled();

    component.draftPassword.set('Temp-1234');
    component.saveModal();
    expect(userApi.resetPassword).toHaveBeenCalledWith(2, { newPassword: 'Temp-1234' });
    expect(component.accounts().find((item) => item.username === 'buyer01')?.mustChangePassword).toBe(true);
    expect(component.modal()).toBeNull();
    fixture.detectChanges();
    const row = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>,
    ).find((el) => el.textContent?.includes('buyer01'))!;
    expect(row.textContent).toContain('待使用者修改密碼');
  });

  it('only allows resetting accounts that requested it, and can reject the request (V27)', () => {
    component.setTab('accounts');
    fixture.detectChanges();
    const manager = component.accounts().find((item) => item.username === 'manager01')!;
    // manager01 沒有申請：不能重設
    expect(component.canResetPassword({ ...manager, id: 99 })).toBe(false);
    component.openResetPasswordModal({ ...manager, id: 99 });
    expect(component.modal()).toBeNull();

    const row = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>,
    ).find((el) => el.textContent?.includes('buyer01'))!;
    expect(row.textContent).toContain('申請重設密碼');

    vi.spyOn(dialog, 'confirm').mockReturnValue(of(true));
    const buyer = component.accounts().find((item) => item.username === 'buyer01')!;
    component.rejectPasswordResetRequest(buyer);
    expect(userApi.rejectPasswordResetRequest).toHaveBeenCalledWith(2);
    expect(component.accounts().find((item) => item.username === 'buyer01')?.passwordResetRequestedAt).toBeNull();
  });

  it('reloads accounts when the reset request was already cancelled by the user logging in (V28)', () => {
    component.setTab('accounts');
    fixture.detectChanges();
    const buyer = component.accounts().find((item) => item.username === 'buyer01')!;
    component.openResetPasswordModal(buyer);
    userApi.resetPassword.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { success: false, message: '此帳號沒有待處理的重設密碼申請（可能已由使用者登入而自動取消）' },
          }),
      ) as never,
    );
    const listCalls = userApi.list.mock.calls.length;
    component.draftPassword.set('Temp-1234');
    component.saveModal();
    expect(component.modal()).toBeNull();
    expect(userApi.list.mock.calls.length).toBe(listCalls + 1);
    expect(dialog.state()?.messages[0]).toContain('自動取消');
  });

  it('does not open password reset for the signed-in account', () => {
    vi.spyOn(TestBed.inject(AuthService), 'currentUser').mockReturnValue({
      id: 2,
      username: 'buyer01',
      name: '陳小姐',
      role: 'PURCHASER',
      mustChangePassword: false,
    });
    component.setTab('accounts');
    fixture.detectChanges();
    const buyer = component.accounts().find((item) => item.username === 'buyer01')!;
    component.openResetPasswordModal(buyer);
    expect(component.modal()).toBeNull();
    const row = Array.from(
      fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>,
    ).find((el) => el.textContent?.includes('buyer01'))!;
    const resetButton = Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.includes('重設密碼'))!;
    expect(resetButton.disabled).toBe(true);
  });

  // 2026-09-29 依用途分三組（方案 B）：每個側邊欄項目只顯示自己那一組的分頁。
  const tabLabelsOfGroup = (group: SettingsGroup): (string | undefined)[] => {
    // 路由 data.settingsGroup 在建構時讀取；這裡直接指定欄位模擬 /settings/{group}。
    Object.assign(component, { settingsGroup: group, pageTitle: SETTINGS_GROUP_TITLE[group] });
    // OnPush：欄位不是 signal，要手動標記元件自己的 view 需要重新檢查。
    fixture.componentRef.injector.get(ChangeDetectorRef).markForCheck();
    fixture.detectChanges();
    return Array.from(
      fixture.nativeElement.querySelectorAll('nav.settings__tabs button') as NodeListOf<HTMLButtonElement>,
    ).map((b) => b.textContent?.trim());
  };

  it('shows only the scoring & review rule tabs under 評分與審核規則', () => {
    expect(tabLabelsOfGroup('scoring')).toEqual([
      '評估模式',
      '自訂屬性與因子',
      '目標區間',
      '計分與判定參數',
      '審核風險選項',
    ]);
    expect(fixture.nativeElement.querySelector('#settings-title')?.textContent).toContain('評分與審核規則');
    expect(fixture.nativeElement.querySelector('.settings__tab-divider')).toBeNull();
  });

  it('shows only the data tabs under 選品基礎資料 (核心客群 stays hidden while locked)', () => {
    expect(tabLabelsOfGroup('data')).toEqual(['商品類型', '節慶檔期', '天氣連動']);
    expect(fixture.nativeElement.querySelector('#settings-title')?.textContent).toContain('選品基礎資料');
    expect(component.isTabInGroup('audience')).toBe(true);
    expect(component.isTabInGroup('risks')).toBe(false);
  });

  it('shows only the system tabs under 系統管理', () => {
    expect(tabLabelsOfGroup('system')).toEqual(['帳號管理', '排程與同步']);
    expect(fixture.nativeElement.querySelector('#settings-title')?.textContent).toContain('系統管理');
    expect(component.isTabInGroup('accounts')).toBe(true);
    expect(component.isTabInGroup('modes')).toBe(false);
  });

  it('keeps slider snapping but accepts precise manual input', () => {
    const setting = { key: 'shrinkage_k_category', dataType: 'INTEGER', minValue: 1, maxValue: 100 } as never;
    (component as unknown as { onSliderDrag(s: unknown, v: unknown): void }).onSliderDrag(setting, 7);
    expect(component.systemSettingDraftValue()).toBe('5');
    (component as unknown as { onSliderManualInput(v: unknown): void }).onSliderManualInput(7);
    expect(component.systemSettingDraftValue()).toBe('7');
  });

  it('shares the same button to toggle a product type between disable and restore', () => {
    component.setTab('productTypes');
    component.toggleProductTypeActive('食品／生鮮');
    expect(settingsApi.disableProductType).toHaveBeenCalled();
    expect(component.productTypes().find((item) => item.name === '食品／生鮮')?.active).toBe(false);

    component.toggleProductTypeActive('食品／生鮮');
    expect(settingsApi.restoreProductType).toHaveBeenCalled();
    expect(component.productTypes().find((item) => item.name === '食品／生鮮')?.active).toBe(true);
  });

  it('shows fixed read-only weights and switches modes', () => {
    component.setTab('modes');
    component.selectMode('PROFIT');
    fixture.detectChanges();
    expect(settingsApi.switchEvaluationMode).toHaveBeenCalledWith(3);
    expect(component.activeMode()).toBe('PROFIT');
    expect(fixture.nativeElement.textContent).toContain('高利潤模式');
    expect(fixture.nativeElement.textContent).toContain('目前生效');
  });

  it('renders loading and error recovery states', () => {
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入設定');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('無法載入設定');
    component.retry();
    expect(component.pageState()).toBe('default');
  });

  // ===== 2026-09-24：分頁拆分、?tab= 同步、演算法參數說明改提示泡泡 =====

  it('renders the extracted extension and weather tabs as child components', () => {
    component.setTab('extensions');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-custom-extensions')).toBeTruthy();
    expect(settingsApi.getCustomFieldDefinitions).toHaveBeenCalled();

    component.setTab('weather');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-weather-linkage')).toBeTruthy();
  });

  it('no longer renders weather panels or custom definitions inside their old tabs', () => {
    component.setTab('campaigns');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('天氣訊號標籤對照');

    component.setTab('productTypes');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('自訂商品屬性');
  });

  it('writes the active tab to the ?tab= query param', async () => {
    const router = TestBed.inject(Router);
    component.setTab('scoreBands');
    await fixture.whenStable();
    expect(router.url).toContain('tab=scoreBands');
    // 自己同步網址觸發的 NavigationEnd 不應該讓分頁跳回去或重複載入
    expect(component.activeTab()).toBe('scoreBands');
  });

  it('shows algorithm parameter descriptions in info tips and skips empty ones', () => {
    component.setTab('systemSettings');
    fixture.detectChanges();
    const tips = fixture.nativeElement.querySelectorAll('app-info-tip');
    expect(tips).toHaveLength(1);
    expect(tips[0].querySelector('button').getAttribute('aria-label')).toContain('收斂到全體平均');
  });

  // 2026-09-29：排程作業不是評分規則，從「計分與判定參數」搬到「系統管理 › 排程與同步」。
  it('moves the scheduled-job panels out of 計分與判定參數 into 排程與同步', () => {
    component.setTab('systemSettings');
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('h2')?.textContent).toContain('計分與判定參數');
    expect(host.querySelector('app-trend-crawler-panel')).toBeNull();
    expect(host.querySelector('app-google-trends-panel')).toBeNull();
    // 天氣加成上限與比重留在天氣連動元件，這裡只放前往連結
    const link = host.querySelector('.settings__cross-link a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/settings/data?tab=weather');

    component.setTab('jobs');
    fixture.detectChanges();
    expect(host.querySelector('h2')?.textContent).toContain('排程與同步');
    expect(host.querySelector('app-trend-crawler-panel')).toBeTruthy();
    expect(host.querySelector('app-google-trends-panel')).toBeTruthy();
    // 2026-09-29：熱度規則選品面板隨熱度建議清單移除
    expect(host.querySelector('app-ai-suggestion-batch-panel')).toBeNull();
    expect(component.pageState()).toBe('default');
  });

  // ===== 2026-09-29：評分與審核規則功能檢查（自訂模式儲存權重無效等） =====

  describe('自訂模式權重與目標區間（2026-09-29 修正）', () => {
    const CUSTOM_MODE = {
      id: 4, modeCode: 'CUSTOM', modeName: '自訂模式', version: 1, description: '', isActive: false, isEditable: true,
    };
    const fixedFactor = (factorCode: string, weight: number) => ({
      factorCode, factorName: factorCode, category: 'BUSINESS', weight,
    });
    // 自訂模式目前的權重表：七個固定因子＋一個已停用的自訂因子（ECO_PACKAGING 仍有舊列）
    const CUSTOM_WEIGHTS = {
      modeCode: 'CUSTOM', modeName: '自訂模式', version: 1,
      factors: [
        fixedFactor('MARGIN_RATE', 30), fixedFactor('DISCOUNT_DEPTH', 10), fixedFactor('SUPPLY_STABILITY', 10),
        fixedFactor('AUDIENCE_MATCH', 10), fixedFactor('HISTORY_FULFILLMENT', 10), fixedFactor('PURCHASE_RATE', 10),
        fixedFactor('TREND_HEAT', 10),
        { factorCode: 'ECO_PACKAGING', factorName: '環保包裝評級', category: 'SUSTAINABILITY', weight: 10 },
      ],
    };
    const definition = (id: number, factorCode: string, isActive: boolean, strategyCode = 'MANUAL_SCALE') => ({
      id, factorCode, factorName: `${factorCode} 名稱`, category: null, strategyCode, dataSourceCode: null,
      customFieldDefinitionId: null, strategyParams: null, isActive, isSuperseded: false,
    });
    const DEFINITIONS = [
      definition(1, 'ECO_PACKAGING', false),
      // 新建立、還沒有自訂模式權重列的因子
      definition(2, 'NEW_FACTOR', true),
      definition(3, 'SOCIAL_BUZZ', true, 'TARGET_BAND_NORMALIZE'),
    ];

    function recreateWithCustomMode(): void {
      settingsApi.getEvaluationModes.mockReturnValue(of([...MOCK_MODES, CUSTOM_MODE].map((m) => ({ ...m }))));
      settingsApi.getEvaluationModeFactors.mockImplementation((id: number) =>
        of(id === 4 ? structuredClone(CUSTOM_WEIGHTS) : makeWeights(MOCK_MODES.find((m) => m.id === id)?.modeCode ?? 'BALANCED')),
      );
      settingsApi.getFactorDefinitions.mockReturnValue(of(DEFINITIONS.map((d) => ({ ...d }))));
      fixture = TestBed.createComponent(Settings);
      component = fixture.componentInstance;
      fixture.detectChanges();
    }

    it('權重編輯器排除已停用的自訂因子、列出新因子，送出的清單恰好是生效中的因子', () => {
      recreateWithCustomMode();
      const custom = component.modes().find((m) => m.code === 'CUSTOM')!;
      component.startEditWeights(custom);

      expect(component.factorOrder()).not.toContain('ECO_PACKAGING');
      expect(component.factorOrder()).toContain('NEW_FACTOR');
      // 停用因子的舊權重 10 不能算進加總
      expect(component.weightDraftTotal()).toBe(90);

      component.toggleFactorEnabled('NEW_FACTOR');
      component.updateWeightDraft('NEW_FACTOR', 10);
      settingsApi.updateEvaluationModeFactors.mockReturnValue(of(structuredClone(CUSTOM_WEIGHTS)));
      component.saveWeights();

      expect(settingsApi.updateEvaluationModeFactors).toHaveBeenCalledTimes(1);
      const [modeId, body] = settingsApi.updateEvaluationModeFactors.mock.calls[0] as unknown as [
        number,
        { factors: { factorCode: string; weight: number }[] },
      ];
      expect(modeId).toBe(4);
      const codes = body.factors.map((f) => f.factorCode);
      expect(codes).not.toContain('ECO_PACKAGING');
      expect(codes).toEqual(expect.arrayContaining(['MARGIN_RATE', 'NEW_FACTOR', 'SOCIAL_BUZZ']));
      expect(body.factors.find((f) => f.factorCode === 'NEW_FACTOR')?.weight).toBe(10);
      expect(body.factors.reduce((sum, f) => sum + f.weight, 0)).toBe(100);
    });

    it('唯讀權重明細把已停用的自訂因子標示為不計分', () => {
      recreateWithCustomMode();
      fixture.detectChanges();
      const inactiveRows = fixture.nativeElement.querySelectorAll('.mode-grid__breakdown .is-inactive');
      expect(inactiveRows.length).toBe(1);
      expect(inactiveRows[0].textContent).toContain('環保包裝評級');
      expect(inactiveRows[0].textContent).toContain('已停用，不計分');
    });

    it('按「編輯權重」不會連帶把系統生效模式切到自訂模式', () => {
      recreateWithCustomMode();
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector('.mode-grid__edit-weights') as HTMLButtonElement;
      button.click();
      fixture.detectChanges();

      expect(settingsApi.switchEvaluationMode).not.toHaveBeenCalled();
      expect(component.activeMode()).toBe('BALANCED');
      expect(component.editingWeightsModeId()).toBe(4);
    });

    it('目標區間分頁自行載入商品類型與自訂因子：只能選生效中的大類、可選目標區間正規化的自訂因子', () => {
      settingsApi.getFactorDefinitions.mockReturnValue(of(DEFINITIONS.map((d) => ({ ...d }))));
      settingsApi.getProductTypes.mockReturnValue(
        of([
          { id: 1, name: '生鮮食品', level: 1, parentId: null, isActive: true, isSystemDefault: true },
          { id: 2, name: '蔬菜', level: 2, parentId: 1, isActive: true, isSystemDefault: false },
          { id: 3, name: '停用大類', level: 1, parentId: null, isActive: false, isSystemDefault: false },
        ]),
      );
      settingsApi.getProductTypeScoreBands.mockReturnValue(
        of([
          { id: 1, productTypeId: null, factorCode: 'MARGIN_RATE', lowerBound: 0, upperBound: 0.4, version: 1,
            sourceMode: 'MANUAL', sampleSize: null, includesSimulated: null, computedAt: null },
          { id: 2, productTypeId: 1, factorCode: 'MARGIN_RATE', lowerBound: 0.1, upperBound: 0.5, version: 1,
            sourceMode: 'MANUAL', sampleSize: null, includesSimulated: null, computedAt: null },
          { id: 3, productTypeId: null, factorCode: 'SOCIAL_BUZZ', lowerBound: 0, upperBound: 500, version: 1,
            sourceMode: 'MANUAL', sampleSize: null, includesSimulated: null, computedAt: null },
        ]),
      );

      component.setTab('scoreBands');
      fixture.detectChanges();

      expect(settingsApi.getProductTypes).toHaveBeenCalled();
      expect(component.scoreBandProductTypeOptions().map((t) => t.id)).toEqual([1]);
      expect(component.scoreBandFactorOptions().map((f) => f.code)).toEqual([
        'MARGIN_RATE', 'DISCOUNT_DEPTH', 'SOCIAL_BUZZ',
      ]);
      // 自訂因子名稱隨清單即時帶入，不停在代碼
      expect(component.globalScoreBands().find((b) => b.factorCode === 'SOCIAL_BUZZ')?.factorLabel).toBe('SOCIAL_BUZZ 名稱');

      // 「依歷史紀錄計算」只出現在品類覆寫的毛利率／折扣深度
      const [globalMargin, typeMargin, globalBuzz] = [1, 2, 3].map(
        (id) => component.globalScoreBands().concat(component.overrideScoreBands()).find((b) => b.id === id)!,
      );
      expect(component.supportsHistoricalBand(globalMargin)).toBe(false);
      expect(component.supportsHistoricalBand(typeMargin)).toBe(true);
      expect(component.supportsHistoricalBand(globalBuzz)).toBe(false);

      // 2026-09-30：畫面移除「來源模式」選單，編輯列只剩上下界輸入，一律以手動填入送出。
      component.openScoreBandEditor(typeMargin);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('tr.is-editing select')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('tr.is-editing input[type=number]').length).toBe(2);
      expect(component.scoreBandDraftMode()).toBe('MANUAL');
    });
  });
});
