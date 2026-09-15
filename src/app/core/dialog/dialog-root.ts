import { Component, inject } from '@angular/core';
import { DialogService } from './dialog.service';
import { ModalSurface } from './modal-surface';
import { Icon } from '../../shared/components/icon/icon';

@Component({
  selector: 'app-dialog-root',
  imports: [ModalSurface, Icon],
  templateUrl: './dialog-root.html',
  styleUrl: './dialog-root.scss',
})
export class DialogRoot {
  protected readonly dialog = inject(DialogService);
}
