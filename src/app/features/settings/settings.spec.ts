import { DialogService } from '../../core/dialog/dialog.service';
import { Subject } from 'rxjs';
import '../../core/dialog/modal-test-setup';
import { APP_RUNTIME_CONFIG } from '../../core/config/app-config';
/**
 * 檔案用途：驗證固定模式、9 類商品、條件式刪除、檔期入口與帳號停用等設定規則。
 *
 * ⚠️ 這次接上真實 API 後才發現：useMockData 目前是 false（見 app-config.ts），
 * 代表每個分頁第一次切換過去都會呼叫對應的真實 API service。跟其他元件
 * 用同一套策略：整個 mock 掉 SettingsApiService／UserApiService／兩個
 * Lookup 服務，讓測試不依賴全域設定值，也不需要真的打網路。
 *
 * 商品類型刪除需確認系統來源及使用數；仍保留後端 409 的最後一道防線。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ProductTypeLookupService } from './api/product-type-lookup.service';
import { RiskOptionLookupService } from './api/risk-option-lookup.service';
import { SettingsApiService } from './api/settings-api.service';
import { UserApiService } from '../user-management/api/user-api.service';
import { Settings } from './settings';

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
  { id: 1, name: '實際供貨風險', description: null, isSystemDefault: true },
  { id: 2, name: '商品品質與客訴風險', description: null, isSystemDefault: true },
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
  { id: 1, username: 'manager01', name: '林經理', role: 'MANAGER' as const, enabled: true, createdAt: null },
  { id: 2, username: 'buyer01', name: '陳小姐', role: 'PURCHASER' as const, enabled: true, createdAt: null },
  { id: 3, username: 'buyer02', name: '王先生', role: 'PURCHASER' as const, enabled: false, createdAt: null },
];

describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let component: Settings;

  const settingsApi = {
    getEvaluationModes: vi.fn(() => of(MOCK_MODES.map((m) => ({ ...m })))),
    getEvaluationModeFactors: vi.fn((id: number) =>
      of(makeWeights(MOCK_MODES.find((m) => m.id === id)?.modeCode ?? 'BALANCED')),
    ),
    getCurrentEvaluationMode: vi.fn(() => of({ ...MOCK_MODES[0] })),
    switchEvaluationMode: vi.fn((id: number) =>
      of({ ...MOCK_MODES.find((m) => m.id === id)! }),
    ),
    getRiskOptions: vi.fn(() => of(MOCK_RISK_OPTIONS.map((r) => ({ ...r })))),
    createRiskOption: vi.fn((body: { name: string }) =>
      of({ id: 99, name: body.name, description: null, isSystemDefault: false }),
    ),
    getAudienceProfile: vi.fn(() => of({ ...MOCK_AUDIENCE_PROFILE })),
    updateAudienceProfile: vi.fn((body: unknown) => of({ ...MOCK_AUDIENCE_PROFILE, ...(body as object) })),
    getProductTypes: vi.fn(() => of(MOCK_PRODUCT_TYPES.map((p) => ({ ...p })))),
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
  };

  const userApi = {
    list: vi.fn(() => of(MOCK_ACCOUNTS.map((a) => ({ ...a })))),
    create: vi.fn((body: { username: string; name: string; role: 'PURCHASER' | 'MANAGER' }) =>
      of({ id: 4, username: body.username, name: body.name, role: body.role, enabled: true, createdAt: null }),
    ),
    disable: vi.fn((id: number) =>
      of({ ...MOCK_ACCOUNTS.find((a) => a.id === id)!, enabled: false }),
    ),
    restore: vi.fn((id: number) =>
      of({ ...MOCK_ACCOUNTS.find((a) => a.id === id)!, enabled: true }),
    ),
  };

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
    userApi.list.mockReturnValue(of(MOCK_ACCOUNTS.map((a) => ({ ...a }))));

    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        { provide: APP_RUNTIME_CONFIG, useValue: { useMockData: false } },
        { provide: SettingsApiService, useValue: settingsApi },
        { provide: UserApiService, useValue: userApi },
        { provide: ProductTypeLookupService, useValue: productTypeLookup },
        { provide: RiskOptionLookupService, useValue: riskOptionLookup },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it.each([[null, '尚無資料'], [0, '0'], [12, '12']])('renders used count %s without treating zero as missing', (value, label) => {
    component.setTab('productTypes');
    component.productTypes.update(items => [{...items[0], used: value as number | null}]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tbody tr td:nth-child(3)').textContent.trim()).toBe(label);
    expect(fixture.nativeElement.textContent).not.toContain('系統預設與自訂類型；已被品項使用時不可刪除。');
  });

  it('switches settings tabs without a classification toast', () => {
    component.setTab('productTypes');
    component.setTab('risks');
    fixture.detectChanges();
    expect(component.statusMessage()).toBe('');
    expect(fixture.nativeElement.querySelector('.status-toast')).toBeNull();
  });

  it('creates the complete management settings page', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('評估模式');
    expect(fixture.nativeElement.textContent).toContain('帳號管理');
    // 核心客群目前鎖住（component.audienceSettingsVisible = false），
    // 分頁按鈕跟內容都不應該渲染出來，不是「顯示但disabled」。
    expect(fixture.nativeElement.textContent).not.toContain('核心客群設定');
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.tabs button')).some(
        (button: unknown) => (button as HTMLButtonElement).textContent?.includes('核心客群'),
      ),
    ).toBe(false);
  });

  it('prevents normal navigation from entering the hidden audience tab', () => {
    component.setTab('audience');
    expect(component.activeTab()).toBe('modes');
    expect(component.statusMessage()).toContain('暫不開放');
    // 被攔下時不該連帶觸發真實模式的分頁載入（不打 GET /audience-profile）。
    expect(settingsApi.getAudienceProfile).not.toHaveBeenCalled();
  });

  it('validates audience age range', () => {
    component.form.patchValue({ ageMin: 50, ageMax: 30 });
    component.saveAudience();
    expect(component.saved()).toBe(false);
    expect(component.ageRangeInvalid()).toBe(true);
    expect(component.statusMessage()).toContain('請修正客群設定欄位');
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

  it('creates a risk option through modal state', () => {
    component.openModal('risk');
    component.draftName.set('測試風險');
    component.draftKeywords.set('測試關鍵字');
    component.saveModal();
    expect(settingsApi.createRiskOption).toHaveBeenCalledWith({
      name: '測試風險',
      alertKeywords: '測試關鍵字',
    });
    expect(component.riskOptions().some((item) => item.name === '測試風險')).toBe(true);
  });

  it('preserves the server 409 guard even after confirming a known unused custom type', () => {
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

    // 模擬已確認未使用，但確認後被其他人引用的情境。
    component.productTypes.update(items => items.map(item => item.name === '食品／生鮮' ? { ...item, system: false, used: 0 } : item));
    component.removeProductType('食品／生鮮');
    TestBed.inject(DialogService).handleConfirm();

    expect(settingsApi.deleteProductType).toHaveBeenCalled();
    expect(component.productTypes().some((item) => item.name === '食品／生鮮')).toBe(true);
    expect(component.statusMessage()).toContain('不可刪除');
  });

  it('blocks default, used and unknown product types before confirmation', () => {
    component.setTab('productTypes');
    for (const patch of [{system: true, used: 0}, {system: false, used: 2}, {system: false, used: null}]) {
      component.productTypes.update(items => items.map(item => ({...item, ...patch})));
      component.removeProductType('食品／生鮮');
      expect(TestBed.inject(DialogService).state()).toBeNull();
      expect(component.statusMessage()).toBeTruthy();
    }
    expect(settingsApi.deleteProductType).not.toHaveBeenCalled();
  });

  it('requires confirmation and prevents repeat deletes while pending', () => {
    component.setTab('productTypes');
    component.productTypes.update(items => items.map(item => ({...item, system: false, used: 0})));
    const response = new Subject<undefined>();
    settingsApi.deleteProductType.mockReturnValueOnce(response);
    const dialog = TestBed.inject(DialogService);
    component.removeProductType('食品／生鮮');
    expect(dialog.state()?.messages.join('')).toContain('食品／生鮮');
    expect(settingsApi.deleteProductType).not.toHaveBeenCalled();
    dialog.handleCancel();
    expect(component.deletingType()).toBeNull();
    component.removeProductType('食品／生鮮');
    dialog.handleConfirm();
    component.removeProductType('食品／生鮮');
    expect(settingsApi.deleteProductType).toHaveBeenCalledTimes(1);
    response.next(undefined); response.complete();
    expect(component.deletingType()).toBeNull();
    expect(component.statusMessage()).toContain('已刪除');
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
    // 停用：呼叫 disable，文字/顏色切換成「復用帳號」。
    component.toggleAccountActive('buyer01');
    expect(userApi.disable).toHaveBeenCalledWith(2);
    expect(component.accounts().find((item) => item.username === 'buyer01')?.active).toBe(false);
    fixture.detectChanges();
    const toggleButton = Array.from(
      fixture.nativeElement.querySelectorAll('.status-actions-cell .text-action'),
    ).find((el) => (el as HTMLElement).closest('tr')?.textContent?.includes('buyer01')) as HTMLButtonElement;
    expect(toggleButton?.textContent).toContain('復用帳號');
    expect(toggleButton?.classList.contains('is-restore')).toBe(true);

    // 復用：同一個方法，狀態反過來時改呼叫 restore。
    component.toggleAccountActive('buyer01');
    expect(userApi.restore).toHaveBeenCalledWith(2);
    expect(component.accounts().find((item) => item.username === 'buyer01')?.active).toBe(true);
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
});
