import './modal-test-setup';
import { TestBed } from '@angular/core/testing';
import { DialogRoot } from './dialog-root';
import { DialogService } from './dialog.service';

describe('DialogRoot keyboard interaction', () => {
  // 2026-09-27：點擊背景空白處不再關閉視窗（見 ModalSurface.backdrop()），
  // 關閉方式只剩確定／取消／Escape，背景點擊改在下方獨立測試驗證「不會關閉」。
  it.each(['confirm', 'cancel', 'escape'])('restores the trigger after %s', async (method) => {
    await TestBed.configureTestingModule({ imports: [DialogRoot] }).compileComponents();
    const fixture = TestBed.createComponent(DialogRoot);
    const service = TestBed.inject(DialogService);
    fixture.detectChanges();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    try {
      trigger.focus();
      service.confirm('確認', ['內容']).subscribe();
      // Busy bindings may blur the original button before the modal renders.
      trigger.disabled = true;
      trigger.blur();
      fixture.detectChanges();
      await fixture.whenStable();
      const cancel = fixture.nativeElement.querySelector('.app-dialog-cancel') as HTMLButtonElement;
      const confirm = fixture.nativeElement.querySelector('.app-dialog-confirm') as HTMLButtonElement;
      expect(document.activeElement).toBe(cancel);
      expect(document.body.style.overflow).toBe('hidden');
      expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(confirm);
      confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(cancel);
      trigger.disabled = false;
      if (method === 'escape') cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (method === 'confirm') confirm.click();
      else cancel.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(service.state()).toBeNull();
      expect(document.body.style.overflow).not.toBe('hidden');
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
      fixture.destroy();
    }
  });

  it('keeps the dialog open when the backdrop is clicked', async () => {
    await TestBed.configureTestingModule({ imports: [DialogRoot] }).compileComponents();
    const fixture = TestBed.createComponent(DialogRoot);
    const service = TestBed.inject(DialogService);
    fixture.detectChanges();
    try {
      let answered: boolean | null = null;
      service.confirm('確認', ['內容']).subscribe((result) => (answered = result));
      fixture.detectChanges();
      await fixture.whenStable();

      fixture.nativeElement.querySelector('.app-dialog-backdrop').click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(service.state()).not.toBeNull();
      expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
      expect(answered).toBeNull();

      // 視窗內的取消按鈕仍然可以關閉
      (fixture.nativeElement.querySelector('.app-dialog-cancel') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(service.state()).toBeNull();
      expect(answered).toBe(false);
    } finally {
      fixture.destroy();
    }
  });
});
