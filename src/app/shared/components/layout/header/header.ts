/** 檔案用途：後台頂部列；呈現系統定位並透過事件交由父層控制手機選單。 */
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-header',
  imports: [],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  @Input() roleLabel = '操作人員';
  @Input() userName = '';

  @Output() readonly menuToggle = new EventEmitter<void>();
  @Output() readonly logoutRequested = new EventEmitter<void>();
}

// 相容 master 新增的 LayoutComponent 命名，不改變目前 Header 行為。
export { Header as HeaderComponent };
