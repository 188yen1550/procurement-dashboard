/**
 * 檔案用途：驗證 App 根元件可由 TestBed 建立，以及依登入角色切換 <html data-role>。
 * fixture 管理測試 DOM 與生命週期；本檔不宣稱覆蓋登入、路由或 API 整合流程。
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Auth } from './core/auth/auth';
import { CurrentUser } from './core/auth/auth.contract';

describe('App', () => {
  const currentUser = signal<CurrentUser | null>(null);

  beforeEach(async () => {
    currentUser.set(null);
    document.documentElement.removeAttribute('data-role');
    await TestBed.configureTestingModule({
      imports: [App],
      // App 只讀 currentUser 決定配色；用可控的 signal 取代真正的 Auth（它還依賴 HttpClient）。
      providers: [{ provide: Auth, useValue: { currentUser: currentUser.asReadonly() } }],
    }).compileComponents();
  });

  afterEach(() => document.documentElement.removeAttribute('data-role'));

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('sets data-role on <html> by the signed-in role and clears it after logout', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(document.documentElement.hasAttribute('data-role')).toBe(false);

    currentUser.set({ id: 2, username: 'manager', name: '管理測試人員', role: 'MANAGER', mustChangePassword: false });
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-role')).toBe('manager');

    currentUser.set({ id: 1, username: 'purchaser', name: '操作測試人員', role: 'PURCHASER', mustChangePassword: false });
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-role')).toBe('purchaser');

    currentUser.set(null);
    fixture.detectChanges();
    expect(document.documentElement.hasAttribute('data-role')).toBe(false);
  });
});
