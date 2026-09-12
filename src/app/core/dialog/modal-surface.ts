import { Directive, ElementRef, Injectable, OnDestroy, afterNextRender, afterEveryRender, inject, input, output } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class ModalScrollLock {
  private readonly document = inject(DOCUMENT);
  private count = 0;
  private previous: string[] = [];
  lock(): void {
    if (this.count++ === 0) {
      this.previous = [this.document.documentElement.style.overflow, this.document.body.style.overflow];
      this.document.documentElement.style.overflow = 'hidden';
      this.document.body.style.overflow = 'hidden';
    }
  }
  unlock(): void {
    if (--this.count === 0) {
      this.document.documentElement.style.overflow = this.previous[0];
      this.document.body.style.overflow = this.previous[1];
    }
  }
}

/** All modal surfaces use the browser top layer, including feature-owned forms. */
@Directive({
  selector: 'dialog[appModal]',
  host: {
    class: 'app-modal-surface',
    'aria-modal': 'true',
    '(cancel)': 'cancel($event)',
    '(keydown)': 'keydown($event)',
    '(click)': 'backdrop($event)',
  },
})
export class ModalSurface implements OnDestroy {
  readonly modalBusy = input(false);
  readonly modalTrigger = input<HTMLElement | null>(null);
  readonly dismissed = output<void>();
  private readonly element = inject<ElementRef<HTMLDialogElement>>(ElementRef);
  private readonly lock = inject(ModalScrollLock);
  private trigger: HTMLElement | null = null;
  private opened = false;

  constructor() {
    afterNextRender(() => {
      const dialog = this.element.nativeElement;
      this.trigger = this.modalTrigger() ?? dialog.ownerDocument.activeElement as HTMLElement | null;
      dialog.showModal();
      this.opened = true;
      this.lock.lock();
      const initial = dialog.querySelector<HTMLElement>('[autofocus], button:not(:disabled), input:not(:disabled), [tabindex]');
      (initial ?? dialog).focus();
    });
    afterEveryRender(() => {
      const dialog = this.element.nativeElement;
      if (this.opened && !dialog.contains(dialog.ownerDocument.activeElement)) {
        dialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]')?.focus();
      }
    });
  }

  cancel(event: Event): void {
    event.preventDefault();
    if (!this.modalBusy()) this.dismissed.emit();
  }

  backdrop(event: MouseEvent): void {
    if (event.target === this.element.nativeElement) this.cancel(event);
  }

  keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancel(event);
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = this.element.nativeElement;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]'
    )).filter(item => !item.matches(':disabled, [hidden], [type="hidden"], [tabindex="-1"]') && item.getAttribute('aria-hidden') !== 'true');
    const first = items[0], last = items[items.length - 1];
    const active = dialog.ownerDocument.activeElement;
    if (!first || !dialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  ngOnDestroy(): void {
    if (!this.opened) return;
    this.element.nativeElement.close();
    this.lock.unlock();
    if (this.trigger?.isConnected && !this.trigger.matches(':disabled')) this.trigger.focus();
  }
}
