import './modal-test-setup';
import { TestBed } from '@angular/core/testing';
import { DialogRoot } from './dialog-root';
import { DialogService } from './dialog.service';

describe('DialogRoot keyboard interaction', () => {
  it.each(['confirm', 'cancel', 'escape', 'backdrop'])('restores the trigger after %s', async (method) => {
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
      else if (method === 'backdrop') fixture.nativeElement.querySelector('.app-dialog-backdrop').click();
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
});
