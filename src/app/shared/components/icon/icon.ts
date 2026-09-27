/**
 * 檔案用途：全站共用的功能圖示元件。
 *
 * ## 為什麼需要這個元件
 *
 * 這次的字級/圖示體檢發現：全站有將近 20 種功能圖示（鎖頭、搜尋、返回、
 * 排序方向、使用者、勾選、關閉、警示、趨勢方向…）是直接把 Unicode 符號或
 * emoji（🔒 🔍 ← ▲ ▼ ⇅ 👤 ✓ × ⚠ ↗ ↘ 等）當純文字寫在樣板裡，大小完全綁在
 * font-size 上、粗細與對齊在不同作業系統／字體下差異很大，這正是這次
 * 「圖示過小、不易辨識」的主要成因之一。
 *
 * 統一改用這個元件而不是在每個樣板各自貼一段 SVG：
 * - 尺寸只由 --icon-sm／--icon-md 兩個 token 控制，改一處全站生效
 * - 顏色用 currentColor，自動跟隨外層文字顏色（連結、按鈕的 hover/active
 *   狀態不用另外處理圖示顏色）
 * - 用 @switch 而非 [innerHTML]：SVG path 是靜態字串，用 innerHTML 需要
 *   額外處理 Angular 的 HTML sanitizer（DomSanitizer.bypassSecurityTrustHtml），
 *   多一層風險换不到任何好處，靜態樣板反而更簡單、也更容易做型別檢查
 *   （name 是字面量聯集，打錯字名稱編譯期就會擋下來）。
 *
 * ## 使用方式
 *
 *   <app-icon name="lock" />
 *   <app-icon name="lock" size="sm" />  <!-- 表格列內較小的圖示 -->
 *
 * aria-hidden 預設為 true：圖示多半緊鄰說明文字（例如「🔒 核心選品資料已
 * 鎖定」），語意已經由旁邊的文字承載，圖示本身對螢幕閱讀器是重複資訊。
 * 若某處圖示是唯一的語意載體（純圖示按鈕、沒有文字標籤），呼叫端要另外
 * 在外層元素加 aria-label，不要指望這個元件自己生出來——它不知道情境。
 */
import { Component, input } from '@angular/core';

export type IconName =
  | 'lock'
  | 'eye'
  | 'eye-off'
  | 'search'
  | 'chevron-left'
  | 'chevron-up'
  | 'chevron-down'
  | 'chevrons-up-down'
  | 'user'
  | 'check'
  | 'x'
  | 'alert-triangle'
  | 'image'
  | 'trending-up'
  | 'trending-down'
  | 'trending-flat'
  | 'refresh-cw'
  | 'inbox'
  | 'info'
  | 'help-circle'
  | 'sparkles'
  | 'layout-dashboard'
  | 'list'
  | 'clipboard-list'
  | 'check-circle'
  | 'sliders-horizontal'
  | 'settings';

@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      [class.icon-sm]="size() === 'sm'"
      [class.icon-md]="size() === 'md'"
      [attr.aria-hidden]="hidden() ? 'true' : null"
      [attr.role]="hidden() ? null : 'img'"
    >
      @switch (name()) {
        @case ('lock') {
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        }
        @case ('eye') {
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        }
        @case ('eye-off') {
          <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
          <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
          <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
          <path d="m2 2 20 20" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        }
        @case ('chevron-left') {
          <path d="m15 18-6-6 6-6" />
        }
        @case ('chevron-up') {
          <path d="m18 15-6-6-6 6" />
        }
        @case ('chevron-down') {
          <path d="m6 9 6 6 6-6" />
        }
        @case ('chevrons-up-down') {
          <path d="m7 15 5 5 5-5" />
          <path d="m7 9 5-5 5 5" />
        }
        @case ('user') {
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        }
        @case ('check') {
          <path d="M20 6 9 17l-5-5" />
        }
        @case ('x') {
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        }
        @case ('alert-triangle') {
          <path
            d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
          />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        }
        @case ('image') {
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        }
        @case ('trending-up') {
          <path d="M16 7h6v6" />
          <path d="m22 7-8.5 8.5-5-5L2 17" />
        }
        @case ('trending-down') {
          <path d="M16 17h6v-6" />
          <path d="m22 17-8.5-8.5-5 5L2 7" />
        }
        @case ('trending-flat') {
          <path d="M4 12h16" />
        }
        @case ('refresh-cw') {
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M16 16h5v5" />
        }
        @case ('inbox') {
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path
            d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
          />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        }
        @case ('help-circle') {
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        }
        @case ('sparkles') {
          <path
            d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
          />
          <path d="M20 3v4" /><path d="M22 5h-4" /><path d="M4 17v2" /><path d="M5 18H3" />
        }
        @case ('layout-dashboard') {
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        }
        @case ('list') {
          <path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
          <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
        }
        @case ('clipboard-list') {
          <rect width="8" height="4" x="8" y="2" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" />
        }
        @case ('check-circle') {
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        }
        @case ('sliders-horizontal') {
          <path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" />
          <path d="M21 20h-5" /><path d="M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" />
        }
        @case ('settings') {
          <path
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          />
          <circle cx="12" cy="12" r="3" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      flex-shrink: 0;
    }

    /*
     * 圖示實際大小由元件內部的 svg 規則決定，不是外層 host 的 width/height——
     * 呼叫端如果只在自己的 CSS 裡對 app-icon 元素設 width/height，只會撐大
     * 外層的置中容器，裡面的 svg 還是原本的 --icon-sm/md，看起來就是「圖示
     * 沒變大、旁邊卻空了一圈」。
     *
     * 需要非標準尺寸（例如空狀態、圖片預留位置這種裝飾性大圖示）時，呼叫端
     * 要設 --icon-size-override 這個 CSS 變數，而不是直接設 width/height：
     *   .empty-state app-icon { --icon-size-override: 2.6rem; }
     */
    svg {
      width: var(--icon-size-override, var(--icon-md));
      height: var(--icon-size-override, var(--icon-md));
    }

    svg.icon-sm {
      width: var(--icon-size-override, var(--icon-sm));
      height: var(--icon-size-override, var(--icon-sm));
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<'sm' | 'md'>('md');
  /** 圖示旁邊已經有說明文字時保持 true（預設）；圖示是唯一語意來源時傳 false，並自行在外層補 aria-label。 */
  readonly hidden = input(true);
}
