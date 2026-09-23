/**
 * 檔案用途：驗證「天氣連動」分頁（2026-09-24 由 settings 拆出）。
 * 前五個案例原樣搬自 settings.spec.ts 的天氣相關測試，只把「重新載入檔期清單」
 * 改成驗證 campaignsChanged 輸出（檔期列表已在另一個分頁）；後面補上地域占比
 * 加總狀態與比例條的案例。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { SettingsApiService } from '../../api/settings-api.service';
import { WeatherLinkage } from './weather-linkage';

describe('WeatherLinkage', () => {
  let fixture: ComponentFixture<WeatherLinkage>;
  let component: WeatherLinkage;
  let dialog: DialogService;

  const settingsApi = {
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
