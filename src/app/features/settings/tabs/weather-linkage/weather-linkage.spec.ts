/**
 * 檔案用途：驗證「天氣連動」分頁（2026-09-24 由 settings 拆出；V26 改版）。
 * V26：天氣檔期移除，原本的「目前的天氣檔期／切換狀態／訊號預覽」案例改為
 * 天氣資料狀態、手動同步與天氣加成設定；標籤對照與地域占比的案例維持不變。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { SettingsApiService } from '../../api/settings-api.service';
import { WeatherLinkage, syncResultMessage } from './weather-linkage';

describe('WeatherLinkage', () => {
  let fixture: ComponentFixture<WeatherLinkage>;
  let component: WeatherLinkage;
  let dialog: DialogService;

  const settingsApi = {
    getWeatherStatus: vi.fn(() =>
      of({
        historyDays: 30,
        forecastDays: 14,
        coldStartThresholdDays: 30,
        lastFetchedAt: '2026-09-25T05:00:12',
        regions: [
          { region: 'NORTH', regionLabel: '北部', historyDayCount: 30, forecastDayCount: 14, lastFetchedAt: '2026-09-25T05:00:12' },
          { region: 'EAST', regionLabel: '東部', historyDayCount: 3, forecastDayCount: 14, lastFetchedAt: '2026-09-25T05:00:12' },
        ],
      }),
    ),
    syncWeatherData: vi.fn(() =>
      of({
        syncedRegions: ['NORTH', 'EAST'],
        failedRegions: [],
        coldStartRegions: ['EAST'],
        upsertedDays: 60,
        syncedAt: '2026-09-25T10:00:00',
      }),
    ),
    getWeatherBoostSettings: vi.fn(() =>
      of({ historyWeightPercentage: 60, forecastWeightPercentage: 40, boostCap: 5, historyDays: 30, forecastDays: 14, updatedAt: null }),
    ),
    updateWeatherBoostSettings: vi.fn((body: { historyWeightPercentage: number; forecastWeightPercentage: number; boostCap: number }) =>
      of({ ...body, historyDays: 30, forecastDays: 14, updatedAt: '2026-09-25T10:00:00' }),
    ),
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

  it('loads weather status, boost settings, tag mappings and region weights on init', () => {
    expect(settingsApi.getWeatherStatus).toHaveBeenCalled();
    expect(settingsApi.getWeatherBoostSettings).toHaveBeenCalled();
    expect(settingsApi.getWeatherSignalTagMappings).toHaveBeenCalled();
    expect(settingsApi.getRegionWeights).toHaveBeenCalled();
    expect(component.weatherSignalTagMappings()).toHaveLength(1);
    // 天氣類型顯示中文，不露出 RAINY 代碼。
    expect(fixture.nativeElement.querySelector('.config-table--weather-mapping tbody').textContent).not.toContain('RAINY');
  });

  it('shows the data update time and flags regions with too little history', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.weather-linkage__updated-at')?.textContent).toContain('2026-09-25 05:00');
    const rows = root.querySelectorAll('.config-table--weather-status tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).not.toContain('資料不足');
    expect(rows[1].textContent).toContain('資料不足');
    expect(root.textContent).not.toContain('天氣檔期');
  });

  it('syncs weather data, reports cold-started regions and reloads the status', () => {
    const status = vi.fn();
    component.status.subscribe(status);
    component.syncWeatherData();
    expect(settingsApi.syncWeatherData).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(expect.stringContaining('東部已補齊過去 30 天'));
    expect(settingsApi.getWeatherStatus).toHaveBeenCalledTimes(2);
  });

  it('builds a readable sync message including failed regions', () => {
    expect(syncResultMessage(['NORTH'], ['SOUTH'], [])).toBe(
      '天氣資料同步完成：北部已更新；南部取得失敗（保留既有資料，下次排程重試）。',
    );
  });

  it('validates boost weights before saving and saves valid settings', () => {
    expect(component.draftHistoryWeight()).toBe('60');
    expect(component.boostSettingsError()).toBe('');

    component.draftForecastWeight.set('30');
    expect(component.boostSettingsError()).toContain('加總須為 100');
    component.saveBoostSettings();
    expect(settingsApi.updateWeatherBoostSettings).not.toHaveBeenCalled();

    component.draftHistoryWeight.set('70');
    component.draftBoostCap.set('12');
    expect(component.boostSettingsError()).toContain('0～10');

    component.draftBoostCap.set('4');
    const status = vi.fn();
    component.status.subscribe(status);
    component.saveBoostSettings();
    expect(settingsApi.updateWeatherBoostSettings).toHaveBeenCalledWith({
      historyWeightPercentage: 70,
      forecastWeightPercentage: 30,
      boostCap: 4,
    });
    expect(status).toHaveBeenCalledWith(expect.stringContaining('重新計算'));
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
    const sum = fixture.nativeElement.querySelector('.weather-linkage__region-weight-footer .config-sum');
    expect(sum.getAttribute('data-state')).toBe('error');
    expect(sum.textContent).toContain('須為 100');
    const saveButton = fixture.nativeElement.querySelector('.weather-linkage__region-weight-footer .btn--primary');
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
    expect(fixture.nativeElement.querySelectorAll('.region-bar__segment')).toHaveLength(3);
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
    const select = fixture.nativeElement.querySelector('.config-table--weather-mapping .tier-select');
    expect(select.getAttribute('data-tier')).toBe('CORE');
  });
});
