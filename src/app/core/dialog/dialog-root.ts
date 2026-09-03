import { Component, inject } from '@angular/core';
import { DialogService } from './dialog.service';

/**
 * 檔案用途：全站唯一的 dialog 元件，掛在 app.html。
 * 元件本身不持有任何狀態，純粹讀 DialogService.state() 呈現。
 */
@Component({
  selector: 'app-dialog-root',
  templateUrl: './dialog-root.html',
  styleUrl: './dialog-root.scss',
})
export class DialogRoot {
  protected readonly dialog = inject(DialogService);
}
