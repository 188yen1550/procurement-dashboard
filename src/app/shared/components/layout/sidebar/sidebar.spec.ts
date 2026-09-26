/** 檔案用途：驗證 Sidebar 元件與角色導覽 UI；可見性 assertion 不代表後端 RBAC。 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Sidebar } from './sidebar';

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('greys out and disables navigation while a password change is required (2026-09-26)', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('nav.navigation')?.hasAttribute('inert')).toBe(false);
    expect(root.querySelector('.locked-notice')).toBeNull();

    fixture.componentRef.setInput('locked', true);
    fixture.detectChanges();

    const nav = root.querySelector('nav.navigation')!;
    expect(nav.classList).toContain('is-locked');
    expect(nav.hasAttribute('inert')).toBe(true);
    expect(nav.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('.locked-notice')?.textContent).toContain('請先修改密碼');
  });
});
