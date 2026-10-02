/**
 * 檔案用途：驗證 InfoTip 提示泡泡（2026-09-24 由原生 title 升級）。
 * 重點：可用鍵盤／點擊開啟（觸控裝置沒有 hover）、Esc 與點外面會關、
 * 點擊不冒泡（放在可排序表頭或 label 裡時不誤觸發）。
 */
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InfoTip } from './info-tip';

@Component({
  imports: [InfoTip],
  template: `<div (click)="parentClicks = parentClicks + 1"><app-info-tip text="貝氏收縮說明" /></div>
    <p class="outside">outside</p>`,
})
class Host {
  parentClicks = 0;
}

describe('InfoTip', () => {
  let fixture: ComponentFixture<Host>;
  let trigger: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    trigger = fixture.nativeElement.querySelector('.info-tip__trigger');
  });

  const bubble = () => fixture.nativeElement.querySelector('[role="tooltip"]') as HTMLElement | null;

  it('is a real button labelled with the help text, closed by default', () => {
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-label')).toBe('說明：貝氏收縮說明');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(bubble()).toBeNull();
    // 不再依賴原生 title tooltip
    expect(trigger.hasAttribute('title')).toBe(false);
  });

  it('opens on focus and links the bubble via aria-describedby', () => {
    trigger.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(bubble()?.textContent).toContain('貝氏收縮說明');
    expect(trigger.getAttribute('aria-describedby')).toBe(bubble()?.id);
  });

  it('pins on click without bubbling to the parent, closes on Escape', () => {
    trigger.click();
    fixture.detectChanges();
    expect(bubble()).not.toBeNull();
    expect(fixture.componentInstance.parentClicks).toBe(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(bubble()).toBeNull();
  });

  it('closes when clicking elsewhere on the page', () => {
    trigger.click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.outside').click();
    fixture.detectChanges();
    expect(bubble()).toBeNull();
  });
});
