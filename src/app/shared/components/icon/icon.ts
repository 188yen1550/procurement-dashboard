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
  | 'refresh-cw';

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
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      flex-shrink: 0;
    }

    svg {
      width: var(--icon-md);
      height: var(--icon-md);
    }

    svg.icon-sm {
      width: var(--icon-sm);
      height: var(--icon-sm);
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<'sm' | 'md'>('md');
  /** 圖示旁邊已經有說明文字時保持 true（預設）；圖示是唯一語意來源時傳 false，並自行在外層補 aria-label。 */
  readonly hidden = input(true);
}
