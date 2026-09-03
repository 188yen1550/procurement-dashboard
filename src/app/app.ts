/**
 * 檔案用途：定義前端應用程式最外層的 standalone 根元件。
 * 根元件只承接 Router outlet，不管理登入或商品商業狀態。
 */
import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DialogRoot } from './core/dialog/dialog-root';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DialogRoot],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
/** 應用程式根元件；`index.html` 掛載 selector，RouterOutlet 顯示目前路由頁面。 */
export class App {
  /** 預設專案標題 signal；目前不代表可由後端修改的系統設定。 */
  protected readonly title = signal('procurement-dashboard');
}
