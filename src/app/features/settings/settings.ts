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
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { DialogService } from '../../core/dialog/dialog.service';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { FestiveCategory, UserRole } from '../../core/domain/enums';
import { joinCampaignTags, splitKeywords } from '../../core/domain/labels';
import { ProductTypeLookupService } from './api/product-type-lookup.service';
import { RiskOptionLookupService } from './api/risk-option-lookup.service';
import {
  FestiveCampaignTagPayload,
  ProductTypeScoreBandCreateRequestPayload,
  ProductTypeScoreBandResponsePayload,
  RiskOptionResponsePayload,
  ScoreBandSourceMode,
} from './api/settings-api.contract';
import { SettingsApiService } from './api/settings-api.service';
import { UserApiService } from '../user-management/api/user-api.service';
import { UserAccountResponsePayload } from '../user-management/api/user-api.contract';
import { WeightFactorPayload } from '../product-management/api/product-api.contract';

type SettingsState = 'default' | 'disabled' | 'loading' | 'error';
type SettingsTab =
  | 'modes'
  | 'risks'
  | 'audience'
  | 'productTypes'
  | 'campaigns'
  | 'accounts'
  | 'scoreBands'
  | 'systemSettings';

interface EvaluationModeVM {
  id: number | null;
  code: string;
  name: string;
  description: string;
  /** 真實模式載入中或載入失敗時為 null，畫面顯示「載入中」而非假權重。 */
  weights: { business: number; audience: number; history: number; forecast: number } | null;
  /** 七個因子的原始權重，供權重編輯器使用；四象限彙總（weights）僅供卡片顯示。 */
  rawFactors: WeightFactorPayload[] | null;
  /** 只有 CUSTOM 模式為 true。三套固定模式後端會拒絕修改，此欄位決定要不要顯示編輯入口。 */
  isEditable: boolean;
}

/**
 * 七個評分因子的中文顯示名稱。
 *
 * 對應後端 constants/FactorCode.java 的 ALL 清單。後端只回 factorCode
 * （英文代碼）與 category（畫面分組用），中文名稱前端自行維護對照表——
 * 跟 role 顯示文案走同一套模式（後端不外露中文，見 auth.contract.ts）。
 */
const FACTOR_LABEL: Record<string, string> = {
  MARGIN_RATE: '毛利率',
  DISCOUNT_DEPTH: '折扣深度',
  SUPPLY_STABILITY: '供應穩定性',
  AUDIENCE_MATCH: '核心客群匹配度',
  HISTORY_FULFILLMENT: '歷史成團率',
  PURCHASE_RATE: '預估購買率',
  TREND_HEAT: '市場趨勢熱度',
};

/** 後端 FactorCode.ALL 的順序，畫面上的權重編輯器沿用同一順序，避免每次渲染順序跳動。 */
const FACTOR_ORDER: readonly string[] = [
  'MARGIN_RATE',
  'DISCOUNT_DEPTH',
  'SUPPLY_STABILITY',
  'AUDIENCE_MATCH',
  'HISTORY_FULFILLMENT',
  'PURCHASE_RATE',
  'TREND_HEAT',
];

/**
 * 目標區間（product_type_score_bands）的顯示模型。
 *
 * ⚠️ productTypeId 為 null 代表全域預設，套用到所有沒有專屬設定的品類。
 */
interface SystemSettingVM {
  key: string;
  category: string;
  displayName: string;
  description: string;
  dataType: 'INTEGER' | 'DECIMAL' | 'STRING';
  minValue: number | null;
  maxValue: number | null;
  unit: string | null;
  value: string;
  hasStoredValue: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

interface ScoreBandVM {
  id: number;
  productTypeId: number | null;
  productTypeName: string;
  factorCode: string;
  factorLabel: string;
  lowerBound: number;
  upperBound: number;
  sourceMode: ScoreBandSourceMode;
  sampleSize: number | null;
  computedAt: string | null;
}

interface RiskOptionVM {
  id: number | null;
  name: string;
  keywords: string;
  isSystemDefault: boolean;
}

interface ProductTypeVM {
  id: number | null;
  name: string;
  system: boolean;
  used: number;
  active: boolean;
  /** 兩層階層：1=大類、2=小類，null 代表舊資料或載入失敗時的降級狀態。 */
  parentId: number | null;
  level: number | null;
}

/** 設定頁品類管理列表的顯示分組：大類本身＋底下的小類清單。 */
interface ProductTypeGroupVM {
  major: ProductTypeVM;
  minors: ProductTypeVM[];
}

/**
 * 節慶檔期的四個生命週期狀態，原本畫面上（清單顯示跟手動切換的下拉
 * 選單）都直接顯示這四個英文代碼給使用者看，沒有經過任何中文轉換。
 */
const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  UPCOMING: '即將開始',
  PREPARING: '準備期',
  ACTIVE: '進行中',
  EXPIRED: '已結束',
};

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

/** 固定三套模式的展示殼；真實模式的 weights 另外呼叫 factors 端點補上。 */
const MODE_SHELLS: readonly { code: string; name: string; description: string }[] = [
  { code: 'BALANCED', name: '均衡模式', description: '商業條件、客群、歷史與預測各佔四分之一。' },
  { code: 'VOLUME', name: '衝量模式', description: '優先考量客群匹配與預測人氣。' },
  { code: 'PROFIT', name: '高利潤模式', description: '提高商業條件權重，同時保留人氣預測。' },
];

/** Mock 版的七因子明細，四套模式（含 CUSTOM）都要有，供權重編輯器 demo 用。 */
function mockRawFactors(business: number, audience: number, history: number, forecast: number) {
  return FACTOR_ORDER.map((factorCode): WeightFactorPayload => {
    const category = ['MARGIN_RATE', 'DISCOUNT_DEPTH', 'SUPPLY_STABILITY'].includes(factorCode)
      ? 'BUSINESS'
      : factorCode === 'AUDIENCE_MATCH'
        ? 'AUDIENCE'
        : factorCode === 'HISTORY_FULFILLMENT'
          ? 'HISTORY'
          : 'FORECAST';
    const groupTotal =
      category === 'BUSINESS' ? business : category === 'AUDIENCE' ? audience : category === 'HISTORY' ? history : forecast;
    const groupSize =
      category === 'BUSINESS' ? 3 : category === 'FORECAST' ? 2 : 1;
    return { factorCode, factorName: FACTOR_LABEL[factorCode], category, weight: Math.round((groupTotal / groupSize) * 100) / 100 };
  });
}

const MOCK_MODES: readonly EvaluationModeVM[] = [
  {
    id: 1,
    ...MODE_SHELLS[0],
    weights: { business: 25, audience: 25, history: 25, forecast: 25 },
    rawFactors: mockRawFactors(25, 25, 25, 25),
    isEditable: false,
  },
  {
    id: 2,
    ...MODE_SHELLS[1],
    weights: { business: 15, audience: 30, history: 15, forecast: 40 },
    rawFactors: mockRawFactors(15, 30, 15, 40),
    isEditable: false,
  },
  {
    id: 3,
    ...MODE_SHELLS[2],
    weights: { business: 45, audience: 15, history: 15, forecast: 25 },
    rawFactors: mockRawFactors(45, 15, 15, 25),
    isEditable: false,
  },
  {
    id: 4,
    code: 'CUSTOM',
    name: '自訂模式',
    description: '主管可自行調整七項因子權重，用於實驗性的選品策略。',
    weights: { business: 25, audience: 25, history: 25, forecast: 25 },
    rawFactors: mockRawFactors(25, 25, 25, 25),
    isEditable: true,
  },
];

const MOCK_SYSTEM_SETTINGS: readonly SystemSettingVM[] = [
  {
    key: 'shrinkage_k_category',
    category: '貝氏收縮',
    displayName: '品類層平滑常數 k',
    description: '要累積多少筆樣本，品類才會被信任一半以上；數字越大，愈需要更多樣本才會偏離全域平均。',
    dataType: 'INTEGER',
    minValue: 1,
    maxValue: 100,
    unit: '次',
    value: '10',
    hasStoredValue: true,
    updatedAt: '2025-01-05T10:00:00',
    updatedByName: '林建宏',
  },
  {
    key: 'shrinkage_k_product',
    category: '貝氏收縮',
    displayName: '商品層平滑常數 k',
    description: '同上，但作用在單一商品自己的歷史上。建議小於品類層 k，否則商品層永遠不會真正發揮作用。',
    dataType: 'INTEGER',
    minValue: 1,
    maxValue: 100,
    unit: '次',
    value: '5',
    hasStoredValue: true,
    updatedAt: '2025-01-05T10:00:00',
    updatedByName: '林建宏',
  },
  {
    key: 'trend_half_life_days',
    category: '趨勢分析',
    displayName: '趨勢新鮮度半衰期',
    description: '趨勢訊號的影響力衰減一半所需的天數，數字越小系統對最新資料的反應越敏感、越快忘記舊資料。',
    dataType: 'INTEGER',
    minValue: 1,
    maxValue: 365,
    unit: '天',
    value: '14',
    hasStoredValue: true,
    updatedAt: '2025-01-05T10:00:00',
    updatedByName: '林建宏',
  },
  {
    key: 'score_band_min_sample_size',
    category: '目標區間',
    displayName: '歷史模式最低樣本數',
    description: '切換目標區間為 HISTORICAL 模式時，低於這個樣本數會直接拒絕計算，改請使用 MANUAL 模式。',
    dataType: 'INTEGER',
    minValue: 1,
    maxValue: 1000,
    unit: '筆',
    value: '5',
    hasStoredValue: false,
    updatedAt: null,
    updatedByName: null,
  },
];

const MOCK_SCORE_BANDS: readonly ScoreBandVM[] = [
  {
    id: 1,
    productTypeId: null,
    productTypeName: '全域預設',
    factorCode: 'DISCOUNT_DEPTH',
    factorLabel: FACTOR_LABEL['DISCOUNT_DEPTH'],
    lowerBound: 0,
    upperBound: 0.5,
    sourceMode: 'MANUAL',
    sampleSize: null,
    computedAt: null,
  },
  {
    id: 2,
    productTypeId: null,
    productTypeName: '全域預設',
    factorCode: 'MARGIN_RATE',
    factorLabel: FACTOR_LABEL['MARGIN_RATE'],
    lowerBound: 0,
    upperBound: 0.4,
    sourceMode: 'MANUAL',
    sampleSize: null,
    computedAt: null,
  },
];

const MOCK_RISK_OPTIONS: readonly RiskOptionVM[] = [
  { id: 1, name: '實際供貨風險', keywords: '缺貨、延遲、供貨不穩', isSystemDefault: true },
  { id: 2, name: '商品品質與客訴風險', keywords: '瑕疵、過敏、客訴', isSystemDefault: true },
  { id: 3, name: '市場不確定性與需求變動風險', keywords: '熱度下降、需求波動、競品', isSystemDefault: true },
];

const MOCK_PRODUCT_TYPES: readonly ProductTypeVM[] = [
  { id: 100, name: '食品', system: true, used: 0, active: true, parentId: null, level: 1 },
  { id: 1, name: '食品／生鮮', system: true, used: 12, active: true, parentId: 100, level: 2 },
  { id: 9, name: '食品／其他', system: true, used: 0, active: true, parentId: 100, level: 2 },
  { id: 200, name: '生活用品', system: true, used: 0, active: true, parentId: null, level: 1 },
  { id: 2, name: '日用品', system: true, used: 8, active: true, parentId: 200, level: 2 },
  { id: 4, name: '生活雜貨', system: true, used: 4, active: true, parentId: 200, level: 2 },
  { id: 7, name: '寢具家用', system: true, used: 2, active: true, parentId: 200, level: 2 },
  { id: 8, name: '精品禮盒', system: true, used: 1, active: true, parentId: 200, level: 2 },
  { id: 300, name: '時尚科技', system: true, used: 0, active: true, parentId: null, level: 1 },
  { id: 3, name: '3C／家電', system: true, used: 6, active: true, parentId: 300, level: 2 },
  { id: 5, name: '美妝保養', system: true, used: 3, active: true, parentId: 300, level: 2 },
  { id: 6, name: '服飾配件', system: true, used: 0, active: true, parentId: 300, level: 2 },
];

const MOCK_CAMPAIGNS: readonly CampaignVM[] = [
  {
    id: 1,
    code: 'MOON2026',
    name: '中秋節',
    category: 'FESTIVAL',
    categoryLabel: '節慶',
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
    categoryLabel: '節慶',
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
    categoryLabel: '季節',
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
  imports: [FormsModule, ReactiveFormsModule, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  readonly campaignStatusLabel = CAMPAIGN_STATUS_LABEL;
  private readonly api = inject(SettingsApiService);
  private readonly dialog = inject(DialogService);
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
  /**
   * 展開中的大類 id 集合。預設全部收合（id 不在集合裡＝收合），
   * 避免品類一多，畫面一開就是一長串攤平的小類清單。
   */
  readonly expandedMajorIds = signal<Set<number>>(new Set());
  readonly campaigns = signal<CampaignVM[]>(this.useMockData ? [...MOCK_CAMPAIGNS] : []);
  readonly accounts = signal<AccountVM[]>(this.useMockData ? [...MOCK_ACCOUNTS] : []);
  readonly scoreBands = signal<ScoreBandVM[]>(this.useMockData ? [...MOCK_SCORE_BANDS] : []);
  readonly systemSettings = signal<SystemSettingVM[]>(
    this.useMockData ? [...MOCK_SYSTEM_SETTINGS] : [],
  );

  /** 每個分頁是否已經載入過一次，避免切回去重複打 API。Mock 模式視為全部已載入。 */
  private readonly loadedTabs = new Set<SettingsTab>(this.useMockData ? (
    ['modes', 'risks', 'audience', 'productTypes', 'campaigns', 'accounts', 'scoreBands', 'systemSettings'] as const
  ) : []);

  readonly modal = signal<
    null | 'risk' | 'productType' | 'campaign' | 'campaignStatus' | 'account'
  >(null);
  readonly selectedCampaign = signal('');
  readonly draftName = signal('');
  readonly draftKeywords = signal('');

  /**
   * 人工風險選項的重新命名／關鍵字編輯——原本 updateRiskOption() 這支
   * API 早就存在（後端方法上的中文說明直接寫著「重新命名 & 關鍵字修改」），
   * 卻從來沒有被畫面呼叫過，整份設定頁只有「新增」，沒有「編輯」。
   *
   * null 代表目前是新增模式；有值代表正在編輯這個 id 的既有選項。
   */
  readonly editingRiskOptionId = signal<number | null>(null);

  /**
   * 關鍵字改用陣列＋逐一輸入的方式管理，畫面上呈現成一顆一顆可個別刪除
   * 的標籤（chip），不是一個逗號分隔的長字串塞進 textarea 讓使用者自己
   * 分段——那種寫法看不出「目前到底存了幾個關鍵字、各自是什麼」，
   * 編輯時也容易不小心打錯逗號位置把兩個關鍵字黏在一起。
   */
  readonly draftKeywordChips = signal<string[]>([]);
  readonly draftKeywordInput = signal('');

  /** Enter 送出目前輸入的文字，加進標籤清單；重複或空白不處理。 */
  addDraftKeyword(): void {
    const value = this.draftKeywordInput().trim();
    if (!value) return;
    if (this.draftKeywordChips().includes(value)) {
      this.draftKeywordInput.set('');
      return;
    }
    this.draftKeywordChips.update((chips) => [...chips, value]);
    this.draftKeywordInput.set('');
  }

  removeDraftKeyword(index: number): void {
    this.draftKeywordChips.update((chips) => chips.filter((_, i) => i !== index));
  }

  /** 唯讀顯示用：把後端存的分隔字串拆回一顆一顆標籤。 */
  splitKeywords(raw: string): string[] {
    return raw
      .split(/[、,，]/)
      .map((k) => k.trim())
      .filter(Boolean);
  }
  readonly draftUsername = signal('');
  readonly draftRole = signal<UserRole>('PURCHASER');
  readonly draftPassword = signal('');
  readonly draftCategory = signal<FestiveCategory>('FESTIVAL');
  readonly draftStart = signal('');
  readonly draftEnd = signal('');
  readonly draftLeadDays = signal(30);
  /**
   * 新增檔期用的唯一代碼。原本這裡完全沒有輸入欄位——saveModal() 的
   * else 分支只留了一句「請洽開發團隊補上欄位」的錯誤訊息，等於新增
   * 節慶檔期這個功能從來沒有真正做完，使用者點下「新增檔期」按鈕，
   * 填完表單送出後只會看到這句提示，永遠新增不了。這裡補上真正缺的
   * 那個欄位，讓建立流程走得通。
   */
  readonly draftCampaignCode = signal('');
  readonly draftTags = signal<FestiveCampaignTagPayload[]>([{ tag: '', matchTier: 'CORE' }]);

  // ----- 節慶標籤選擇（獨立 dialog，搜尋 + 複選勾選）-----
  // 原本的標籤編輯是每一列自由輸入文字＋選等級，容易打錯字（跟其他檔期
  // 已經在用的標籤名稱不一致，AI 比對命中率就會受影響），也沒辦法一眼
  //看出系統裡已經有哪些標籤在用。改成搜尋＋勾選既有標籤為主，等級歸類
  // 屬於進階設定，不放在第一層互動裡。
  readonly tagPickerOpen = signal(false);
  readonly tagPickerSearch = signal('');
  readonly tagPickerSelected = signal<Set<string>>(new Set());

  /** 全站目前所有檔期用過的標籤，去重排序——不是憑空編造的固定清單。 */
  readonly knownTags = computed(() =>
    [...new Set(this.campaigns().flatMap((c) => c.tags.map((t) => t.tag).filter(Boolean)))].sort(),
  );

  readonly filteredKnownTags = computed(() => {
    const keyword = this.tagPickerSearch().trim().toLocaleLowerCase('zh-Hant');
    if (!keyword) return this.knownTags();
    return this.knownTags().filter((t) => t.toLocaleLowerCase('zh-Hant').includes(keyword));
  });

  /** 搜尋文字本身不在已知清單裡時，允許直接新增這個新標籤。 */
  readonly canAddNewTag = computed(() => {
    const keyword = this.tagPickerSearch().trim();
    return !!keyword && !this.knownTags().includes(keyword);
  });

  /** 目前草稿裡實際有效（非空字串）的標籤數量，供「已選 N 項」跟顯示邏輯共用判斷。 */
  readonly selectedTagRows = computed(() => this.draftTags().filter((r) => r.tag));

  openTagPicker(): void {
    this.tagPickerSelected.set(new Set(this.draftTags().map((r) => r.tag).filter(Boolean)));
    this.tagPickerSearch.set('');
    this.tagPickerOpen.set(true);
  }

  closeTagPicker(): void {
    this.tagPickerOpen.set(false);
  }

  toggleTagPickerSelection(tag: string): void {
    this.tagPickerSelected.update((set) => {
      const next = new Set(set);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  addNewTagFromSearch(): void {
    const tag = this.tagPickerSearch().trim();
    if (!tag) return;
    this.tagPickerSelected.update((set) => new Set(set).add(tag));
    this.tagPickerSearch.set('');
  }

  /**
   * 確認選擇：新勾選的標籤預設等級為「一般」（GENERAL）——等級歸類是
   * 進階設定，第一次選標籤時不該強迫使用者馬上決定；已經存在的標籤
   * 維持原本設定過的等級，不會因為重新打開這個 dialog 就被重置。
   */
  confirmTagPicker(): void {
    const selected = this.tagPickerSelected();
    const existing = new Map(this.draftTags().map((r) => [r.tag, r.matchTier]));
    const merged: FestiveCampaignTagPayload[] = [...selected].map((tag) => ({
      tag,
      matchTier: existing.get(tag) ?? 'GENERAL',
    }));
    this.draftTags.set(merged.length > 0 ? merged : [{ tag: '', matchTier: 'CORE' }]);
    this.tagPickerOpen.set(false);
  }
  readonly draftStatus = signal('ACTIVE');
  /**
   * 「手動切換狀態」modal 用：true＝手動指定狀態（is_manual_override 開啟），
   * false＝恢復自動判斷（is_manual_override 關閉）。原本這裡沒有反向路徑，
   * overrideEnabled 送出時永遠是 true，一旦手動覆蓋就再也回不去，
   * 這個 signal 補上「恢復自動判斷」這個選項。
   */
  readonly draftManualOverride = signal(true);
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
    // 切換分頁本身不需要提示訊息——分頁內容切換的視覺回饋已經很明顯
    // （分頁按鈕的 active 樣式、內容區塊整個換掉），額外跳一句「已切換
    // 設定分類」只是雜訊，不會幫助使用者理解發生了什麼事。
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
      case 'scoreBands':
        this.loadScoreBands();
        return;
      case 'systemSettings':
        this.loadSystemSettings();
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
            rawFactors: null,
            isEditable: mode.isEditable ?? false,
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
          this.modes.update((items) =>
            items.map((item) =>
              item.id === modeId
                ? { ...item, weights: aggregateWeightsByGroup(snapshot.factors), rawFactors: snapshot.factors }
                : item,
            ),
          );
        },
        // 單一模式的權重載入失敗，該卡片維持「載入中」而非讓整頁報錯。
        error: () => undefined,
      });
  }

  // ----- 權重編輯（僅 CUSTOM 模式）-----

  readonly editingWeightsModeId = signal<number | null>(null);
  readonly weightDrafts = signal<Record<string, number>>({});
  readonly isSavingWeights = signal(false);

  readonly factorOrder = FACTOR_ORDER;
  readonly factorLabel = FACTOR_LABEL;

  /** 目前草稿的加總。畫面即時顯示，但依決議只在送出時檢查、不擋輸入。 */
  readonly weightDraftTotal = computed(() =>
    Math.round(Object.values(this.weightDrafts()).reduce((sum, w) => sum + (w || 0), 0) * 100) / 100,
  );

  startEditWeights(mode: EvaluationModeVM): void {
    if (!mode.isEditable || !mode.rawFactors || mode.id === null) return;
    const drafts: Record<string, number> = {};
    mode.rawFactors.forEach((f) => {
      drafts[f.factorCode] = f.weight ?? 0;
    });
    this.weightDrafts.set(drafts);
    this.editingWeightsModeId.set(mode.id);
  }

  cancelEditWeights(): void {
    this.editingWeightsModeId.set(null);
    this.weightDrafts.set({});
  }

  updateWeightDraft(factorCode: string, value: number): void {
    this.weightDrafts.update((drafts) => ({ ...drafts, [factorCode]: value }));
  }

  /**
   * 送出權重編輯。依決議只在送出時檢查一次加總，不做輸入中即時擋。
   *
   * ⚠️ 整份覆蓋：後端 EvaluationFactorUpdateRequest 要求全部七個因子，
   * weightDrafts 由 startEditWeights() 一次帶入全部七項，這裡不會遺漏。
   */
  saveWeights(): void {
    const modeId = this.editingWeightsModeId();
    if (modeId === null || this.isSavingWeights()) return;

    const total = this.weightDraftTotal();
    if (Math.abs(total - 100) > 0.01) {
      this.statusMessageState.show(`七項權重加總須為 100，目前為 ${total}，請調整後再送出。`);
      return;
    }

    const factors = this.factorOrder.map((factorCode) => ({
      factorCode,
      weight: this.weightDrafts()[factorCode] ?? 0,
    }));

    if (this.useMockData) {
      this.modes.update((items) =>
        items.map((item) =>
          item.id === modeId && item.rawFactors
            ? {
                ...item,
                rawFactors: item.rawFactors.map((f) => ({
                  ...f,
                  weight: this.weightDrafts()[f.factorCode] ?? f.weight,
                })),
                weights: aggregateWeightsByGroup(
                  item.rawFactors.map((f) => ({ ...f, weight: this.weightDrafts()[f.factorCode] ?? f.weight })),
                ),
              }
            : item,
        ),
      );
      this.cancelEditWeights();
      this.statusMessageState.show('已更新本地 Mock 權重。');
      return;
    }

    this.isSavingWeights.set(true);
    this.api
      .updateEvaluationModeFactors(modeId, { factors })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          this.modes.update((items) =>
            items.map((item) =>
              item.id === modeId
                ? { ...item, weights: aggregateWeightsByGroup(snapshot.factors), rawFactors: snapshot.factors }
                : item,
            ),
          );
          this.isSavingWeights.set(false);
          this.cancelEditWeights();
          this.statusMessageState.show(
            '權重已更新。本次調整僅影響之後新送審的商品，已完成審核的紀錄不會變動。',
          );
        },
        error: (err) => {
          this.isSavingWeights.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
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
              used: item.usedCount,
              active: item.isActive ?? true,
              parentId: item.parentId,
              level: item.level,
            })),
          );
          this.markLoaded('productTypes');
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  /**
   * 依大類分組，畫面用這個結構呈現「大類底下有哪些小類」，不要再把
   * 大類跟小類攤平顯示在同一條清單裡。
   *
   * level 為 null（理論上不會發生，除非後端回應格式異常）的項目不會
   * 出現在任何分組裡——寧可讓這種異常資料在畫面上「消失不見」，也不要
   * 因為型別防呆不足而讓它被誤判成大類或小類、跑進不該出現的分組。
   */
  readonly productTypeGroups = computed<ProductTypeGroupVM[]>(() => {
    const all = this.productTypes();
    const majors = all.filter((t) => t.level === 1);
    const minorsByParent = new Map<number, ProductTypeVM[]>();
    for (const t of all) {
      if (t.level !== 2 || t.parentId === null) continue;
      const arr = minorsByParent.get(t.parentId) ?? [];
      arr.push(t);
      minorsByParent.set(t.parentId, arr);
    }
    return majors.map((major) => ({
      major,
      minors: minorsByParent.get(major.id ?? -1) ?? [],
    }));
  });

  /** 該大類目前是否展開。id 為 null（異常資料）一律視為收合。 */
  isProductTypeGroupExpanded(majorId: number | null): boolean {
    return majorId !== null && this.expandedMajorIds().has(majorId);
  }

  /** 切換單一大類的展開／收合狀態。 */
  toggleProductTypeGroup(majorId: number | null): void {
    if (majorId === null) return;
    this.expandedMajorIds.update((current) => {
      const next = new Set(current);
      if (next.has(majorId)) {
        next.delete(majorId);
      } else {
        next.add(majorId);
      }
      return next;
    });
  }

  /**
   * 刪除是不可復原的破壞性操作——這是真正的 DELETE，不是像帳號／風險選項
   * 那種可以復用的停用。原本這裡按下按鈕就立刻呼叫 API，中間沒有任何
   * 確認步驟；查證整份檔案後發現這是全站唯一一個真正刪除資料、卻完全
   * 沒有確認機制的操作，補上確認框，訊息裡明確寫出要刪除的品類名稱，
   * 不是泛用的「確定要刪除嗎？」。
   */
  removeProductType(name: string): void {
    const item = this.productTypes().find((type) => type.name === name);
    if (!item) return;

    this.dialog
      .confirm(
        '確認刪除商品類型',
        [
          `即將永久刪除「${name}」，此操作無法復原。`,
          '若這個類型已經被任何品項使用，刪除會被拒絕，請改用「停用」。',
        ],
        '確定刪除',
        '取消',
      )
      .subscribe((confirmed) => {
        if (confirmed) this.performRemoveProductType(name, item);
      });
  }

  /**
   * 人工風險選項停用——原本這裡完全沒有任何停用機制，API 早就存在
   * （後端方法上的中文說明直接寫著「復用」，代表停用/復用本來就是
   * 一組對稱的功能），只是從沒接上畫面。
   *
   * ⚠️ 跟商品類型的停用/復用不同：這裡只做得到「停用」，做不到「復用」——
   * GET /api/settings/risk-options 這支端點本身只回傳啟用中的選項
   * （WHERE is_active=true），停用後這筆資料會直接從清單消失，沒有
   * 任何畫面看得到已停用的選項，自然也無從點擊復用。這是資料可見性
   * 本身的既有限制，不是這次能一併解決的，用確認框明確告知這個後果，
   * 不要讓使用者在不知情的狀況下弄丟一個選項的可見性。
   */
  disableRiskOptionRow(item: RiskOptionVM): void {
    this.dialog
      .confirm(
        '確認停用風險選項',
        [
          `即將停用「${item.name}」。`,
          '⚠️ 停用後這個選項會從清單消失，目前沒有畫面可以看到已停用的選項、也無法從這裡復用，請確認這是你要的結果。',
        ],
        '確定停用',
        '取消',
      )
      .subscribe((confirmed) => {
        if (!confirmed) return;
        if (this.useMockData) {
          this.riskOptions.update((items) => items.filter((r) => r.id !== item.id));
          this.statusMessageState.show(`已在本地模擬停用「${item.name}」。`);
          return;
        }
        if (!item.id) return;
        this.api
          .disableRiskOption(item.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.riskOptions.update((items) => items.filter((r) => r.id !== item.id));
              this.riskOptionLookup.invalidate();
              this.statusMessageState.show(`已停用「${item.name}」。`);
            },
            error: (err) => this.statusMessageState.show(toApiError(err).message),
          });
      });
  }

  private performRemoveProductType(name: string, item: ProductTypeVM): void {
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

  // ----- 目標區間（全域預設 + 各商品類型覆寫）-----

  private loadScoreBands(): void {
    this.api
      .getProductTypeScoreBands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          // 品類名稱要另外查——ProductTypeScoreBandResponse 只有 productTypeId，
          // 跟商品清單頁同一個陷阱，沿用既有的 ProductTypeLookupService 避免 N+1。
          this.productTypeLookup
            .getNameMap()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((nameById) => {
              this.scoreBands.set(list.map((band) => toScoreBandVM(band, nameById)));
              this.markLoaded('scoreBands');
            });
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  // ----- 8. 系統設定（演算法參數）-----

  private loadSystemSettings(): void {
    this.api
      .getSystemSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.systemSettings.set(
            list.map((s) => ({
              key: s.key,
              category: s.category,
              displayName: s.displayName,
              description: s.description,
              dataType: s.dataType,
              minValue: s.minValue === null ? null : Number(s.minValue),
              maxValue: s.maxValue === null ? null : Number(s.maxValue),
              unit: s.unit,
              value: s.value,
              hasStoredValue: s.hasStoredValue,
              updatedAt: s.updatedAt,
              updatedByName: s.updatedByName,
            })),
          );
          this.markLoaded('systemSettings');
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  /**
   * 依 category 分組，畫面依此分區塊顯示（貝氏收縮／趨勢分析／MOQ判定／
   * 效期判定／溫層判定／運費估算／目標區間），不要把 17 項全部攤平在
   * 同一長串清單裡，那樣使用者很難找到自己要調整的那一項。
   */
  readonly systemSettingsByCategory = computed(() => {
    const groups = new Map<string, SystemSettingVM[]>();
    for (const s of this.systemSettings()) {
      const arr = groups.get(s.category) ?? [];
      arr.push(s);
      groups.set(s.category, arr);
    }
    return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
  });

  readonly editingSystemSettingKey = signal<string | null>(null);
  readonly systemSettingDraftValue = signal('');
  readonly isSavingSystemSetting = signal(false);

  openSystemSettingEditor(setting: SystemSettingVM): void {
    this.editingSystemSettingKey.set(setting.key);
    this.systemSettingDraftValue.set(setting.value);
  }

  cancelSystemSettingEdit(): void {
    this.editingSystemSettingKey.set(null);
  }

  /**
   * 送出前先做一次前端範圍檢查——不是為了取代後端驗證（後端一定會重新
   * 驗證一次，範圍規則的唯一真實來源在後端的 SystemSettingRegistry），
   * 純粹是避免使用者填了明顯超出範圍的值之後，還要等一趟網路來回才知道
   * 錯在哪裡。STRING 型別（目前只有 supported_temperature_zones）不做
   * 數值檢查，只確認非空。
   */
  saveSystemSetting(): void {
    const key = this.editingSystemSettingKey();
    if (key === null || this.isSavingSystemSetting()) return;

    const setting = this.systemSettings().find((s) => s.key === key);
    if (!setting) return;

    const raw = this.systemSettingDraftValue().trim();
    if (!raw) {
      this.statusMessageState.show('設定值不可為空。');
      return;
    }
    if (setting.dataType !== 'STRING') {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        this.statusMessageState.show(`${setting.displayName} 必須是數字。`);
        return;
      }
      if (setting.dataType === 'INTEGER' && !Number.isInteger(parsed)) {
        this.statusMessageState.show(`${setting.displayName} 必須是整數。`);
        return;
      }
      if (setting.minValue !== null && parsed < setting.minValue) {
        this.statusMessageState.show(`${setting.displayName} 不可小於 ${setting.minValue}。`);
        return;
      }
      if (setting.maxValue !== null && parsed > setting.maxValue) {
        this.statusMessageState.show(`${setting.displayName} 不可大於 ${setting.maxValue}。`);
        return;
      }
    }

    if (this.useMockData) {
      this.systemSettings.update((items) =>
        items.map((s) =>
          s.key === key
            ? { ...s, value: raw, hasStoredValue: true, updatedAt: new Date().toISOString() }
            : s,
        ),
      );
      this.cancelSystemSettingEdit();
      this.statusMessageState.show('已更新本地 Mock 設定值。');
      return;
    }

    this.isSavingSystemSetting.set(true);
    this.api
      .updateSystemSetting(key, { value: raw })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.systemSettings.update((items) =>
            items.map((s) =>
              s.key === key
                ? {
                    ...s,
                    value: updated.value,
                    hasStoredValue: updated.hasStoredValue,
                    updatedAt: updated.updatedAt,
                    updatedByName: updated.updatedByName,
                  }
                : s,
            ),
          );
          this.isSavingSystemSetting.set(false);
          this.cancelSystemSettingEdit();
          this.statusMessageState.show(`已更新「${setting.displayName}」。`);
        },
        error: (err) => {
          this.isSavingSystemSetting.set(false);
          // 後端範圍驗證失敗的錯誤訊息（例如「不可小於 1」）直接顯示，
          // 不重新組一份文字。
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  /** 全域預設（productTypeId 為 null）的列。 */
  readonly globalScoreBands = computed(() => this.scoreBands().filter((b) => b.productTypeId === null));

  /** 各商品類型覆寫的列。 */
  readonly overrideScoreBands = computed(() => this.scoreBands().filter((b) => b.productTypeId !== null));

  readonly editingScoreBandId = signal<number | null>(null);
  readonly scoreBandDraftMode = signal<ScoreBandSourceMode>('MANUAL');
  readonly scoreBandDraftLower = signal(0);
  readonly scoreBandDraftUpper = signal(0);
  readonly isSavingScoreBand = signal(false);

  /** 開始編輯一筆既有的目標區間（全域或品類覆寫皆可）。 */
  openScoreBandEditor(band: ScoreBandVM): void {
    this.editingScoreBandId.set(band.id);
    this.scoreBandDraftMode.set(band.sourceMode);
    this.scoreBandDraftLower.set(band.lowerBound);
    this.scoreBandDraftUpper.set(band.upperBound);
  }

  // ----- 新增品類專屬覆寫 -----

  readonly isCreatingScoreBand = signal(false);
  readonly newScoreBandProductTypeId = signal<number | null>(null);
  readonly newScoreBandFactorCode = signal<string>('MARGIN_RATE');
  readonly newScoreBandLower = signal(0);
  readonly newScoreBandUpper = signal(0);
  readonly isSavingNewScoreBand = signal(false);

  /**
   * 目標區間適用的因子代碼。後端 `applyHistoricalBand()` 只有 MARGIN_RATE／
   * DISCOUNT_DEPTH 有對應的歷史資料計算邏輯，但 MANUAL 模式（新增時唯一
   * 支援的模式）理論上七個因子都能設定固定區間。這裡先只開放已知會被
   * ScoreBandResolver／ScoringAlgorithms 用到的兩個，避免使用者建立一筆
   * 「因子代碼合法但評分邏輯從未讀取它」的死資料——目前只有這兩個因子
   * 的計分路徑（normalizeByBand）會查目標區間表，其餘五個因子用別的
   * 方式計分，不會讀這張表。
   */
  readonly scoreBandFactorOptions: readonly { code: string; label: string }[] = [
    { code: 'MARGIN_RATE', label: FACTOR_LABEL['MARGIN_RATE'] },
    { code: 'DISCOUNT_DEPTH', label: FACTOR_LABEL['DISCOUNT_DEPTH'] },
  ];

  openCreateScoreBand(): void {
    this.newScoreBandProductTypeId.set(null);
    this.newScoreBandFactorCode.set('MARGIN_RATE');
    this.newScoreBandLower.set(0);
    this.newScoreBandUpper.set(0);
    this.isCreatingScoreBand.set(true);
  }

  cancelCreateScoreBand(): void {
    this.isCreatingScoreBand.set(false);
  }

  /**
   * 新增品類專屬目標區間。⚠️ 只支援 MANUAL——與後端
   * ProductTypeScoreBandCreateRequest 的限制一致，見該檔案的類別註解。
   */
  createScoreBand(): void {
    if (this.isSavingNewScoreBand()) return;

    const productTypeId = this.newScoreBandProductTypeId();
    const factorCode = this.newScoreBandFactorCode();
    const lowerBound = this.newScoreBandLower();
    const upperBound = this.newScoreBandUpper();

    if (productTypeId === null) {
      this.statusMessageState.show('請選擇商品類型。');
      return;
    }
    if (upperBound <= lowerBound) {
      this.statusMessageState.show('上界必須大於下界。');
      return;
    }

    if (this.useMockData) {
      const typeName = this.productTypes().find((t) => t.id === productTypeId)?.name ?? '—';
      this.scoreBands.update((items) => [
        ...items,
        {
          id: Math.max(0, ...items.map((i) => i.id)) + 1,
          productTypeId,
          productTypeName: typeName,
          factorCode,
          factorLabel: FACTOR_LABEL[factorCode] ?? factorCode,
          lowerBound,
          upperBound,
          sourceMode: 'MANUAL',
          sampleSize: null,
          computedAt: null,
        },
      ]);
      this.cancelCreateScoreBand();
      this.statusMessageState.show('已新增本地 Mock 品類覆寫。');
      return;
    }

    const payload: ProductTypeScoreBandCreateRequestPayload = {
      productTypeId,
      factorCode,
      lowerBound,
      upperBound,
    };

    this.isSavingNewScoreBand.set(true);
    this.api
      .createProductTypeScoreBand(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.productTypeLookup
            .getNameMap()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((nameById) => {
              this.scoreBands.update((items) => [...items, toScoreBandVM(created, nameById)]);
              this.isSavingNewScoreBand.set(false);
              this.cancelCreateScoreBand();
              this.statusMessageState.show('已新增品類專屬目標區間。');
            });
        },
        error: (err) => {
          this.isSavingNewScoreBand.set(false);
          // 品類×因子已存在時後端回 400，訊息已包含「請改用編輯」的提示，原樣顯示即可。
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  cancelScoreBandEdit(): void {
    this.editingScoreBandId.set(null);
  }

  saveScoreBand(): void {
    const id = this.editingScoreBandId();
    if (id === null || this.isSavingScoreBand()) return;

    const sourceMode = this.scoreBandDraftMode();
    // HISTORICAL 模式下這兩個值會被後端忽略，這裡仍然送出目前草稿值也無妨，
    // 但不送更清楚表達「這兩個欄位在這個模式下不生效」。
    const payload =
      sourceMode === 'MANUAL'
        ? { sourceMode, lowerBound: this.scoreBandDraftLower(), upperBound: this.scoreBandDraftUpper() }
        : { sourceMode };

    if (this.useMockData) {
      this.scoreBands.update((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                sourceMode,
                lowerBound: sourceMode === 'MANUAL' ? this.scoreBandDraftLower() : item.lowerBound,
                upperBound: sourceMode === 'MANUAL' ? this.scoreBandDraftUpper() : item.upperBound,
              }
            : item,
        ),
      );
      this.cancelScoreBandEdit();
      this.statusMessageState.show('已更新本地 Mock 目標區間。');
      return;
    }

    this.isSavingScoreBand.set(true);
    this.api
      .updateProductTypeScoreBand(id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.productTypeLookup
            .getNameMap()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((nameById) => {
              this.scoreBands.update((items) =>
                items.map((item) => (item.id === id ? toScoreBandVM(updated, nameById) : item)),
              );
              this.isSavingScoreBand.set(false);
              this.cancelScoreBandEdit();
              this.statusMessageState.show('目標區間已更新。');
            });
        },
        error: (err) => {
          this.isSavingScoreBand.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  // ----- Modal 通用邏輯 -----

  openModal(type: Exclude<ReturnType<typeof this.modal>, null>, campaign = ''): void {
    this.selectedCampaign.set(campaign);
    this.modal.set(type);
  }

  /**
   * 開啟「手動切換狀態」modal：把該檔期目前的狀態回填進草稿，
   * 並預設為「手動指定狀態」——這是按鈕原本唯一支援的行為，
   * 「恢復自動判斷」是使用者在 modal 內再另外選的次要選項。
   */
  openCampaignStatusModal(item: CampaignVM): void {
    this.selectedCampaign.set(item.name);
    this.draftStatus.set(item.status);
    this.draftManualOverride.set(true);
    this.modal.set('campaignStatus');
  }

  /** 開啟風險選項編輯：把既有名稱與關鍵字回填進草稿狀態。 */
  openRiskEditModal(item: RiskOptionVM): void {
    this.editingRiskOptionId.set(item.id);
    this.draftName.set(item.name);
    this.draftKeywordChips.set(item.keywords ? this.splitKeywords(item.keywords) : []);
    this.draftKeywordInput.set('');
    this.modal.set('risk');
  }

  closeModal(): void {
    this.modal.set(null);
    this.draftName.set('');
    this.draftKeywords.set('');
    this.draftUsername.set('');
    this.draftPassword.set('');
    this.draftTags.set([{ tag: '', matchTier: 'CORE' }]);
    this.tagPickerSearch.set('');
    this.tagPickerSelected.set(new Set());
    this.editingRiskOptionId.set(null);
    this.draftKeywordChips.set([]);
    this.draftKeywordInput.set('');
    this.draftCampaignCode.set('');
    this.draftManualOverride.set(true);
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
    if (type === 'risk' && this.draftName().trim() && this.draftKeywordChips().length > 0) {
      const keywords = this.draftKeywordChips().join('、');
      const editingId = this.editingRiskOptionId();
      if (editingId !== null) {
        this.riskOptions.update((items) =>
          items.map((item) =>
            item.id === editingId ? { ...item, name: this.draftName().trim(), keywords } : item,
          ),
        );
      } else {
        this.riskOptions.update((items) => [
          ...items,
          { id: null, name: this.draftName().trim(), keywords, isSystemDefault: false },
        ]);
      }
    } else if (type === 'productType' && this.draftName().trim()) {
      this.productTypes.update((items) => [
        ...items,
        { id: null, name: this.draftName().trim(), system: false, used: 0, active: true, parentId: null, level: null },
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
        categoryLabel: this.draftCategory() === 'FESTIVAL' ? '節慶' : '季節',
        range: `${this.draftStart()}–${this.draftEnd()}`,
        status: 'UPCOMING',
        override: false,
        tags: this.draftTags().filter((t) => t.tag.trim()),
      };
      this.campaigns.update((items) =>
        this.selectedCampaign()
          ? items.map((item) => (item.name === this.selectedCampaign() ? { ...item, ...value } : item))
          : [...items, { id: null, code: this.draftCampaignCode().trim(), ...value } as CampaignVM],
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
      const keywords = this.draftKeywordChips().join('、');
      if (!this.draftName().trim() || this.draftKeywordChips().length === 0) {
        this.statusMessageState.show('請完整填寫必填欄位。');
        return;
      }

      const editingId = this.editingRiskOptionId();
      if (editingId !== null) {
        this.api
          .updateRiskOption(editingId, { name: this.draftName().trim(), alertKeywords: keywords })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (updated) => {
              this.riskOptions.update((items) =>
                items.map((item) => (item.id === editingId ? toRiskOptionVM(updated) : item)),
              );
              this.riskOptionLookup.invalidate();
              this.statusMessageState.show('已更新風險選項。');
              this.closeModal();
            },
            error: (err) => this.statusMessageState.show(toApiError(err).message),
          });
        return;
      }

      this.api
        .createRiskOption({ name: this.draftName().trim(), alertKeywords: keywords })
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
              { id: created.id, name: created.name, system: false, used: 0, active: true, parentId: created.parentId, level: created.level },
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
      const isCreating = !this.selectedCampaign();
      if (
        !this.draftName().trim() ||
        !this.draftStart() ||
        !this.draftEnd() ||
        !this.draftTags().some((row) => row.tag.trim()) ||
        (isCreating && !this.draftCampaignCode().trim())
      ) {
        this.statusMessageState.show(
          isCreating
            ? '請完整填寫必填欄位（含檔期代碼），並至少輸入一個標籤。'
            : '請完整填寫必填欄位，並至少輸入一個標籤。',
        );
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
        this.api
          .createFestiveCampaign({
            campaignCode: this.draftCampaignCode().trim(),
            campaignName: this.draftName().trim(),
            category: this.draftCategory(),
            startDate: this.draftStart(),
            endDate: this.draftEnd(),
            preparationLeadDays: this.draftLeadDays(),
            tags,
          })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (created) => {
              this.campaigns.update((items) => [...items, toCampaignVM(created)]);
              this.statusMessageState.show('已新增檔期。');
              this.closeModal();
            },
            error: (err) => this.statusMessageState.show(toApiError(err).message),
          });
      }
      return;
    }
  }

  /**
   * 手動切換檔期狀態，或恢復自動判斷。
   *
   * ⚠️ 恢復自動判斷時（draftManualOverride() === false）不送使用者在下拉選單
   * 上選的狀態，一律送 target 目前的狀態——「恢復自動判斷」的語意是關掉
   * is_manual_override 這個開關，不是順便再手動指定一次新狀態，這兩件事要
   * 分開，否則使用者會以為選了下拉選單的值也會一併生效。
   */
  applyCampaignStatus(): void {
    const target = this.campaigns().find((item) => item.name === this.selectedCampaign());
    if (!target) return;

    const overrideEnabled = this.draftManualOverride();
    const status = overrideEnabled ? this.draftStatus() : target.status;

    if (this.useMockData) {
      this.campaigns.update((items) =>
        items.map((item) =>
          item.name === this.selectedCampaign() ? { ...item, status, override: overrideEnabled } : item,
        ),
      );
      this.modal.set(null);
      return;
    }

    if (!target.id) return;
    this.api
      .switchFestiveCampaignStatus(target.id, {
        status: status as 'UPCOMING' | 'PREPARING' | 'ACTIVE' | 'EXPIRED',
        overrideEnabled,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.campaigns.update((items) =>
            items.map((item) => (item.id === updated.id ? toCampaignVM(updated) : item)),
          );
          this.statusMessageState.show(overrideEnabled ? '已手動切換檔期狀態。' : '已恢復自動判斷。');
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

/**
 * 依 category 加總七個因子的權重，還原成卡片顯示用的四象限彙總。
 *
 * ⚠️ 修正：舊版用 `.find()` 只取「第一個符合 category 的因子」的權重，
 * 但 BUSINESS 組有 3 個因子（MARGIN_RATE／DISCOUNT_DEPTH／SUPPLY_STABILITY）、
 * FORECAST 組有 2 個（PURCHASE_RATE／TREND_HEAT），find() 會漏掉其餘因子，
 * 導致卡片顯示的商業條件／預測人氣百分比比實際權重小很多。改用加總。
 */
function aggregateWeightsByGroup(
  factors: WeightFactorPayload[],
): { business: number; audience: number; history: number; forecast: number } {
  const sumOf = (category: string) =>
    Math.round(
      factors.filter((f) => f.category === category).reduce((sum, f) => sum + (f.weight ?? 0), 0) * 100,
    ) / 100;
  return {
    business: sumOf('BUSINESS'),
    audience: sumOf('AUDIENCE'),
    history: sumOf('HISTORY'),
    forecast: sumOf('FORECAST'),
  };
}

function toScoreBandVM(
  payload: ProductTypeScoreBandResponsePayload,
  productTypeNameById: Map<number, string>,
): ScoreBandVM {
  return {
    id: payload.id,
    productTypeId: payload.productTypeId,
    productTypeName:
      payload.productTypeId === null ? '全域預設' : productTypeNameById.get(payload.productTypeId) ?? '—',
    factorCode: payload.factorCode,
    factorLabel: FACTOR_LABEL[payload.factorCode] ?? payload.factorCode,
    lowerBound: payload.lowerBound ?? 0,
    upperBound: payload.upperBound ?? 0,
    sourceMode: payload.sourceMode,
    sampleSize: payload.sampleSize,
    computedAt: payload.computedAt,
  };
}

function toRiskOptionVM(payload: RiskOptionResponsePayload): RiskOptionVM {
  return {
    id: payload.id,
    name: payload.name,
    keywords: payload.alertKeywords ?? '',
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
    categoryLabel: payload.category === 'FESTIVAL' ? '節慶' : '季節',
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
