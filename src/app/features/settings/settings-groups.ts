/**
 * 檔案用途：設定頁分頁與側邊欄分組的單一定義來源（2026-09 系統設定側邊欄拆分）。
 *
 * 原本只有一個「設定」側邊欄項目，進去後十個水平分頁。拆成兩個側邊欄項目：
 *   - 評分規則（/settings/scoring）：調整「選品怎麼被打分」，異動頻率較高。
 *   - 營運與帳號設定（/settings/operations）：維護基礎資料與人員權限，異動頻率較低。
 * 兩者仍是同一個 Settings 元件，依路由 data.settingsGroup 決定顯示哪一組分頁；
 * 後端 API 完全沒有變動。
 *
 * 新增分頁時只要在這裡把它放進其中一組，路由轉址、分頁顯示都會跟著生效。
 */
export type SettingsTab =
  | 'modes'
  | 'risks'
  | 'audience'
  | 'productTypes'
  | 'campaigns'
  | 'accounts'
  | 'scoreBands'
  | 'systemSettings'
  | 'extensions'
  | 'weather';

export type SettingsGroup = 'scoring' | 'operations';

/** 各組分頁，陣列順序即畫面分頁順序；第一個是該組的預設分頁。 */
export const SETTINGS_TAB_GROUPS: Readonly<Record<SettingsGroup, readonly SettingsTab[]>> = {
  scoring: ['modes', 'extensions', 'scoreBands', 'systemSettings'],
  operations: ['productTypes', 'risks', 'audience', 'campaigns', 'weather', 'accounts'],
};

/** 側邊欄與頁面標題用的組名。 */
export const SETTINGS_GROUP_TITLE: Readonly<Record<SettingsGroup, string>> = {
  scoring: '評分規則',
  operations: '營運與帳號設定',
};

/** 所有分頁（兩組合併，順序同畫面）。 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  ...SETTINGS_TAB_GROUPS.scoring,
  ...SETTINGS_TAB_GROUPS.operations,
];

/** 分頁屬於哪一組；不是已知分頁（含 null）時回傳 null。 */
export function settingsGroupOfTab(tab: string | null | undefined): SettingsGroup | null {
  if (!tab) return null;
  for (const group of Object.keys(SETTINGS_TAB_GROUPS) as SettingsGroup[]) {
    if ((SETTINGS_TAB_GROUPS[group] as readonly string[]).includes(tab)) return group;
  }
  return null;
}
