/**
 * 檔案用途：系統設定 › 「天氣連動」分頁：天氣檔期同步、天氣訊號標籤對照、地域占比。
 *
 * 2026-09-24 拆分（決策 D5）。三塊原本擠在「節慶檔期」分頁、檔期列表上方，
 * 抽成獨立分頁的理由：
 *   1. 三者是同一條連動鏈——對照表決定同步時會產生哪些天氣檔期，地域占比
 *      決定加成的地域覆蓋率打幾折（後端只有 WeatherCampaignSyncService
 *      使用 RegionWeight）。
 *   2. 設定頻率不同：這裡是設一次就少動的參數，檔期列表才是日常操作對象，
 *      放在同一頁讓主角被擠到最下方。
 *
 * 程式邏輯原樣搬自 settings.ts（2026-09-21～23 新增的三組功能），差異只有：
 *   - 成功訊息改用 status 輸出交給父元件 toast；錯誤仍直接開 dialog。
 *   - 同步成功後原本直接重載檔期列表，改成 campaignsChanged 通知父元件。
 *   - 操作訊息中的天氣類型改顯示中文，不再露出 RAINY 這類代碼。
 * 樣式改用全域 .config-panel／.config-table（見 _components.scss）。
 *
 * 2026-09-24（決議 A）：天氣檔期從「節慶檔期」分頁移到這裡——「天氣檔期自動同步」面板下
 * 新增「目前的天氣檔期」唯讀清單（準備期／進行中＋手動覆蓋中），保留切換狀態（主管判斷
 * 系統誤判時的復原路徑）。切換狀態沿用既有 manual-status 端點，不另開 API。
 */
import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { FestiveCampaignStatus, TagMatchTier, WeatherSignalType } from '../../../../core/domain/enums';
import {
  WEATHER_FORECAST_CONFIDENCE_LABEL,
  WEATHER_REGION_LABEL,
  WEATHER_SIGNAL_TYPE_LABEL,
} from '../../../../core/domain/labels';
import { Icon } from '../../../../shared/components/icon/icon';
import {
  FestiveCampaignResponsePayload,
  RegionWeightPayload,
  WeatherSignalPreviewPayload,
  WeatherSignalTagMappingResponsePayload,
} from '../../api/settings-api.contract';
import { SettingsApiService } from '../../api/settings-api.service';

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

/**
 * 天氣檔期狀態的中文。天氣型沒有「本期」概念，EXPIRED 顯示「已結束」（節慶頁是「本期停用」）；
 * 同步服務只會寫 PREPARING／ACTIVE／EXPIRED，UPCOMING 僅防禦顯示用。
 */
export const WEATHER_CAMPAIGN_STATUS_LABEL: Record<FestiveCampaignStatus, string> = {
  UPCOMING: '即將開始',
  PREPARING: '準備期',
  ACTIVE: '進行中',
  EXPIRED: '已結束',
};

/** 手動指定時可選的狀態：與同步服務會產生的狀態一致，不提供 UPCOMING。 */
const WEATHER_CAMPAIGN_STATUS_OPTIONS: readonly FestiveCampaignStatus[] = ['PREPARING', 'ACTIVE', 'EXPIRED'];

/** 命中等級的中文。跟「節慶檔期」標籤的 核心／一般／弱 同一套用語。 */
const MATCH_TIER_OPTIONS: readonly { value: TagMatchTier; label: string }[] = [
  { value: 'CORE', label: '核心' },
  { value: 'GENERAL', label: '一般' },
  { value: 'WEAK', label: '弱' },
];

@Component({
  selector: 'app-weather-linkage',
  imports: [FormsModule, DatePipe, Icon],
  templateUrl: './weather-linkage.html',
  styleUrl: './weather-linkage.scss',
})
export class WeatherLinkage implements OnInit {
  private readonly api = inject(SettingsApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly weatherSignalTypeLabel = WEATHER_SIGNAL_TYPE_LABEL;
  readonly weatherForecastConfidenceLabel = WEATHER_FORECAST_CONFIDENCE_LABEL;
  readonly weatherRegionLabel = WEATHER_REGION_LABEL;
  readonly matchTierOptions = MATCH_TIER_OPTIONS;

  /** 父元件的「停用」示範狀態（pageState === 'disabled'）。 */
  readonly disabled = input(false);
  /** 成功類操作回饋，交給父元件既有的 toast 顯示。 */
  readonly status = output<string>();
  /** 天氣同步寫入了檔期，父元件據此讓「節慶檔期」分頁下次重新載入。 */
  readonly campaignsChanged = output<void>();

  ngOnInit(): void {
    this.reload();
  }

  /** 父元件切到這個分頁、或使用者原地重點「系統設定」時呼叫。 */
  reload(): void {
    this.loadWeatherCampaigns();
    this.loadWeatherSignalTagMappings();
    this.loadRegionWeights();
  }

  /**
   * 加總狀態：送出按鈕 disabled 只是暗示，這裡讓畫面直接顯示「對／不對」。
   * 用 0.01 容差，避免 33.33+33.33+33.34 這類小數加總出現浮點誤差被誤判。
   */
  readonly regionWeightSumState = computed<'ok' | 'error'>(() =>
    Math.abs(this.regionWeightDraftSum() - 100) <= 0.01 ? 'ok' : 'error',
  );

  /** 四區占比的即時預覽長條（依草稿值，不是已儲存值），加總不為 100 時仍依比例畫。 */
  readonly regionWeightBar = computed(() => {
    const drafts = this.regionWeightDrafts();
    const total = Object.values(drafts).reduce((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
    return this.regionWeights().map((item) => {
      const value = Math.max(0, Number(drafts[item.region]) || 0);
      return {
        region: item.region,
        label: this.weatherRegionLabel[item.region] ?? item.region,
        value,
        share: total > 0 ? (value / total) * 100 : 0,
      };
    });
  });

  /** 單一區域的占比超出 0～100（或不是數字）時，欄位本身標紅，不必等到看加總才發現。 */
  isRegionWeightOutOfRange(region: string): boolean {
    const raw = this.regionWeightDrafts()[region];
    if (raw === undefined || raw === null || String(raw).trim() === '') return true;
    const value = Number(raw);
    return Number.isNaN(value) || value < 0 || value > 100;
  }

  private showAlert(message: string, title = '操作失敗'): void {
    this.dialog.notify('error', title, [message]).subscribe();
  }

  // ==================================================================
  // 目前的天氣檔期（2026-09-24，決議 A）
  // ==================================================================

  readonly campaignStatusLabel = WEATHER_CAMPAIGN_STATUS_LABEL;
  readonly campaignStatusOptions = WEATHER_CAMPAIGN_STATUS_OPTIONS;
  readonly weatherCampaigns = signal<FestiveCampaignResponsePayload[]>([]);
  readonly weatherCampaignsLoading = signal(false);
  readonly weatherCampaignsError = signal('');

  loadWeatherCampaigns(): void {
    if (this.useMockData) return;
    this.weatherCampaignsLoading.set(true);
    this.weatherCampaignsError.set('');
    this.api
      .getCurrentWeatherCampaigns()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.weatherCampaigns.set(list);
          this.weatherCampaignsLoading.set(false);
        },
        error: (err) => {
          this.weatherCampaignsLoading.set(false);
          this.weatherCampaignsError.set(toApiError(err).message);
        },
      });
  }

  /** 命中標籤顯示用：「雨具、防水」。 */
  campaignTagsText(item: FestiveCampaignResponsePayload): string {
    return item.tags.map((t) => t.tag).join('、') || '—';
  }

  /** 地域覆蓋率（0～1）轉百分比文字；後端未給值時顯示「—」。 */
  coverageText(item: FestiveCampaignResponsePayload): string {
    if (item.regionCoverageRatio === null || item.regionCoverageRatio === undefined) return '—';
    return `${Math.round(Number(item.regionCoverageRatio) * 100)}%`;
  }

  readonly statusTarget = signal<FestiveCampaignResponsePayload | null>(null);
  readonly draftStatus = signal<FestiveCampaignStatus>('ACTIVE');
  readonly draftManualOverride = signal(true);
  readonly statusSaving = signal(false);

  /** 如實回填目前狀態與是否手動覆蓋：打開來看、直接儲存不會意外改變設定。 */
  openStatus(item: FestiveCampaignResponsePayload): void {
    this.statusTarget.set(item);
    this.draftStatus.set(item.campaignStatus);
    this.draftManualOverride.set(item.isManualOverride ?? false);
    this.statusSaving.set(false);
  }

  closeStatus(): void {
    this.statusTarget.set(null);
    this.statusSaving.set(false);
  }

  /**
   * 恢復自動判斷時送目前狀態（後端會依實際起訖日重算），不送下拉選單的值。
   * 成功後整份重載：恢復自動後狀態可能變成已結束而不再屬於這份清單，逐列替換會留下殘列。
   */
  applyStatus(): void {
    const target = this.statusTarget();
    if (!target || this.statusSaving()) return;
    const overrideEnabled = this.draftManualOverride();
    if (this.useMockData) {
      this.closeStatus();
      return;
    }
    this.statusSaving.set(true);
    this.api
      .switchFestiveCampaignStatus(target.id, {
        status: overrideEnabled ? this.draftStatus() : target.campaignStatus,
        overrideEnabled,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.status.emit(overrideEnabled ? '已手動切換天氣檔期狀態。' : '已恢復由天氣同步判斷。');
          this.closeStatus();
          this.loadWeatherCampaigns();
        },
        error: (err) => {
          this.statusSaving.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

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
    // 四捨五入到小數兩位再顯示／比較：33.33 + 33.33 + 33.34 在浮點數下不會剛好是 100。
    const raw = Object.values(drafts).reduce((sum, value) => sum + (Number(value) || 0), 0);
    return Math.round(raw * 100) / 100;
  });

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
      this.showAlert('Mock 模式沒有真實天氣資料可預覽，請切換到已串接後端的環境測試。', '功能限制');
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
          this.showAlert(toApiError(err).message);
        },
      });
  }

  /**
   * 手動觸發一次完整天氣檔期同步（WeatherController，POST /sync），跟每天
   * 05:00排程呼叫的是後端同一支方法，行為完全一致。成功後重新載入檔期
   * 清單，讓下方表格立刻反映這次同步的結果，不用使用者自己按重新整理；
   * 同時清空預覽結果——預覽的內容此時已經落地或過期，繼續顯示只會誤導。
   * 2026-09-24：檔期列表已在另一個分頁，改為發出 campaignsChanged 讓父元件標記重載。
   */
  syncWeatherCampaigns(): void {
    if (this.useMockData) {
      this.showAlert('Mock 模式無法觸發真實天氣同步。', '功能限制');
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
          this.status.emit(
            `天氣檔期同步完成：共${result.totalSignalCount}個訊號、更新${result.syncedCampaignCount}筆檔期${expiredNote}。`,
          );
          // 同步結果直接反映在下方「目前的天氣檔期」；父元件的通知保留給其他依賴檔期資料的畫面。
          this.loadWeatherCampaigns();
          this.campaignsChanged.emit();
        },
        error: (err) => {
          this.weatherSyncing.set(false);
          this.showAlert(toApiError(err).message);
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
          this.showAlert(toApiError(err).message);
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
      this.showAlert(`四區占比加總須為100，目前為：${sum}`, '驗證失敗');
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
      this.status.emit('已更新（Mock 模式，未實際送出）。');
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
          this.status.emit('區域占比已更新。');
        },
        error: (err) => {
          this.regionWeightSaving.set(false);
          this.showAlert(toApiError(err).message);
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
          this.showAlert(toApiError(err).message);
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
      this.showAlert('請選擇天氣訊號類型。', '驗證失敗');
      return;
    }
    if (!tag) {
      this.showAlert('請輸入標籤內容。', '驗證失敗');
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
      this.status.emit(`已新增對照：${this.weatherSignalTypeLabel[weatherSignalType]} → ${tag}`);
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
          this.status.emit(`已新增對照：${this.weatherSignalTypeLabel[created.weatherSignalType]} → ${created.tag}`);
        },
        error: (err) => {
          this.weatherSignalTagMappingSaving.set(false);
          this.showAlert(toApiError(err).message);
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
        error: (err) => this.showAlert(toApiError(err).message),
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
      this.status.emit(
        `已${nextActive ? '啟用' : '停用'}對照：${this.weatherSignalTypeLabel[item.weatherSignalType]} → ${item.tag}`,
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
      error: (err) => this.showAlert(toApiError(err).message),
    });
  }
}
