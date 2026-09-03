/** 檔案用途：登入後的後台殼層，組合 Header、Sidebar、手機選單狀態與子路由內容。 */
import { Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Auth } from '../../../../core/auth/auth';
import { Header } from '../header/header';
import { Sidebar } from '../sidebar/sidebar';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, Header, Sidebar],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout {
  private readonly auth = inject(Auth);

  readonly isMenuOpen = signal(false);

  /**
   * ⚠️ 改成 computed()，不要在建構時只讀一次快照：真實模式下頁面重新整理
   * 後，authGuard 會非同步呼叫 restoreSession() 才確認登入者身分（見
   * auth.ts 的說明），如果這裡只在建構當下讀一次 isManager()，遇到這個
   * 時序就會抓到還沒回填的舊值，選單跟角色徽章會顯示錯誤或空白。
   */
  readonly isManager = computed(() => this.auth.isManager());
  readonly roleLabel = computed(() => (this.isManager() ? '管理人員' : '操作人員'));
  readonly userName = computed(() => this.auth.currentUser()?.name ?? '');

  toggleMenu(): void {
    this.isMenuOpen.update((isOpen) => !isOpen);
  }

  closeMenu(): void {
    this.isMenuOpen.set(false);
  }

  logout(): void {
    this.auth.logout();
  }
}
