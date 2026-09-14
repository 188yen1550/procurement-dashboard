import './modal-test-setup';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalSurface } from './modal-surface';

@Component({
  imports: [ModalSurface],
  template: `<button id="launch" (click)="open.set(true)">開啟</button>
    @if(open()) { <dialog appModal aria-labelledby="title" [modalBusy]="busy()" (dismissed)="open.set(false)">
      <section><h2 id="title">測試表單</h2><button id="cancel">取消</button><input id="field" /><button disabled>停用</button><button id="last">儲存</button></section></dialog>
    }`,
})
class Host { open = signal(false); busy = signal(false); }

describe('ModalSurface', () => {
  it('locks scroll, traps form focus and keeps a busy modal open', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const launch = fixture.nativeElement.querySelector('#launch');
    document.body.style.overflow = 'auto';
    launch.focus(); launch.click(); fixture.detectChanges(); await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog');
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    const first = dialog.querySelector('#cancel');
    const last = dialog.querySelector('#last');
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true}));
    expect(document.activeElement).toBe(last);
    fixture.componentInstance.busy.set(true); fixture.detectChanges();
    dialog.dispatchEvent(new Event('cancel', {cancelable: true}));
    expect(fixture.componentInstance.open()).toBe(true);
    fixture.componentInstance.busy.set(false); fixture.detectChanges();
    dialog.dispatchEvent(new Event('cancel', {cancelable: true}));
    fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(launch);
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });
});
