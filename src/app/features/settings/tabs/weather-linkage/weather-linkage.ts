/**
 * 檔案用途：系統設定 › 「天氣連動」分頁（V26，2026-09-25 改版）。
 *
 * 決議：系統不再有天氣檔期，天氣改為依每日天氣數據直接計算的獨立「天氣加成」，與節慶加成並列：
 *   最終分數 = 加權總分 + 節慶加成 + 天氣加成
 *   天氣加成 = (歷史天氣分 × 歷史比重% + 預測天氣分 × 預測比重%) ÷ 100 × 加成上限
 *
 * 這個分頁由上而下是同一條計算鏈的四個設定：
 *   1. 天氣資料：四區每日天氣資料的涵蓋天數與「資料更新時間」，可手動觸發同步。
 *   2. 天氣加成設定：歷史／預測比重（加總 100）與加成上限（0～10）。
 *   3. 天氣訊號標籤對照：哪種天氣命中哪些商品標籤、命中等級（決定逐日命中分數）。
 *   4. 地域占比：四區天氣分的加權依據（季節檔期的區域覆蓋率也用同一份占比）。
 *
 * 原本的「天氣檔期自動同步／訊號預覽／目前的天氣檔期與切換狀態」隨天氣檔期一併移除。
 * 成功訊息用 status 輸出交給父元件 toast；錯誤直接開 dialog。
 */
import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { TagMatchTier, WeatherSignalType } from '../../../../core/domain/enums';
import {
  WEATHER_REGION_COVERAGE_NOTE,
  WEATHER_REGION_LABEL,
  WEATHER_SIGNAL_TYPE_LABEL,
  weatherRegionCitiesText,
} from '../../../../core/domain/labels';
import {
  RegionWeightPayload,
  WeatherBoostSettingsPayload,
  WeatherDataStatusPayload,
  WeatherSignalTagMappingResponsePayload,
} from '../../api/settings-api.contract';
import { SettingsApiService } from '../../api/settings-api.service';

/**
 * 天氣訊號標籤對照的「天氣類型」下拉選項，刻意排除 NORMAL——一般天氣不該
 * 命中任何商品（WeatherBoostService 的逐日命中本來就不會用到），後端 SettingsService
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

/** 天氣加成上限的範圍上限（後端 WeatherBoostService 同一個值）。 */
const BOOST_CAP_MAX = 10;

/** Mock 模式的天氣加成設定：與 V26 migration 的預設值一致。 */
const MOCK_BOOST_SETTINGS: WeatherBoostSettingsPayload = {
  historyWeightPercentage: 60,
  forecastWeightPercentage: 40,
  boostCap: 5,
  historyDays: 30,
  forecastDays: 14,
  updatedAt: null,
};

/** 同步結果訊息：區域代碼轉中文；失敗與冷啟動的區域另外註明。 */
export function syncResultMessage(synced: string[], failed: string[], coldStart: string[]): string {
  const label = (codes: string[]) => codes.map((code) => WEATHER_REGION_LABEL[code] ?? code).join('、');
  const parts = [`天氣資料同步完成：${synced.length > 0 ? label(synced) : '無'}已更新`];
  if (coldStart.length > 0) parts.push(`${label(coldStart)}已補齊過去 30 天`);
  if (failed.length > 0) parts.push(`${label(failed)}取得失敗（保留既有資料，下次排程重試）`);
  return `${parts.join('；')}。`;
}

/** 命中等級的中文。跟「節慶檔期」標籤的 核心／一般／弱 同一套用語。 */
const MATCH_TIER_OPTIONS: readonly { value: TagMatchTier; label: string }[] = [
  { value: 'CORE', label: '核心' },
  { value: 'GENERAL', label: '一般' },
  { value: 'WEAK', label: '弱' },
];

@Component({
  selector: 'app-weather-linkage',
  imports: [FormsModule, DatePipe],
  templateUrl: './weather-linkage.html',
  styleUrl: './weather-linkage.scss',
})
export class WeatherLinkage implements OnInit {
  private readonly api = inject(SettingsApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly weatherSignalTypeLabel = WEATHER_SIGNAL_TYPE_LABEL;
  readonly weatherRegionLabel = WEATHER_REGION_LABEL;
  /** 2026-09-29：每區實際涵蓋（取樣）的縣市提醒。 */
  readonly regionCities = weatherRegionCitiesText;
  readonly regionCoverageNote = WEATHER_REGION_COVERAGE_NOTE;
  readonly matchTierOptions = MATCH_TIER_OPTIONS;

  /** 父元件的「停用」示範狀態（pageState === 'disabled'）。 */
  readonly disabled = input(false);
  /** 成功類操作回饋，交給父元件既有的 toast 顯示。 */
  readonly status = output<string>();

  ngOnInit(): void {
    this.reload();
  }

  /** 父元件切到這個分頁、或使用者原地重點「系統設定」時呼叫。 */
  reload(): void {
    this.loadWeatherStatus();
    this.loadBoostSettings();
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
  // 天氣資料狀態與手動同步（V26：天氣不再產生檔期，只同步每日天氣資料）
  // ==================================================================

  readonly weatherStatus = signal<WeatherDataStatusPayload | null>(null);
  readonly weatherStatusLoading = signal(false);
  readonly weatherStatusError = signal('');
  readonly weatherSyncing = signal(false);

  loadWeatherStatus(): void {
    if (this.useMockData) return;
    this.weatherStatusLoading.set(true);
    this.weatherStatusError.set('');
    this.api
      .getWeatherStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.weatherStatus.set(status);
          this.weatherStatusLoading.set(false);
        },
        error: (err) => {
          this.weatherStatusLoading.set(false);
          this.weatherStatusError.set(toApiError(err).message);
        },
      });
  }

  /** 某區歷史天數未達冷啟動門檻：下次同步會自動補齊過去 30 天。 */
  isHistoryIncomplete(historyDayCount: number): boolean {
    const status = this.weatherStatus();
    return !!status && historyDayCount < status.coldStartThresholdDays;
  }

  /**
   * 手動觸發一次每日天氣資料同步（POST /sync），與每天 05:00 排程是後端同一支方法。
   * 完成後後端會重算尚未核准商品的加成；這裡重新載入資料狀態，讓「資料更新時間」立即反映。
   */
  syncWeatherData(): void {
    if (this.useMockData) {
      this.showAlert('Mock 模式無法觸發真實天氣同步。', '功能限制');
      return;
    }
    this.weatherSyncing.set(true);
    this.api
      .syncWeatherData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.weatherSyncing.set(false);
          this.status.emit(syncResultMessage(result.syncedRegions, result.failedRegions, result.coldStartRegions));
          this.loadWeatherStatus();
        },
        error: (err) => {
          this.weatherSyncing.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  // ==================================================================
  // 天氣加成設定（V26）：歷史／預測比重（加總 100）與加成上限
  // ==================================================================

  readonly boostSettings = signal<WeatherBoostSettingsPayload | null>(this.useMockData ? MOCK_BOOST_SETTINGS : null);
  readonly boostSettingsLoading = signal(false);
  readonly boostSettingsSaving = signal(false);
  readonly draftHistoryWeight = signal(this.useMockData ? String(MOCK_BOOST_SETTINGS.historyWeightPercentage) : '');
  readonly draftForecastWeight = signal(this.useMockData ? String(MOCK_BOOST_SETTINGS.forecastWeightPercentage) : '');
  readonly draftBoostCap = signal(this.useMockData ? String(MOCK_BOOST_SETTINGS.boostCap) : '');

  /** 比重加總（0.01 容差，理由同地域占比）與上限範圍的即時驗證。 */
  readonly boostWeightSum = computed(
    () => Math.round(((Number(this.draftHistoryWeight()) || 0) + (Number(this.draftForecastWeight()) || 0)) * 100) / 100,
  );
  readonly boostSettingsError = computed(() => {
    const history = Number(this.draftHistoryWeight());
    const forecast = Number(this.draftForecastWeight());
    const cap = Number(this.draftBoostCap());
    if ([this.draftHistoryWeight(), this.draftForecastWeight(), this.draftBoostCap()].some((v) => v.trim() === '')) {
      return '三個欄位皆為必填。';
    }
    if ([history, forecast, cap].some((v) => Number.isNaN(v))) return '請輸入數字。';
    if (history < 0 || forecast < 0) return '比重不可為負數。';
    if (Math.abs(this.boostWeightSum() - 100) > 0.01) return `歷史與預測比重加總須為 100（目前 ${this.boostWeightSum()}）。`;
    if (cap < 0 || cap > BOOST_CAP_MAX) return `加成上限須介於 0～${BOOST_CAP_MAX} 分。`;
    return '';
  });

  /** 試算說明：天氣分 100（整段期間每天都命中核心標籤）時的加成，讓主管理解上限的意義。 */
  readonly boostExample = computed(() => {
    const cap = Number(this.draftBoostCap());
    return Number.isNaN(cap) ? null : cap;
  });

  loadBoostSettings(): void {
    if (this.useMockData) return;
    this.boostSettingsLoading.set(true);
    this.api
      .getWeatherBoostSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.applyBoostSettings(settings);
          this.boostSettingsLoading.set(false);
        },
        error: (err) => {
          this.boostSettingsLoading.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  saveBoostSettings(): void {
    if (this.boostSettingsError() || this.boostSettingsSaving()) return;
    const body = {
      historyWeightPercentage: Number(this.draftHistoryWeight()),
      forecastWeightPercentage: Number(this.draftForecastWeight()),
      boostCap: Number(this.draftBoostCap()),
    };
    if (this.useMockData) {
      this.boostSettings.set({ ...MOCK_BOOST_SETTINGS, ...body });
      this.status.emit('已更新天氣加成設定。');
      return;
    }
    this.boostSettingsSaving.set(true);
    this.api
      .updateWeatherBoostSettings(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.boostSettingsSaving.set(false);
          this.applyBoostSettings(settings);
          this.status.emit('已更新天氣加成設定，尚未核准商品的加成將重新計算。');
        },
        error: (err) => {
          this.boostSettingsSaving.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  private applyBoostSettings(settings: WeatherBoostSettingsPayload): void {
    this.boostSettings.set(settings);
    this.draftHistoryWeight.set(String(Number(settings.historyWeightPercentage)));
    this.draftForecastWeight.set(String(Number(settings.forecastWeightPercentage)));
    this.draftBoostCap.set(String(Number(settings.boostCap)));
  }

  /**
   * 天氣訊號標籤對照管理（SettingsController，2026-09-22新增）——把原本
   * 寫死在後端的天氣標籤對照表（V26 起決定天氣加成的逐日命中分數）
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
   * 分流慣例（多數設定清單走這套；天氣資料狀態與同步是例外——那兩支本質上需要
   * 真實天氣資料源，Mock 模式下沒有意義；這裡是純設定資料，Mock 模式一樣能展示畫面）。
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
