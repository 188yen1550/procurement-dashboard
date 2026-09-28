/**
 * 檔案用途：設定頁分頁與側邊欄分組的單一定義來源。
 *
 * 2026-09-29 改為依「用途」分三組（設定頁分類調整建議・方案 B），取代 2026-09-25
 * 依「異動頻率」分的兩組（評分規則／營運與帳號設定）。原本的分法讓「營運與帳號設定」
 * 裡一半項目其實直接影響分數（核心客群、節慶檔期、天氣連動），而「演算法參數」裡又混進
 * 跟評分無關的排程作業；使用者是看組名找東西，所以改成每組回答一個問題：
 *   - 評分與審核規則（/settings/scoring）：商品「怎麼被評判」。
 *   - 選品基礎資料（/settings/data）：系統「拿什麼資料」來評判。
 *   - 系統管理（/settings/system）：「誰能用」、背景作業是否正常。
 * 三組仍是同一個 Settings 元件，依路由 data.settingsGroup 決定顯示哪一組分頁；
 * 後端 API 完全沒有變動。舊網址（/settings?tab=、/settings/operations、分頁放錯組的網址）
 * 一律依分頁反查所屬的組轉址，見 settings.routes.ts。
 *
 * 例外：天氣連動裡的「加成上限與歷史／預報比重」本質上是評分規則，但它和天氣資料同步、
 * 訊號標籤對照、地域占比共用 weather-linkage 元件，拆開不划算；改在「計分與判定參數」
 * 放一條前往天氣連動的提示連結。
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
  | 'weather'
  | 'jobs';

export type SettingsGroup = 'scoring' | 'data' | 'system';

/** 各組分頁，陣列順序即畫面分頁順序；第一個是該組的預設分頁。 */
export const SETTINGS_TAB_GROUPS: Readonly<Record<SettingsGroup, readonly SettingsTab[]>> = {
  scoring: ['modes', 'extensions', 'scoreBands', 'systemSettings', 'risks'],
  data: ['productTypes', 'audience', 'campaigns', 'weather'],
  system: ['accounts', 'jobs'],
};

/** 側邊欄與頁面標題用的組名。 */
export const SETTINGS_GROUP_TITLE: Readonly<Record<SettingsGroup, string>> = {
  scoring: '評分與審核規則',
  data: '選品基礎資料',
  system: '系統管理',
};

/** 側邊欄顯示順序。 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = ['scoring', 'data', 'system'];

/** 所有分頁（三組合併，順序同畫面）。 */
export const SETTINGS_TABS: readonly SettingsTab[] = SETTINGS_GROUPS.flatMap((group) => SETTINGS_TAB_GROUPS[group]);

/** 分頁屬於哪一組；不是已知分頁（含 null）時回傳 null。 */
export function settingsGroupOfTab(tab: string | null | undefined): SettingsGroup | null {
  if (!tab) return null;
  for (const group of SETTINGS_GROUPS) {
    if ((SETTINGS_TAB_GROUPS[group] as readonly string[]).includes(tab)) return group;
  }
  return null;
}
