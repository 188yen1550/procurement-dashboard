/**
 * 檔案用途：讓 statusMessage 這類「提示訊息」signal 在設定非空值之後
 * 自動消失，不用一直停留在畫面上。
 *
 * 為什麼要做這個：全站 5 個頁面（review／settings／product-management／
 * product-form／ai-suggestions）各自維護一份 `statusMessage = signal('')`，
 * 用同一種 `.status-toast`／`.feedback-toast` 樣式呈現，但目前設定之後
 * 會一直停留在畫面上，直到下一次呼叫 `.set(...)` 才會被蓋掉——如果使用者
 * 之後沒有再觸發任何動作，這句提示就會永遠留著。
 *
 * 沒有在每個 `.set(...)` 呼叫點各自加 setTimeout（那樣有幾十個呼叫點就要
 * 改幾十處，而且很容易漏改、每個人加的秒數還可能不一致）。改成在元件
 * 建構時呼叫這支工具「一次」，用 Angular 的 effect() 監看這個 signal，
 * 設定非空值時起 5 秒計時器，時間到就清空；下一次值改變時（不管是被
 * 使用者的下一個動作蓋掉，還是元件被銷毀）都會先清掉前一個計時器，
 * 不會有兩個計時器互相搶著清空的競態問題。
 *
 * 使用方式：只能在 injection context 裡呼叫（元件欄位初始化或建構子內）。
 *
 *   readonly statusMessage = signal('');
 *   constructor() { autoDismissStatusMessage(this.statusMessage); }
 */
import { WritableSignal, effect } from '@angular/core';

export function autoDismissStatusMessage(message: WritableSignal<string>, ms = 5000): void {
  effect((onCleanup) => {
    const value = message();
    if (!value) return;
    const timer = setTimeout(() => message.set(''), ms);
    onCleanup(() => clearTimeout(timer));
  });
}
