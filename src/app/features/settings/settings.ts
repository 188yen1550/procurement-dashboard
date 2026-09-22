/**
 * 檔案用途：管理評估模式、人工風險、核心客群、商品類型、檔期與帳號。
 * 真實模式按分頁延遲載入資料。帳號可停用或復用；商品類型能否刪除由後端
 * 驗證引用關係；檔期內容編輯與狀態切換使用不同操作。
 */
import { ListSort, SortHeader, SortRowsPipe, ListSortControls } from '../../shared/ui/list-sort';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { DialogService } from '../../core/dialog/dialog.service';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { FestiveCategory, TemperatureZone, TagMatchTier, UserRole, WeatherSignalType } from '../../core/domain/enums';
import {
  joinCampaignTags,
  splitKeywords,
  TEMPERATURE_ZONE_LABEL,
  WEATHER_FORECAST_CONFIDENCE_LABEL,
  WEATHER_REGION_LABEL,
  WEATHER_SIGNAL_TYPE_LABEL,
} from '../../core/domain/labels';
import { ProductTypeLookupService } from './api/product-type-lookup.service';
import { RiskOptionLookupService } from './api/risk-option-lookup.service';
import {
  CustomFieldDefinitionResponsePayload,
  CustomFieldType,
  FactorDataSource,
  FactorDefinitionResponsePayload,
  FactorStrategyCode,
  FestiveCampaignTagPayload,
  ProductTypeScoreBandCreateRequestPayload,
  ProductTypeScoreBandResponsePayload,
  RegionWeightPayload,
  RiskOptionResponsePayload,
  ScoreBandSourceMode,
  WeatherSignalPreviewPayload,
  WeatherSignalTagMappingResponsePayload,
} from './api/settings-api.contract';
import { SettingsApiService } from './api/settings-api.service';
import { UserApiService } from '../user-management/api/user-api.service';
import { UserAccountResponsePayload } from '../user-management/api/user-api.contract';
import { WeightFactorPayload } from '../product-management/api/product-api.contract';
import { Icon } from '../../shared/components/icon/icon';

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
  active: boolean;
  id: number | null;
  name: string;
  keywords: string;
  isSystemDefault: boolean;
}

/** 自訂計分因子的畫面顯示模型（2026-09-20新增，方案B；V14新增編輯所需欄位）。 */
interface FactorDefinitionVM {
  id: number;
  factorCode: string;
  factorName: string;
  category: string | null;
  strategyCode: FactorStrategyCode;
  dataSourceCode: FactorDataSource | null;
  customFieldDefinitionId: number | null;
  strategyParams: Record<string, number> | null;
  isActive: boolean;
  /** V14新增：已被新版本取代——true時隱藏「啟用」按鈕，只能看不能動。 */
  isSuperseded: boolean;
}

function toFactorDefinitionVM(payload: FactorDefinitionResponsePayload): FactorDefinitionVM {
  return {
    id: payload.id,
    factorCode: payload.factorCode,
    factorName: payload.factorName,
    category: payload.category,
    strategyCode: payload.strategyCode,
    dataSourceCode: payload.dataSourceCode,
    customFieldDefinitionId: payload.customFieldDefinitionId,
    strategyParams: payload.strategyParams,
    isActive: payload.isActive,
    isSuperseded: payload.isSuperseded,
  };
}

/** 自訂商品屬性（動態問卷）的畫面顯示模型（2026-09-20新增，Phase 1；V14新增編輯/分數說明欄位）。 */
interface CustomFieldDefinitionVM {
  id: number;
  fieldCode: string;
  fieldName: string;
  helpText: string | null;
  fieldType: CustomFieldType;
  isRequired: boolean;
  isActive: boolean;
  applicableRootProductTypeIds: number[];
  /** V14新增：僅fieldType='SCALE_1_5'時可能有值，key為'1'~'5'、value為說明文字。 */
  scaleLabels: Record<string, string> | null;
  /** V14新增：已被新版本取代——true時隱藏「啟用」按鈕，只能看不能動。 */
  isSuperseded: boolean;
}

function toCustomFieldDefinitionVM(payload: CustomFieldDefinitionResponsePayload): CustomFieldDefinitionVM {
  return {
    id: payload.id,
    fieldCode: payload.fieldCode,
    fieldName: payload.fieldName,
    helpText: payload.helpText,
    fieldType: payload.fieldType,
    isRequired: payload.isRequired,
    isActive: payload.isActive,
    applicableRootProductTypeIds: payload.applicableRootProductTypeIds,
    scaleLabels: payload.scaleLabels,
    isSuperseded: payload.isSuperseded,
  };
}

/** 1~5分數說明編輯表單用的固定五列結構，避免畫面直接操作稀疏的Record。 */
const SCALE_LABEL_KEYS: readonly string[] = ['1', '2', '3', '4', '5'];

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

/**
 * 天氣訊號標籤對照的「天氣類型」下拉選項，刻意排除 NORMAL——一般天氣不該
 * 命中任何商品（WeatherCampaignSyncService 既有規則），後端 SettingsService
 * 建立/編輯時也會拒絕 NORMAL，這裡不列出來，避免使用者選了才在送出後
 * 收到錯誤訊息。標籤文字沿用 WEATHER_SIGNAL_TYPE_LABEL，不在這裡重複維護
 * 一份文案。
 */
const WEATHER_SIGNAL_TAG_MAPPING_TYPE_OPTIONS: readonly WeatherSignalType[] = [
  'HOT',
  'HUMID_HOT',
  'HUMID',
  'RAINY',
  'HEAVY_RAIN',
  'STRONG_WIND',
  'COOL',
  'COLD',
  'DRY_COOL',
];

interface CampaignVM {
  id: number | null;
  code: string;
  name: string;
  category: FestiveCategory;
  categoryLabel: string;
  range: string;
  status: string;
  override: boolean;
  leadDays: number;
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
  { id: 1, name: '實際供貨風險', keywords: '缺貨、延遲、供貨不穩', isSystemDefault: true, active: true },
  { id: 2, name: '商品品質與客訴風險', keywords: '瑕疵、過敏、客訴', isSystemDefault: true, active: true },
  { id: 3, name: '市場不確定性與需求變動風險', keywords: '熱度下降、需求波動、競品', isSystemDefault: true, active: true },
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
    leadDays: 30,
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
    leadDays: 21,
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
    leadDays: 45,
    tags: [{ tag: 'seasonal', matchTier: 'WEAK' }],
  },
];

const MOCK_WEATHER_SIGNAL_TAG_MAPPINGS: readonly WeatherSignalTagMappingResponsePayload[] = [
  { id: 1, weatherSignalType: 'RAINY', tag: '雨具', matchTier: 'CORE', isActive: true, isSystemDefault: true },
  { id: 2, weatherSignalType: 'RAINY', tag: '防水', matchTier: 'GENERAL', isActive: true, isSystemDefault: true },
  { id: 3, weatherSignalType: 'HOT', tag: '涼感', matchTier: 'CORE', isActive: true, isSystemDefault: true },
  { id: 4, weatherSignalType: 'HOT', tag: '消暑', matchTier: 'GENERAL', isActive: true, isSystemDefault: true },
  { id: 5, weatherSignalType: 'COLD', tag: '保暖', matchTier: 'CORE', isActive: true, isSystemDefault: true },
];

/** 地域占比設定的 Mock 資料（2026-09-23新增）：等權重，跟 V20 migration 的種子資料一致。 */
const MOCK_REGION_WEIGHTS: readonly RegionWeightPayload[] = [
  { region: 'NORTH', weightPercentage: 25, updatedAt: null },
  { region: 'CENTRAL', weightPercentage: 25, updatedAt: null },
  { region: 'SOUTH', weightPercentage: 25, updatedAt: null },
  { region: 'EAST', weightPercentage: 25, updatedAt: null },
];

const MOCK_ACCOUNTS: readonly AccountVM[] = [
  { id: 1, username: 'manager01', name: '林經理', role: 'MANAGER', active: true },
  { id: 2, username: 'buyer01', name: '陳小姐', role: 'PURCHASER', active: true },
  { id: 3, username: 'buyer02', name: '王先生', role: 'PURCHASER', active: false },
];

@Component({
  selector: 'app-settings',
  imports: [ListSortControls, SortHeader, SortRowsPipe, FormsModule, ReactiveFormsModule, DatePipe, Icon],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  readonly typeSort = new ListSort();
  readonly campaignSort = new ListSort();
  readonly accountSort = new ListSort();
  readonly campaignStatusLabel = CAMPAIGN_STATUS_LABEL;
  readonly weatherSignalTypeLabel = WEATHER_SIGNAL_TYPE_LABEL;
  readonly weatherForecastConfidenceLabel = WEATHER_FORECAST_CONFIDENCE_LABEL;
  readonly weatherRegionLabel = WEATHER_REGION_LABEL;
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
  readonly editingProductTypeId = signal<number | null>(null);
  /**
   * 新增商品類型時要不要掛在某個大類底下——null 代表「這筆是大類本身」，
   * 有值代表「這筆是小類，掛在這個 id 指定的大類下面」。只在新增流程用，
   * 編輯既有類型（改名）不會動到這個欄位，維持既有編輯行為不變。
   */
  /**
   * 新增商品類型時是「大類」還是「小類」——UI 用單選鈕切換。編輯既有類型
   * （改名）不會用到這個欄位，維持既有編輯行為不變。
   */
  readonly draftProductTypeLevel = signal<1 | 2>(1);
  readonly draftProductTypeParentId = signal<number | null>(null);
  /** 新增小類時「選擇上層大類」下拉選單的選項——只列出現有的大類（level=1）。 */
  readonly availableMajorTypes = computed(() => this.productTypes().filter((t) => t.level === 1));

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

  /** 天氣檔期同步面板狀態（WeatherController，2026-09-21新增）。 */
  readonly weatherPreview = signal<WeatherSignalPreviewPayload[] | null>(null);
  readonly weatherPreviewLoading = signal(false);
  readonly weatherSyncing = signal(false);

  /**
   * 天氣訊號標籤對照管理（SettingsController，2026-09-22新增）——把原本
   * 寫死在後端 WeatherCampaignSyncService.WEATHER_TAG_MAPPING 的對照表
   * 改成管理層可自行調整。刻意獨立一組 signal／方法，不接進既有風險選項
   * 那套共用 draft/modal 狀態機：那套是為「同一個 modal 同時服務新增與
   * 編輯多種實體」設計的，這裡只需要一個簡單的清單＋新增列表單＋
   * 停用/復用，接進去徒增耦合，不值得。
   *
   * NORMAL 不列入可選項目：一般天氣不該命中任何商品，後端也會拒絕，
   * 見 WEATHER_SIGNAL_TAG_MAPPING_TYPE_OPTIONS。
   */
  readonly weatherSignalTagMappings = signal<WeatherSignalTagMappingResponsePayload[]>(
    this.useMockData ? [...MOCK_WEATHER_SIGNAL_TAG_MAPPINGS] : [],
  );
  readonly weatherSignalTagMappingsLoading = signal(false);
  readonly weatherSignalTagMappingSaving = signal(false);
  readonly draftWeatherSignalType = signal<WeatherSignalType | ''>('');
  readonly draftWeatherSignalTag = signal('');
  readonly draftWeatherSignalMatchTier = signal<TagMatchTier>('CORE');
  readonly weatherSignalTagMappingTypeOptions = WEATHER_SIGNAL_TAG_MAPPING_TYPE_OPTIONS;

  /**
   * 地域占比設定（SettingsController，2026-09-23新增，地域性影響評分方案B+D）：
   * 四區固定，不開放新增/刪除，只開放調整占比，整份送出、加總須為100
   * （語意比照因子權重編輯 updateEvaluationModeFactors()，見後端 SettingsService
   * 同名方法的類別註解）。
   *
   * regionWeightDrafts 是編輯中的字串值（<input> 綁定用），跟已儲存的
   * regionWeights 分開：儲存前允許暫時不為100（例如正在調整中間狀態），
   * 只有按下「儲存」時才驗證＋送出，不要求每次按鍵都合法。
   */
  readonly regionWeights = signal<RegionWeightPayload[]>(
    this.useMockData ? [...MOCK_REGION_WEIGHTS] : [],
  );
  readonly regionWeightsLoading = signal(false);
  readonly regionWeightSaving = signal(false);
  readonly regionWeightDrafts = signal<Record<string, string>>({});

  readonly regionWeightDraftSum = computed(() => {
    const drafts = this.regionWeightDrafts();
    return Object.values(drafts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  });

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

  /**
   * 搜尋文字本身不在已知清單裡時，允許直接新增這個新標籤。
   *
   * ⚠️ 原本用 knownTags().includes(keyword) 做精確比對（區分大小寫），
   * 但上面的 filteredKnownTags 是不分大小寫比對——結果是已有「Gift」時，
   * 打「gift」不只會在清單裡篩出「Gift」，「＋ 新增標籤」按鈕也會同時
   * 出現，使用者一沒注意點了新增，就會多出一個大小寫不同但語意重複的
   * 標籤，直接違背這整個 dialog 想避免「標籤名稱不一致」的初衷。改成
   * 一樣不分大小寫比對，兩者判斷基準才會一致。
   */
  readonly canAddNewTag = computed(() => {
    const keyword = this.tagPickerSearch().trim();
    if (!keyword) return false;
    const normalized = keyword.toLocaleLowerCase('zh-Hant');
    return !this.knownTags().some((tag) => tag.toLocaleLowerCase('zh-Hant') === normalized);
  });

  /** 目前草稿裡實際有效（非空字串）的標籤數量，供「已選 N 項」跟顯示邏輯共用判斷。 */
  readonly selectedTagRows = computed(() => this.draftTags().filter((r) => r.tag));

  /**
   * 「進階：調整比對等級」的下拉選單改比對等級時要用這個方法，不要在
   * 樣板裡直接 `row.matchTier = $event`。selectedTagRows() 是
   * computed(() => draftTags().filter(...))，篩出來的物件跟 draftTags()
   * 陣列裡的是同一個參照——直接改屬性雖然「畫面上看起來有變」，但完全
   * 繞過 draftTags.set()，signal 沒有真的更新，依賴 draftTags() 的其他
   * computed／等值比較都不會正確重新運算，是很容易埋雷的寫法。
   */
  updateTagMatchTier(tag: string, matchTier: FestiveCampaignTagPayload['matchTier']): void {
    this.draftTags.update((rows) => rows.map((row) => (row.tag === tag ? { ...row, matchTier } : row)));
  }

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
   * 「切換狀態」modal 用：true＝手動指定狀態（is_manual_override 開啟），
   * false＝恢復自動判斷（is_manual_override 關閉）。原本這裡沒有反向路徑，
   * overrideEnabled 送出時永遠是 true，一旦手動覆蓋就再也回不去，
   * 這個 signal 補上「恢復自動判斷」這個選項。
   */
  readonly draftManualOverride = signal(true);
  readonly isSaving = signal(false);
  /** risk / productType / account / campaign / campaignStatus 共用的新增/編輯 modal 存檔中狀態。 */
  readonly isSavingModal = signal(false);

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
          this.loadFactorDefinitions();
          // 新增自訂因子的表單（見下方 factorSourceKind 相關狀態）需要知道
          // 有哪些自訂商品屬性可以選為資料源，這個訊號原本只有「商品類型」
          // 分頁載入時才會拿到——使用者可能先進「評估模式」分頁就想新增
          // 因子，這裡一併載入，不假設使用者一定先逛過商品類型分頁。
          this.loadCustomFieldDefinitions();
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

  /**
   * 目前勾選「啟用」的因子代碼（2026-09-20新增：自訂模式增刪因子）。
   * 未勾選的因子權重會被鎖住並強制為 0——後端 getAllActiveFactorCodes()
   * 要求整份送出的清單必須涵蓋所有目前生效中的因子（固定七個＋所有啟用中的
   * 自訂因子），沒有真正「刪除」這回事，「刪除」只能實作成「權重歸零＋
   * 視為未啟用」，數學上 weightedAverage() 本來就把權重0排除在分母外，
   * 效果等同刪除。
   */
  readonly enabledFactorCodes = signal<Set<string>>(new Set());

  /**
   * 編輯器要列出的完整因子清單：這個模式目前已經在用的（mode.rawFactors）
   * ＋全部生效中、但這個模式還沒用過的自訂因子。後者也必須列出來，即使
   * 預設不啟用——否則儲存時送出的清單會漏掉這些因子代碼，被後端的
   * 「缺少必要的因子」擋下（見 getAllActiveFactorCodes() 的整份覆蓋要求）。
   */
  readonly weightEditorRows = computed<{ factorCode: string; factorName: string }[]>(() => {
    const mode = this.modes().find((m) => m.id === this.editingWeightsModeId());
    if (!mode?.rawFactors) return [];
    const rows = mode.rawFactors.map((f) => ({ factorCode: f.factorCode, factorName: f.factorName }));
    const existingCodes = new Set(rows.map((r) => r.factorCode));
    this.factorDefinitions().forEach((definition) => {
      if (definition.isActive && !existingCodes.has(definition.factorCode)) {
        rows.push({ factorCode: definition.factorCode, factorName: definition.factorName });
      }
    });
    return rows;
  });

  /**
   * 2026-09-20改用 weightEditorRows()，不再只看 mode.rawFactors——理由同上，
   * 編輯器要能顯示「還沒加入這個模式」的自訂因子，才能勾選啟用。
   * 沒有正在編輯任何模式時退回 FACTOR_ORDER，避免其他還沒編輯的畫面情境出錯。
   */
  readonly factorOrder = computed<readonly string[]>(() => {
    const rows = this.weightEditorRows();
    return rows.length > 0 ? rows.map((r) => r.factorCode) : FACTOR_ORDER;
  });

  /**
   * 同上理由，改成從 weightEditorRows() 組出：因子的中文名稱直接讀後端
   * 回傳的 factorName（自訂因子的名稱本來就是管理層建立時自己填的），
   * 沒有必要也不應該在前端另外維護一份對照表。
   */
  readonly factorLabel = computed<Record<string, string>>(() => {
    const dynamicLabels: Record<string, string> = {};
    this.weightEditorRows().forEach((r) => {
      dynamicLabels[r.factorCode] = r.factorName;
    });
    return { ...FACTOR_LABEL, ...dynamicLabels };
  });

  /** 目前草稿的加總。畫面即時顯示，但依決議只在送出時檢查、不擋輸入。 */
  readonly weightDraftTotal = computed(() =>
    Math.round(Object.values(this.weightDrafts()).reduce((sum, w) => sum + (w || 0), 0) * 100) / 100,
  );

  startEditWeights(mode: EvaluationModeVM): void {
    if (!mode.isEditable || !mode.rawFactors || mode.id === null) return;
    // 先設定正在編輯的模式，weightEditorRows() 才能正確算出「這個模式還沒用過、
    // 但已存在的自訂因子」清單。
    this.editingWeightsModeId.set(mode.id);

    const drafts: Record<string, number> = {};
    const enabled = new Set<string>();
    mode.rawFactors.forEach((f) => {
      drafts[f.factorCode] = f.weight ?? 0;
      // 用「權重是否大於0」判斷勾選狀態，不是用「是否存在於 rawFactors」——
      // 後端沒有獨立的啟用/停用欄位，權重0本身就是唯一的「已停用」訊號
      // （見 enabledFactorCodes 類別註解）。這樣重新打開編輯器時，上次
      // 取消勾選（歸零）的因子才會正確顯示成未勾選，而不是因為它還留在
      // rawFactors 裡就被誤判成勾選中。
      if ((f.weight ?? 0) > 0) {
        enabled.add(f.factorCode);
      }
    });
    // 還沒被這個模式使用的自訂因子：預設不啟用、權重0，管理層要主動勾選
    // 才會納入計分；仍要先放進 drafts，儲存時才不會漏掉這個因子代碼。
    this.weightEditorRows().forEach((row) => {
      if (!(row.factorCode in drafts)) drafts[row.factorCode] = 0;
    });
    this.weightDrafts.set(drafts);
    this.enabledFactorCodes.set(enabled);
  }

  cancelEditWeights(): void {
    this.editingWeightsModeId.set(null);
    this.weightDrafts.set({});
    this.enabledFactorCodes.set(new Set());
  }

  updateWeightDraft(factorCode: string, value: number): void {
    this.weightDrafts.update((drafts) => ({ ...drafts, [factorCode]: value }));
  }

  /**
   * 勾選/取消勾選某個因子（新增/刪除因子的實際操作）。
   * 取消勾選時強制把權重歸零並鎖住輸入框（樣板 [disabled]），不留著舊數字
   * 造成「看起來被移除、實際上還在算分」的誤解。「刪除」的真實效果就是
   * 權重0——後端沒有真正把這一列從送出清單裡拿掉的機制，見上方
   * enabledFactorCodes 的類別註解。
   *
   * 2026-09-20修正：不再接收外部傳入的 checked 狀態（改用 (change) 事件，
   * 不是 (ngModelChange)，事件本身不帶可靠的布林值），改成內部自行判斷目前
   * 勾選狀態並翻轉，比照同檔案 toggleTagPickerSelection() 的既有寫法。
   */
  toggleFactorEnabled(factorCode: string): void {
    const wasEnabled = this.enabledFactorCodes().has(factorCode);
    this.enabledFactorCodes.update((set) => {
      const next = new Set(set);
      if (next.has(factorCode)) {
        next.delete(factorCode);
      } else {
        next.add(factorCode);
      }
      return next;
    });
    if (wasEnabled) {
      this.updateWeightDraft(factorCode, 0);
    }
  }

  /**
   * 送出權重編輯。依決議只在送出時檢查一次加總，不做輸入中即時擋。
   *
   * ⚠️ 整份覆蓋：後端 EvaluationFactorUpdateRequest 要求送齊「目前所有生效中
   * 的因子」（既有七個＋自訂因子，數量不再固定是七）。2026-09-20改用
   * factorOrder()（見上方 computed 的說明）取代原本寫死的 this.factorOrder
   * （FACTOR_ORDER 常數）——舊寫法會導致自訂因子的權重永遠不會被送出，
   * 且如果自訂模式目前的因子數不是七項，舊寫法送出的清單「項數不齊全」，
   * 後端會直接拒絕。
   */
  saveWeights(): void {
    const modeId = this.editingWeightsModeId();
    if (modeId === null || this.isSavingWeights()) return;

    // 基本防呆：不能把因子全部取消勾選——那樣送出去全部因子權重都是0，
    // 加總檢查會先擋下來，但錯誤訊息應該講清楚真正的原因是什麼，而不是
    // 讓使用者對著「加總須為100」的訊息一頭霧水，不知道為什麼怎麼調都是0。
    if (this.enabledFactorCodes().size === 0) {
      this.statusMessageState.show('至少要啟用一個因子，不能全部取消勾選。');
      return;
    }

    const total = this.weightDraftTotal();
    if (Math.abs(total - 100) > 0.01) {
      this.statusMessageState.show(`全部因子權重加總須為 100，目前為 ${total}，請調整後再送出。`);
      return;
    }

    const factors = this.factorOrder().map((factorCode) => ({
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

  // ----- 自訂計分因子（2026-09-20新增，方案B）-----
  //
  // 沒有沿用既有的共用 modal() 系統：既有 modal 是靠共用的 draftXxx 訊號組出
  // 好幾種完全不同的表單（風險/品類/檔期/帳號），saveModal()／saveModalMock()
  // 已經是一長串 if-else，硬塞一種欄位形狀差很多的新表單（選運算邏輯＋選資料源＋
  // 選填參數）進去，只會讓那兩個已經很長的方法更難讀、也更容易在改動時不小心
  // 影響到其他既有表單。獨立一組訊號與方法，风险更低、也更容易單獨測試。

  readonly factorDefinitions = signal<FactorDefinitionVM[]>([]);
  readonly isCreatingFactorDefinition = signal(false);
  readonly isSavingFactorDefinition = signal(false);
  /**
   * V14新增：null＝目前是「新增」表單；非null＝正在編輯這個id的因子，
   * 表單與新增共用同一組 newFactorXxx 訊號（見 openEditFactorDefinition()），
   * 只是送出時走 updateFactorDefinition() 而不是 createFactorDefinition()，
   * 且因子代碼欄位改為唯讀——編輯不開放修改代碼，見後端
   * FactorDefinitionUpdateRequest 類別註解。
   */
  readonly editingFactorDefinitionId = signal<number | null>(null);
  readonly newFactorCode = signal('');
  readonly newFactorName = signal('');
  /**
   * 資料源類型：既有 Product 固定欄位，或自訂商品屬性（動態問卷）題目。
   * 2026-09-20新增。運算邏輯不再由使用者直接選——見 newFactorStrategy()
   * 下方的說明，改成依這裡選的資料源自動決定，避免選出互不相容的組合。
   */
  readonly newFactorSourceKind = signal<'FIXED' | 'CUSTOM_FIELD'>('FIXED');
  readonly newFactorDataSource = signal<FactorDataSource>('PRICE_COMPETITIVENESS');
  readonly newFactorCustomFieldId = signal<number | null>(null);
  /** 空字串代表沿用該策略的預設倍率（MANUAL_SCALE=20／MANUAL_PERCENT=100），不送 strategyParams。 */
  readonly newFactorScale = signal('');

  /** 中文顯示名稱，對應後端 FactorStrategyCode 的三個已實作值，純顯示用（見 newFactorStrategy()）。 */
  readonly factorStrategyLabel: Record<string, string> = {
    MANUAL_SCALE: '人工評分 × 倍率',
    MANUAL_PERCENT: '人工估值 × 倍率',
    TARGET_BAND_NORMALIZE: '依品類目標區間正規化',
  };

  /** 中文顯示名稱，對應後端 FactorDataSource。 */
  readonly factorDataSourceLabel: Record<string, string> = {
    PRICE_COMPETITIVENESS: '價格競爭力（1~5人工評分）',
    MOQ: '最低訂購量（原始數字，需設定目標區間）',
    SUPPLIER_MAX_CAPACITY: '供應商最大產能（原始數字，需設定目標區間）',
  };

  /**
   * 每個資料源相容哪一種運算邏輯，對應後端 FactorDataSource.getCompatibleStrategy()。
   * 新增資料源時要同步更新這裡。
   */
  readonly factorDataSourceOptions: readonly {
    code: FactorDataSource;
    compatibleStrategy: FactorStrategyCode;
  }[] = [
    { code: 'PRICE_COMPETITIVENESS', compatibleStrategy: 'MANUAL_SCALE' },
    { code: 'MOQ', compatibleStrategy: 'TARGET_BAND_NORMALIZE' },
    { code: 'SUPPLIER_MAX_CAPACITY', compatibleStrategy: 'TARGET_BAND_NORMALIZE' },
  ];

  /**
   * 依 CustomFieldType 對應的運算邏輯，鏡射後端 CustomFieldType.
   * getCompatibleStrategy()。TEXT 型態不會出現在這裡（見
   * availableCustomFieldsForFactor() 已經把它篩掉）。
   */
  readonly customFieldTypeStrategy: Record<string, FactorStrategyCode> = {
    SCALE_1_5: 'MANUAL_SCALE',
    PERCENT_0_1: 'MANUAL_PERCENT',
    RAW_NUMBER: 'TARGET_BAND_NORMALIZE',
  };

  /**
   * 可選為計分資料源的自訂商品屬性——只有數值類（排除 TEXT）且生效中的。
   * 2026-09-20新增，「開新計分因子資料源」最後一階段：讓自訂因子除了能綁
   * 既有 Product 固定欄位，也能綁管理層自己在「商品類型」分頁新增的自訂
   * 商品屬性題目。
   */
  readonly availableCustomFieldsForFactor = computed(() =>
    this.customFieldDefinitions().filter((f) => f.isActive && f.fieldType !== 'TEXT'),
  );

  /**
   * 運算邏輯不再由使用者直接選——依目前選的資料源（既有欄位或自訂屬性）
   * 自動決定。原本是「先選運算邏輯，再篩出相容的資料源」，兩種資料源
   * 並存後反過來更簡單：使用者只需要決定「要用哪個數字來打分數」，
   * 邏輯怎麼算是那個數字的形狀決定的，不需要使用者自己知道兩者要對得上。
   */
  readonly newFactorStrategy = computed<FactorStrategyCode | null>(() => {
    if (this.newFactorSourceKind() === 'FIXED') {
      return (
        this.factorDataSourceOptions.find((o) => o.code === this.newFactorDataSource())?.compatibleStrategy ?? null
      );
    }
    const field = this.availableCustomFieldsForFactor().find((f) => f.id === this.newFactorCustomFieldId());
    return field ? (this.customFieldTypeStrategy[field.fieldType] ?? null) : null;
  });

  private loadFactorDefinitions(): void {
    this.api
      .getFactorDefinitions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // 停用的舊版本（isSuperseded=true，因編輯而被取代）不需要在前端顯示——
        // 它們永遠不能再被啟用（見後端 enableFactorDefinition() 的防呆），留著
        // 只會讓清單越積越多歷史雜訊。純粹手動停用（isSuperseded=false）的
        // 因子仍然照常顯示，管理層才能看到並重新啟用。
        next: (list) =>
          this.factorDefinitions.set(list.map(toFactorDefinitionVM).filter((item) => !item.isSuperseded)),
        // 自訂因子清單載入失敗不影響評估模式卡片本身的顯示，該區塊維持空清單即可。
        error: () => undefined,
      });
  }

  openCreateFactorDefinition(): void {
    this.editingFactorDefinitionId.set(null);
    this.newFactorCode.set('');
    this.newFactorName.set('');
    this.newFactorSourceKind.set('FIXED');
    this.newFactorDataSource.set('PRICE_COMPETITIVENESS');
    this.newFactorCustomFieldId.set(null);
    this.newFactorScale.set('');
    this.isCreatingFactorDefinition.set(true);
  }

  /**
   * V14新增：開啟編輯表單，用選定因子目前的內容預填同一組表單訊號。
   * 因子代碼維持顯示但欄位在畫面上是唯讀（見 settings.html），送出時
   * 也不會被送出——updateFactorDefinition() 沿用舊代碼，不理會這裡的值。
   */
  openEditFactorDefinition(item: FactorDefinitionVM): void {
    this.editingFactorDefinitionId.set(item.id);
    this.newFactorCode.set(item.factorCode);
    this.newFactorName.set(item.factorName);
    if (item.dataSourceCode) {
      this.newFactorSourceKind.set('FIXED');
      this.newFactorDataSource.set(item.dataSourceCode);
      this.newFactorCustomFieldId.set(null);
    } else {
      this.newFactorSourceKind.set('CUSTOM_FIELD');
      this.newFactorCustomFieldId.set(item.customFieldDefinitionId);
    }
    const scale = item.strategyParams?.['scale'];
    this.newFactorScale.set(scale != null ? String(scale) : '');
    this.isCreatingFactorDefinition.set(true);
  }

  /**
   * 切換資料源類型（既有欄位／自訂商品屬性）時，把另一邊的選擇重置成預設值，
   * 避免使用者先選了自訂屬性、又切回既有欄位，殘留的 newFactorCustomFieldId
   * 被誤送出（雖然 createFactorDefinition() 只依 newFactorSourceKind() 決定
   * 送哪一個欄位，殘留值不會真的被送出，但重置更乾淨，也讓畫面狀態更好預期）。
   */
  updateNewFactorSourceKind(kind: 'FIXED' | 'CUSTOM_FIELD'): void {
    this.newFactorSourceKind.set(kind);
    if (kind === 'FIXED') {
      this.newFactorCustomFieldId.set(null);
    } else {
      this.newFactorDataSource.set('PRICE_COMPETITIVENESS');
      const firstAvailable = this.availableCustomFieldsForFactor()[0];
      this.newFactorCustomFieldId.set(firstAvailable ? firstAvailable.id : null);
    }
  }

  cancelCreateFactorDefinition(): void {
    this.isCreatingFactorDefinition.set(false);
    this.editingFactorDefinitionId.set(null);
  }

  /**
   * 表單送出的統一入口，依 editingFactorDefinitionId() 分派到新增或編輯。
   * 兩者共用同一組欄位驗證（必填、策略是否可解析、倍率格式），只有送出的
   * API 呼叫不同——編輯不送 factorCode（後端 FactorDefinitionUpdateRequest
   * 本來就沒有這個欄位，見其類別註解，代碼不可修改）。
   */
  submitFactorDefinition(): void {
    if (this.isSavingFactorDefinition()) return;

    const factorCode = this.newFactorCode().trim().toUpperCase();
    const factorName = this.newFactorName().trim();
    if (!factorCode || !factorName) {
      this.statusMessageState.show('請填寫因子代碼與名稱。');
      return;
    }

    const strategyCode = this.newFactorStrategy();
    if (!strategyCode) {
      this.statusMessageState.show(
        this.newFactorSourceKind() === 'FIXED'
          ? '請選擇資料源。'
          : '請選擇自訂商品屬性——目前沒有可用的數值類題目，請先到下方新增一個。',
      );
      return;
    }

    const scaleInput = this.newFactorScale().trim();
    const strategyParams: Record<string, number> | undefined = scaleInput
      ? { scale: Number(scaleInput) }
      : undefined;
    if (scaleInput && Number.isNaN(strategyParams?.['scale'])) {
      this.statusMessageState.show('倍率必須是數字。');
      return;
    }

    const isFixedSource = this.newFactorSourceKind() === 'FIXED';
    const editingId = this.editingFactorDefinitionId();

    if (this.useMockData) {
      if (editingId != null) {
        this.factorDefinitions.update((items) =>
          items.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  factorName,
                  strategyCode,
                  dataSourceCode: isFixedSource ? this.newFactorDataSource() : null,
                  customFieldDefinitionId: isFixedSource ? null : this.newFactorCustomFieldId(),
                }
              : item,
          ),
        );
        this.cancelCreateFactorDefinition();
        this.statusMessageState.show('已在本地編輯 Mock 自訂因子。');
        return;
      }
      this.factorDefinitions.update((items) => [
        ...items,
        {
          id: -(items.length + 1),
          factorCode,
          factorName,
          category: null,
          strategyCode,
          dataSourceCode: isFixedSource ? this.newFactorDataSource() : null,
          customFieldDefinitionId: isFixedSource ? null : this.newFactorCustomFieldId(),
          strategyParams: strategyParams ?? null,
          isActive: true,
          isSuperseded: false,
        },
      ]);
      this.cancelCreateFactorDefinition();
      this.statusMessageState.show('已在本地新增 Mock 自訂因子。');
      return;
    }

    this.isSavingFactorDefinition.set(true);

    // 二選一：既有欄位或自訂商品屬性，另一個固定送 null，見後端
    // FactorDefinitionCreateRequest／FactorDefinitionUpdateRequest 類別註解
    // 的「資料源二選一」說明。category 固定不送，理由見下方 create 分支註解。
    const dataSourceCode = isFixedSource ? this.newFactorDataSource() : null;
    const customFieldDefinitionId = isFixedSource ? null : this.newFactorCustomFieldId();

    if (editingId != null) {
      this.api
        .updateFactorDefinition(editingId, {
          factorName,
          strategyCode,
          dataSourceCode,
          customFieldDefinitionId,
          strategyParams: strategyParams ?? null,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.isSavingFactorDefinition.set(false);
            this.cancelCreateFactorDefinition();
            // 編輯會產生新版本（新id）並把舊版本標記為已取代，兩者狀態都要
            // 反映在清單上，直接重新整份載入比在本地嘗試拼湊兩列的狀態更保險。
            this.loadFactorDefinitions();
            this.statusMessageState.show('自訂因子已更新。');
          },
          error: (err) => {
            this.isSavingFactorDefinition.set(false);
            this.statusMessageState.show(toApiError(err).message);
          },
        });
      return;
    }

    this.api
      .createFactorDefinition({
        factorCode,
        factorName,
        // 2026-09-20拿掉分組欄位：category 的唯一用途是卡片上的四象限彙總
        // 顯示，那個顯示已經在同一輪改成展開因子明細（見 mode-grid 樣板），
        // 分組已經沒有任何畫面在讀，繼續讓使用者填一個沒有效果的欄位只會
        // 造成困惑。後端 FactorDefinitionCreateRequest.category 保留可為 null，
        // 這裡固定不送即可，不需要為此再動後端。
        strategyCode,
        dataSourceCode,
        customFieldDefinitionId,
        strategyParams: strategyParams ?? null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.factorDefinitions.update((items) => [...items, toFactorDefinitionVM(created)]);
          this.isSavingFactorDefinition.set(false);
          this.cancelCreateFactorDefinition();
          this.statusMessageState.show(
            '自訂因子已新增。要讓某個自訂模式開始採計，請到上方「編輯權重」加入並分配權重。',
          );
        },
        error: (err) => {
          this.isSavingFactorDefinition.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  disableFactorDefinition(id: number): void {
    if (this.useMockData) {
      this.factorDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: false } : item)),
      );
      this.statusMessageState.show('已在本地停用 Mock 自訂因子。');
      return;
    }
    this.api
      .disableFactorDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.factorDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toFactorDefinitionVM(updated) : item)),
          ),
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  enableFactorDefinition(id: number): void {
    if (this.useMockData) {
      this.factorDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: true } : item)),
      );
      this.statusMessageState.show('已在本地啟用 Mock 自訂因子。');
      return;
    }
    this.api
      .enableFactorDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.factorDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toFactorDefinitionVM(updated) : item)),
          ),
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  // ----- 自訂商品屬性（動態問卷，2026-09-20新增，Phase 1：僅題目管理）-----
  //
  // 品類勾選比照 toggleTagPickerSelection() 的既有寫法（[checked]+click+
  // preventDefault()），是這一輪之前才確認真正可行的核取方塊寫法，直接
  // 沿用，不再重蹈 [ngModel]/(ngModelChange) 那次的覆轍。

  readonly customFieldDefinitions = signal<CustomFieldDefinitionVM[]>([]);
  readonly isCreatingCustomField = signal(false);
  readonly isSavingCustomField = signal(false);
  /** V14新增：null＝新增表單；非null＝正在編輯這個id的題目，理由同editingFactorDefinitionId。 */
  readonly editingCustomFieldId = signal<number | null>(null);
  readonly newFieldCode = signal('');
  readonly newFieldName = signal('');
  readonly newFieldType = signal<CustomFieldType>('SCALE_1_5');
  readonly newFieldHelpText = signal('');
  readonly newFieldRequired = signal(false);
  readonly newFieldApplicableTypeIds = signal<Set<number>>(new Set());
  /**
   * V14新增：1~5分數說明，key固定為'1'~'5'（見SCALE_LABEL_KEYS），value為
   * 使用者填的文字，留空的分數不會被送出（見submitCustomFieldDefinition()）。
   * 只有 newFieldType()==='SCALE_1_5' 時，畫面才會顯示這組輸入。
   */
  readonly newFieldScaleLabels = signal<Record<string, string>>({});
  readonly scaleLabelKeys = SCALE_LABEL_KEYS;

  readonly customFieldTypeLabel: Record<string, string> = {
    SCALE_1_5: '1~5人工評分',
    PERCENT_0_1: '0~1小數估值',
    RAW_NUMBER: '原始數字',
    TEXT: '純文字（不參與計分）',
  };

  /** 下拉選單用的陣列版本，直接沿用上面的 label 對照表，避免兩處各維護一份文字。 */
  readonly customFieldTypeOptions: readonly { code: CustomFieldType; label: string }[] = (
    ['SCALE_1_5', 'PERCENT_0_1', 'RAW_NUMBER', 'TEXT'] as const
  ).map((code) => ({ code, label: this.customFieldTypeLabel[code] }));

  private loadCustomFieldDefinitions(): void {
    this.api
      .getCustomFieldDefinitions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // 理由同 loadFactorDefinitions()：被編輯取代的舊版本不需要在前端顯示。
        next: (list) =>
          this.customFieldDefinitions.set(
            list.map(toCustomFieldDefinitionVM).filter((item) => !item.isSuperseded),
          ),
        // 自訂屬性清單載入失敗不影響商品類型管理本身的顯示，該區塊維持空清單即可。
        error: () => undefined,
      });
  }

  /** 把品類 id 陣列轉成畫面可讀的大類名稱，空陣列顯示「全部品類」。 */
  /**
   * 把品類 id 陣列轉成畫面可讀的大類名稱，空陣列顯示「全部品類」。
   *
   * 2026-09-20修正一個防呆缺口：原本「有 id 但一個都對不到名稱」時會
   * 誤顯示成「全部品類」——這是錯的，「有限制但查無名稱」（品類被刪除、
   * 或品類清單還沒載入完成）跟「本來就沒有限制」是兩種完全不同的狀態，
   * 混在一起顯示會讓管理層誤以為一個原本有品類限制的題目其實適用全部
   * 品類，進而做出錯誤的判斷。現在只有 ids 真的是空陣列時才顯示「全部
   * 品類」；有 id 卻對不到名稱的，改顯示「未知品類」並標明筆數，不悄悄
   * 吞掉、也不謊報成「沒有限制」。
   */
  describeApplicableTypes(ids: number[]): string {
    if (!ids || ids.length === 0) {
      return '全部品類';
    }
    const names = ids.map((id) => this.productTypes().find((t) => t.id === id)?.name).filter((name): name is string => !!name);
    const unresolvedCount = ids.length - names.length;
    if (names.length === 0) {
      return `未知品類（${unresolvedCount}項，可能已被刪除）`;
    }
    if (unresolvedCount > 0) {
      return `${names.join('、')}（另有${unresolvedCount}項未知品類）`;
    }
    return names.join('、');
  }

  /** 因子清單表格用：把資料源顯示成人類看得懂的文字，涵蓋既有欄位與自訂商品屬性兩種來源。 */
  describeFactorDataSource(factor: FactorDefinitionVM): string {
    if (factor.dataSourceCode) {
      return this.factorDataSourceLabel[factor.dataSourceCode] ?? factor.dataSourceCode;
    }
    if (factor.customFieldDefinitionId != null) {
      const field = this.customFieldDefinitions().find((f) => f.id === factor.customFieldDefinitionId);
      return field ? `${field.fieldName}（自訂屬性）` : '未知的自訂屬性（可能已被刪除）';
    }
    return '—';
  }

  openCreateCustomField(): void {
    this.editingCustomFieldId.set(null);
    this.newFieldCode.set('');
    this.newFieldName.set('');
    this.newFieldType.set('SCALE_1_5');
    this.newFieldHelpText.set('');
    this.newFieldRequired.set(false);
    this.newFieldApplicableTypeIds.set(new Set());
    this.newFieldScaleLabels.set({});
    this.isCreatingCustomField.set(true);
  }

  /**
   * V14新增：開啟編輯表單，用選定題目目前的內容預填同一組表單訊號。
   * 欄位代碼維持顯示但欄位在畫面上是唯讀——編輯不開放修改代碼，見後端
   * CustomFieldDefinitionUpdateRequest 類別註解。
   */
  openEditCustomField(item: CustomFieldDefinitionVM): void {
    this.editingCustomFieldId.set(item.id);
    this.newFieldCode.set(item.fieldCode);
    this.newFieldName.set(item.fieldName);
    this.newFieldType.set(item.fieldType);
    this.newFieldHelpText.set(item.helpText ?? '');
    this.newFieldRequired.set(item.isRequired);
    this.newFieldApplicableTypeIds.set(new Set(item.applicableRootProductTypeIds));
    this.newFieldScaleLabels.set({ ...(item.scaleLabels ?? {}) });
    this.isCreatingCustomField.set(true);
  }

  cancelCreateCustomField(): void {
    this.isCreatingCustomField.set(false);
    this.editingCustomFieldId.set(null);
  }

  /** V14新增：更新單一分數（'1'~'5'）的說明文字，留空代表這個分數不需要說明。 */
  updateNewFieldScaleLabel(key: string, value: string): void {
    this.newFieldScaleLabels.update((labels) => {
      const next = { ...labels };
      const trimmed = value.trim();
      if (trimmed) {
        next[key] = trimmed;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  toggleNewFieldApplicableType(typeId: number): void {
    this.newFieldApplicableTypeIds.update((set) => {
      const next = new Set(set);
      if (next.has(typeId)) {
        next.delete(typeId);
      } else {
        next.add(typeId);
      }
      return next;
    });
  }

  /**
   * 表單送出的統一入口，依 editingCustomFieldId() 分派到新增或編輯，
   * 寫法對稱 submitFactorDefinition()。編輯時代碼不可變、也不重複查重
   * （反正沒有送出，後端 CustomFieldDefinitionUpdateRequest 本來就沒有
   * fieldCode 欄位）。
   */
  submitCustomFieldDefinition(): void {
    if (this.isSavingCustomField()) return;

    const editingId = this.editingCustomFieldId();
    const fieldCode = this.newFieldCode().trim().toUpperCase();
    const fieldName = this.newFieldName().trim();
    if (!fieldCode || !fieldName) {
      this.statusMessageState.show('請填寫欄位代碼與名稱。');
      return;
    }

    if (editingId == null) {
      // 2026-09-20新增防呆：格式跟重複兩項檢查都能在前端先擋，不用等後端
      // 回應才知道錯在哪。格式比照既有計分因子代碼的既定慣例（英數字加底線，
      // 不能以數字開頭）——欄位代碼是給程式跟未來的計分資料源對照用的鍵值，
      // 不是給人看的顯示文字（那是 fieldName 的職責），混進空白或符號會讓
      // 之後串接計分系統時難以預期地出錯。編輯時代碼不可修改、也不會被送出，
      // 不需要重跑這兩項檢查。
      if (!/^[A-Z][A-Z0-9_]*$/.test(fieldCode)) {
        this.statusMessageState.show('欄位代碼只能是英文字母、數字、底線，且不能以數字開頭。');
        return;
      }
      if (this.customFieldDefinitions().some((item) => item.fieldCode === fieldCode && item.isActive)) {
        this.statusMessageState.show(`欄位代碼「${fieldCode}」已存在，請改用其他代碼。`);
        return;
      }
    }

    const fieldType = this.newFieldType();
    // V14新增：1~5分數說明只有SCALE_1_5型態才有意義，其餘型態即使使用者
    // 之前填過（例如先選SCALE_1_5填了說明，又切回其他型態），送出時一律
    // 清空，不送給後端——後端也會擋（見ValidationMessage.
    // CUSTOM_FIELD_SCALE_LABEL_NOT_APPLICABLE），這裡先擋一次，錯誤訊息
    // 更早出現。
    const scaleLabels = fieldType === 'SCALE_1_5' ? this.newFieldScaleLabels() : null;
    const scaleLabelsPayload = scaleLabels && Object.keys(scaleLabels).length > 0 ? scaleLabels : null;

    const applicableIds = Array.from(this.newFieldApplicableTypeIds());

    if (this.useMockData) {
      if (editingId != null) {
        this.customFieldDefinitions.update((items) =>
          items.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  fieldName,
                  helpText: this.newFieldHelpText().trim() || null,
                  fieldType,
                  isRequired: this.newFieldRequired(),
                  applicableRootProductTypeIds: applicableIds,
                  scaleLabels: scaleLabelsPayload,
                }
              : item,
          ),
        );
        this.cancelCreateCustomField();
        this.statusMessageState.show('已在本地編輯 Mock 自訂屬性。');
        return;
      }
      this.customFieldDefinitions.update((items) => [
        ...items,
        {
          id: -(items.length + 1),
          fieldCode,
          fieldName,
          helpText: this.newFieldHelpText().trim() || null,
          fieldType,
          isRequired: this.newFieldRequired(),
          isActive: true,
          applicableRootProductTypeIds: applicableIds,
          scaleLabels: scaleLabelsPayload,
          isSuperseded: false,
        },
      ]);
      this.cancelCreateCustomField();
      this.statusMessageState.show('已在本地新增 Mock 自訂屬性。');
      return;
    }

    this.isSavingCustomField.set(true);

    if (editingId != null) {
      this.api
        .updateCustomFieldDefinition(editingId, {
          fieldName,
          helpText: this.newFieldHelpText().trim() || null,
          fieldType,
          isRequired: this.newFieldRequired(),
          applicableRootProductTypeIds: applicableIds,
          scaleLabels: scaleLabelsPayload,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.isSavingCustomField.set(false);
            this.cancelCreateCustomField();
            // 編輯可能連動改綁生效中的因子、也會產生新舊兩個版本，直接
            // 重新整份載入因子清單與屬性清單，避免本地拼湊狀態失真，
            // 理由同 submitFactorDefinition()。
            this.loadCustomFieldDefinitions();
            this.loadFactorDefinitions();
            this.statusMessageState.show('自訂屬性已更新。');
          },
          error: (err) => {
            this.isSavingCustomField.set(false);
            this.statusMessageState.show(toApiError(err).message);
          },
        });
      return;
    }

    this.api
      .createCustomFieldDefinition({
        fieldCode,
        fieldName,
        helpText: this.newFieldHelpText().trim() || null,
        fieldType,
        isRequired: this.newFieldRequired(),
        applicableRootProductTypeIds: applicableIds,
        scaleLabels: scaleLabelsPayload,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.customFieldDefinitions.update((items) => [...items, toCustomFieldDefinitionVM(created)]);
          this.isSavingCustomField.set(false);
          this.cancelCreateCustomField();
          this.statusMessageState.show(
            '自訂屬性已新增。目前還不會出現在商品表單上，那是下一階段的工作。',
          );
        },
        error: (err) => {
          this.isSavingCustomField.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  disableCustomField(id: number): void {
    if (this.useMockData) {
      this.customFieldDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: false } : item)),
      );
      this.statusMessageState.show('已在本地停用 Mock 自訂屬性。');
      return;
    }
    this.api
      .disableCustomFieldDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.customFieldDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toCustomFieldDefinitionVM(updated) : item)),
          ),
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  enableCustomField(id: number): void {
    if (this.useMockData) {
      this.customFieldDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: true } : item)),
      );
      this.statusMessageState.show('已在本地啟用 Mock 自訂屬性。');
      return;
    }
    this.api
      .enableCustomFieldDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.customFieldDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toCustomFieldDefinitionVM(updated) : item)),
          ),
        error: (err) => this.statusMessageState.show(toApiError(err).message),
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
          this.loadCustomFieldDefinitions();
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

    const isMajor = item.level === 1;
    this.dialog
      .confirm(
        '確認刪除商品類型',
        [
          `即將永久刪除「${name}」，此操作無法復原。`,
          isMajor
            ? '若這個大類底下仍有小類、或有任何品項使用，刪除會被拒絕，請先處理小類或改用「停用」。'
            : '若這個類型已經被任何品項使用，刪除會被拒絕，請改用「停用」。',
        ],
        '確定刪除',
        '取消',
      )
      .subscribe((confirmed) => {
        if (confirmed) this.performRemoveProductType(name, item);
      });
  }

  /** 停用項目保留在管理清單，可再次啟用。 */
  toggleRiskOptionActive(item: RiskOptionVM): void {
    if (!item.active) {
      this.setRiskOptionActive(item, true);
      return;
    }
    this.dialog.confirm(
      '確認停用風險選項',
      ['即將停用「' + item.name + '」。', '停用後不再提供選用，仍可在此清單重新啟用。'],
      '確定停用', '取消',
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed) => {
      if (confirmed) this.setRiskOptionActive(item, false);
    });
  }

  private setRiskOptionActive(item: RiskOptionVM, active: boolean): void {
    const apply = () => {
      this.riskOptions.update((items) => items.map((row) =>
        row === item ? { ...row, active } : row,
      ));
      this.riskOptionLookup.invalidate();
      this.statusMessageState.show('已' + (active ? '啟用' : '停用') + '「' + item.name + '」。');
    };
    if (this.useMockData) {
      apply();
      return;
    }
    if (item.id === null) return;
    const request = active ? this.api.enableRiskOption(item.id) : this.api.disableRiskOption(item.id);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: apply,
      error: (err) => this.statusMessageState.show(toApiError(err).message),
    });
  }

  private performRemoveProductType(name: string, item: ProductTypeVM): void {
    if (this.useMockData) {
      if (item.used && item.used > 0) {
        this.statusMessageState.show('此類型已被品項使用，不可刪除，請改為停用。');
        return;
      }
      // 大類（level=1）就算自己 used=0（商品只能掛在小類，大類的 used
      // 恆為 0），只要底下還有小類就不能刪除，否則小類會變成孤兒資料，
      // 跟真實 API 的 existsByParentId() 檢查對齊。
      const hasChildren = this.productTypes().some((type) => type.parentId === item.id);
      if (hasChildren) {
        this.statusMessageState.show('此大類底下仍有小類，請先刪除或搬移小類，無法直接刪除。');
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
          // 後端 409（IllegalStateException）的訊息本身就是為了安全顯示給
          // 使用者而寫的可控文字，「品項使用中」跟「底下還有小類」各有專屬
          // 訊息，直接用 error.message；不要再用前端寫死的單一文案蓋掉，
          // 否則「底下還有小類」會被誤顯示成「已被品項使用」，講錯真正原因。
          this.statusMessageState.show(toApiError(err).message);
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
    // ⚠️ 補上大類→小類連動（跟後端 disableProductType() 的邏輯對齊，
    // 見該方法註解）：停用大類時，畫面上底下的小類也要一起變成已停用，
    // 不然會出現「大類已停用，小類卻還顯示啟用中」的不一致畫面。
    const cascadeDisable = (items: ProductTypeVM[], target: ProductTypeVM): ProductTypeVM[] => {
      const updated = items.map((item) => (item.name === name ? { ...item, active: false } : item));
      if (target.level !== 1) return updated;
      return updated.map((item) =>
        item.level === 2 && item.parentId === target.id ? { ...item, active: false } : item,
      );
    };

    if (this.useMockData) {
      const target = this.productTypes().find((type) => type.name === name);
      if (!target) return;
      this.productTypes.update((items) => cascadeDisable(items, target));
      return;
    }

    const item = this.productTypes().find((type) => type.name === name);
    if (!item?.id) return;

    this.api
      .disableProductType(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.productTypes.update((items) => cascadeDisable(items, item));
          this.productTypeLookup.invalidate();
          this.statusMessageState.show(
            item.level === 1 ? `已停用「${name}」，底下小類也一併停用。` : `已停用「${name}」。`,
          );
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
    // 天氣訊號標籤對照跟節慶檔期同屬「檔期」分頁，一起載入，不用使用者
    // 額外觸發——見 loadWeatherSignalTagMappings() 類別註解。
    this.loadWeatherSignalTagMappings();
    // 地域占比設定同理，跟天氣訊號標籤對照一起放在「檔期」分頁，一起載入。
    this.loadRegionWeights();
  }

  /**
   * 預覽目前會分類出的天氣訊號，不寫入資料庫（WeatherController，
   * GET /signals/preview）。用來在正式同步前，先確認Open-Meteo資料與
   * WeatherNormalizer門檻分類出來的結果合不合理。
   *
   * Mock模式下沒有真實天氣資料可以預覽——與其編造一份假訊號讓畫面「看起來
   * 正常」，不如直接告訴使用者這個功能要接上真實後端才能用，避免誤判。
   */
  previewWeatherSignals(): void {
    if (this.useMockData) {
      this.statusMessageState.show('Mock 模式沒有真實天氣資料可預覽，請切換到已串接後端的環境測試。');
      return;
    }

    this.weatherPreviewLoading.set(true);
    this.api
      .previewWeatherSignals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (signals) => {
          this.weatherPreview.set(signals);
          this.weatherPreviewLoading.set(false);
        },
        error: (err) => {
          this.weatherPreviewLoading.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  /**
   * 手動觸發一次完整天氣檔期同步（WeatherController，POST /sync），跟每天
   * 05:00排程呼叫的是後端同一支方法，行為完全一致。成功後重新載入檔期
   * 清單，讓下方表格立刻反映這次同步的結果，不用使用者自己按重新整理；
   * 同時清空預覽結果——預覽的內容此時已經落地或過期，繼續顯示只會誤導。
   */
  syncWeatherCampaigns(): void {
    if (this.useMockData) {
      this.statusMessageState.show('Mock 模式無法觸發真實天氣同步。');
      return;
    }

    this.weatherSyncing.set(true);
    this.api
      .syncWeatherCampaigns()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.weatherSyncing.set(false);
          this.weatherPreview.set(null);
          const expiredNote =
            result.expiredCampaignCount > 0 ? `、${result.expiredCampaignCount}筆已標記結束` : '';
          this.statusMessageState.show(
            `天氣檔期同步完成：共${result.totalSignalCount}個訊號、更新${result.syncedCampaignCount}筆檔期${expiredNote}。`,
          );
          this.loadCampaigns();
        },
        error: (err) => {
          this.weatherSyncing.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  /**
   * 地域占比設定清單載入（地域性影響評分方案B+D，2026-09-23新增）。載入後
   * 同步把 regionWeightDrafts 初始化成目前已儲存的值（字串形式，供 <input>
   * 綁定），使用者開始編輯前，草稿跟已儲存值是一致的。
   */
  loadRegionWeights(): void {
    if (this.useMockData) {
      const weights = [...MOCK_REGION_WEIGHTS];
      this.regionWeights.set(weights);
      this.resetRegionWeightDrafts(weights);
      return;
    }
    this.regionWeightsLoading.set(true);
    this.api
      .getRegionWeights()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.regionWeights.set(list);
          this.resetRegionWeightDrafts(list);
          this.regionWeightsLoading.set(false);
        },
        error: (err) => {
          this.regionWeightsLoading.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  private resetRegionWeightDrafts(list: RegionWeightPayload[]): void {
    this.regionWeightDrafts.set(
      Object.fromEntries(list.map((item) => [item.region, String(item.weightPercentage)])),
    );
  }

  updateRegionWeightDraft(region: string, value: string): void {
    this.regionWeightDrafts.update((drafts) => ({ ...drafts, [region]: value }));
  }

  /**
   * 儲存四區占比。前端先擋「加總須為100」再送出，避免使用者按了儲存才
   * 在錯誤訊息看到這個規則——但這只是提早給回饋，不是唯一的防線，後端
   * SettingsService.updateRegionWeights() 一樣會驗證一次（見該方法類別
   * 註解），前端這層檢查繞過了也不影響資料正確性。
   */
  saveRegionWeights(): void {
    const drafts = this.regionWeightDrafts();
    const sum = this.regionWeightDraftSum();
    if (Math.abs(sum - 100) > 0.01) {
      this.statusMessageState.show(`四區占比加總須為100，目前為：${sum}`);
      return;
    }

    const regionWeights = Object.entries(drafts).map(([region, value]) => ({
      region,
      weightPercentage: Number(value) || 0,
    }));

    if (this.useMockData) {
      this.regionWeights.update((list) =>
        list.map((item) => {
          const updated = regionWeights.find((r) => r.region === item.region);
          return updated ? { ...item, weightPercentage: updated.weightPercentage } : item;
        }),
      );
      this.statusMessageState.show('已更新（Mock 模式，未實際送出）。');
      return;
    }

    this.regionWeightSaving.set(true);
    this.api
      .updateRegionWeights({ regionWeights })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.regionWeightSaving.set(false);
          this.regionWeights.set(list);
          this.resetRegionWeightDrafts(list);
          this.statusMessageState.show('區域占比已更新。');
        },
        error: (err) => {
          this.regionWeightSaving.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  /**
   * 天氣訊號標籤對照清單載入。跟 loadRiskOptions() 同一套 mock/真實 API
   * 分流慣例（多數設定清單走這套，previewWeatherSignals／syncWeatherCampaigns
   * 是例外——那兩支本質上需要真實天氣資料源，Mock 模式下沒有意義；這裡是
   * 純設定資料，Mock 模式一樣能展示畫面，所以沿用主流慣例而非比照那兩支）。
   */
  loadWeatherSignalTagMappings(): void {
    if (this.useMockData) {
      this.weatherSignalTagMappings.set([...MOCK_WEATHER_SIGNAL_TAG_MAPPINGS]);
      return;
    }
    this.weatherSignalTagMappingsLoading.set(true);
    this.api
      .getWeatherSignalTagMappings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.weatherSignalTagMappings.set(list);
          this.weatherSignalTagMappingsLoading.set(false);
        },
        error: (err) => {
          this.weatherSignalTagMappingsLoading.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  /**
   * 新增一筆對照。前端只做「不可為空」的基本檢查——weatherSignalType 不含
   * NORMAL（下拉選項本來就排除，見 WEATHER_SIGNAL_TAG_MAPPING_TYPE_OPTIONS），
   * 重複組合、NORMAL 誤送等規則性驗證留給後端 SettingsService 統一把關，
   * 避免前後端各自維護一份判斷邏輯、日後對不齊。
   */
  addWeatherSignalTagMapping(): void {
    const weatherSignalType = this.draftWeatherSignalType();
    const tag = this.draftWeatherSignalTag().trim();
    if (!weatherSignalType) {
      this.statusMessageState.show('請選擇天氣訊號類型。');
      return;
    }
    if (!tag) {
      this.statusMessageState.show('請輸入標籤內容。');
      return;
    }
    const matchTier = this.draftWeatherSignalMatchTier();

    const resetDraft = () => {
      this.draftWeatherSignalType.set('');
      this.draftWeatherSignalTag.set('');
      this.draftWeatherSignalMatchTier.set('CORE');
    };

    if (this.useMockData) {
      const mockId = -(this.weatherSignalTagMappings().length + 1);
      this.weatherSignalTagMappings.update((items) => [
        ...items,
        { id: mockId, weatherSignalType, tag, matchTier, isActive: true, isSystemDefault: false },
      ]);
      resetDraft();
      this.statusMessageState.show(`已新增對照：${weatherSignalType} → ${tag}`);
      return;
    }

    this.weatherSignalTagMappingSaving.set(true);
    this.api
      .createWeatherSignalTagMapping({ weatherSignalType, tag, matchTier })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.weatherSignalTagMappingSaving.set(false);
          this.weatherSignalTagMappings.update((items) => [...items, created]);
          resetDraft();
          this.statusMessageState.show(`已新增對照：${created.weatherSignalType} → ${created.tag}`);
        },
        error: (err) => {
          this.weatherSignalTagMappingSaving.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  /**
   * 調整既有對照的命中權重層級（下拉選單 change 時直接送出，不走額外的
   * 編輯模式/儲存按鈕——這張表的欄位少、調整頻率低，比照
   * updateTagMatchTier() 在節慶標籤編輯裡「選了就是選了」的即時儲存體驗，
   * 不需要多一層確認步驟）。
   */
  changeWeatherSignalTagMappingTier(item: WeatherSignalTagMappingResponsePayload, matchTier: TagMatchTier): void {
    if (item.matchTier === matchTier) return;

    const apply = (updated: Partial<WeatherSignalTagMappingResponsePayload> = {}) => {
      this.weatherSignalTagMappings.update((items) =>
        items.map((row) => (row.id === item.id ? { ...row, matchTier, ...updated } : row)),
      );
    };

    if (this.useMockData) {
      apply();
      return;
    }
    this.api
      .updateWeatherSignalTagMapping(item.id, { matchTier })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => apply(updated),
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  /**
   * 停用／復用。系統預設列（isSystemDefault=true）一樣可以停用——後端只擋
   * 刪除，不擋停用（見 SettingsService.disableWeatherSignalTagMapping()
   * 類別註解），管理層若判斷某筆系統預設對照已不合時宜，應該能關掉它，
   * 前端沒有理由比後端更嚴格。
   */
  toggleWeatherSignalTagMappingActive(item: WeatherSignalTagMappingResponsePayload): void {
    const nextActive = !item.isActive;
    const apply = () => {
      this.weatherSignalTagMappings.update((items) =>
        items.map((row) => (row.id === item.id ? { ...row, isActive: nextActive } : row)),
      );
      this.statusMessageState.show(
        `已${nextActive ? '啟用' : '停用'}對照：${item.weatherSignalType} → ${item.tag}`,
      );
    };

    if (this.useMockData) {
      apply();
      return;
    }
    const request = nextActive
      ? this.api.enableWeatherSignalTagMapping(item.id)
      : this.api.disableWeatherSignalTagMapping(item.id);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: apply,
      error: (err) => this.statusMessageState.show(toApiError(err).message),
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
    // ⚠️ 原本這裡完全沒有回填備戰天數——CampaignVM 之前也沒有 leadDays
    // 欄位，表單一路沿用 draftLeadDays 的殘留值（預設 30 或上一次編輯/
    // 新增留下的數字），送出時會用這個錯的值覆蓋掉該檔期真正的備戰天數，
    // 屬於靜默資料損毀。現在 CampaignVM 已經帶 leadDays，這裡補上回填。
    this.draftLeadDays.set(campaign.leadDays);
    // tags 是整份覆蓋：先把現有標籤帶進表單，讓使用者在既有基礎上增刪，
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

  /**
   * 範本 template 內不能直接呼叫全域的 String(...)（Angular 樣板編譯器會把它
   * 當成 component 上的屬性去找，因而報 TS2339）。number/range input 的
   * ngModelChange 會送出 number，但 systemSettingDraftValue 統一存字串，
   * 所以透過這個 component method 做轉換。
   */
  protected toDraftValue(value: unknown): string {
    return String(value ?? '');
  }

  /**
   * 滑桿顯示／收斂的「業務顆粒度」（拖曳後收斂成這個數字的倍數，給
   * snapSettingValue() 用）：
   * - 品類/商品層平滑常數 k（shrinkage_k_category / shrinkage_k_product）：
   *   業務上只在意 5 為單位的粗略調整，收斂成 0、5、10…的倍數。
   * - 中性基準分數（neutral_baseline_score）：後端型別雖然是 DECIMAL
   *   （為了跟其他百分比類設定共用同一個 API 型別），但業務語意上就是
   *   整數分數，固定用 1。
   * - 其餘沿用原本規則：INTEGER 用 1，DECIMAL 用 0.01。
   *
   * ⚠️ 這個值只給 snapSettingValue() 的「四捨五入到倍數」邏輯用，
   * **不要**再直接綁到 <input type="range"> 的原生 [step] 屬性——原生
   * step 有自己的一套「合法值」機制，min/max 沒有剛好落在 step 倍數
   * 格線上時（例如 min=1、step=5、max=100，格線是 1,6,11…96，100 根本
   * 不在格線上），瀏覽器內部限制拖曳只能停在格線上，會讓拉桿永遠碰不到
   * 真正的邊界值 100，之後不管在 JS 這層怎麼收斂都補救不回來——原始值
   * 從瀏覽器那一關就已經被卡在 96，不是 100。原生 [step] 一律固定用
   * nativeSliderStep()（1 或 0.01），業務上想要的「5 一格」的視覺/收斂
   * 效果完全交由 snapSettingValue() 在 JS 這一層自己做，不假手瀏覽器。
   */
  protected sliderStep(setting: SystemSettingVM): number {
    if (setting.key === 'shrinkage_k_category' || setting.key === 'shrinkage_k_product') return 5;
    if (setting.key === 'neutral_baseline_score') return 1;
    return setting.dataType === 'INTEGER' ? 1 : 0.01;
  }

  /**
   * <input type="range"> 原生 [step] 屬性專用——永遠用「這個資料型別最細
   * 的顆粒度」（整數 1、小數 0.01），讓瀏覽器在任何 min/max 組合下都能
   * 真正拖到邊界值，不會被 sliderStep() 那個業務用的粗顆粒度（例如 5）
   * 卡住。實際顯示要收斂成幾的倍數，由 snapSettingValue() 在拖曳事件裡
   * 自己算，不依賴原生 step 的「合法值」機制。
   */
  protected nativeSliderStep(setting: SystemSettingVM): number {
    return setting.dataType === 'INTEGER' ? 1 : 0.01;
  }

  /** 拖動滑桿：每一格都即時收斂到 sliderStep() 的倍數。 */
  protected onSliderDrag(setting: SystemSettingVM, value: unknown): void {
    this.systemSettingDraftValue.set(this.snapSettingValue(setting, this.toDraftValue(value)));
  }

  private snapSettingValue(setting: SystemSettingVM, raw: string): string {
    const step = this.sliderStep(setting);
    const min = setting.minValue;
    const max = setting.maxValue;
    const parsed = Number(raw);

    if (raw.trim() === '' || Number.isNaN(parsed)) {
      return this.toDraftValue(min ?? 0);
    }

    // 原生 [step] 已經改用 nativeSliderStep()（永遠是 1 或 0.01），瀏覽器
    // 不會再因為業務顆粒度（例如 5）跟 min/max 對不齊而卡住邊界值，
    // 所以這裡改成單純判斷「原始值是不是剛好等於邊界」，命中就直接回傳
    // 邊界本身，不再套用倍數捨入——不需要再猜測、估算容許誤差範圍。
    if (max !== null && parsed >= max) {
      return this.toDraftValue(max);
    }
    if (min !== null && parsed <= min) {
      return this.toDraftValue(min);
    }

    const snapped = Math.round(parsed / step) * step;
    const lowerBounded = min !== null ? Math.max(min, snapped) : snapped;
    const bounded = max !== null ? Math.min(max, lowerBounded) : lowerBounded;

    // step < 1（目前只有一般 DECIMAL 設定的 0.01）才需要顯示小數；
    // k 常數跟中性基準分數的 step 都 >= 1，一律顯示整數，避免出現
    // 「10.00 次」這種多餘的尾數。
    return step < 1 ? bounded.toFixed(2) : String(Math.round(bounded));
  }

  /*
   * 這四個分類採用滑桿操作——都是「在一個固定範圍內挑一個數字」的調參
   * 情境（分位數、平滑常數、半衰期天數…），拖動滑桿比在小數字輸入框
   * 裡打字更直覺，也不會不小心打出超出範圍的值。其餘分類（效期判定、
   * 溫層判定、運費估算）不在此列：溫層判定是固定選項的複選，不是連續
   * 數值；效期判定與運費估算則是使用者對「精確金額／天數」有明確預期
   * 的欄位，滑桿的精細度反而不利於輸入一個心裡已經想好的準確數字。
   */
  readonly sliderCategories = new Set(['目標區間', '貝氏收縮', '趨勢分析', '最低訂購量(MOQ)判定']);

  /*
   * 通路支援溫層（supported_temperature_zones）是目前唯一的 STRING
   * 型系統參數，值是逗號分隔的代碼字串，但實際上是「常溫／冷藏／冷凍
   * 這三個固定選項裡，通路支援哪幾個」的複選題，不是自由文字。原本
   * 用純文字輸入框讓使用者自己打逗號分隔字串，容易打錯字或打出不存在
   * 的代碼，後端還要額外驗證——改成勾選方塊，選項就只會是這三個合法
   * 值，從輸入端就避免掉這個問題。TEMPERATURE_ZONE_LABEL 跟商品表單
   * 的溫層下拉共用同一份對照表，中文標籤不會兩邊各自維護一套。
   */
  readonly temperatureZoneOptions: readonly TemperatureZone[] = ['NORMAL', 'CHILLED', 'FROZEN'];
  readonly temperatureZoneLabel = TEMPERATURE_ZONE_LABEL;

  isTemperatureZoneSelected(zone: TemperatureZone): boolean {
    return splitKeywords(this.systemSettingDraftValue()).includes(zone);
  }

  toggleTemperatureZone(zone: TemperatureZone): void {
    const current = splitKeywords(this.systemSettingDraftValue());
    const next = current.includes(zone) ? current.filter((z) => z !== zone) : [...current, zone];
    this.systemSettingDraftValue.set(next.join(','));
  }

  /** 唯讀狀態下「目前值」的顯示文字——STRING 型別目前只有溫層判定這一筆，
   *  把逗號分隔的英文代碼換成中文標籤；不認得的代碼（例如資料庫裡殘留
   *  的舊值）原樣顯示，不讓畫面因為一個沒對應到的代碼而整段消失。 */
  formatSystemSettingValue(setting: SystemSettingVM): string {
    if (setting.key !== 'supported_temperature_zones') return setting.value;
    return splitKeywords(setting.value)
      .map((code) => this.temperatureZoneLabel[code as TemperatureZone] ?? code)
      .join('、');
  }

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
   * 開啟「切換狀態」modal：把該檔期目前的狀態與是否手動覆蓋都如實回填
   * 進草稿——不預設任何一種模式，維持「打開來看不會意外改變設定」。
   */
  openCampaignStatusModal(item: CampaignVM): void {
    this.selectedCampaign.set(item.name);
    this.draftStatus.set(item.status);
    // ⚠️ 修正：這裡原本寫死 set(true)，不管檔期目前實際是「手動覆蓋」
    // 還是「自動判斷」，一律讓 modal 開起來時顯示「手動指定狀態」。使用者
    // 只是想看一下目前狀態、確認沒問題就按「儲存」，結果會把原本設定
    // 「自動判斷」的檔期，靜靜地改成「手動覆蓋」——畫面上確實存檔成功、
    // 也沒有錯誤訊息，但存下去的是使用者沒打算做的變更。改成如實回填
    // 檔期目前的 override 狀態，不做任何動作、直接按儲存時才會維持原狀。
    this.draftManualOverride.set(item.override);
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

  /**
   * 開啟商品類型編輯：原本畫面上只有「新增」，完全沒有編輯入口——後端
   * updateProductType() PUT 端點其實已經存在，只是前端從來沒有接上，
   * 導致改錯名字的自訂類型只能刪除重建（還可能因為已被品項使用而刪不掉）。
   * 補上入口，行為跟風險選項的編輯（openRiskEditModal）同一套模式。
   */
  openProductTypeEditModal(item: ProductTypeVM): void {
    this.editingProductTypeId.set(item.id);
    this.draftName.set(item.name);
    this.modal.set('productType');
  }

  closeModal(): void {
    this.modal.set(null);
    this.isSavingModal.set(false);
    this.draftName.set('');
    this.draftKeywords.set('');
    this.draftUsername.set('');
    this.draftPassword.set('');
    this.draftTags.set([{ tag: '', matchTier: 'CORE' }]);
    this.tagPickerSearch.set('');
    this.tagPickerSelected.set(new Set());
    this.editingRiskOptionId.set(null);
    this.editingProductTypeId.set(null);
    this.draftProductTypeLevel.set(1);
    this.draftProductTypeParentId.set(null);
    this.draftKeywordChips.set([]);
    this.draftKeywordInput.set('');
    this.draftCampaignCode.set('');
    this.draftManualOverride.set(true);
    // ⚠️ 這四個原本沒有被重置——只有 editCampaign() 會寫入它們，關閉/
    // 新增沒有清空。結果是：編輯過某個檔期之後，直接點「＋ 新增檔期」，
    // 表單會殘留上一個檔期的分類/日期/備戰天數，不是乾淨的新表單。
    this.draftCategory.set('FESTIVAL');
    this.draftStart.set('');
    this.draftEnd.set('');
    this.draftLeadDays.set(30);
  }

  saveModal(): void {
    if (this.isSavingModal()) return;
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
          { id: null, name: this.draftName().trim(), keywords, isSystemDefault: false, active: true },
        ]);
      }
    } else if (type === 'productType' && this.draftName().trim()) {
      const editingTypeId = this.editingProductTypeId();
      if (editingTypeId !== null) {
        this.productTypes.update((items) =>
          items.map((item) => (item.id === editingTypeId ? { ...item, name: this.draftName().trim() } : item)),
        );
      } else {
        const level = this.draftProductTypeLevel();
        const parentId = level === 2 ? this.draftProductTypeParentId() : null;
        this.productTypes.update((items) => [
          ...items,
          {
            id: null,
            name: this.draftName().trim(),
            system: false,
            used: 0,
            active: true,
            parentId,
            level,
          },
        ]);
      }
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
        leadDays: this.draftLeadDays(),
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
        this.isSavingModal.set(true);
        this.api
          .updateRiskOption(editingId, { name: this.draftName().trim(), alertKeywords: keywords })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (updated) => {
              this.riskOptions.update((items) =>
                items.map((item) => (item.id === editingId ? { ...toRiskOptionVM(updated), active: updated.isActive ?? item.active } : item)),
              );
              this.riskOptionLookup.invalidate();
              this.statusMessageState.show('已更新風險選項。');
              this.closeModal();
            },
            error: (err) => {
              this.isSavingModal.set(false);
              this.statusMessageState.show(toApiError(err).message);
            },
          });
        return;
      }

      this.isSavingModal.set(true);
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
          error: (err) => {
            this.isSavingModal.set(false);
            this.statusMessageState.show(toApiError(err).message);
          },
        });
      return;
    }

    if (type === 'productType') {
      if (!this.draftName().trim()) {
        this.statusMessageState.show('請輸入類型名稱。');
        return;
      }
      const editingTypeId = this.editingProductTypeId();

      // ⚠️ 只在「新增」流程檢查層級：編輯既有類型（改名）不動層級/上層大類，
      // draftProductTypeLevel 只是新增用的暫存選擇，不該套用到編輯上。
      if (editingTypeId === null && this.draftProductTypeLevel() === 2 && this.draftProductTypeParentId() === null) {
        this.statusMessageState.show('請選擇這個小類要掛在哪個大類底下。');
        return;
      }

      this.isSavingModal.set(true);

      if (editingTypeId !== null) {
        this.api
          .updateProductType(editingTypeId, { name: this.draftName().trim() })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (updated) => {
              this.productTypes.update((items) =>
                items.map((item) => (item.id === editingTypeId ? { ...item, name: updated.name } : item)),
              );
              this.productTypeLookup.invalidate();
              this.statusMessageState.show('已更新商品類型。');
              this.closeModal();
            },
            error: (err) => {
              this.isSavingModal.set(false);
              this.statusMessageState.show(toApiError(err).message);
            },
          });
        return;
      }

      const parentId = this.draftProductTypeLevel() === 2 ? this.draftProductTypeParentId() : null;
      this.api
        .createProductType({ name: this.draftName().trim(), parentId })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created) => {
            this.productTypes.update((items) => [
              ...items,
              { id: created.id, name: created.name, system: false, used: 0, active: true, parentId: created.parentId, level: created.level },
            ]);
            this.productTypeLookup.invalidate();
            this.statusMessageState.show(parentId !== null ? '已新增小類。' : '已新增大類。');
            this.closeModal();
          },
          error: (err) => {
            this.isSavingModal.set(false);
            this.statusMessageState.show(toApiError(err).message);
          },
        });
      return;
    }

    if (type === 'account') {
      if (!this.draftUsername().trim() || !this.draftName().trim() || this.draftPassword().trim().length < 8) {
        this.statusMessageState.show('請完整填寫必填欄位，密碼至少 8 碼。');
        return;
      }
      this.isSavingModal.set(true);
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
            this.isSavingModal.set(false);
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
      // ⚠️ 防呆：festive_campaign_tags 在 (campaign_id, tag) 上有 UNIQUE 約束，
      // 後端 saveTags() 現在會自動去重，但前端這裡也順手做一次——避免明明
      // 知道會撞唯一約束，還是把可能重複的清單原封不動送出去，多一趟浪費
      // 的來回請求。用 trim 後的文字當 key，同名時保留第一筆的比對等級。
      const seenTags = new Map<string, FestiveCampaignTagPayload>();
      for (const row of this.draftTags()) {
        const trimmed = row.tag.trim();
        if (!trimmed || seenTags.has(trimmed)) continue;
        seenTags.set(trimmed, { tag: joinCampaignTags([trimmed]), matchTier: row.matchTier });
      }
      const tags = [...seenTags.values()];

      const existing = this.campaigns().find((item) => item.name === this.selectedCampaign());

      this.isSavingModal.set(true);
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
            error: (err) => {
              this.isSavingModal.set(false);
              this.statusMessageState.show(toApiError(err).message);
            },
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
            error: (err) => {
              this.isSavingModal.set(false);
              this.statusMessageState.show(toApiError(err).message);
            },
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
    if (this.isSavingModal()) return;
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
      this.closeModal();
      return;
    }

    if (!target.id) return;
    this.isSavingModal.set(true);
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
          this.closeModal();
        },
        error: (err) => {
          this.isSavingModal.set(false);
          this.statusMessageState.show(toApiError(err).message);
        },
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
    active: payload.isActive ?? true,
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
  preparationLeadDays: number | null;
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
    // 後端未填時預設 30（見 FestiveCampaignResponsePayload 註解），這裡跟著
    // 用同一個保底值，避免 null 一路傳進表單的 number input 變成空白。
    leadDays: payload.preparationLeadDays ?? 30,
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
