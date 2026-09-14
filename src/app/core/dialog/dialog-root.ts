import { Component, inject } from '@angular/core';
import { DialogService } from './dialog.service';
import { ModalSurface } from './modal-surface';

@Component({
  selector: 'app-dialog-root',
  imports: [ModalSurface],
  templateUrl: './dialog-root.html',
  styleUrl: './dialog-root.scss',
})
export class DialogRoot {
  protected readonly dialog = inject(DialogService);
}
