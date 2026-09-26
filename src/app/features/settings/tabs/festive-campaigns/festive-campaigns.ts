/**
 * 檔案用途：系統設定 › 「節慶檔期」分頁（2026-09-24 檔期規則改版，由 settings 拆出的子元件）。
 *
 * ## 這次改了什麼
 * - 節慶／季節檔期改存「每年固定」的日期規則（固定國曆日、第 N 個星期幾、農曆、節氣），
 *   不再填年度起訖日；列表顯示的起訖日與狀態是後端依規則推算的「目前或下一期」。
 * - 表單即時預覽由今天起的 3 期（300ms debounce 呼叫預覽 API，不寫入）。
 * - 季節型可設定受影響區域（不選＝全國）；節慶型不帶地域屬性，一律全國（2026-09-24 決議）。
 * - 節慶的補假與連假展開、逐年日期覆寫（官方公告的例外）。
 * - 天氣型檔期不在這頁：列表只查 FESTIVAL／SEASON，天氣檔期的檢視與切換狀態移到
 *   「天氣連動 › 目前的天氣檔期」（2026-09-24 決議）。
 * - 偏移天數只適用節慶型；季節型隱藏欄位、一律送 0（2026-09-24 決議）。
 * - 修正 B4：列表操作一律以 id 識別；原本以名稱比對，同名檔期會改到另一筆。
 *
 * ## 為什麼拆成子元件
 * 新的表單比原本多出規則、預覽、區域、覆寫四塊，留在 settings.ts 會讓那支檔案再長回去
 * （2026-09-24 決議）。標籤選擇 dialog 的邏輯原樣搬過來。
 *
 * 驗證訊息與後端 ValidationMessage 一致，修改時兩邊一起改。
 */
import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import {
  CampaignDateRuleType,
  FestiveCampaignStatus,
  FestiveCategory,
  SolarTerm,
} from '../../../../core/domain/enums';
import {
  CAMPAIGN_DATE_RULE_TYPE_LABEL,
  CAMPAIGN_STATUS_SOURCE_LABEL,
  FESTIVE_CATEGORY_LABEL,
  joinCampaignTags,
  SOLAR_TERM_LABEL,
  WEATHER_REGION_LABEL,
} from '../../../../core/domain/labels';
import { Icon } from '../../../../shared/components/icon/icon';
import { InfoTip } from '../../../../shared/components/info-tip/info-tip';
import { ListSort, SortHeader, SortRowsPipe } from '../../../../shared/ui/list-sort';
import {
  FestiveCampaignOccurrenceOverridePayload,
  FestiveCampaignOccurrencePreviewPayload,
  FestiveCampaignResponsePayload,
  FestiveCampaignRulePayload,
  FestiveCampaignTagPayload,
} from '../../api/settings-api.contract';
import { SettingsApiService } from '../../api/settings-api.service';

/** V26：檔期只有節慶與季節（天氣改為獨立的天氣加成，設定在「天氣連動」分頁）。 */
type EditableCategory = FestiveCategory;

export const EDITABLE_CATEGORIES: readonly EditableCategory[] = ['FESTIVAL', 'SEASON'];

/** 列表列的畫面模型。sortRows pipe 依欄位名稱排序，所以排序用的鍵要是扁平欄位。 */
export interface CampaignRowVM {
  id: number;
  code: string;
  name: string;
  category: FestiveCategory;
  categoryLabel: string;
  ruleText: string;
  /** 本期起訖，推算不出來時顯示「—」。 */
  range: string;
  /** 排序用：本期開始日（ISO），沒有時排最後。 */
  rangeSortKey: string;
  cycleYear: number | null;
  overridden: boolean;
  status: FestiveCampaignStatus;
  statusSourceLabel: string;
  override: boolean;
  regionsText: string;
  raw: FestiveCampaignResponsePayload;
}

interface PreviewState {
  status: 'idle' | 'invalid' | 'loading' | 'ok' | 'error';
  items: FestiveCampaignOccurrencePreviewPayload[];
  message: string;
}

const CAMPAIGN_STATUS_LABEL: Record<FestiveCampaignStatus, string> = {
  UPCOMING: '即將開始',
  PREPARING: '準備期',
  ACTIVE: '進行中',
  EXPIRED: '本期停用',
};

/** 與後端 ValidationMessage 一致。 */
export const CAMPAIGN_RULE_MESSAGES = {
  code: '檔期代碼須為大寫英數與底線，且不可包含年份',
  date: '日期不存在',
  nthWeekday: '請選擇第 1–4 個或最後一個星期幾',
  lunar: '農曆日期不存在',
  solarTerm: '請選擇節氣',
  offset: '偏移天數須介於 -30 與 30 之間',
  offsetFestivalOnly: '偏移天數僅適用節慶型檔期',
  duration: '節慶持續天數須介於 1 與 60 之間',
  seasonEnd: '請設定季節結束月日',
  leadDays: '準備期天數須介於 0 與 180 之間',
  overrideRange: '覆寫日期區間無效',
} as const;

const MAX_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const CODE_FORMAT = /^[A-Z][A-Z0-9_]{1,49}$/;
const CODE_WITH_YEAR = /_\d{4}$/;

const isInt = (value: number | null, min: number, max: number): boolean =>
  value !== null && Number.isInteger(value) && value >= min && value <= max;

/** 表單規則的前端驗證（與後端 FestiveCampaignRuleService.validateRule 同一套規則）。null＝合法。 */
export function validateCampaignRule(rule: FestiveCampaignRulePayload): string | null {
  const month = rule.ruleMonth ?? null;
  const day = rule.ruleDay ?? null;
  switch (rule.dateRuleType) {
    case 'FIXED_DATE':
      if (!isInt(month, 1, 12) || !isInt(day, 1, MAX_DAYS_IN_MONTH[(month ?? 1) - 1])) {
        return CAMPAIGN_RULE_MESSAGES.date;
      }
      break;
    case 'NTH_WEEKDAY':
      if (
        !isInt(month, 1, 12) ||
        ![1, 2, 3, 4, -1].includes(rule.ruleWeekOrdinal ?? 0) ||
        !isInt(rule.ruleWeekday ?? null, 1, 7)
      ) {
        return CAMPAIGN_RULE_MESSAGES.nthWeekday;
      }
      break;
    case 'LUNAR_DATE':
      if (!isInt(month, 1, 12) || !isInt(day, 1, 30)) return CAMPAIGN_RULE_MESSAGES.lunar;
      break;
    case 'SOLAR_TERM':
      if (!rule.ruleSolarTerm) return CAMPAIGN_RULE_MESSAGES.solarTerm;
      break;
  }
  if (!isInt(rule.ruleOffsetDays ?? 0, -30, 30)) return CAMPAIGN_RULE_MESSAGES.offset;
  if (rule.category !== 'FESTIVAL' && (rule.ruleOffsetDays ?? 0) !== 0) return CAMPAIGN_RULE_MESSAGES.offsetFestivalOnly;
  if (rule.category === 'FESTIVAL') {
    if (!isInt(rule.durationDays ?? null, 1, 60)) return CAMPAIGN_RULE_MESSAGES.duration;
  } else if (!isInt(rule.endMonth ?? null, 1, 12) || !isInt(rule.endDay ?? null, 1, 31)) {
    return CAMPAIGN_RULE_MESSAGES.seasonEnd;
  }
  return null;
}

/** 檔期代碼：大寫英數與底線，不可以 _＋4 位數字結尾（D5：代碼不帶年份）。 */
export function isValidCampaignCode(code: string): boolean {
  return CODE_FORMAT.test(code) && !CODE_WITH_YEAR.test(code);
}

/**
 * 列表「地域」欄：節慶型一律顯示「全國」（不帶地域屬性，後端計分同樣忽略），
 * 即使舊資料在 festive_campaign_regions 留有列也不顯示，避免畫面與計分不一致。
 */
function regionsText(category: FestiveCategory, regions: string[]): string {
  if (category === 'FESTIVAL' || regions.length === 0) return '全國';
  return regions.map((r) => WEATHER_REGION_LABEL[r] ?? r).join('、');
}

/**
 * 「偏移天數」的就地說明（? 圖示 hover）。只有節慶型有這個欄位（季節型開始月日可直接填，已隱藏）。
 * 語意對應後端 CampaignOccurrenceResolver：整個檔期一起移動，持續天數從移動後的日期起算。
 */
export const OFFSET_DAYS_TIP =
  '把日期規則算出的「基準日」往前（負數）或往後（正數）移動幾天，當作檔期開始日，持續天數從移動後的日期起算。' +
  '用在節慶本身不是規則直接指到的那一天，例如：除夕＝農曆 1/1 偏移 -1、寒食節＝清明偏移 -1；' +
  '或想讓檔期早於節日開跑，例如母親節前一週＝5 月第 2 個星期日偏移 -7、持續 8 天。' +
  '與「準備期天數」不同：偏移會移動檔期本身的起訖；準備期只是在開始日之前提早進入「準備期」狀態，不改變起訖。';

export function toCampaignRow(payload: FestiveCampaignResponsePayload): CampaignRowVM {
  const regions = payload.regions ?? [];
  return {
    id: payload.id,
    code: payload.campaignCode,
    name: payload.campaignName,
    category: payload.category,
    categoryLabel: FESTIVE_CATEGORY_LABEL[payload.category],
    ruleText: payload.ruleDescription ?? '—',
    range: payload.startDate && payload.endDate ? `${payload.startDate} – ${payload.endDate}` : '—',
    rangeSortKey: payload.startDate ?? '9999-12-31',
    cycleYear: payload.cycleYear,
    overridden: payload.occurrenceOverridden ?? false,
    status: payload.campaignStatus,
    statusSourceLabel: payload.statusSource ? CAMPAIGN_STATUS_SOURCE_LABEL[payload.statusSource] : '',
    override: payload.isManualOverride ?? false,
    regionsText: regionsText(payload.category, regions),
    raw: payload,
  };
}

@Component({
  selector: 'app-festive-campaigns',
  imports: [FormsModule, Icon, InfoTip, SortHeader, SortRowsPipe],
  templateUrl: './festive-campaigns.html',
  styleUrl: './festive-campaigns.scss',
})
export class FestiveCampaigns implements OnInit {
  private readonly api = inject(SettingsApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly disabled = input(false);
  /** 成功訊息交給父元件頁首 toast。 */
  readonly status = output<string>();

  readonly campaignStatusLabel = CAMPAIGN_STATUS_LABEL;
  readonly ruleTypeLabel = CAMPAIGN_DATE_RULE_TYPE_LABEL;
  readonly solarTermLabel = SOLAR_TERM_LABEL;
  readonly regionLabel = WEATHER_REGION_LABEL;
  readonly regionCodes = Object.keys(WEATHER_REGION_LABEL);
  readonly offsetDaysTip = OFFSET_DAYS_TIP;
  readonly ruleTypes: CampaignDateRuleType[] = ['FIXED_DATE', 'NTH_WEEKDAY', 'LUNAR_DATE', 'SOLAR_TERM'];
  readonly solarTerms: SolarTerm[] = ['QINGMING', 'DONGZHI'];
  readonly months = Array.from({ length: 12 }, (_, i) => i + 1);
  readonly weekdays = [
    { value: 1, label: '一' },
    { value: 2, label: '二' },
    { value: 3, label: '三' },
    { value: 4, label: '四' },
    { value: 5, label: '五' },
    { value: 6, label: '六' },
    { value: 7, label: '日' },
  ];
  readonly ordinals = [
    { value: 1, label: '第 1 個' },
    { value: 2, label: '第 2 個' },
    { value: 3, label: '第 3 個' },
    { value: 4, label: '第 4 個' },
    { value: -1, label: '最後一個' },
  ];

  readonly sort = new ListSort();
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly rows = signal<CampaignRowVM[]>([]);

  ngOnInit(): void {
    this.reload();
  }

  /** 父元件切到這個分頁或原地重點「系統設定」時呼叫。 */
  reload(): void {
    if (this.useMockData) return;
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .getFestiveCampaigns(EDITABLE_CATEGORIES)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.rows.set(list.map(toCampaignRow));
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.loadError.set(toApiError(err).message);
        },
      });
  }

  private replaceRow(updated: FestiveCampaignResponsePayload): void {
    const row = toCampaignRow(updated);
    this.rows.update((items) =>
      items.some((item) => item.id === row.id)
        ? items.map((item) => (item.id === row.id ? row : item))
        : [...items, row],
    );
  }

  private showAlert(message: string, title = '操作失敗'): void {
    this.dialog.notify('error', title, [message]).subscribe();
  }

  // ==================================================================
  // 新增／編輯 modal
  // ==================================================================

  readonly modal = signal<null | 'campaign' | 'status'>(null);
  /** 編輯中檔期的 id（B4：以 id 識別，不用名稱）。null＝新增。 */
  readonly editingId = signal<number | null>(null);
  readonly isSaving = signal(false);

  readonly draftCode = signal('');
  readonly draftName = signal('');
  readonly draftCategory = signal<EditableCategory>('FESTIVAL');
  readonly draftRuleType = signal<CampaignDateRuleType>('FIXED_DATE');
  readonly draftMonth = signal<number | null>(null);
  readonly draftDay = signal<number | null>(null);
  readonly draftWeekOrdinal = signal<number | null>(null);
  readonly draftWeekday = signal<number | null>(null);
  readonly draftSolarTerm = signal<SolarTerm | null>(null);
  readonly draftOffset = signal<number | null>(0);
  readonly draftDuration = signal<number | null>(1);
  readonly draftEndMonth = signal<number | null>(null);
  readonly draftEndDay = signal<number | null>(null);
  readonly draftObserved = signal(false);
  readonly draftExpand = signal(false);
  readonly draftRegions = signal<Set<string>>(new Set());
  readonly draftLeadDays = signal<number | null>(30);
  readonly draftTags = signal<FestiveCampaignTagPayload[]>([]);

  /** 季節型只能用固定國曆日期（後端同樣限制）。 */
  readonly effectiveRuleType = computed<CampaignDateRuleType>(() =>
    this.draftCategory() === 'SEASON' ? 'FIXED_DATE' : this.draftRuleType(),
  );

  /** 目前表單組成的規則（送預覽、送存檔共用）。只帶當前規則類型用得到的欄位。 */
  readonly rulePayload = computed<FestiveCampaignRulePayload>(() => {
    const category = this.draftCategory();
    const type = this.effectiveRuleType();
    const festival = category === 'FESTIVAL';
    return {
      category,
      dateRuleType: type,
      ruleMonth: type === 'SOLAR_TERM' ? null : this.draftMonth(),
      ruleDay: type === 'FIXED_DATE' || type === 'LUNAR_DATE' ? this.draftDay() : null,
      ruleWeekOrdinal: type === 'NTH_WEEKDAY' ? this.draftWeekOrdinal() : null,
      ruleWeekday: type === 'NTH_WEEKDAY' ? this.draftWeekday() : null,
      ruleSolarTerm: type === 'SOLAR_TERM' ? this.draftSolarTerm() : null,
      // 季節型不開放偏移：切回季節時不清 draftOffset（切回節慶可還原），只在送出內容一律帶 0。
      ruleOffsetDays: festival ? (this.draftOffset() ?? 0) : 0,
      durationDays: festival ? this.draftDuration() : null,
      endMonth: festival ? null : this.draftEndMonth(),
      endDay: festival ? null : this.draftEndDay(),
      observedHolidayRule: festival && this.draftObserved() ? 'TW_STATUTORY' : 'NONE',
      expandLongWeekend: festival && this.draftObserved() && this.draftExpand(),
      // 節慶不帶地域（一律全國）；切回季節時保留原勾選，所以只在送出內容裡排除，不清 draftRegions。
      regions: festival ? [] : this.regionCodes.filter((code) => this.draftRegions().has(code)),
    };
  });

  readonly ruleError = computed(() => (this.modal() === 'campaign' ? validateCampaignRule(this.rulePayload()) : null));

  readonly leadDaysError = computed(() =>
    isInt(this.draftLeadDays(), 0, 180) ? null : CAMPAIGN_RULE_MESSAGES.leadDays,
  );

  readonly codeError = computed(() =>
    this.editingId() === null && !isValidCampaignCode(this.draftCode().trim()) ? CAMPAIGN_RULE_MESSAGES.code : null,
  );

  /**
   * 即時預覽：規則變更後 300ms 才呼叫後端（輸入月日時不必每打一個字就打一次 API）；
   * 規則在前端就不合法時不呼叫，直接顯示原因。switchMap 讓舊請求在新規則出現時被取消，
   * 畫面不會被晚回來的舊結果蓋掉。
   */
  readonly preview = signal<PreviewState>({ status: 'idle', items: [], message: '' });

  constructor() {
    toObservable(computed(() => (this.modal() === 'campaign' ? JSON.stringify(this.rulePayload()) : '')))
      .pipe(
        distinctUntilChanged(),
        debounceTime(300),
        switchMap((serialized) => {
          if (!serialized) return of<PreviewState>({ status: 'idle', items: [], message: '' });
          const rule = JSON.parse(serialized) as FestiveCampaignRulePayload;
          const invalid = validateCampaignRule(rule);
          if (invalid) return of<PreviewState>({ status: 'invalid', items: [], message: invalid });
          if (this.useMockData) {
            return of<PreviewState>({ status: 'error', items: [], message: 'Mock 模式不提供預覽。' });
          }
          return this.api.previewFestiveCampaignOccurrences(rule).pipe(
            map((items): PreviewState => ({ status: 'ok', items, message: '' })),
            catchError((err) => of<PreviewState>({ status: 'error', items: [], message: toApiError(err).message })),
            startWith<PreviewState>({ status: 'loading', items: this.preview().items, message: '' }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.preview.set(state));
  }

  openCreate(): void {
    this.resetDraft();
    this.modal.set('campaign');
  }

  openEdit(row: CampaignRowVM): void {
    const raw = row.raw;
    this.resetDraft();
    this.editingId.set(row.id);
    this.draftCode.set(raw.campaignCode);
    this.draftName.set(raw.campaignName);
    this.draftCategory.set(raw.category as EditableCategory);
    this.draftRuleType.set(raw.dateRuleType ?? 'FIXED_DATE');
    this.draftMonth.set(raw.ruleMonth);
    this.draftDay.set(raw.ruleDay);
    this.draftWeekOrdinal.set(raw.ruleWeekOrdinal);
    this.draftWeekday.set(raw.ruleWeekday);
    this.draftSolarTerm.set(raw.ruleSolarTerm);
    this.draftOffset.set(raw.ruleOffsetDays ?? 0);
    this.draftDuration.set(raw.durationDays ?? 1);
    this.draftEndMonth.set(raw.endMonth);
    this.draftEndDay.set(raw.endDay);
    this.draftObserved.set(raw.observedHolidayRule === 'TW_STATUTORY');
    this.draftExpand.set(raw.expandLongWeekend ?? false);
    this.draftRegions.set(new Set(raw.regions ?? []));
    // 後端未填時預設 30；null 傳進 number input 會變空白。
    this.draftLeadDays.set(raw.preparationLeadDays ?? 30);
    // tags 是整份覆蓋：先帶入現有標籤，避免存檔清光。
    this.draftTags.set(raw.tags.map((t) => ({ ...t })));
    this.modal.set('campaign');
    this.loadOverrides(row.id);
  }

  private resetDraft(): void {
    this.editingId.set(null);
    this.isSaving.set(false);
    this.draftCode.set('');
    this.draftName.set('');
    this.draftCategory.set('FESTIVAL');
    this.draftRuleType.set('FIXED_DATE');
    this.draftMonth.set(null);
    this.draftDay.set(null);
    this.draftWeekOrdinal.set(null);
    this.draftWeekday.set(null);
    this.draftSolarTerm.set(null);
    this.draftOffset.set(0);
    this.draftDuration.set(1);
    this.draftEndMonth.set(null);
    this.draftEndDay.set(null);
    this.draftObserved.set(false);
    this.draftExpand.set(false);
    this.draftRegions.set(new Set());
    this.draftLeadDays.set(30);
    this.draftTags.set([]);
    this.overrides.set([]);
    this.resetOverrideDraft();
    this.tagPickerOpen.set(false);
  }

  closeModal(): void {
    this.modal.set(null);
    this.resetDraft();
  }

  toggleRegion(code: string): void {
    this.draftRegions.update((set) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  setObserved(enabled: boolean): void {
    this.draftObserved.set(enabled);
    // 連假展開以補假規則為前提；取消補假時一併取消，避免送出看不到的殘值。
    if (!enabled) this.draftExpand.set(false);
  }

  /** 數字欄位：空字串視為 null（不是 0），讓驗證能分辨「沒填」。 */
  toNumber(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  save(): void {
    if (this.isSaving()) return;
    const problem =
      (this.draftName().trim() ? null : '請填寫檔期名稱') ??
      this.codeError() ??
      this.ruleError() ??
      this.leadDaysError();
    if (problem) {
      this.showAlert(problem, '驗證失敗');
      return;
    }
    if (this.useMockData) {
      this.showAlert('Mock 模式不寫入資料。', '功能限制');
      return;
    }

    // festive_campaign_tags 在 (campaign_id, tag) 上有 UNIQUE 約束；後端會去重，前端也先做一次。
    const seen = new Map<string, FestiveCampaignTagPayload>();
    for (const row of this.draftTags()) {
      const trimmed = row.tag.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.set(trimmed, { tag: joinCampaignTags([trimmed]), matchTier: row.matchTier });
      }
    }
    const common = {
      ...this.rulePayload(),
      campaignName: this.draftName().trim(),
      preparationLeadDays: this.draftLeadDays(),
      tags: [...seen.values()],
    };
    const id = this.editingId();
    const request$ =
      id === null
        ? this.api.createFestiveCampaign({ ...common, campaignCode: this.draftCode().trim() })
        : this.api.updateFestiveCampaign(id, common);

    this.isSaving.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.replaceRow(saved);
        this.status.emit(id === null ? '已新增檔期。' : '已更新檔期。');
        this.closeModal();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.showAlert(toApiError(err).message);
      },
    });
  }

  // ==================================================================
  // 逐年日期覆寫（僅編輯既有節慶／季節檔期時）
  // ==================================================================

  readonly overrides = signal<FestiveCampaignOccurrenceOverridePayload[]>([]);
  readonly overrideCycleYear = signal<number | null>(null);
  readonly overrideStart = signal('');
  readonly overrideEnd = signal('');
  readonly overrideNote = signal('');
  readonly isSavingOverride = signal(false);

  readonly overrideError = computed(() => {
    const year = this.overrideCycleYear();
    const start = this.overrideStart();
    const end = this.overrideEnd();
    if (!isInt(year, 2000, 2099) || !start || !end || end < start) return CAMPAIGN_RULE_MESSAGES.overrideRange;
    const spanDays = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    return spanDays > 120 ? CAMPAIGN_RULE_MESSAGES.overrideRange : null;
  });

  private resetOverrideDraft(): void {
    this.overrideCycleYear.set(null);
    this.overrideStart.set('');
    this.overrideEnd.set('');
    this.overrideNote.set('');
    this.isSavingOverride.set(false);
  }

  private loadOverrides(id: number): void {
    if (this.useMockData) return;
    this.api
      .getFestiveCampaignOccurrenceOverrides(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.overrides.set(list),
        error: () => this.overrides.set([]),
      });
  }

  /** 點既有覆寫帶回表單修改（同一期再存一次＝更新）。 */
  editOverride(item: FestiveCampaignOccurrenceOverridePayload): void {
    this.overrideCycleYear.set(item.cycleYear);
    this.overrideStart.set(item.startDate);
    this.overrideEnd.set(item.endDate);
    this.overrideNote.set(item.note ?? '');
  }

  saveOverride(): void {
    const id = this.editingId();
    const year = this.overrideCycleYear();
    if (id === null || year === null || this.isSavingOverride()) return;
    if (this.overrideError()) {
      this.showAlert(this.overrideError()!, '驗證失敗');
      return;
    }
    this.isSavingOverride.set(true);
    this.api
      .upsertFestiveCampaignOccurrenceOverride(id, year, {
        startDate: this.overrideStart(),
        endDate: this.overrideEnd(),
        note: this.overrideNote().trim() || null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.overrides.update((items) =>
            [...items.filter((item) => item.cycleYear !== saved.cycleYear), saved].sort(
              (a, b) => a.cycleYear - b.cycleYear,
            ),
          );
          this.resetOverrideDraft();
          this.refreshRow(id);
          this.status.emit(`已儲存 ${saved.cycleYear} 年的日期覆寫。`);
        },
        error: (err) => {
          this.isSavingOverride.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  deleteOverride(item: FestiveCampaignOccurrenceOverridePayload): void {
    const id = this.editingId();
    if (id === null) return;
    this.dialog
      .confirm(`刪除 ${item.cycleYear} 年的日期覆寫？`, ['刪除後該期改回依規則推算。'], '刪除')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.api
          .deleteFestiveCampaignOccurrenceOverride(id, item.cycleYear)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.overrides.update((items) => items.filter((o) => o.cycleYear !== item.cycleYear));
              this.refreshRow(id);
              this.status.emit(`已刪除 ${item.cycleYear} 年的日期覆寫。`);
            },
            error: (err) => this.showAlert(toApiError(err).message),
          });
      });
  }

  /** 覆寫會改變本期起訖與狀態，重新取一次列表讓該列同步（列表 API 已批次載入，成本低）。 */
  private refreshRow(id: number): void {
    this.api
      .getFestiveCampaigns(EDITABLE_CATEGORIES)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          const updated = list.find((item) => item.id === id);
          if (updated) this.replaceRow(updated);
        },
        error: () => undefined,
      });
  }

  // ==================================================================
  // 切換狀態 modal
  // ==================================================================

  readonly statusTarget = signal<CampaignRowVM | null>(null);
  readonly draftStatus = signal<FestiveCampaignStatus>('ACTIVE');
  readonly draftManualOverride = signal(true);

  /** 如實回填目前狀態與是否手動覆蓋：打開來看、直接儲存不會意外改變設定。 */
  openStatus(row: CampaignRowVM): void {
    this.statusTarget.set(row);
    this.draftStatus.set(row.status);
    this.draftManualOverride.set(row.override);
    this.isSaving.set(false);
    this.modal.set('status');
  }

  closeStatus(): void {
    this.modal.set(null);
    this.statusTarget.set(null);
    this.isSaving.set(false);
  }

  /** 恢復自動判斷時不送下拉選單的值，一律送目前狀態——關掉開關跟指定新狀態是兩件事。 */
  applyStatus(): void {
    const target = this.statusTarget();
    if (!target || this.isSaving()) return;
    const overrideEnabled = this.draftManualOverride();
    if (this.useMockData) {
      this.closeStatus();
      return;
    }
    this.isSaving.set(true);
    this.api
      .switchFestiveCampaignStatus(target.id, {
        status: overrideEnabled ? this.draftStatus() : target.status,
        overrideEnabled,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.replaceRow(updated);
          this.status.emit(overrideEnabled ? '已手動切換檔期狀態。' : '已恢復自動判斷。');
          this.closeStatus();
        },
        error: (err) => {
          this.isSaving.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  // ==================================================================
  // 節慶標籤選擇（原樣搬自 settings.ts）
  // ==================================================================

  readonly tagPickerOpen = signal(false);
  readonly tagPickerSearch = signal('');
  readonly tagPickerSelected = signal<Set<string>>(new Set());

  /** 全站目前所有檔期用過的標籤，去重排序。 */
  readonly knownTags = computed(() =>
    [...new Set(this.rows().flatMap((row) => row.raw.tags.map((t) => t.tag).filter(Boolean)))].sort(),
  );

  readonly filteredKnownTags = computed(() => {
    const keyword = this.tagPickerSearch().trim().toLocaleLowerCase('zh-Hant');
    if (!keyword) return this.knownTags();
    return this.knownTags().filter((t) => t.toLocaleLowerCase('zh-Hant').includes(keyword));
  });

  /** 不分大小寫比對，避免新增大小寫不同但語意重複的標籤。 */
  readonly canAddNewTag = computed(() => {
    const keyword = this.tagPickerSearch().trim();
    if (!keyword) return false;
    const normalized = keyword.toLocaleLowerCase('zh-Hant');
    return !this.knownTags().some((tag) => tag.toLocaleLowerCase('zh-Hant') === normalized);
  });

  readonly selectedTagRows = computed(() => this.draftTags().filter((r) => r.tag));

  updateTagMatchTier(tag: string, matchTier: FestiveCampaignTagPayload['matchTier']): void {
    this.draftTags.update((rows) => rows.map((row) => (row.tag === tag ? { ...row, matchTier } : row)));
  }

  removeTag(tag: string): void {
    this.draftTags.update((rows) => rows.filter((row) => row.tag !== tag));
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

  /** 新勾選的標籤預設「一般」；既有標籤維持原本等級。 */
  confirmTagPicker(): void {
    const existing = new Map(this.draftTags().map((r) => [r.tag, r.matchTier]));
    this.draftTags.set(
      [...this.tagPickerSelected()].map((tag) => ({ tag, matchTier: existing.get(tag) ?? 'GENERAL' })),
    );
    this.tagPickerOpen.set(false);
  }
}
