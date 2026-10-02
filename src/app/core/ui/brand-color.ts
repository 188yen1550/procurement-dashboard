/**
 * 檔案用途：讓 Chart.js 這類「只吃顏色字串、不認 CSS 變數」的地方也能跟著角色配色。
 *
 * 樣式檔一律引用 var(--color-brand*)（見 shared/styles/_tokens.scss，管理層登入後
 * <html data-role="manager"> 會覆蓋成紫色）；但 Chart.js 把顏色畫在 canvas 上，
 * 傳 'var(--color-brand)' 不會生效，要在畫圖當下讀出實際的色碼。
 */

const FALLBACK: Record<BrandToken, string> = {
  '--color-brand': '#1c5286',
  '--color-brand-hover': '#17456f',
  '--color-brand-tint': '#eaf3fb',
};

export type BrandToken = '--color-brand' | '--color-brand-hover' | '--color-brand-tint';

/** 讀出目前生效的品牌色；測試環境（jsdom 沒有樣式表）或讀不到時退回操作層的預設藍色。 */
export function brandColor(token: BrandToken): string {
  if (typeof document === 'undefined') return FALLBACK[token];
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || FALLBACK[token];
}
