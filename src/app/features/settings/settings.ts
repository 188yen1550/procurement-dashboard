/**
 * 檔案用途：管理頁的三套固定評估模式、人工風險、核心客群、商品類型、檔期與帳號。
 * 帳號只能停用；使用中的商品類型不可刪除；檔期編輯與手動狀態切換是不同入口。
 *
 * ## 這次接上真實 API 做了什麼
 *
 * 1. Mock 模式完全保留——固定示範資料、UI 狀態切換器都不動，PM 展示用。
 *
 * 2. 真實模式採「分頁延遲載入」：進頁面只載入預設分頁（評估模式），
 *    其餘分頁在使用者第一次切換過去時才呼叫 API，之後同一個元件實例
 *    內切換回來不重複打——設定頁是低頻頁面，用簡單的「載入過就跳過」
 *    旗標即可，不需要像 ProductTypeLookupService 那種跨元件共用的快取。
 *
 * ## ⚠️ 真實模式下三個誠實的資料落差（不假造）
 *
 * - 人工風險選項：`RiskOptionResponsePayload` 沒有 `alertKeywords` 欄位，
 *   清單頁看不到目前設定的關鍵字內容（只能看到名稱），這是後端 GET 端點
 *   本來就沒回傳，不是前端疏漏。
 * - 商品類型：`ProductTypeResponsePayload` 沒有「使用品項數」，刪除鍵一律
 *   可按，實際擋下與否交給後端的 409（已被品項引用）處理，不在前端假裝
 *   算得出使用數。
 * - 帳號管理：`UserAccountResponsePayload` 沒有姓名以外的稽核欄位，
 *   跟 Mock 一致，沒有落差。
 */
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { FestiveCategory, UserRole } from '../../core/domain/enums';
import { joinCampaignTags, splitKeywords } from '../../core/domain/labels';
import { ProductTypeLookupService } from './api/product-type-lookup.service';
import { RiskOptionLookupService } from './api/risk-option-lookup.service';
import {
  FestiveCampaignTagPayload,
  RiskOptionResponsePayload,
} from './api/settings-api.contract';
import { SettingsApiService } from './api/settings-api.service';
import { UserApiService } from '../user-management/api/user-api.service';
import { UserAccountResponsePayload } from '../user-management/api/user-api.contract';

type SettingsState = 'default' | 'disabled' | 'loading' | 'error';
type SettingsTab = 'modes' | 'risks' | 'audience' | 'productTypes' | 'campaigns' | 'accounts';

interface EvaluationModeVM {
  id: number | null;
  code: string;
  name: string;
  description: string;
  /** 真實模式載入中或載入失敗時為 null，畫面顯示「載入中」而非假權重。 */
  weights: { business: number; audience: number; history: number; forecast: number } | null;
}

interface RiskOptionVM {
  id: number | null;
  name: string;
  /** ⚠️ 真實模式恆為 NOT_PROVIDED：GET 端點沒有這個欄位。 */
  keywords: string;
  isSystemDefault: boolean;
}

interface ProductTypeVM {
  id: number | null;
  name: string;
  system: boolean;
  /** ⚠️ 真實模式恆為 null：後端沒有這個統計。 */
  used: number | null;
  active: boolean;
}

interface CampaignVM {
  id: number | null;
  code: string;
  name: string;
  category: FestiveCategory;
  categoryLabel: string;
  range: string;
  status: string;
  override: boolean;
  tags: FestiveCampaignTagPayload[];
}

interface AccountVM {
  id: number | null;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
}

const NOT_PROVIDED = '（後端未提供）';

/** 固定三套模式的展示殼；真實模式的 weights 另外呼叫 factors 端點補上。 */
const MODE_SHELLS: readonly { code: string; name: string; description: string }[] = [
  { code: 'BALANCED', name: '均衡模式', description: '商業條件、客群、歷史與預測各佔四分之一。' },
  { code: 'VOLUME', name: '衝量模式', description: '優先考量客群匹配與預測人氣。' },
  { code: 'PROFIT', name: '高利潤模式', description: '提高商業條件權重，同時保留人氣預測。' },
];

const MOCK_MODES: readonly EvaluationModeVM[] = [
  { id: 1, ...MODE_SHELLS[0], weights: { business: 25, audience: 25, history: 25, forecast: 25 } },
  { id: 2, ...MODE_SHELLS[1], weights: { business: 15, audience: 30, history: 15, forecast: 40 } },
  { id: 3, ...MODE_SHELLS[2], weights: { business: 45, audience: 15, history: 15, forecast: 25 } },
];

const MOCK_RISK_OPTIONS: readonly RiskOptionVM[] = [
  { id: 1, name: '實際供貨風險', keywords: '缺貨、延遲、供貨不穩', isSystemDefault: true },
  { id: 2, name: '商品品質與客訴風險', keywords: '瑕疵、過敏、客訴', isSystemDefault: true },
  { id: 3, name: '市場不確定性與需求變動風險', keywords: '熱度下降、需求波動、競品', isSystemDefault: true },
];

const MOCK_PRODUCT_TYPES: readonly ProductTypeVM[] = [
  { id: 1, name: '食品／生鮮', system: true, used: 12, active: true },
  { id: 2, name: '日用品', system: true, used: 8, active: true },
  { id: 3, name: '3C／家電', system: true, used: 6, active: true },
  { id: 4, name: '生活雜貨', system: true, used: 4, active: true },
  { id: 5, name: '美妝保養', system: true, used: 3, active: true },
  { id: 6, name: '服飾配件', system: true, used: 0, active: true },
  { id: 7, name: '寢具家用', system: true, used: 2, active: true },
  { id: 8, name: '精品禮盒', system: true, used: 1, active: true },
  { id: 9, name: '其他', system: true, used: 0, active: true },
];

const MOCK_CAMPAIGNS: readonly CampaignVM[] = [
  {
    id: 1,
    code: 'MOON2026',
    name: '中秋節',
    category: 'FESTIVAL',
    categoryLabel: '🎊 節慶',
    range: '2026/08/15–2026/09/25',
    status: 'ACTIVE',
    override: false,
    tags: [{ tag: 'bbq', matchTier: 'CORE' }],
  },
  {
    id: 2,
    code: 'OCT2026',
    name: '雙十連假',
    category: 'FESTIVAL',
    categoryLabel: '🎊 節慶',
    range: '2026/09/15–2026/10/10',
    status: 'PREPARING',
    override: false,
    tags: [{ tag: 'gift', matchTier: 'GENERAL' }],
  },
  {
    id: 3,
    code: 'AUTUMN2026',
    name: '秋冬換季',
    category: 'SEASON',
    categoryLabel: '🍂 季節',
    range: '2026/10/01–2026/11/15',
    status: 'UPCOMING',
    override: true,
    tags: [{ tag: 'seasonal', matchTier: 'WEAK' }],
  },
];

const MOCK_ACCOUNTS: readonly AccountVM[] = [
  { id: 1, username: 'manager01', name: '林經理', role: 'MANAGER', active: true },
  { id: 2, username: 'buyer01', name: '陳小姐', role: 'PURCHASER', active: true },
  { id: 3, username: 'buyer02', name: '王先生', role: 'PURCHASER', active: false },
];

@Component({
  selector: 'app-settings',
  imports: [FormsModule, ReactiveFormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly api = inject(SettingsApiService);
  private readonly userApi = inject(UserApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);
  private readonly riskOptionLookup = inject(RiskOptionLookupService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  /**
   * 核心客群設定目前鎖住，不開放操作／管理層進入編輯。
   * 沿用 20260831 分支的既有決策，不是這次合併新增的規則——
   * 之後若要重新開放，只需要把這裡改回 true，setTab() 跟樣板的分頁
   * 按鈕不需要再動。
   */
  readonly audienceSettingsVisible = false;
  readonly stateOptions: readonly SettingsState[] = ['default', 'disabled', 'loading', 'error'];
  readonly activeTab = signal<SettingsTab>('modes');
  readonly pageState = signal<SettingsState>(this.useMockData ? 'default' : 'loading');
  readonly saved = signal(false);
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly activeMode = signal('BALANCED');

  constructor() {
    // 原本呼叫 autoDismissStatusMessage(this.statusMessage) 的地方拿掉了，
    // 現在的自動消失邏輯已經內建在 createDismissibleMessage() 裡，
    // 不需要另外註冊監看。
    // 原地重新點擊「系統設定」連結時 ngOnInit() 不會再被觸發，要靠這裡才能
    // 重新抓資料——直接呼叫 loadTab(activeTab())、不經過 setTab() 的
    // loadedTabs 判斷，因為那個判斷本來是「同一個分頁只在第一次切換時載入
    // 一次」的效能優化，這裡的情境是使用者主動要求重新整理，要強制重抓
    // 目前所在的分頁，不能被「已經載入過」擋下來。Mock 模式不套用。
    if (!this.useMockData) reloadOnRevisit(() => this.loadTab(this.activeTab()));
  }

  readonly modes = signal<EvaluationModeVM[]>(this.useMockData ? [...MOCK_MODES] : []);
  readonly riskOptions = signal<RiskOptionVM[]>(this.useMockData ? [...MOCK_RISK_OPTIONS] : []);
  readonly productTypes = signal<ProductTypeVM[]>(
    this.useMockData ? [...MOCK_PRODUCT_TYPES] : [],
  );
  readonly campaigns = signal<CampaignVM[]>(this.useMockData ? [...MOCK_CAMPAIGNS] : []);
  readonly accounts = signal<AccountVM[]>(this.useMockData ? [...MOCK_ACCOUNTS] : []);

  /** 每個分頁是否已經載入過一次，避免切回去重複打 API。Mock 模式視為全部已載入。 */
  private readonly loadedTabs = new Set<SettingsTab>(this.useMockData ? (
    ['modes', 'risks', 'audience', 'productTypes', 'campaigns', 'accounts'] as const
  ) : []);

  readonly modal = signal<
    null | 'risk' | 'productType' | 'campaign' | 'campaignStatus' | 'account'
  >(null);
  readonly selectedCampaign = signal('');
  readonly draftName = signal('');
  readonly draftKeywords = signal('');
  readonly draftUsername = signal('');
  readonly draftRole = signal<UserRole>('PURCHASER');
  readonly draftPassword = signal('');
  readonly draftCategory = signal<FestiveCategory>('FESTIVAL');
  readonly draftStart = signal('');
  readonly draftEnd = signal('');
  readonly draftLeadDays = signal(30);
  readonly draftTags = signal<FestiveCampaignTagPayload[]>([{ tag: '', matchTier: 'CORE' }]);
  readonly draftStatus = signal('ACTIVE');
  readonly isSaving = signal(false);

  readonly form = this.fb().nonNullable.group({
    name: ['核心家庭團購客群', [Validators.required, Validators.maxLength(100)]],
    ageMin: [28, [Validators.required, Validators.min(18), Validators.max(99)]],
    ageMax: [45, [Validators.required, Validators.min(18), Validators.max(99)]],
    priceSensitivity: ['MEDIUM', Validators.required],
    preferenceDescription: [
      '重視實用性、安全性與團購價格優勢，偏好家庭共用與節慶情境商品。',
      [Validators.required, Validators.maxLength(500)],
    ],
    keywords: ['家庭, 實用, 親子, 團購優惠', Validators.required],
  });

  private fb(): FormBuilder {
    return new FormBuilder();
  }

  ngOnInit(): void {
    if (!this.useMockData) this.loadTab('modes');
  }

  // ----- 分頁切換與延遲載入 -----

  setTab(tab: SettingsTab): void {
    if (tab === 'audience' && !this.audienceSettingsVisible) {
      this.statusMessageState.show('核心客群設定目前暫不開放。');
      return;
    }
    this.activeTab.set(tab);
    // this.statusMessageState.show('已切換設定分類。');
    if (!this.useMockData && !this.loadedTabs.has(tab)) this.loadTab(tab);
  }

  private loadTab(tab: SettingsTab): void {
    this.pageState.set('loading');
    switch (tab) {
      case 'modes':
        this.loadModes();
        return;
      case 'risks':
        this.loadRiskOptions();
        return;
      case 'audience':
        this.loadAudienceProfile();
        return;
      case 'productTypes':
        this.loadProductTypes();
        return;
      case 'campaigns':
        this.loadCampaigns();
        return;
      case 'accounts':
        this.loadAccounts();
        return;
    }
  }

  private markLoaded(tab: SettingsTab): void {
    this.loadedTabs.add(tab);
    this.pageState.set('default');
  }

  private handleLoadError(err: unknown): void {
    this.pageState.set('error');
    this.statusMessageState.show(toApiError(err).message);
  }

  // ----- 1. 評估模式 -----

  private loadModes(): void {
    this.api
      .getEvaluationModes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          const shells = list.map((mode) => ({
            id: mode.id,
            code: mode.modeCode,
            name: mode.modeName,
            description: mode.description ?? '',
            weights: null,
          }));
          this.modes.set(shells);
          this.markLoaded('modes');
          this.loadCurrentMode();
          shells.forEach((mode) => this.loadModeWeights(mode.id));
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  private loadCurrentMode(): void {
    this.api
      .getCurrentEvaluationMode()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (mode) => this.activeMode.set(mode.modeCode),
        // 目前生效模式載入失敗不影響三張卡片本身的顯示，只是暫時不知道哪張是生效中。
        error: () => undefined,
      });
  }

  /** 權重是另一支端點，三套模式各自獨立呼叫，之後填回對應那張卡片。 */
  private loadModeWeights(modeId: number): void {
    this.api
      .getEvaluationModeFactors(modeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          const weightOf = (category: string) =>
            snapshot.factors.find((f) => f.category === category)?.weight ?? 0;
          this.modes.update((items) =>
            items.map((item) =>
              item.id === modeId
                ? {
                    ...item,
                    weights: {
                      business: weightOf('BUSINESS'),
                      audience: weightOf('AUDIENCE'),
                      history: weightOf('HISTORY'),
                      forecast: weightOf('FORECAST'),
                    },
                  }
                : item,
            ),
          );
        },
        // 單一模式的權重載入失敗，該卡片維持「載入中」而非讓整頁報錯。
        error: () => undefined,
      });
  }

  selectMode(code: string): void {
    if (this.pageState() === 'disabled') return;

    if (this.useMockData) {
      this.activeMode.set(code);
      this.statusMessageState.show(`已在本地切換為 ${this.modes().find((m) => m.code === code)?.name}。`);
      return;
    }

    const target = this.modes().find((m) => m.code === code);
    if (!target?.id) return;

    this.api
      .switchEvaluationMode(target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (mode) => {
          this.activeMode.set(mode.modeCode);
          this.statusMessageState.show(
            `已切換為 ${mode.modeName}，所有未審核商品的即時分數將重新計算。`,
          );
        },
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  // ----- 2. 人工風險選項 -----

  private loadRiskOptions(): void {
    this.api
      .getRiskOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.riskOptions.set(list.map((item) => toRiskOptionVM(item)));
          this.markLoaded('risks');
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  // ----- 3. 核心客群 -----

  private loadAudienceProfile(): void {
    this.api
      .getAudienceProfile()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          this.form.patchValue({
            name: profile.name,
            ageMin: profile.ageMin ?? 18,
            ageMax: profile.ageMax ?? 99,
            priceSensitivity: profile.priceSensitivity ?? 'MEDIUM',
            preferenceDescription: profile.preferenceDescription ?? '',
            keywords: joinKeywordsForDisplay(profile.keywords),
          });
          this.form.markAsPristine();
          this.markLoaded('audience');
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  saveAudience(): void {
    if (this.form.invalid || this.ageRangeInvalid()) {
      this.form.markAllAsTouched();
      this.statusMessageState.show('請修正客群設定欄位。');
      return;
    }

    if (this.useMockData) {
      this.saved.set(true);
      this.form.markAsPristine();
      this.statusMessageState.show('核心客群已儲存至本地 Mock 狀態。');
      return;
    }

    const raw = this.form.getRawValue();
    this.isSaving.set(true);
    this.api
      .updateAudienceProfile({
        name: raw.name,
        ageMin: raw.ageMin,
        ageMax: raw.ageMax,
        priceSensitivity: raw.priceSensitivity as 'LOW' | 'MEDIUM' | 'HIGH',
        preferenceDescription: raw.preferenceDescription,
        // ⚠️ 一律正規化成逗號、頓號、空白皆可（後端 split("[,、\s]+")），
        // 這裡直接沿用使用者輸入即可，後端本身就寬容分隔符。
        keywords: raw.keywords,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.saved.set(true);
          this.form.markAsPristine();
          this.statusMessageState.show('核心客群已儲存。');
        },
        error: (err) => {
          this.isSaving.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  // ----- 4. 商品類型 -----

  private loadProductTypes(): void {
    this.api
      .getProductTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.productTypes.set(
            list.map((item) => ({
              id: item.id,
              name: item.name,
              system: item.isSystemDefault ?? false,
              used: null,
              active: item.isActive ?? true,
            })),
          );
          this.markLoaded('productTypes');
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  removeProductType(name: string): void {
    const item = this.productTypes().find((type) => type.name === name);
    if (!item) return;

    if (this.useMockData) {
      if (item.used && item.used > 0) {
        this.statusMessageState.show('此類型已被品項使用，不可刪除，請改為停用。');
        return;
      }
      this.productTypes.update((items) => items.filter((type) => type.name !== name));
      return;
    }

    if (!item.id) return;
    this.api
      .deleteProductType(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.productTypes.update((items) => items.filter((type) => type.name !== name));
          this.productTypeLookup.invalidate();
          this.statusMessageState.show(`已刪除「${name}」。`);
        },
        error: (err) => {
          const error = toApiError(err);
          this.statusMessageState.show(
            error.status === 409 ? '此類型已被品項使用，不可刪除，請改為停用。' : error.message,
          );
        },
      });
  }

  /** 依目前狀態決定要停用還是復用，樣板只需要綁定同一個方法。 */
  toggleProductTypeActive(name: string): void {
    const item = this.productTypes().find((type) => type.name === name);
    if (!item) return;
    if (item.active) this.disableProductType(name);
    else this.restoreProductType(name);
  }

  disableProductType(name: string): void {
    if (this.useMockData) {
      this.productTypes.update((items) =>
        items.map((item) => (item.name === name ? { ...item, active: false } : item)),
      );
      return;
    }

    const item = this.productTypes().find((type) => type.name === name);
    if (!item?.id) return;

    this.api
      .disableProductType(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.productTypes.update((items) =>
            items.map((type) => (type.name === name ? { ...type, active: false } : type)),
          );
          this.productTypeLookup.invalidate();
          this.statusMessageState.show(`已停用「${name}」。`);
        },
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  private restoreProductType(name: string): void {
    if (this.useMockData) {
      this.productTypes.update((items) =>
        items.map((item) => (item.name === name ? { ...item, active: true } : item)),
      );
      return;
    }

    const item = this.productTypes().find((type) => type.name === name);
    if (!item?.id) return;

    this.api
      .restoreProductType(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.productTypes.update((items) =>
            items.map((type) => (type.name === name ? { ...type, active: true } : type)),
          );
          this.productTypeLookup.invalidate();
          this.statusMessageState.show(`已復用「${name}」。`);
        },
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  // ----- 5. 節慶檔期 -----

  private loadCampaigns(): void {
    this.api
      .getFestiveCampaigns()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.campaigns.set(list.map((item) => toCampaignVM(item)));
          this.markLoaded('campaigns');
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  editCampaign(name: string): void {
    const campaign = this.campaigns().find((item) => item.name === name);
    if (!campaign) return;
    this.selectedCampaign.set(name);
    this.draftName.set(campaign.name);
    this.draftCategory.set(campaign.category);
    const [start, end] = campaign.range.split('–').map((date) => date.replaceAll('/', '-'));
    this.draftStart.set(start ?? '');
    this.draftEnd.set(end ?? '');
    // ⚠️ tags 是整份覆蓋：先把現有標籤帶進表單，讓使用者在既有基礎上增刪，
    // 不要讓表單以空陣列開局，否則存檔會把原有標籤全部清光。
    this.draftTags.set(
      campaign.tags.length > 0 ? campaign.tags.map((t) => ({ ...t })) : [{ tag: '', matchTier: 'CORE' }],
    );
    this.modal.set('campaign');
  }

  // ----- 6. 帳號管理 -----

  private loadAccounts(): void {
    this.userApi
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.accounts.set(list.map((item) => toAccountVM(item)));
          this.markLoaded('accounts');
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  /** 依目前狀態決定要停用還是復用，樣板只需要綁定同一個方法。 */
  toggleAccountActive(username: string): void {
    const item = this.accounts().find((account) => account.username === username);
    if (!item) return;
    if (item.active) this.disableAccount(username);
    else this.restoreAccount(username);
  }

  disableAccount(username: string): void {
    if (this.useMockData) {
      this.accounts.update((items) =>
        items.map((item) => (item.username === username ? { ...item, active: false } : item)),
      );
      this.statusMessageState.show('已停用帳號；稽核關聯資料仍保留。');
      return;
    }

    const item = this.accounts().find((account) => account.username === username);
    if (!item?.id) return;

    this.userApi
      .disable(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.accounts.update((items) =>
            items.map((account) =>
              account.username === username ? { ...account, active: false } : account,
            ),
          );
          this.statusMessageState.show('已停用帳號；稽核關聯資料仍保留。');
        },
        error: (err) => {
          const error = toApiError(err);
          // ⚠️ 後端擋「不可停用自己的帳號」是 409，訊息要單獨顯示，
          // 不要讓使用者以為是網路問題重試。
          this.statusMessageState.show(error.message);
        },
      });
  }

  private restoreAccount(username: string): void {
    if (this.useMockData) {
      this.accounts.update((items) =>
        items.map((item) => (item.username === username ? { ...item, active: true } : item)),
      );
      this.statusMessageState.show('已復用帳號。');
      return;
    }

    const item = this.accounts().find((account) => account.username === username);
    if (!item?.id) return;

    this.userApi
      .restore(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.accounts.update((items) =>
            items.map((account) =>
              account.username === username ? { ...account, active: true } : account,
            ),
          );
          this.statusMessageState.show('已復用帳號。');
        },
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  // ----- Modal 通用邏輯 -----

  openModal(type: Exclude<ReturnType<typeof this.modal>, null>, campaign = ''): void {
    this.selectedCampaign.set(campaign);
    this.modal.set(type);
  }

  closeModal(): void {
    this.modal.set(null);
    this.draftName.set('');
    this.draftKeywords.set('');
    this.draftUsername.set('');
    this.draftPassword.set('');
    this.draftTags.set([{ tag: '', matchTier: 'CORE' }]);
  }

  addTagRow(): void {
    this.draftTags.update((rows) => [...rows, { tag: '', matchTier: 'GENERAL' }]);
  }

  removeTagRow(index: number): void {
    this.draftTags.update((rows) => rows.filter((_, i) => i !== index));
  }

  saveModal(): void {
    const type = this.modal();

    if (this.useMockData) {
      this.saveModalMock(type);
      return;
    }
    this.saveModalReal(type);
  }

  private saveModalMock(type: ReturnType<typeof this.modal>): void {
    if (type === 'risk' && this.draftName().trim() && this.draftKeywords().trim()) {
      this.riskOptions.update((items) => [
        ...items,
        { id: null, name: this.draftName().trim(), keywords: this.draftKeywords().trim(), isSystemDefault: false },
      ]);
    } else if (type === 'productType' && this.draftName().trim()) {
      this.productTypes.update((items) => [
        ...items,
        { id: null, name: this.draftName().trim(), system: false, used: 0, active: true },
      ]);
    } else if (
      type === 'campaign' &&
      this.draftName().trim() &&
      this.draftStart() &&
      this.draftEnd() &&
      this.draftTags().some((row) => row.tag.trim())
    ) {
      const value: Partial<CampaignVM> = {
        name: this.draftName().trim(),
        category: this.draftCategory(),
        categoryLabel: this.draftCategory() === 'FESTIVAL' ? '🎊 節慶' : '🍂 季節',
        range: `${this.draftStart()}–${this.draftEnd()}`,
        status: 'UPCOMING',
        override: false,
        tags: this.draftTags().filter((t) => t.tag.trim()),
      };
      this.campaigns.update((items) =>
        this.selectedCampaign()
          ? items.map((item) => (item.name === this.selectedCampaign() ? { ...item, ...value } : item))
          : [...items, { id: null, code: '', ...value } as CampaignVM],
      );
    } else if (
      type === 'account' &&
      this.draftUsername().trim() &&
      this.draftName().trim() &&
      this.draftPassword().trim()
    ) {
      this.accounts.update((items) => [
        ...items,
        {
          id: null,
          username: this.draftUsername().trim(),
          name: this.draftName().trim(),
          role: this.draftRole(),
          active: true,
        },
      ]);
    } else {
      this.statusMessageState.show('請完整填寫必填欄位。');
      return;
    }
    this.statusMessageState.show('已儲存至本地 Mock 狀態。');
    this.closeModal();
  }

  private saveModalReal(type: ReturnType<typeof this.modal>): void {
    if (type === 'risk') {
      if (!this.draftName().trim() || !this.draftKeywords().trim()) {
        this.statusMessageState.show('請完整填寫必填欄位。');
        return;
      }
      this.api
        .createRiskOption({ name: this.draftName().trim(), alertKeywords: this.draftKeywords().trim() })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created) => {
            this.riskOptions.update((items) => [...items, toRiskOptionVM(created)]);
            this.riskOptionLookup.invalidate();
            this.statusMessageState.show('已新增風險選項，審核頁勾選清單即時生效。');
            this.closeModal();
          },
          error: (err) => this.statusMessageState.show(toApiError(err).message),
        });
      return;
    }

    if (type === 'productType') {
      if (!this.draftName().trim()) {
        this.statusMessageState.show('請輸入類型名稱。');
        return;
      }
      this.api
        .createProductType({ name: this.draftName().trim() })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created) => {
            this.productTypes.update((items) => [
              ...items,
              { id: created.id, name: created.name, system: false, used: null, active: true },
            ]);
            this.productTypeLookup.invalidate();
            this.statusMessageState.show('已新增商品類型。');
            this.closeModal();
          },
          error: (err) => this.statusMessageState.show(toApiError(err).message),
        });
      return;
    }

    if (type === 'account') {
      if (!this.draftUsername().trim() || !this.draftName().trim() || this.draftPassword().trim().length < 8) {
        this.statusMessageState.show('請完整填寫必填欄位，密碼至少 8 碼。');
        return;
      }
      this.userApi
        .create({
          username: this.draftUsername().trim(),
          name: this.draftName().trim(),
          role: this.draftRole(),
          password: this.draftPassword(),
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created) => {
            this.accounts.update((items) => [...items, toAccountVM(created)]);
            this.statusMessageState.show('已新增帳號。');
            this.closeModal();
          },
          error: (err) => {
            // username 重複時後端回 400，直接顯示訊息，讓使用者知道要換一個帳號名。
            this.statusMessageState.show(toApiError(err).message);
          },
        });
      return;
    }

    if (type === 'campaign') {
      if (
        !this.draftName().trim() ||
        !this.draftStart() ||
        !this.draftEnd() ||
        !this.draftTags().some((row) => row.tag.trim())
      ) {
        this.statusMessageState.show('請完整填寫必填欄位，並至少輸入一個標籤。');
        return;
      }
      const tags = this.draftTags()
        .filter((row) => row.tag.trim())
        .map((row) => ({ tag: joinCampaignTags([row.tag.trim()]), matchTier: row.matchTier }));

      const existing = this.campaigns().find((item) => item.name === this.selectedCampaign());

      if (existing?.id) {
        this.api
          .updateFestiveCampaign(existing.id, {
            campaignName: this.draftName().trim(),
            category: this.draftCategory(),
            startDate: this.draftStart(),
            endDate: this.draftEnd(),
            preparationLeadDays: this.draftLeadDays(),
            tags,
          })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (updated) => {
              this.campaigns.update((items) =>
                items.map((item) => (item.id === existing.id ? toCampaignVM(updated) : item)),
              );
              this.statusMessageState.show('已更新檔期。');
              this.closeModal();
            },
            error: (err) => this.statusMessageState.show(toApiError(err).message),
          });
      } else {
        this.statusMessageState.show(
          '新增檔期需要唯一的檔期代碼（campaignCode），此畫面尚未提供輸入欄位，' +
            '請洽開發團隊補上欄位後再新增，目前僅支援編輯既有檔期。',
        );
      }
      return;
    }
  }

  applyCampaignStatus(): void {
    const target = this.campaigns().find((item) => item.name === this.selectedCampaign());
    if (!target) return;

    if (this.useMockData) {
      this.campaigns.update((items) =>
        items.map((item) =>
          item.name === this.selectedCampaign()
            ? { ...item, status: this.draftStatus(), override: true }
            : item,
        ),
      );
      this.modal.set(null);
      return;
    }

    if (!target.id) return;
    this.api
      .switchFestiveCampaignStatus(target.id, {
        status: this.draftStatus() as 'UPCOMING' | 'PREPARING' | 'ACTIVE' | 'EXPIRED',
        overrideEnabled: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.campaigns.update((items) =>
            items.map((item) => (item.id === updated.id ? toCampaignVM(updated) : item)),
          );
          this.statusMessageState.show('已手動切換檔期狀態。');
          this.modal.set(null);
        },
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  // ----- UI 狀態切換器（Mock 模式展示用）-----

  setState(state: SettingsState): void {
    this.pageState.set(state);
    if (state === 'disabled') this.form.disable();
    else this.form.enable();
    this.statusMessageState.show(`已切換為 ${state} 狀態。`);
  }

  retry(): void {
    this.pageState.set('default');
    this.form.enable();
    if (this.useMockData) {
      this.statusMessageState.show('設定資料已恢復。');
      return;
    }
    this.loadTab(this.activeTab());
  }

  fieldInvalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  ageRangeInvalid(): boolean {
    return this.form.controls.ageMin.value > this.form.controls.ageMax.value;
  }
}

// =========================================================================
// Payload → View Model 轉換（純函式，元件外層方便測試）
// =========================================================================

function toRiskOptionVM(payload: RiskOptionResponsePayload): RiskOptionVM {
  return {
    id: payload.id,
    name: payload.name,
    // GET 端點沒有 alertKeywords，誠實顯示未提供，不去猜測內容。
    keywords: NOT_PROVIDED,
    isSystemDefault: payload.isSystemDefault ?? false,
  };
}

function toCampaignVM(payload: {
  id: number;
  campaignCode: string;
  campaignName: string;
  category: FestiveCategory;
  startDate: string;
  endDate: string;
  campaignStatus: string;
  isManualOverride: boolean | null;
  tags: FestiveCampaignTagPayload[];
}): CampaignVM {
  return {
    id: payload.id,
    code: payload.campaignCode,
    name: payload.campaignName,
    category: payload.category,
    categoryLabel: payload.category === 'FESTIVAL' ? '🎊 節慶' : '🍂 季節',
    range: `${payload.startDate}–${payload.endDate}`,
    status: payload.campaignStatus,
    override: payload.isManualOverride ?? false,
    tags: payload.tags ?? [],
  };
}

function toAccountVM(payload: UserAccountResponsePayload): AccountVM {
  return {
    id: payload.id,
    username: payload.username,
    name: payload.name,
    role: payload.role,
    active: payload.enabled ?? true,
  };
}

/** 後端 keywords 可能用逗號、頓號或空白混雜分隔，統一轉成頓號顯示比較符合中文閱讀習慣。 */
function joinKeywordsForDisplay(keywords: string | null): string {
  if (!keywords) return '';
  return splitKeywords(keywords).join('、');
}
