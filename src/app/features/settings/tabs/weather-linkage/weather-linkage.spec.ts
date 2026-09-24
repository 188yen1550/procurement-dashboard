/**
 * 檔案用途：驗證「天氣連動」分頁（2026-09-24 由 settings 拆出）。
 * 前五個案例原樣搬自 settings.spec.ts 的天氣相關測試，只把「重新載入檔期清單」
 * 改成驗證 campaignsChanged 輸出（檔期列表已在另一個分頁）；後面補上地域占比
 * 加總狀態與比例條的案例。
 * 2026-09-24：補「目前的天氣檔期」清單與切換狀態（由節慶檔期分頁移入）。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { FestiveCampaignResponsePayload } from '../../api/settings-api.contract';
import { SettingsApiService } from '../../api/settings-api.service';
import { WeatherLinkage } from './weather-linkage';

function weatherCampaign(overrides: Partial<FestiveCampaignResponsePayload>): FestiveCampaignResponsePayload {
  return {
    id: 11,
    campaignCode: 'WEATHER_HEAVY_RAIN_NORTH_20260925',
    campaignName: '北部大雨（系統自動）',
    category: 'WEATHER',
    startDate: '2026-09-25',
    endDate: '2026-09-27',
    preparationLeadDays: 3,
    campaignStatus: 'PREPARING',
    statusSource: 'SYNC',
    isManualOverride: false,
    manualOverrideCycle: null,
    region: 'NORTH',
    weatherConfidence: 'HIGH',
    regionCoverageRatio: 0.4,
    tags: [
      { tag: '雨具', matchTier: 'CORE' },
      { tag: '防水', matchTier: 'GENERAL' },
    ],
    dateRuleType: null,
    ruleMonth: null,
    ruleDay: null,
    ruleWeekOrdinal: null,
    ruleWeekday: null,
    ruleSolarTerm: null,
    ruleOffsetDays: null,
    durationDays: null,
    endMonth: null,
    endDay: null,
    observedHolidayRule: null,
    expandLongWeekend: null,
    regions: ['NORTH'],
    cycleYear: 2026,
    occurrenceOverridden: false,
    observedHolidays: [],
    ruleDescription: '依天氣預報',
    ...overrides,
  };
}

describe('WeatherLinkage', () => {
  let fixture: ComponentFixture<WeatherLinkage>;
  let component: WeatherLinkage;
  let dialog: DialogService;

  const settingsApi = {
    getCurrentWeatherCampaigns: vi.fn(() =>
      of([weatherCampaign({}), weatherCampaign({ id: 12, campaignName: '南部炎熱（系統自動）', campaignStatus: 'EXPIRED', isManualOverride: true })]),
    ),
    switchFestiveCampaignStatus: vi.fn((id: number) => of(weatherCampaign({ id, isManualOverride: true }))),
    previewWeatherSignals: vi.fn(() =>
      of([
        { region: 'SOUTH', type: 'HOT' as const, windowStart: '2026-09-22', windowEnd: '2026-09-24', confidence: 'HIGH' as const },
      ]),
    ),
    syncWeatherCampaigns: vi.fn(() => of({ totalSignalCount: 1, syncedCampaignCount: 1, expiredCampaignCount: 0 })),
    getWeatherSignalTagMappings: vi.fn(() =>
      of([{ id: 1, weatherSignalType: 'RAINY' as const, tag: '雨具', matchTier: 'CORE' as const, isActive: true, isSystemDefault: true }]),
    ),
    createWeatherSignalTagMapping: vi.fn((body: { weatherSignalType: string; tag: string; matchTier: string }) =>
      of({ id: 99, isActive: true, isSystemDefault: false, ...body }),
    ),
    updateWeatherSignalTagMapping: vi.fn((id: number, body: { matchTier: string }) =>
      of({ id, weatherSignalType: 'RAINY', tag: '雨具', isActive: true, isSystemDefault: true, ...body }),
    ),
    disableWeatherSignalTagMapping: vi.fn((id: number) =>
      of({ id, weatherSignalType: 'RAINY', tag: '雨具', matchTier: 'CORE', isActive: false, isSystemDefault: true }),
    ),
    enableWeatherSignalTagMapping: vi.fn((id: number) =>
      of({ id, weatherSignalType: 'RAINY', tag: '雨具', matchTier: 'CORE', isActive: true, isSystemDefault: true }),
    ),
    getRegionWeights: vi.fn(() =>
      of([
        { region: 'NORTH', weightPercentage: 25, updatedAt: null },
        { region: 'CENTRAL', weightPercentage: 25, updatedAt: null },
        { region: 'SOUTH', weightPercentage: 25, updatedAt: null },
        { region: 'EAST', weightPercentage: 25, updatedAt: null },
      ]),
    ),
    updateRegionWeights: vi.fn((body: { regionWeights: Array<{ region: string; weightPercentage: number }> }) =>
      of(body.regionWeights.map((item) => ({ ...item, updatedAt: '2026-09-23T00:00:00' }))),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [WeatherLinkage],
      providers: [{ provide: SettingsApiService, useValue: settingsApi }],
    }).compileComponents();
    fixture = TestBed.createComponent(WeatherLinkage);
    component = fixture.componentInstance;
    dialog = TestBed.inject(DialogService);
    fixture.detectChanges();
  });

  it('loads tag mappings and region weights on init', () => {
    expect(settingsApi.getWeatherSignalTagMappings).toHaveBeenCalled();
    expect(settingsApi.getRegionWeights).toHaveBeenCalled();
    expect(component.weatherSignalTagMappings()).toHaveLength(1);
    // 天氣類型顯示中文，不露出 RAINY 代碼。
    expect(fixture.nativeElement.querySelector('.weather-mapping-table tbody').textContent).not.toContain('RAINY');
  });

  it('lists current weather campaigns with confidence, coverage, tags and manual badge', () => {
    expect(settingsApi.getCurrentWeatherCampaigns).toHaveBeenCalledTimes(1);
    const text = fixture.nativeElement.querySelector('.weather-campaign-table tbody').textContent;
    expect(text).toContain('北部大雨（系統自動）');
    expect(text).toContain('2026-09-25 ～ 2026-09-27');
    expect(text).toContain('40%');
    expect(text).toContain('雨具、防水');
    expect(text).toContain('準備期');
    // 手動設為已結束的列仍列出（才能恢復自動），顯示「已結束」而非節慶用語「本期停用」
    expect(text).toContain('已結束');
    expect(text).not.toContain('本期停用');
    expect(fixture.nativeElement.querySelectorAll('.manual-badge')).toHaveLength(1);
  });

  it('switches a weather campaign status manually and reloads the list', () => {
    const status = vi.fn();
    component.status.subscribe(status);
    component.openStatus(component.weatherCampaigns()[0]);
    // 如實回填：這筆原本由同步判斷，打開時預設「恢復自動判斷」，要改成手動指定才出現下拉選單
    expect(component.draftManualOverride()).toBe(false);
    component.draftManualOverride.set(true);
    fixture.detectChanges();
    const options = [...fixture.nativeElement.querySelectorAll('select[name="weatherStatus"] option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(['PREPARING', 'ACTIVE', 'EXPIRED']);
    component.draftStatus.set('EXPIRED');
    component.applyStatus();
    expect(settingsApi.switchFestiveCampaignStatus).toHaveBeenCalledWith(11, { status: 'EXPIRED', overrideEnabled: true });
    expect(settingsApi.getCurrentWeatherCampaigns).toHaveBeenCalledTimes(2);
    expect(component.statusTarget()).toBeNull();
    expect(status).toHaveBeenCalledWith('已手動切換天氣檔期狀態。');
  });

  it('restores automatic judgement by sending the current status, not the dropdown value', () => {
    const target = component.weatherCampaigns()[1];
    component.openStatus(target);
    expect(component.draftManualOverride()).toBe(true);
    component.draftStatus.set('ACTIVE');
    component.draftManualOverride.set(false);
    component.applyStatus();
    expect(settingsApi.switchFestiveCampaignStatus).toHaveBeenCalledWith(12, { status: 'EXPIRED', overrideEnabled: false });
  });

  it('previews weather signals without announcing a campaign change', () => {
    const changed = vi.fn();
    component.campaignsChanged.subscribe(changed);
    component.previewWeatherSignals();
    fixture.detectChanges();
    expect(component.weatherPreview()).toEqual([
      { region: 'SOUTH', type: 'HOT', windowStart: '2026-09-22', windowEnd: '2026-09-24', confidence: 'HIGH' },
    ]);
    expect(changed).not.toHaveBeenCalled();
  });

  it('syncs weather campaigns, reports the result and notifies the parent', () => {
    const changed = vi.fn();
    const status = vi.fn();
    component.campaignsChanged.subscribe(changed);
    component.status.subscribe(status);
    component.syncWeatherCampaigns();
    expect(settingsApi.syncWeatherCampaigns).toHaveBeenCalled();
    expect(status.mock.calls[0][0]).toContain('天氣檔期同步完成');
    expect(changed).toHaveBeenCalled();
    // 同步後立即重載下方「目前的天氣檔期」
    expect(settingsApi.getCurrentWeatherCampaigns).toHaveBeenCalledTimes(2);
  });

  it('adds a new mapping and resets the draft form', () => {
    component.draftWeatherSignalType.set('HOT');
    component.draftWeatherSignalTag.set('消暑');
    component.draftWeatherSignalMatchTier.set('GENERAL');
    component.addWeatherSignalTagMapping();
    expect(settingsApi.createWeatherSignalTagMapping).toHaveBeenCalledWith({
      weatherSignalType: 'HOT',
      tag: '消暑',
      matchTier: 'GENERAL',
    });
    expect(component.weatherSignalTagMappings().some((m) => m.tag === '消暑')).toBe(true);
    expect(component.draftWeatherSignalTag()).toBe('');
    expect(component.draftWeatherSignalType()).toBe('');
  });

  it('rejects a blank tag before calling the API', () => {
    const notify = vi.spyOn(dialog, 'notify').mockReturnValue(of(undefined));
    component.draftWeatherSignalType.set('HOT');
    component.draftWeatherSignalTag.set('   ');
    component.addWeatherSignalTagMapping();
    expect(settingsApi.createWeatherSignalTagMapping).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });

  it('toggles a mapping and changes its match tier', () => {
    const item = component.weatherSignalTagMappings()[0];
    component.changeWeatherSignalTagMappingTier(item, 'WEAK');
    expect(settingsApi.updateWeatherSignalTagMapping).toHaveBeenCalledWith(item.id, { matchTier: 'WEAK' });
    component.toggleWeatherSignalTagMappingActive(component.weatherSignalTagMappings()[0]);
    expect(settingsApi.disableWeatherSignalTagMapping).toHaveBeenCalledWith(item.id);
    expect(component.weatherSignalTagMappings()[0].isActive).toBe(false);
  });

  it('shows a visible error state when region weights do not add up to 100', () => {
    component.updateRegionWeightDraft('NORTH', '40');
    fixture.detectChanges();
    const sum = fixture.nativeElement.querySelector('.config-sum');
    expect(sum.getAttribute('data-state')).toBe('error');
    expect(sum.textContent).toContain('須為 100');
    const saveButton = fixture.nativeElement.querySelector('.region-weight-footer .btn-primary');
    expect(saveButton.disabled).toBe(true);
  });

  it('treats 33.33 + 33.33 + 33.34 + 0 as exactly 100', () => {
    component.updateRegionWeightDraft('NORTH', '33.33');
    component.updateRegionWeightDraft('CENTRAL', '33.33');
    component.updateRegionWeightDraft('SOUTH', '33.34');
    component.updateRegionWeightDraft('EAST', '0');
    expect(component.regionWeightDraftSum()).toBe(100);
    expect(component.regionWeightSumState()).toBe('ok');
    // 占比 0 的區域不畫進比例條。
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.region-bar-segment')).toHaveLength(3);
  });

  it('marks a single region input as invalid when it is out of 0~100', () => {
    component.updateRegionWeightDraft('NORTH', '120');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#region-weight-NORTH');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.querySelector('#region-weight-CENTRAL').getAttribute('aria-invalid')).toBe('false');
    expect(component.isRegionWeightOutOfRange('SOUTH')).toBe(false);
  });

  it('tags each match tier select with its tier for the colour cue', () => {
    const select = fixture.nativeElement.querySelector('.weather-mapping-table .tier-select');
    expect(select.getAttribute('data-tier')).toBe('CORE');
  });
});
