/** 檔案用途：驗證設定頁兩組側邊欄的分頁歸屬，以及舊網址 /settings?tab= 的轉址規則。 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree, provideRouter } from '@angular/router';
import { SETTINGS_TAB_GROUPS, SETTINGS_TABS, settingsGroupOfTab } from './settings-groups';
import { redirectLegacySettingsUrl } from './settings.routes';

describe('settings groups', () => {
  it('assigns every tab to exactly one group', () => {
    const all = [...SETTINGS_TAB_GROUPS.scoring, ...SETTINGS_TAB_GROUPS.operations];
    expect(new Set(all).size).toBe(all.length);
    expect(SETTINGS_TABS).toHaveLength(10);
  });

  it('maps tabs to the agreed sidebar groups', () => {
    for (const tab of ['modes', 'extensions', 'scoreBands', 'systemSettings']) {
      expect(settingsGroupOfTab(tab)).toBe('scoring');
    }
    for (const tab of ['productTypes', 'risks', 'audience', 'campaigns', 'weather', 'accounts']) {
      expect(settingsGroupOfTab(tab)).toBe('operations');
    }
    expect(settingsGroupOfTab('unknown')).toBeNull();
    expect(settingsGroupOfTab(null)).toBeNull();
  });
});

describe('redirectLegacySettingsUrl', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const redirect = (queryParams: Record<string, string>) => {
    const result = TestBed.runInInjectionContext(() =>
      redirectLegacySettingsUrl({ queryParams } as unknown as ActivatedRouteSnapshot),
    );
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  };

  it('keeps the requested tab and sends it to its group', () => {
    expect(redirect({ tab: 'accounts' })).toBe('/settings/operations?tab=accounts');
    expect(redirect({ tab: 'scoreBands' })).toBe('/settings/scoring?tab=scoreBands');
  });

  it('falls back to scoring rules for a bare or unknown url', () => {
    expect(redirect({})).toBe('/settings/scoring');
    expect(redirect({ tab: 'nope' })).toBe('/settings/scoring');
  });
});
