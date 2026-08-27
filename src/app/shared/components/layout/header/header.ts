import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-header',
  imports: [],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  @Input() roleLabel = '操作人員';

  @Output() readonly menuToggle = new EventEmitter<void>();
  @Output() readonly logoutRequested = new EventEmitter<void>();
}

// 相容 master 新增的 LayoutComponent 命名，不改變目前 Header 行為。
export { Header as HeaderComponent };
