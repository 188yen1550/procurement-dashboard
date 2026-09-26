/**
 * 檔案用途：把後端回傳的檔案（Blob）交給瀏覽器下載。
 *
 * 獨立成 service 而不是在元件裡直接操作 DOM：
 * 1. 下載只是「建立暫時的物件網址 → 用隱藏的 <a download> 觸發 → 釋放網址」這個固定流程，
 *    之後其他匯出功能可以直接重用；
 * 2. 單元測試環境（jsdom）沒有 URL.createObjectURL，元件測試直接替換這個 service 即可。
 *
 * ⚠️ 瀏覽器不會回報「使用者是否真的存了檔」，這裡只負責觸發下載。需要記錄「已匯出」
 * 這類狀態時，應由後端在產生檔案的同一個請求裡處理（見 ProductExportService）。
 */
import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FileDownloadService {
  private readonly document = inject(DOCUMENT);

  save(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    this.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 延後釋放：部分瀏覽器在 click() 同步返回時還沒開始讀取物件網址。
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
