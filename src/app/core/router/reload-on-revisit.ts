/**
 * 檔案用途：讓「使用者已經在這個頁面、又點了一次同一個側邊欄連結」也能
 * 觸發重新載入資料，不用整頁重新整理才看得到最新數字。
 *
 * 背景：Angular 預設對「導到目前所在的同一個網址」完全沒有反應——不會
 * 觸發 NavigationEnd，元件也不會被銷毀重建，單靠 ngOnInit() 只會在第一次
 * 「切換到」這個頁面時抓資料，之後使用者原地重新點擊同一個連結，畫面
 * 不會更新，數字看起來就像「更新不夠即時」。
 *
 * 這支工具要搭配 app.config.ts 的 `onSameUrlNavigation: 'reload'` 一起用：
 * 那個設定讓「原地點擊」也會真的觸發一次 NavigationEnd，這裡負責監聽並
 * 呼叫呼叫端傳進來的 reload callback。只設定其中一邊都不會生效。
 *
 * 使用方式：只能在 injection context 裡呼叫（元件建構子內），並且要傳
 * 「這個元件對應的路由是否還原封不動」的判斷——多數情況下只要目前網址
 * 開頭符合這個頁面的路徑即可，不需要精確比對查詢字串。
 *
 *   constructor() {
 *     reloadOnRevisit(() => this.load());
 *   }
 */
import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

export function reloadOnRevisit(reload: () => void): void {
  const router = inject(Router);
  const destroyRef = inject(DestroyRef);
  // 訂閱本身只會在元件存活期間有效（takeUntilDestroyed）。真正的路由切換
  // 一定會先銷毀這個元件、連帶清掉這個訂閱，所以能收到事件的時候，
  // 幾乎必然就是「原地重新點擊同一個網址」這一種情況，不需要額外比對
  // event.urlAfterRedirects === router.url 才能判斷。
  router.events
    .pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe(() => reload());
}
