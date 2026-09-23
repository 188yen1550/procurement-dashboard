/**
 * 檔案用途：術語說明用的小圖示＋提示文字元件。
 *
 * 選品資料與系統設定裡有大量專有名詞（折扣深度、貝氏收縮平滑常數、
 * 資料完整度…），原本完全沒有就地說明，使用者要嘛自己猜、要嘛去問
 * 開發或翻文件。這個元件補上「游標放上去看解釋」的最小可行方案：
 *
 * - 用原生 title 屬性（瀏覽器內建 hover tooltip），不用另外寫一套
 *   浮層定位/顯示邏輯——這批術語說明是「簡短一兩句話」，原生 tooltip
 *   的能力已經足夠，換一套自製浮層元件的維護成本換不到對應的好處。
 * - tabindex="0" 讓鍵盤使用者也能 focus 到這個圖示，瀏覽器對 focus 中
 *   的元素同樣會顯示 title tooltip，不是只有滑鼠使用者看得到。
 * - aria-label 與 title 同步，螢幕閱讀器讀得到說明內容，不只是「說明」
 *   兩個字。
 *
 * 2026-09-23 由 procurement-dashboard-updated 分支整併進主線。
 *
 * 使用方式：<app-info-tip text="折扣深度 = (市價 − 售價) ÷ 市價，數值越高代表團購價相對市價折讓越深。" />
 */
import { Component, input } from '@angular/core';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-info-tip',
  imports: [Icon],
  template: `
    <span
      class="info-tip"
      tabindex="0"
      role="img"
      [attr.title]="text()"
      [attr.aria-label]="text()"
    >
      <app-icon name="help-circle" size="sm" />
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        vertical-align: middle;
      }
      .info-tip {
        display: inline-flex;
        align-items: center;
        color: #8a97a3;
        cursor: help;
      }
      .info-tip:hover,
      .info-tip:focus-visible {
        color: #1c5286;
      }
      .info-tip:focus-visible {
        outline: 2px solid #1c5286;
        outline-offset: 2px;
        border-radius: 50%;
      }
    `,
  ],
})
export class InfoTip {
  readonly text = input.required<string>();
}
