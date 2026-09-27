/**
 * 檔案用途：定義前端應用程式最外層的 standalone 根元件。
 * 根元件只承接 Router outlet，不管理登入或商品商業狀態。
 */
import { DOCUMENT } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Auth } from './core/auth/auth';
import { DialogRoot } from './core/dialog/dialog-root';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DialogRoot],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
/** 應用程式根元件；`index.html` 掛載 selector，RouterOutlet 顯示目前路由頁面。 */
export class App {
  /** 預設專案標題 signal；目前不代表可由後端修改的設定。 */
  protected readonly title = signal('procurement-dashboard');

  private readonly auth = inject(Auth);
  private readonly document = inject(DOCUMENT);

  /**
   * 2026-09-27（UI 規格第 6 點）：依登入角色在 <html> 設定 data-role，
   * _tokens.scss 的 :root[data-role='manager'] 據此切換品牌色，操作層與管理層一眼可辨。
   * 未登入（含登出後）移除屬性，回到預設配色。
   */
  private readonly syncRoleAttribute = effect(() => {
    const role = this.auth.currentUser()?.role;
    const root = this.document.documentElement;
    if (role) {
      root.setAttribute('data-role', role.toLowerCase());
    } else {
      root.removeAttribute('data-role');
    }
  });
}
