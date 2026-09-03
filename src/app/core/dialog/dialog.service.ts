/**
 * 檔案用途：全站共用的 dialog 服務，取代所有 window.confirm()／window.alert()。
 *
 * 為什麼要做這個：原生瀏覽器對話框（如截圖裡的 localhost:4200 顯示）
 * 樣式完全無法客製、行動裝置上呈現粗糙、也跟站內其餘 UI 風格不一致。
 * 這支服務讓全站只有「一套」dialog 視覺與行為，任何元件需要跳確認或
 * 提示都呼叫這裡，不要各自在元件裡疊一份 dialog 邏輯——先前
 * product-form.ts 就自己疊過一份本地 infoDialog，這次一併收斂進來。
 *
 * 使用方式：
 * - 純資訊提示（成功／錯誤／一般訊息，只有一顆「我知道了」）：呼叫 notify()。
 * - 需要使用者二選一決定（確定／取消）：呼叫 confirm()，回傳 Observable<boolean>，
 *   訂閱後才會拿到使用者的選擇——用法跟 window.confirm() 的呼叫端幾乎一樣，
 *   差別只在這是非同步的（confirm() 本身不阻塞，要在 subscribe 裡處理結果）。
 */
import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';

export type DialogVariant = 'info' | 'success' | 'error' | 'confirm';

export interface DialogState {
  variant: DialogVariant;
  title: string;
  messages: string[];
  confirmLabel: string;
  cancelLabel?: string;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialogState = signal<DialogState | null>(null);
  readonly state = this.dialogState.asReadonly();

  private pendingRespond: ((confirmed: boolean) => void) | null = null;

  /** 純資訊提示：成功、錯誤、一般訊息，只有一顆確定鈕。 */
  notify(
    variant: 'info' | 'success' | 'error',
    title: string,
    messages: string[],
    confirmLabel = '我知道了',
  ): Observable<void> {
    return new Observable<void>((subscriber) => {
      this.dialogState.set({ variant, title, messages, confirmLabel });
      this.pendingRespond = () => {
        subscriber.next();
        subscriber.complete();
      };
    });
  }

  /**
   * 需要使用者確認／取消的情境（離開頁面前確認、覆蓋既有資料前確認等）。
   * 取代 window.confirm()：回傳 Observable<boolean>，true 是確定、false 是取消。
   */
  confirm(
    title: string,
    messages: string[],
    confirmLabel = '確定',
    cancelLabel = '取消',
  ): Observable<boolean> {
    return new Observable<boolean>((subscriber) => {
      this.dialogState.set({ variant: 'confirm', title, messages, confirmLabel, cancelLabel });
      this.pendingRespond = (confirmed) => {
        subscriber.next(confirmed);
        subscriber.complete();
      };
    });
  }

  /** 給根層級 dialog 元件呼叫；使用者按下確定。 */
  handleConfirm(): void {
    this.dialogState.set(null);
    const respond = this.pendingRespond;
    this.pendingRespond = null;
    respond?.(true);
  }

  /** 給根層級 dialog 元件呼叫；使用者按下取消，或點背景／ESC 關閉。 */
  handleCancel(): void {
    this.dialogState.set(null);
    const respond = this.pendingRespond;
    this.pendingRespond = null;
    respond?.(false);
  }
}
