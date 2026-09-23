/**
 * 檔案用途：術語說明用的小圖示＋提示泡泡元件。
 *
 * 選品資料與系統設定裡有大量專有名詞（折扣深度、貝氏收縮平滑常數、
 * 資料完整度…），這個元件提供「就地說明」：
 *
 * ## 2026-09-24 升級：原生 title → 自繪提示泡泡（決策 D4）
 * 原本用原生 title 屬性，有三個問題，在說明文字變長（演算法參數整批改用
 * 提示泡泡，貝氏收縮單段說明達 150 字）後變得無法接受：
 *   1. 觸控裝置完全不會顯示 title tooltip；
 *   2. 原生 tooltip 字級由作業系統決定、無法調整，違反全站「最小字級
 *      16px、給視力不佳者使用」的既有決定（見 _tokens.scss 字級說明）；
 *   3. 長文字塞進原生 tooltip 幾乎無法閱讀，也無法把游標移上去停留。
 *
 * ## 互動規則
 * - 滑鼠：hover 圖示顯示；游標可以移到泡泡上停留閱讀（WCAG 1.4.13
 *   hoverable），離開兩者後短暫延遲才收起。
 * - 鍵盤：Tab 聚焦即顯示，Esc 收起，失焦收起。
 * - 觸控／點擊：點圖示切換「釘住」狀態；點頁面其他地方或捲動時收起。
 *
 * ## 為什麼用 position: fixed + JS 計算座標，不用 CSS absolute
 * 這個元件大量出現在 .data-table 裡，而 .data-table 是 overflow-x: auto，
 * absolute 定位的泡泡會被表格容器裁掉。fixed 定位不受祖先 overflow 裁切，
 * 開啟時依圖示位置計算座標，空間不足時改往上方顯示。捲動時直接收起，
 * 不追著捲動重新定位——這是一段說明文字，不是需要長時間對照的浮層。
 *
 * ## 對外 API 不變
 * 仍是 `<app-info-tip text="…" />`。圖示改為 <button type="button">，放在
 * <label> 內點擊時瀏覽器不會把點擊轉送給 label 關聯的核取方塊（button 屬於
 * interactive content），並在元件內 stopPropagation，避免放在可排序表頭裡時
 * 誤觸發排序。既有呼叫端的 (click)="$event.preventDefault()" 保留無害。
 */
import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../icon/icon';

/** 泡泡與圖示之間、以及與視窗邊緣之間保留的距離（px）。 */
const GAP_PX = 8;
/** 游標離開後延遲收起的時間，讓使用者有時間把游標移到泡泡上。 */
const HIDE_DELAY_MS = 120;

let nextInfoTipId = 0;

@Component({
  selector: 'app-info-tip',
  imports: [Icon],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'hide()',
  },
  template: `
    <button
      #trigger
      type="button"
      class="info-tip"
      [attr.aria-label]="'說明：' + text()"
      [attr.aria-describedby]="open() ? tipId : null"
      [attr.aria-expanded]="open()"
      (mouseenter)="show()"
      (mouseleave)="scheduleHide()"
      (focus)="show()"
      (blur)="hideUnlessPinned()"
      (click)="toggle($event)"
    >
      <app-icon name="help-circle" size="sm" />
    </button>
    @if (open()) {
      <span
        #bubble
        class="info-tip-bubble"
        role="tooltip"
        [id]="tipId"
        [style.top.px]="position().top"
        [style.left.px]="position().left"
        (mouseenter)="cancelHide()"
        (mouseleave)="scheduleHide()"
        >{{ text() }}</span
      >
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        vertical-align: middle;
        margin-left: var(--s-1);
      }
      .info-tip {
        display: inline-flex;
        align-items: center;
        padding: 0;
        border: 0;
        border-radius: 50%;
        color: var(--c-ink-faint);
        background: none;
        font: inherit;
        cursor: help;
      }
      .info-tip:hover,
      .info-tip:focus-visible,
      .info-tip[aria-expanded='true'] {
        color: var(--c-brand);
      }
      .info-tip:focus-visible {
        outline: 2px solid var(--c-brand);
        outline-offset: 2px;
      }
      .info-tip-bubble {
        position: fixed;
        z-index: 1000;
        width: max-content;
        max-width: min(24rem, calc(100vw - 1rem));
        padding: var(--s-2-5) var(--s-3);
        border-radius: var(--r-md);
        color: #fff;
        background: var(--c-ink);
        box-shadow: var(--sh-modal);
        font-size: var(--t-sm);
        font-weight: 400;
        line-height: var(--lh-base);
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      @media (prefers-reduced-motion: no-preference) {
        .info-tip-bubble {
          animation: info-tip-in var(--motion-fast);
        }
      }
      @keyframes info-tip-in {
        from {
          opacity: 0;
        }
      }
    `,
  ],
})
export class InfoTip {
  readonly text = input.required<string>();

  readonly tipId = `info-tip-${nextInfoTipId++}`;
  readonly open = signal(false);
  readonly position = signal({ top: 0, left: 0 });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly bubble = viewChild<ElementRef<HTMLElement>>('bubble');

  /** 點擊釘住：觸控裝置沒有 hover，點擊後維持開啟，直到點其他地方。 */
  private pinned = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly closeOnScroll = () => this.hide();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.cancelHide();
      this.detachScrollListener();
    });
  }

  show(): void {
    this.cancelHide();
    if (this.open()) return;
    this.open.set(true);
    // 泡泡渲染後才量得到寬高，下一個 frame 再定位；第一個 frame 先放在
    // 圖示正下方，避免瞬間閃在畫面左上角。
    this.placeBelowTrigger();
    requestAnimationFrame(() => this.reposition());
    window.addEventListener('scroll', this.closeOnScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.closeOnScroll, { passive: true });
  }

  hide(): void {
    this.cancelHide();
    this.pinned = false;
    if (!this.open()) return;
    this.open.set(false);
    this.detachScrollListener();
  }

  hideUnlessPinned(): void {
    if (!this.pinned) this.hide();
  }

  scheduleHide(): void {
    if (this.pinned) return;
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
  }

  cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  toggle(event: MouseEvent): void {
    // 不讓點擊冒泡：這個圖示常放在可排序表頭、<label>、可點選卡片裡，
    // 點說明圖示不該同時觸發排序、勾選或切換卡片。
    event.stopPropagation();
    if (this.pinned) {
      this.hide();
      return;
    }
    this.show();
    this.pinned = true;
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (this.host.nativeElement.contains(event.target as Node)) return;
    this.hide();
  }

  private placeBelowTrigger(): void {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    this.position.set({ top: rect.bottom + GAP_PX, left: Math.max(GAP_PX, rect.left) });
  }

  private reposition(): void {
    const bubble = this.bubble()?.nativeElement;
    if (!bubble || !this.open()) return;
    const triggerRect = this.trigger().nativeElement.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();

    const centeredLeft = triggerRect.left + triggerRect.width / 2 - width / 2;
    const left = Math.min(Math.max(GAP_PX, centeredLeft), window.innerWidth - width - GAP_PX);

    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const placeAbove = spaceBelow < height + GAP_PX * 2 && triggerRect.top > height + GAP_PX * 2;
    this.position.set({
      top: placeAbove ? triggerRect.top - height - GAP_PX : triggerRect.bottom + GAP_PX,
      left: Math.max(GAP_PX, left),
    });
  }

  private detachScrollListener(): void {
    window.removeEventListener('scroll', this.closeOnScroll, { capture: true });
    window.removeEventListener('resize', this.closeOnScroll);
  }
}
