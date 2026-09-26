/**
 * 檔案用途：宣告管理專用 `/settings` lazy route；頂層 managerGuard 只負責前端導覽。
 *
 * 2026-09 側邊欄拆分：/settings/scoring（評分規則）與 /settings/operations（營運與帳號設定）
 * 共用同一個 Settings 元件，以 data.settingsGroup 區分顯示的分頁（見 settings-groups.ts）。
 * 舊網址 /settings 與 /settings?tab=xxx（書籤、其他頁面的連結）自動轉到分頁所屬的組，
 * 不帶分頁或分頁不認得時轉到評分規則。
 */
import { inject } from '@angular/core';
import { RedirectFunction, Router, Routes } from '@angular/router';
import { Settings } from './settings';
import { settingsGroupOfTab } from './settings-groups';

export const redirectLegacySettingsUrl: RedirectFunction = ({ queryParams }) => {
  const tab = typeof queryParams['tab'] === 'string' ? queryParams['tab'] : null;
  const group = settingsGroupOfTab(tab);
  return inject(Router).createUrlTree(['/settings', group ?? 'scoring'], {
    queryParams: group ? { tab } : {},
  });
};

export const SETTINGS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: redirectLegacySettingsUrl },
  { path: 'scoring', component: Settings, data: { settingsGroup: 'scoring' } },
  { path: 'operations', component: Settings, data: { settingsGroup: 'operations' } },
];
