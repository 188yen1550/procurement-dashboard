/**
 * 檔案用途：管理評估模式、審核風險選項、核心客群、商品類型、檔期、帳號與排程作業。
 * 真實模式按分頁延遲載入資料。帳號可停用或復用；商品類型能否刪除由後端
 * 驗證引用關係；檔期內容編輯與狀態切換使用不同操作。
 *
 * 2026-09-24 拆分（決策 D5）：
 *   - 「自訂屬性與因子」分頁 → tabs/custom-extensions（清單狀態在 state/custom-definitions.store）
 *   - 「天氣連動」分頁 → tabs/weather-linkage
 *   - 演算法參數分頁下方的「排程作業」面板 → tabs/ai-suggestion-batch-panel
 *     （2026-09-29 排程面板改放「系統管理 › 排程與同步」分頁，分頁代碼 jobs）
 * 只抽出這三塊，其餘分頁維持原狀（最小修改）。分頁狀態同步到網址 ?tab=，
 * 可從其他頁面或書籤直接開到指定分頁。
 */
import { ListSort, SortHeader, SortRowsPipe, ListSortControls } from '../../shared/ui/list-sort';
import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { DialogService } from '../../core/dialog/dialog.service';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { TemperatureZone, UserRole } from '../../core/domain/enums';
import {
  splitKeywords,
  TEMPERATURE_ZONE_LABEL,
} from '../../core/domain/labels';
import { ProductTypeLookupService } from './api/product-type-lookup.service';
import { RiskOptionLookupService } from './api/risk-option-lookup.service';
import {
  ProductTypeScoreBandCreateRequestPayload,
  ProductTypeScoreBandResponsePayload,
  RiskOptionResponsePayload,
  ScoreBandSourceMode,
} from './api/settings-api.contract';
import { SettingsApiService } from './api/settings-api.service';
import { UserApiService } from '../user-management/api/user-api.service';
import { UserAccountResponsePayload } from '../user-management/api/user-api.contract';
import { WeightFactorPayload } from '../product-management/api/product-api.contract';
import { Icon } from '../../shared/components/icon/icon';
import { InfoTip } from '../../shared/components/info-tip/info-tip';
import { AuthService } from '../../core/auth/auth';
import { PASSWORD_MIN_LENGTH } from '../../core/auth/auth.contract';
import {
  SETTINGS_GROUP_TITLE,
  SETTINGS_TAB_GROUPS,
  SETTINGS_TABS,
  SettingsGroup,
  SettingsTab,
} from './settings-groups';
import { CustomDefinitionsStore } from './state/custom-definitions.store';
import { CustomExtensions, CustomExtensionsNextTab } from './tabs/custom-extensions/custom-extensions';
import { WeatherLinkage } from './tabs/weather-linkage/weather-linkage';
import { FestiveCampaigns } from './tabs/festive-campaigns/festive-campaigns';
import { AiSuggestionBatchPanel } from './tabs/ai-suggestion-batch-panel/ai-suggestion-batch-panel';
import { TrendCrawlerPanel } from './tabs/trend-crawler-panel/trend-crawler-panel';
import { GoogleTrendsPanel } from './tabs/google-trends-panel/google-trends-panel';

type SettingsState = 'default' | 'disabled' | 'loading' | 'error';

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

/**
 * 七個內建評分因子的滑鼠提示說明（2026-09-23 由 procurement-dashboard-updated
 * 分支整併）。整併時逐條對照後端 ProductFactorScorer／HistoricalScoreCalculator／
 * ScoreBandResolver 的實際計算邏輯修正過文字（分支版本有兩處與後端不符：
 * 供應穩定性 1 級是「嚴重缺貨」不是「暫時缺貨」；折扣深度是看有沒有市價，
 * 不是看新品／再販售）。後端計算邏輯改變時，這裡要同步確認。
 *
 * 自訂計分因子沒有對應說明（後端 FactorDefinition 沒有說明欄位），樣板
 * 查不到就不顯示提示圖示。
 */
const FACTOR_HELP: Record<string, string> = {
  MARGIN_RATE:
    '（售價－成本－依材積估算的運費）÷ 售價，再依商品大類的目標區間（未設定時用全域區間）正規化——同樣 30% 毛利，在不同大類的評價不同。',
  DISCOUNT_DEPTH:
    '（市價－售價）÷ 市價，再依目標區間正規化，數值越高代表團購價相對市價折讓越深。未填市價時此項不計分，不會用 0 分計入。',
  SUPPLY_STABILITY:
    '採購人工評估 1～5 級（嚴重缺貨～供應充足），換算為 20～100 分。刻意保留人工判斷，承載系統拿不到的供應商實際狀況。',
  AUDIENCE_MATCH:
    '目前生效中的核心客群關鍵字，與「目標客群描述＋商品名稱」的命中比例（命中關鍵字數 ÷ 關鍵字總數）。',
  HISTORY_FULFILLMENT:
    '歷史成團率的三層貝氏收縮：商品自己的成團率向所屬商品類型收斂，商品類型再向全體收斂；樣本越少越接近上一層，避免只開過幾次就全成團的商品被高估。分母不含取消開團。',
  PURCHASE_RATE: '採購人工填寫的預估購買率（0～100%），直接換算為分數，非系統自動推算。',
  TREND_HEAT:
    '最新一筆外部熱度（趨勢分與熱門度取平均），依「距採集日天數」做指數衰減並收斂到中性基準分，避免舊資料跟今天的資料等權重影響排序。',
};

/** 後端 FactorCode.ALL 的順序，畫面上的權重編輯器沿用同一順序，避免每次渲染順序跳動。 */
/** 後端 applyHistoricalBand() 有歷史資料計算邏輯的因子。 */
const HISTORICAL_BAND_FACTORS: readonly string[] = ['MARGIN_RATE', 'DISCOUNT_DEPTH'];

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

interface AccountVM {
  id: number | null;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  /** V24：密碼仍是管理者設定的，使用者尚未自行修改。 */
  mustChangePassword: boolean;
  /** V27：使用者在登入頁申請重設密碼的時間；沒有待處理申請為 null（此時不能重設）。 */
  passwordResetRequestedAt: string | null;
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
    description:
      '控制品類自己的成團率要收斂到全體平均多快：當這個品類累積的開團樣本數等於 k 時，最終比率剛好各半信自己、一半信全體平均；樣本數遠大於 k 時幾乎完全採信品類自己的數字，遠小於 k 時則幾乎完全採信全體平均。數字越大，代表要更多開團樣本，系統才願意相信這個品類自己的數字。',
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
    description:
      '同一套收斂邏輯，作用對象換成單一商品自己的歷史，上層先驗值則是該商品所屬品類「已收縮過」的成團率（商品先向品類收斂，品類再向全體收斂，兩層依序疊加）。建議設定小於品類層 k：品類的樣本數通常遠多於單一商品，若商品層 k 設得比品類層還大，等於要求商品自己的樣本比品類還多才會被採信，商品層的收縮實質上永遠派不上用場。',
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
    key: 'neutral_baseline_score',
    category: '貝氏收縮',
    displayName: '中性基準分數',
    description:
      '用在兩個情境的收斂目標：①商品或品類完全沒有任何歷史成團紀錄時，直接以此值當作保底比率／分數（等同貝氏收縮公式中樣本數為 0 時的先驗值）；②市場熱度等會隨時間變舊的資料，依「趨勢新鮮度半衰期」做指數衰減時，資料距今天數越多，分數越往這個值靠攏，避免已經過期的資料仍以當初的原始分數繼續影響排序。',
    dataType: 'DECIMAL',
    minValue: 0,
    maxValue: 100,
    unit: '分',
    value: '50',
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

const MOCK_ACCOUNTS: readonly AccountVM[] = [
  { id: 1, username: 'manager01', name: '林經理', role: 'MANAGER', active: true, mustChangePassword: false, passwordResetRequestedAt: null },
  { id: 2, username: 'buyer01', name: '陳小姐', role: 'PURCHASER', active: true, mustChangePassword: false, passwordResetRequestedAt: '2026-09-26T09:00:00' },
  { id: 3, username: 'buyer02', name: '王先生', role: 'PURCHASER', active: false, mustChangePassword: false, passwordResetRequestedAt: null },
];

@Component({
  selector: 'app-settings',
  imports: [
    ListSortControls,
    SortHeader,
    SortRowsPipe,
    FormsModule,
    ReactiveFormsModule,
    DatePipe,
    Icon,
    InfoTip,
    CustomExtensions,
    WeatherLinkage,
    FestiveCampaigns,
    AiSuggestionBatchPanel,
    TrendCrawlerPanel,
    GoogleTrendsPanel,
    // 「計分與判定參數」前往另一組（選品基礎資料 › 天氣連動）的提示連結。
    RouterLink,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  // 自訂因子／自訂屬性清單的共用狀態：這個分頁元件與「自訂屬性與因子」子元件
  // 注入同一個實例（見 state/custom-definitions.store.ts）。
  providers: [CustomDefinitionsStore],
})
export class Settings implements OnInit {
  readonly typeSort = new ListSort();
  readonly accountSort = new ListSort();
  private readonly api = inject(SettingsApiService);
  private readonly dialog = inject(DialogService);
  private readonly userApi = inject(UserApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);
  private readonly riskOptionLookup = inject(RiskOptionLookupService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly definitions = inject(CustomDefinitionsStore);
  private readonly weatherLinkage = viewChild(WeatherLinkage);
  private readonly festiveCampaigns = viewChild(FestiveCampaigns);
  /** 內建因子的提示說明，見 FACTOR_HELP；自訂因子查不到時樣板不顯示提示。 */
  readonly factorHelp = FACTOR_HELP;

  readonly useMockData = APP_CONFIG.useMockData;
  /**
   * 核心客群設定目前鎖住，不開放操作／管理層進入編輯。
   * 沿用 20260831 分支的既有決策，不是這次合併新增的規則——
   * 之後若要重新開放，只需要把這裡改回 true，setTab() 跟樣板的分頁
   * 按鈕不需要再動。
   */
  readonly audienceSettingsVisible = false;

  /**
   * 目前這個路由屬於哪一組（/settings/scoring、/settings/data 或 /settings/system，
   * 見 settings.routes.ts；2026-09-29 由兩組改為依用途分三組）。路由沒帶 data.settingsGroup 時（例如單元測試直接建立元件）為 null，
   * 顯示全部分頁，維持拆分前的行為。
   */
  readonly settingsGroup: SettingsGroup | null =
    (this.route.snapshot.data['settingsGroup'] as SettingsGroup | undefined) ?? null;
  readonly pageTitle = this.settingsGroup ? SETTINGS_GROUP_TITLE[this.settingsGroup] : '設定';

  /** 分頁按鈕是否出現在這一組（不在這一組的分頁由另一個側邊欄項目負責）。 */
  isTabInGroup(tab: SettingsTab): boolean {
    return this.settingsGroup === null || SETTINGS_TAB_GROUPS[this.settingsGroup].includes(tab);
  }
  readonly stateOptions: readonly SettingsState[] = ['default', 'disabled', 'loading', 'error'];
  readonly activeTab = signal<SettingsTab>('modes');
  readonly pageState = signal<SettingsState>(this.useMockData ? 'default' : 'loading');
  readonly saved = signal(false);
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly activeMode = signal('BALANCED');

  /**
   * 錯誤／警告類提醒一律改用 dialog（DialogService.notify()），不再用行內
   * status-toast——toast 貼在頁面最上方，使用者在「目標區間」「演算法參數」
   * 這類內容較長的分頁往下滑動操作時，toast 出現在畫面外看不到，等於沒有
   * 提醒到。dialog 是置中顯示的原生 <dialog>，不受捲動位置影響。
   *
   * 成功類的操作回饋（已新增／已更新／已停用…）維持原本的 statusMessageState
   * toast：這類訊息通常緊跟在使用者剛按下的按鈕旁邊，本來就看得到，改成
   * dialog 只會讓使用者每個成功操作都要多按一次「我知道了」才能繼續下一步，
   * 沒有對應的好處。
   */
  private showAlert(message: string, title = '操作失敗'): void {
    this.dialog.notify('error', title, [message]).subscribe();
  }

  constructor() {
    // 原本呼叫 autoDismissStatusMessage(this.statusMessage) 的地方拿掉了，
    // 現在的自動消失邏輯已經內建在 createDismissibleMessage() 裡，
    // 不需要另外註冊監看。
    // 原地重新點擊「設定」連結時 ngOnInit() 不會再被觸發，要靠這裡才能
    // 重新抓資料——直接呼叫 loadTab(activeTab())、不經過 setTab() 的
    // loadedTabs 判斷，因為那個判斷本來是「同一個分頁只在第一次切換時載入
    // 一次」的效能優化，這裡的情境是使用者主動要求重新整理，要強制重抓
    // 目前所在的分頁，不能被「已經載入過」擋下來。Mock 模式不套用。
    //
    // 2026-09-24：分頁同步到網址 ?tab= 之後，setTab() 自己改網址也會觸發這個
    // NavigationEnd。網址上的分頁等於目前分頁時就是自己剛同步的，略過；
    // 網址帶了另一個分頁（例如從其他頁面連過來）就切過去；沒帶分頁（使用者
    // 點側邊欄「設定」）則維持原本行為：強制重抓目前分頁。
    if (!this.useMockData) {
      reloadOnRevisit(() => {
        const requested = this.tabFromUrl();
        if (requested === this.activeTab()) return;
        if (requested) {
          this.setTab(requested);
          return;
        }
        this.loadTab(this.activeTab());
      });
    }
  }

  /** 網址 ?tab= 的值，只接受已知、目前開放、且屬於這一組的分頁，其他值一律當作沒帶。 */
  private tabFromUrl(): SettingsTab | null {
    const raw = this.route.snapshot.queryParamMap.get('tab');
    const tab = SETTINGS_TABS.find((candidate) => candidate === raw) ?? null;
    if (tab === 'audience' && !this.audienceSettingsVisible) return null;
    if (tab && !this.isTabInGroup(tab)) return null;
    return tab;
  }

  /** 這一組的預設分頁（組內第一個）；沒有分組時沿用原本的「評估模式」。 */
  private defaultTab(): SettingsTab {
    return this.settingsGroup ? SETTINGS_TAB_GROUPS[this.settingsGroup][0] : 'modes';
  }

  /** 共用清單（見 CustomDefinitionsStore）：評估模式權重編輯器與目標區間要讀。 */
  readonly factorDefinitions = this.definitions.factorDefinitions;

  /**
   * 目標區間（scoreBands）在把後端 payload 轉成 ScoreBandVM 時，因子名稱
   * 要能認得自訂因子（例如 SOCIAL_BUZZ → 社群聲量熱度），不能只查內建七
   * 因子的 FACTOR_LABEL——見 toScoreBandVM()。
   */
  private customFactorNameByCode(): Map<string, string> {
    return new Map(this.factorDefinitions().map((f) => [f.factorCode, f.factorName]));
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
  readonly accounts = signal<AccountVM[]>(this.useMockData ? [...MOCK_ACCOUNTS] : []);
  readonly scoreBands = signal<ScoreBandVM[]>(this.useMockData ? [...MOCK_SCORE_BANDS] : []);
  readonly systemSettings = signal<SystemSettingVM[]>(
    this.useMockData ? [...MOCK_SYSTEM_SETTINGS] : [],
  );

  /** 每個分頁是否已經載入過一次，避免切回去重複打 API。Mock 模式視為全部已載入。 */
  private readonly loadedTabs = new Set<SettingsTab>(this.useMockData ? (
    [
      'modes',
      'risks',
      'audience',
      'productTypes',
      'campaigns',
      'accounts',
      'scoreBands',
      'systemSettings',
      'extensions',
      'weather',
      'jobs',
    ] as const
  ) : []);

  readonly modal = signal<
    null | 'risk' | 'productType' | 'account' | 'resetPassword'
  >(null);
  /** V24：「重設密碼」modal 正在處理的帳號；其餘 modal 為 null。 */
  readonly resettingAccount = signal<AccountVM | null>(null);
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
  readonly isSaving = signal(false);
  /** risk / productType / account 共用的新增/編輯 modal 存檔中狀態（檔期的 modal 已移到子元件）。 */
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
    const initialTab = this.tabFromUrl() ?? this.defaultTab();
    this.activeTab.set(initialTab);
    if (!this.useMockData) this.loadTab(initialTab);
  }

  // ----- 分頁切換與延遲載入 -----

  setTab(tab: SettingsTab): void {
    if (tab === 'audience' && !this.audienceSettingsVisible) {
      this.showAlert('核心客群設定目前暫不開放。', '功能未開放');
      return;
    }
    this.activeTab.set(tab);
    this.syncTabToUrl(tab);
    // 切換分頁本身不需要提示訊息——分頁內容切換的視覺回饋已經很明顯
    // （分頁按鈕的 active 樣式、內容區塊整個換掉），額外跳一句「已切換
    // 設定分類」只是雜訊，不會幫助使用者理解發生了什麼事。
    if (!this.useMockData && !this.loadedTabs.has(tab)) this.loadTab(tab);
  }

  /**
   * 目前分頁寫回網址（replaceUrl，不在瀏覽紀錄堆疊每一次切換）。
   * 在測試或沒有路由的環境下 navigate 失敗不影響分頁切換本身。
   */
  private syncTabToUrl(tab: SettingsTab): void {
    if (this.route.snapshot.queryParamMap.get('tab') === tab) return;
    void this.router
      .navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true })
      .catch(() => undefined);
  }

  /** 子元件「自訂屬性與因子」的下一步連結。 */
  onExtensionsNavigate(tab: CustomExtensionsNextTab): void {
    this.setTab(tab);
  }

  /** 子元件的成功訊息統一走這一頁頁首的 toast。 */
  showStatus(message: string): void {
    this.statusMessageState.show(message);
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
        // 子元件首次渲染時自行載入；這裡只處理「已在這個分頁、要求重新整理」。
        this.festiveCampaigns()?.reload();
        this.markLoaded('campaigns');
        return;
      case 'accounts':
        this.loadAccounts();
        return;
      case 'scoreBands':
        // 2026-09-29：新增品類覆寫要選商品類型、自訂因子要顯示名稱。設定頁分組後，
        // 商品類型分頁在另一個路由，這裡不自己載入的話下拉選單永遠是空的。
        this.definitions.loadFactorDefinitions();
        this.loadProductTypeOptions();
        this.loadScoreBands();
        return;
      case 'systemSettings':
        this.loadSystemSettings();
        return;
      case 'extensions':
        // 屬性的「適用品類」要顯示品類名稱，所以一併載入品類清單。
        this.definitions.loadFactorDefinitions();
        this.definitions.loadCustomFieldDefinitions();
        this.loadProductTypes('extensions');
        return;
      case 'jobs':
        // 三個排程面板（PTT 熱度同步、Google 趨勢、AI 主動選品批次）各自在首次渲染時載入狀態；
        // 這個分頁本身沒有要抓的資料。
        this.markLoaded('jobs');
        return;
      case 'weather':
        // 天氣連動子元件自己管理三個面板的載入狀態（ngOnInit 首次載入）；
        // 這裡只處理「已經在這個分頁、使用者要求重新整理」的情況。
        this.weatherLinkage()?.reload();
        this.markLoaded('weather');
        return;
    }
  }

  private markLoaded(tab: SettingsTab): void {
    this.loadedTabs.add(tab);
    this.pageState.set('default');
  }

  private handleLoadError(err: unknown): void {
    this.pageState.set('error');
    this.showAlert(toApiError(err).message);
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
          // 權重編輯器要列出還沒加入這個模式的自訂因子（weightEditorRows），
          // 目標區間也靠這份清單把因子代碼轉成名稱。自訂屬性清單不再在這裡載入：
          // 新增因子的表單已移到「自訂屬性與因子」分頁，由那個分頁載入。
          this.definitions.loadFactorDefinitions();
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
    // 2026-09-29 修正：已停用的自訂因子不列入編輯器。後端要求送出的清單「恰好」是
    // 目前生效中的因子，停用因子的代碼一送出就被當成未知代碼拒絕——原本自訂模式
    // 只要有任何一個停用的自訂因子，儲存權重就一定失敗。
    const inactiveCodes = this.inactiveCustomFactorCodes();
    const rows = mode.rawFactors
      .filter((f) => !inactiveCodes.has(f.factorCode))
      .map((f) => ({ factorCode: f.factorCode, factorName: f.factorName }));
    const existingCodes = new Set(rows.map((r) => r.factorCode));
    this.factorDefinitions().forEach((definition) => {
      if (definition.isActive && !existingCodes.has(definition.factorCode)) {
        rows.push({ factorCode: definition.factorCode, factorName: definition.factorName });
      }
    });
    return rows;
  });

  /**
   * 已停用、且沒有生效中新版本的自訂因子代碼。評估模式的權重明細（rawFactors）
   * 仍會列出它們在 evaluation_factors 的舊列，但計分只讀生效中的因子。
   *
   * 只排除「清單裡明確是停用」的代碼：自訂因子清單還沒載入時什麼都不排除，
   * 維持後端回傳的原樣，避免把生效中的自訂因子誤當停用而漏送。
   */
  readonly inactiveCustomFactorCodes = computed<Set<string>>(() => {
    const definitions = this.factorDefinitions();
    const activeCodes = new Set(definitions.filter((d) => d.isActive).map((d) => d.factorCode));
    return new Set(definitions.filter((d) => !d.isActive && !activeCodes.has(d.factorCode)).map((d) => d.factorCode));
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
    // 2026-09-29：只為編輯器列出的因子建草稿。停用因子的舊權重若留在草稿裡，
    // 畫面上的「目前加總」會把它算進去，跟實際送出的清單對不上。
    const inactiveCodes = this.inactiveCustomFactorCodes();
    mode.rawFactors.forEach((f) => {
      if (inactiveCodes.has(f.factorCode)) return;
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
      this.showAlert('至少要啟用一個因子，不能全部取消勾選。', '權重設定');
      return;
    }

    const total = this.weightDraftTotal();
    if (Math.abs(total - 100) > 0.01) {
      this.showAlert(`全部因子權重加總須為 100，目前為 ${total}，請調整後再送出。`, '權重設定');
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
          this.showAlert(toApiError(err).message);
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
        error: (err) => this.showAlert(toApiError(err).message),
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
      this.showAlert('請修正客群設定欄位。', '核心客群');
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
          this.showAlert(toApiError(err).message);
        },
      });
  }

  // ----- 4. 商品類型 -----

  /**
   * @param alsoMarkLoaded 「自訂屬性與因子」分頁也需要品類清單（顯示適用品類名稱），
   *   從那個分頁觸發時一併把該分頁標記為已載入。
   */
  private loadProductTypes(alsoMarkLoaded?: SettingsTab): void {
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
          if (alsoMarkLoaded) this.markLoaded(alsoMarkLoaded);
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  /**
   * 只載入商品類型清單供其他分頁的下拉選單使用（例如目標區間的新增品類覆寫），
   * 不改變頁面載入狀態；失敗時維持空清單，由使用者重新整理。
   */
  private loadProductTypeOptions(): void {
    this.api
      .getProductTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) =>
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
          ),
        error: () => undefined,
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
    if (item.id === null) {
      // 按鈕在 id === null 時已經是 disabled 狀態（見 settings.html），
      // 正常操作走不到這裡；保留這個防呆只是避免萬一有別的路徑繞過
      // disabled 判斷時，使用者點了卻完全沒反應。
      this.showAlert('這筆資料尚未就緒，請重新整理頁面後再試一次。', '無法操作');
      return;
    }
    const request = active ? this.api.enableRiskOption(item.id) : this.api.disableRiskOption(item.id);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: apply,
      error: (err) => this.showAlert(toApiError(err).message),
    });
  }

  private performRemoveProductType(name: string, item: ProductTypeVM): void {
    if (this.useMockData) {
      if (item.used && item.used > 0) {
        this.showAlert('此類型已被品項使用，不可刪除，請改為停用。', '無法刪除');
        return;
      }
      // 大類（level=1）就算自己 used=0（商品只能掛在小類，大類的 used
      // 恆為 0），只要底下還有小類就不能刪除，否則小類會變成孤兒資料，
      // 跟真實 API 的 existsByParentId() 檢查對齊。
      const hasChildren = this.productTypes().some((type) => type.parentId === item.id);
      if (hasChildren) {
        this.showAlert('此大類底下仍有小類，請先刪除或搬移小類，無法直接刪除。', '無法刪除');
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
          this.showAlert(toApiError(err).message);
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
        error: (err) => this.showAlert(toApiError(err).message),
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
        error: (err) => this.showAlert(toApiError(err).message),
      });
  }

  // ----- 5. 節慶檔期 -----
  // 2026-09-24（V21 檔期規則改版）：列表、表單、狀態切換、標籤選擇、逐年覆寫都搬到
  // tabs/festive-campaigns 子元件，由子元件自行載入。

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

  /**
   * 這一列是不是目前登入的自己（2026-09-23 由分支整併）。
   *
   * 後端會擋「不可停用自己的帳號」（409），但那是撞到才知道；這裡先在
   * 畫面上把自己那一列的停用按鈕 disable，讓使用者根本不會撞到這個錯誤。
   * 後端的檢查仍是真正的防線，前端只是事先防呆。
   */
  isSelfAccount(item: AccountVM): boolean {
    return item.id !== null && item.id === this.auth.currentUser()?.id;
  }

  /**
   * 依目前狀態決定要停用還是復用，樣板只需要綁定同一個方法。
   *
   * 停用是即時生效的操作（對方下一個請求就會被擋下），跟同頁「刪除商品
   * 類型」「停用風險選項」一樣先確認（2026-09-23 由分支整併）；復用沒有
   * 這個風險，不需要確認。
   */
  toggleAccountActive(username: string): void {
    const item = this.accounts().find((account) => account.username === username);
    if (!item) return;
    if (!item.active) {
      this.restoreAccount(username);
      return;
    }
    if (this.isSelfAccount(item)) return;
    this.dialog
      .confirm(
        '確認停用帳號',
        [
          `即將停用「${item.name}」（${item.username}）的帳號。`,
          '停用是即時生效的：對方就算已經登入，下一個請求就會被擋下，請確認對方目前沒有操作到一半。',
        ],
        '確定停用',
        '取消',
      )
      .subscribe((confirmed) => {
        if (confirmed) this.disableAccount(username);
      });
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
          this.showAlert(error.message, '無法停用帳號');
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
        error: (err) => this.showAlert(toApiError(err).message),
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
              this.scoreBands.set(list.map((band) => toScoreBandVM(band, nameById, this.customFactorNameByCode())));
              this.markLoaded('scoreBands');
            });
        },
        error: (err) => this.handleLoadError(err),
      });
  }

  // ----- 8. 設定（計分與判定參數，原「演算法參數」）-----

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

  /**
   * 滑桿旁的手動輸入框（2026-09-23 分支整併，依決策 E）：直接寫入草稿值、
   * **不**套用 snapSettingValue() 的倍數收斂——手動輸入的用途就是讓使用者
   * 打一個滑桿格線以外的精確數字；滑桿本身拖曳時仍維持 sliderStep() 的
   * 業務顆粒度。範圍與型別仍由 saveSystemSetting() 在送出時檢查。
   */
  protected onSliderManualInput(value: unknown): void {
    this.systemSettingDraftValue.set(this.toDraftValue(value));
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
      this.showAlert('設定值不可為空。', '驗證失敗');
      return;
    }
    if (setting.dataType !== 'STRING') {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        this.showAlert(`${setting.displayName} 必須是數字。`, '驗證失敗');
        return;
      }
      if (setting.dataType === 'INTEGER' && !Number.isInteger(parsed)) {
        this.showAlert(`${setting.displayName} 必須是整數。`, '驗證失敗');
        return;
      }
      if (setting.minValue !== null && parsed < setting.minValue) {
        this.showAlert(`${setting.displayName} 不可小於 ${setting.minValue}。`, '驗證失敗');
        return;
      }
      if (setting.maxValue !== null && parsed > setting.maxValue) {
        this.showAlert(`${setting.displayName} 不可大於 ${setting.maxValue}。`, '驗證失敗');
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
          this.showAlert(toApiError(err).message);
        },
      });
  }

  /**
   * 目標區間清單的顯示用版本：因子名稱隨自訂因子清單即時更新。
   * 2026-09-29：自訂因子清單與目標區間是兩支 API，清單晚到時，原本在 toScoreBandVM()
   * 算好的名稱會停在代碼（例如顯示 SOCIAL_BUZZ 而不是「社群聲量熱度」）。
   */
  private readonly labeledScoreBands = computed(() => {
    const names = this.customFactorNameByCode();
    return this.scoreBands().map((b) => ({
      ...b,
      factorLabel: FACTOR_LABEL[b.factorCode] ?? names.get(b.factorCode) ?? b.factorLabel,
    }));
  });

  /** 全域預設（productTypeId 為 null）的列。 */
  readonly globalScoreBands = computed(() => this.labeledScoreBands().filter((b) => b.productTypeId === null));

  /** 各商品類型覆寫的列。 */
  readonly overrideScoreBands = computed(() => this.labeledScoreBands().filter((b) => b.productTypeId !== null));

  /**
   * 「依歷史紀錄計算」只支援品類覆寫的毛利率／折扣深度（見後端 applyHistoricalBand()）。
   * 其他列不顯示這個選項，免得選了才被後端拒絕。
   */
  supportsHistoricalBand(band: ScoreBandVM): boolean {
    return band.productTypeId !== null && HISTORICAL_BAND_FACTORS.includes(band.factorCode);
  }

  /**
   * 新增品類覆寫可選的商品類型：只列生效中的大類。
   * 計分時一律用商品所屬的大類查區間（ScoreBandResolver），掛在小類上的區間永遠不會被讀到。
   */
  readonly scoreBandProductTypeOptions = computed(() =>
    this.productTypes().filter((t) => t.level === 1 && t.active),
  );

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
  readonly scoreBandFactorOptions = computed<readonly { code: string; label: string }[]>(() => [
    { code: 'MARGIN_RATE', label: FACTOR_LABEL['MARGIN_RATE'] },
    { code: 'DISCOUNT_DEPTH', label: FACTOR_LABEL['DISCOUNT_DEPTH'] },
    // 2026-09-29：策略為「目標區間正規化」的生效中自訂因子（例如社群聲量熱度）
    // 計分時同樣依品類查目標區間，也要能設定品類覆寫。
    ...this.factorDefinitions()
      .filter((d) => d.isActive && d.strategyCode === 'TARGET_BAND_NORMALIZE')
      .map((d) => ({ code: d.factorCode, label: d.factorName })),
  ]);

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
      this.showAlert('請選擇商品類型。', '驗證失敗');
      return;
    }
    if (upperBound <= lowerBound) {
      this.showAlert('上界必須大於下界。', '驗證失敗');
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
              this.scoreBands.update((items) => [...items, toScoreBandVM(created, nameById, this.customFactorNameByCode())]);
              this.isSavingNewScoreBand.set(false);
              this.cancelCreateScoreBand();
              this.statusMessageState.show('已新增品類專屬目標區間。');
            });
        },
        error: (err) => {
          this.isSavingNewScoreBand.set(false);
          // 品類×因子已存在時後端回 400，訊息已包含「請改用編輯」的提示，原樣顯示即可。
          this.showAlert(toApiError(err).message);
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
                items.map((item) => (item.id === id ? toScoreBandVM(updated, nameById, this.customFactorNameByCode()) : item)),
              );
              this.isSavingScoreBand.set(false);
              this.cancelScoreBandEdit();
              this.statusMessageState.show('目標區間已更新。');
            });
        },
        error: (err) => {
          this.isSavingScoreBand.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  // ----- Modal 通用邏輯 -----

  openModal(type: Exclude<ReturnType<typeof this.modal>, null>): void {
    this.modal.set(type);
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

  /**
   * V27：只能重設「本人已在登入頁申請」的帳號，且不能是自己。
   * 前端停用按鈕只是防呆；後端沒有待處理申請一律回 409。
   */
  canResetPassword(item: AccountVM): boolean {
    return !this.isSelfAccount(item) && !!item.passwordResetRequestedAt;
  }

  /** 重設密碼按鈕停用時的說明（hover 提示）。 */
  resetPasswordDisabledReason(item: AccountVM): string | null {
    if (this.isSelfAccount(item)) return '自己的密碼請到個人資料頁修改';
    if (!item.passwordResetRequestedAt) return '使用者尚未申請重設密碼（申請入口在登入頁「忘記密碼」）';
    return null;
  }

  /**
   * V27：駁回重設密碼申請（例如無法確認是本人提出）。密碼不變，使用者之後可以再申請。
   * 駁回是可回復的操作（使用者重新申請即可），但仍先確認，避免誤點。
   */
  rejectPasswordResetRequest(item: AccountVM): void {
    if (!item.passwordResetRequestedAt) return;
    this.dialog
      .confirm(
        '駁回重設密碼申請',
        [`即將駁回「${item.name}」（${item.username}）的重設密碼申請。`, '密碼不會變更；對方之後可以再次申請。'],
        '確定駁回',
        '取消',
      )
      .subscribe((confirmed) => {
        if (!confirmed) return;
        if (this.useMockData || !item.id) {
          this.accounts.update((items) =>
            items.map((account) =>
              account.username === item.username ? { ...account, passwordResetRequestedAt: null } : account,
            ),
          );
          this.statusMessageState.show('已駁回重設密碼申請。');
          return;
        }
        this.userApi
          .rejectPasswordResetRequest(item.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (updated) => {
              this.accounts.update((items) =>
                items.map((account) => (account.id === updated.id ? toAccountVM(updated) : account)),
              );
              this.statusMessageState.show('已駁回重設密碼申請。');
            },
            error: (err) => {
              const error = toApiError(err);
              this.showAlert(error.message, '無法駁回申請');
              // V28：409 可能是使用者已用原密碼登入、申請自動取消；重新載入讓標示同步。
              if (error.status === 409) this.loadAccounts();
            },
          });
      });
  }

  /**
   * V24：開啟「重設密碼」modal。臨時密碼由管理者輸入（沿用新增帳號的密碼欄位），
   * 對方下次登入時必須先改掉它，管理者不會長期知道對方正在使用的密碼。
   */
  openResetPasswordModal(item: AccountVM): void {
    if (!this.canResetPassword(item)) return;
    this.resettingAccount.set(item);
    this.draftPassword.set('');
    this.modal.set('resetPassword');
  }

  closeModal(): void {
    this.modal.set(null);
    this.resettingAccount.set(null);
    this.isSavingModal.set(false);
    this.draftName.set('');
    this.draftKeywords.set('');
    this.draftUsername.set('');
    this.draftPassword.set('');
    this.editingRiskOptionId.set(null);
    this.editingProductTypeId.set(null);
    this.draftProductTypeLevel.set(1);
    this.draftProductTypeParentId.set(null);
    this.draftKeywordChips.set([]);
    this.draftKeywordInput.set('');
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
          mustChangePassword: true,
          passwordResetRequestedAt: null,
        },
      ]);
    } else if (type === 'resetPassword' && this.draftPassword().length >= PASSWORD_MIN_LENGTH) {
      const target = this.resettingAccount()?.username;
      this.accounts.update((items) =>
        items.map((item) =>
          item.username === target ? { ...item, mustChangePassword: true, passwordResetRequestedAt: null } : item,
        ),
      );
    } else {
      this.showAlert('請完整填寫必填欄位。', '驗證失敗');
      return;
    }
    this.statusMessageState.show('已儲存至本地 Mock 狀態。');
    this.closeModal();
  }

  private saveModalReal(type: ReturnType<typeof this.modal>): void {
    if (type === 'risk') {
      const keywords = this.draftKeywordChips().join('、');
      if (!this.draftName().trim() || this.draftKeywordChips().length === 0) {
        this.showAlert('請完整填寫必填欄位。', '驗證失敗');
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
              this.showAlert(toApiError(err).message);
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
            this.showAlert(toApiError(err).message);
          },
        });
      return;
    }

    if (type === 'productType') {
      if (!this.draftName().trim()) {
        this.showAlert('請輸入類型名稱。', '驗證失敗');
        return;
      }
      const editingTypeId = this.editingProductTypeId();

      // ⚠️ 只在「新增」流程檢查層級：編輯既有類型（改名）不動層級/上層大類，
      // draftProductTypeLevel 只是新增用的暫存選擇，不該套用到編輯上。
      if (editingTypeId === null && this.draftProductTypeLevel() === 2 && this.draftProductTypeParentId() === null) {
        this.showAlert('請選擇這個小類要掛在哪個大類底下。', '驗證失敗');
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
              this.showAlert(toApiError(err).message);
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
            this.showAlert(toApiError(err).message);
          },
        });
      return;
    }

    if (type === 'resetPassword') {
      const target = this.resettingAccount();
      if (!target?.id) return;
      if (this.draftPassword().length < PASSWORD_MIN_LENGTH) {
        this.showAlert(`臨時密碼至少 ${PASSWORD_MIN_LENGTH} 碼。`, '驗證失敗');
        return;
      }
      this.isSavingModal.set(true);
      this.userApi
        .resetPassword(target.id, { newPassword: this.draftPassword() })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (updated) => {
            this.accounts.update((items) =>
              items.map((item) => (item.id === updated.id ? toAccountVM(updated) : item)),
            );
            this.statusMessageState.show(
              `已重設「${target.name}」的密碼；對方目前的登入已失效，下次登入需先修改密碼。`,
            );
            this.closeModal();
          },
          error: (err) => {
            this.isSavingModal.set(false);
            // 不可重設自己（409）等業務錯誤直接顯示後端訊息。
            const error = toApiError(err);
            this.showAlert(error.message, '無法重設密碼');
            // V28：申請可能已因使用者用原密碼登入而自動取消；關閉視窗並重新載入帳號清單，
            // 讓「申請重設密碼」標示與按鈕狀態回到最新。
            if (error.status === 409) {
              this.closeModal();
              this.loadAccounts();
            }
          },
        });
      return;
    }

    if (type === 'account') {
      if (!this.draftUsername().trim() || !this.draftName().trim() || this.draftPassword().trim().length < 8) {
        this.showAlert('請完整填寫必填欄位，密碼至少 8 碼。', '驗證失敗');
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
            this.statusMessageState.show('已新增帳號；對方第一次登入時需先修改密碼。');
            this.closeModal();
          },
          error: (err) => {
            this.isSavingModal.set(false);
            // username 重複時後端回 400，直接顯示訊息，讓使用者知道要換一個帳號名。
            this.showAlert(toApiError(err).message);
          },
        });
      return;
    }
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
  customFactorNameByCode: Map<string, string>,
): ScoreBandVM {
  return {
    id: payload.id,
    productTypeId: payload.productTypeId,
    productTypeName:
      payload.productTypeId === null ? '全域預設' : productTypeNameById.get(payload.productTypeId) ?? '—',
    factorCode: payload.factorCode,
    // 內建七因子查 FACTOR_LABEL；查不到再查自訂因子清單（factor_definitions.
    // factorName，例如 SOCIAL_BUZZ → 社群聲量熱度）；兩邊都查不到才顯示代碼本身
    // ——理論上不會發生，除非目標區間引用了一個已被刪除的自訂因子。
    factorLabel:
      FACTOR_LABEL[payload.factorCode] ?? customFactorNameByCode.get(payload.factorCode) ?? payload.factorCode,
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

function toAccountVM(payload: UserAccountResponsePayload): AccountVM {
  return {
    id: payload.id,
    username: payload.username,
    name: payload.name,
    role: payload.role,
    active: payload.enabled ?? true,
    mustChangePassword: payload.mustChangePassword === true,
    passwordResetRequestedAt: payload.passwordResetRequestedAt ?? null,
  };
}

/** 後端 keywords 可能用逗號、頓號或空白混雜分隔，統一轉成頓號顯示比較符合中文閱讀習慣。 */
function joinKeywordsForDisplay(keywords: string | null): string {
  if (!keywords) return '';
  return splitKeywords(keywords).join('、');
}
