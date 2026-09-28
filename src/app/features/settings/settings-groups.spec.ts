/** 檔案用途：驗證設定頁三組側邊欄的分頁歸屬，以及各種舊網址的轉址規則（2026-09-29 依用途分三組）。 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { SETTINGS_GROUP_TITLE, SETTINGS_TAB_GROUPS, SETTINGS_TABS, settingsGroupOfTab } from './settings-groups';
import {
  redirectLegacyOperationsUrl,
  redirectLegacySettingsUrl,
  redirectMisplacedSettingsTab,
} from './settings.routes';

describe('settings groups', () => {
  it('assigns every tab to exactly one group', () => {
    const all = [...SETTINGS_TAB_GROUPS.scoring, ...SETTINGS_TAB_GROUPS.data, ...SETTINGS_TAB_GROUPS.system];
    expect(new Set(all).size).toBe(all.length);
    expect(SETTINGS_TABS).toHaveLength(11);
    expect(SETTINGS_TABS).toEqual(all);
  });

  it('maps tabs to the agreed sidebar groups (rules / data / system)', () => {
    for (const tab of ['modes', 'extensions', 'scoreBands', 'systemSettings', 'risks']) {
      expect(settingsGroupOfTab(tab)).toBe('scoring');
    }
    for (const tab of ['productTypes', 'audience', 'campaigns', 'weather']) {
      expect(settingsGroupOfTab(tab)).toBe('data');
    }
    for (const tab of ['accounts', 'jobs']) {
      expect(settingsGroupOfTab(tab)).toBe('system');
    }
    expect(settingsGroupOfTab('unknown')).toBeNull();
    expect(settingsGroupOfTab(null)).toBeNull();
  });

  it('uses purpose-based group titles', () => {
    expect(SETTINGS_GROUP_TITLE).toEqual({ scoring: '評分與審核規則', data: '選品基礎資料', system: '系統管理' });
  });
});

describe('legacy settings urls', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const serialize = (result: unknown) => TestBed.inject(Router).serializeUrl(result as UrlTree);
  const run = (fn: typeof redirectLegacySettingsUrl, queryParams: Record<string, string>, fragment: string | null = null) =>
    serialize(
      TestBed.runInInjectionContext(() => fn({ queryParams, fragment } as unknown as ActivatedRouteSnapshot)),
    );

  it('/settings?tab= keeps the requested tab and sends it to its current group', () => {
    expect(run(redirectLegacySettingsUrl, { tab: 'accounts' })).toBe('/settings/system?tab=accounts');
    expect(run(redirectLegacySettingsUrl, { tab: 'risks' })).toBe('/settings/scoring?tab=risks');
    expect(run(redirectLegacySettingsUrl, { tab: 'weather' })).toBe('/settings/data?tab=weather');
  });

  it('/settings falls back to scoring rules for a bare or unknown url', () => {
    expect(run(redirectLegacySettingsUrl, {})).toBe('/settings/scoring');
    expect(run(redirectLegacySettingsUrl, { tab: 'nope' })).toBe('/settings/scoring');
  });

  it('/settings/operations (two-group era) follows each tab to its new group', () => {
    expect(run(redirectLegacyOperationsUrl, { tab: 'accounts' })).toBe('/settings/system?tab=accounts');
    expect(run(redirectLegacyOperationsUrl, { tab: 'risks' })).toBe('/settings/scoring?tab=risks');
    expect(run(redirectLegacyOperationsUrl, { tab: 'campaigns' })).toBe('/settings/data?tab=campaigns');
    expect(run(redirectLegacyOperationsUrl, {})).toBe('/settings/data');
  });

  it('keeps the #fragment when redirecting', () => {
    expect(run(redirectLegacySettingsUrl, { tab: 'jobs' }, 'trend-crawler')).toBe(
      '/settings/system?tab=jobs#trend-crawler',
    );
  });
});

describe('redirectMisplacedSettingsTab', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const guard = (group: string, queryParams: Record<string, string>, fragment: string | null = null) =>
    TestBed.runInInjectionContext(() =>
      redirectMisplacedSettingsTab(
        { data: { settingsGroup: group }, queryParamMap: convertToParamMap(queryParams), fragment } as unknown as ActivatedRouteSnapshot,
        {} as never,
      ),
    );

  it('lets tabs of its own group, bare urls and unknown tabs through', () => {
    expect(guard('scoring', { tab: 'risks' })).toBe(true);
    expect(guard('system', {})).toBe(true);
    expect(guard('data', { tab: 'nope' })).toBe(true);
  });

  it('sends a tab that moved to another group to that group, keeping the fragment', () => {
    const result = guard('scoring', { tab: 'jobs' }, 'trend-crawler');
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/settings/system?tab=jobs#trend-crawler');
    const moved = guard('data', { tab: 'accounts' });
    expect(TestBed.inject(Router).serializeUrl(moved as UrlTree)).toBe('/settings/system?tab=accounts');
  });
});
