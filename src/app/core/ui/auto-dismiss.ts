/**
 * 檔案用途：建立一個「會自動消失」的提示訊息 signal。
 *
 * ⚠️ 這是修正過的第二版。第一版做法是用 effect() 監看一個既有的
 * `signal<string>('')`，但 Angular signal 預設用 Object.is 比較新舊值，
 * 連續兩次 set() 同一句字串（例如 settings.ts 切換分頁時「已切換設定
 * 分類。」每次文字都一樣）會被視為沒有變化，不會觸發 effect 重新執行
 * ——第二次呼叫看起來設定成功，但計時器根本沒有重新起算，會被第一次
 * 那個已經在倒數的舊計時器提早收掉，使用者體感就是「跳出來一下下就
 * 消失，或完全沒反應」。
 *
 * 這一版不依賴 signal 值本身有沒有變化：show() 每次被呼叫都自己清掉
 * 前一個計時器、重新起算新的 5 秒，跟這次的文字是否跟上一次相同無關。
 *
 * 使用方式：
 *
 *   private readonly statusMessageState = createDismissibleMessage();
 *   readonly statusMessage = this.statusMessageState.signal;
 *
 *   // 原本的 this.statusMessage.set(text) 全部改成：
 *   this.statusMessageState.show(text);
 */
import { WritableSignal, signal } from '@angular/core';

export interface DismissibleMessage {
  readonly signal: WritableSignal<string>;
  show(text: string, ms?: number): void;
}

export function createDismissibleMessage(): DismissibleMessage {
  const state = signal('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    signal: state,
    show(text: string, ms = 5000): void {
      clearTimeout(timer);
      state.set(text);
      if (!text) return;
      timer = setTimeout(() => state.set(''), ms);
    },
  };
}
