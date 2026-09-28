/**
 * 檔案用途：宣告管理專用 `/settings` lazy route；頂層 managerGuard 只負責前端導覽。
 *
 * 2026-09-29 依用途分三組（見 settings-groups.ts）：/settings/scoring（評分與審核規則）、
 * /settings/data（選品基礎資料）、/settings/system（系統管理），共用同一個 Settings 元件，
 * 以 data.settingsGroup 區分顯示的分頁。
 *
 * 舊網址一律依 ?tab= 反查分頁目前所屬的組，書籤不會失效：
 *   - /settings、/settings?tab=xxx（拆組前的單一設定頁）
 *   - /settings/operations（2026-09-25 兩組版本的第二組，已改名為 /settings/data）
 *   - 分頁搬到別組後的舊網址，例如 /settings/operations?tab=accounts、
 *     /settings/scoring?tab=jobs → 由 redirectMisplacedSettingsTab 轉到正確的組
 * 不帶分頁或分頁不認得時：/settings 轉到評分與審核規則，/settings/operations 轉到選品基礎資料。
 */
import { inject } from '@angular/core';
import { CanActivateFn, RedirectFunction, Router, Routes } from '@angular/router';
import { Settings } from './settings';
import { SettingsGroup, settingsGroupOfTab } from './settings-groups';

/** 依 ?tab= 所屬的組產生網址；分頁不認得時用 fallback 組、且不帶 tab。保留 #fragment。 */
function settingsUrlForTab(tab: unknown, fallback: SettingsGroup, fragment?: string | null) {
  const tabName = typeof tab === 'string' ? tab : null;
  const group = settingsGroupOfTab(tabName);
  return inject(Router).createUrlTree(['/settings', group ?? fallback], {
    queryParams: group ? { tab: tabName } : {},
    fragment: fragment ?? undefined,
  });
}

export const redirectLegacySettingsUrl: RedirectFunction = ({ queryParams, fragment }) =>
  settingsUrlForTab(queryParams['tab'], 'scoring', fragment);

/** 2026-09-25 兩組版本的 /settings/operations：改名為 /settings/data，其中帳號、風險選項已搬到別組。 */
export const redirectLegacyOperationsUrl: RedirectFunction = ({ queryParams, fragment }) =>
  settingsUrlForTab(queryParams['tab'], 'data', fragment);

/**
 * ?tab= 指到「另一組」的分頁時轉過去（例如分頁搬組前留下的書籤）。沒帶分頁、分頁不認得、
 * 或分頁本來就在這一組時放行，交給元件自己決定預設分頁。
 *
 * 只在進入路由時檢查；元件切換分頁時是同一個路由只改 query，預設的 runGuardsAndResolvers
 * 不會重跑守衛，也不會有需要擋的情況（元件只會切到這一組自己的分頁）。
 */
export const redirectMisplacedSettingsTab: CanActivateFn = (route) => {
  const current = route.data['settingsGroup'] as SettingsGroup;
  const tab = route.queryParamMap.get('tab');
  const owner = settingsGroupOfTab(tab);
  if (!owner || owner === current) return true;
  return settingsUrlForTab(tab, current, route.fragment);
};

export const SETTINGS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: redirectLegacySettingsUrl },
  { path: 'operations', pathMatch: 'full', redirectTo: redirectLegacyOperationsUrl },
  {
    path: 'scoring',
    component: Settings,
    data: { settingsGroup: 'scoring' },
    canActivate: [redirectMisplacedSettingsTab],
  },
  {
    path: 'data',
    component: Settings,
    data: { settingsGroup: 'data' },
    canActivate: [redirectMisplacedSettingsTab],
  },
  {
    path: 'system',
    component: Settings,
    data: { settingsGroup: 'system' },
    canActivate: [redirectMisplacedSettingsTab],
  },
];
