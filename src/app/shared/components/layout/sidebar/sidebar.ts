/** 檔案用途：主要導覽；管理入口的前端可見性只改善體驗，不能視為後端授權。 */
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  @Input() isOpen = false;
  @Input() isManager = false;

  @Output() readonly closeRequested = new EventEmitter<void>();
}

// 相容 master 新增的 LayoutComponent 命名，不改變目前 Sidebar 行為。
export { Sidebar as SidebarComponent };
