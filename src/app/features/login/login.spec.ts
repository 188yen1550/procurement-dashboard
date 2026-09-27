/** 驗證登入成功、各類錯誤、Loading 收尾、可重試及重複提交防護。 */
import '../../core/dialog/modal-test-setup';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { Auth } from '../../core/auth/auth';
import { CurrentUser } from '../../core/auth/auth.contract';
import { Login } from './login';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let router: Router;
  let navigate: ReturnType<typeof vi.spyOn>;
  const manager: CurrentUser = {
    id: 2,
    username: 'manager',
    name: '管理測試人員',
    role: 'MANAGER',
    mustChangePassword: false,
  };
  const auth = {
    login: vi.fn<(username: string, password: string) => Observable<CurrentUser>>(),
    applyPasswordReset: vi.fn<(username: string) => Observable<string>>(),
  };

  beforeEach(async () => {
    auth.login.mockReset();
    auth.applyPasswordReset.mockReset();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: Auth, useValue: auth }],
    }).compileComponents();
    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.loginForm.setValue({ username: 'manager', password: 'demo123' });
    fixture.detectChanges();
  });

  // 2026-09-27：密碼顯示／隱藏切換。
  it('toggles password visibility without submitting the form', () => {
    const input = fixture.nativeElement.querySelector('#password') as HTMLInputElement;
    const toggle = fixture.nativeElement.querySelector('.password-toggle') as HTMLButtonElement;
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('顯示密碼');
    expect(toggle.type).toBe('button');

    toggle.click();
    fixture.detectChanges();
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('隱藏密碼');
    expect(auth.login).not.toHaveBeenCalled();

    toggle.click();
    fixture.detectChanges();
    expect(input.type).toBe('password');
  });

  it('closes loading and navigates only after login succeeds', () => {
    const response = new Subject<CurrentUser>();
    auth.login.mockReturnValue(response);
    component.onSubmit();
    expect(component.isLoading()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    response.next(manager);
    response.complete();
    expect(component.isLoading()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('shows a backend safe message and allows an immediate retry', () => {
    auth.login
      .mockReturnValueOnce(throwError(() => ({ status: 401, error: { message: '帳號已被停用' } })))
      .mockReturnValueOnce(of(manager));
    component.onSubmit();
    fixture.detectChanges();
    expect(component.isLoading()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('帳號已被停用');
    component.onSubmit();
    expect(auth.login).toHaveBeenCalledTimes(2);
    expect(component.errorMessage()).toBe('');
  });

  it.each([
    [401, '帳號或密碼錯誤。'],
    [403, '帳號沒有登入權限或已停用。'],
    [0, '無法連線至伺服器，請檢查網路後重試。'],
    [500, '系統暫時無法處理登入，請稍後再試。'],
    [422, '登入失敗，請稍後再試。'],
  ])('uses an accessible fallback for status %s', (status, message) => {
    auth.login.mockReturnValue(throwError(() => ({ status, error: null })));
    component.onSubmit();
    fixture.detectChanges();
    expect(component.isLoading()).toBe(false);
    expect(component.errorMessage()).toBe(message);
    const alert = fixture.nativeElement.querySelector('.error-message');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('recovers when Auth.login throws synchronously', () => {
    auth.login.mockImplementation(() => { throw new Error('internal detail'); });
    component.onSubmit();
    fixture.detectChanges();
    expect(component.isLoading()).toBe(false);
    expect(component.errorMessage()).toBe('登入失敗，請稍後再試。');
  });

  it('does not submit twice while a request is pending', () => {
    auth.login.mockReturnValue(new Subject<CurrentUser>());
    component.onSubmit();
    component.onSubmit();
    expect(auth.login).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.btn-primary').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#username').readOnly).toBe(true);
  });

  describe('忘記密碼：申請重設（V27）', () => {
    it('prefills the username and shows the generic backend message after submitting', () => {
      auth.applyPasswordReset.mockReturnValue(of('已送出申請'));
      component.openResetPanel();
      expect(component.resetUsername()).toBe('manager');
      component.submitResetRequest();
      expect(auth.applyPasswordReset).toHaveBeenCalledWith('manager');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.reset-done').textContent).toContain('已送出申請');
      expect(component.resetSubmitting()).toBe(false);
    });

    it('opens the request form in a modal dialog and closes it (2026-09-26)', async () => {
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('dialog.reset-dialog-backdrop')).toBeNull();
      root.querySelector<HTMLButtonElement>('.reset-link')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      const dialog = root.querySelector('dialog.reset-dialog-backdrop')!;
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.querySelector('#reset-username')).not.toBeNull();

      component.closeResetPanel();
      fixture.detectChanges();
      expect(root.querySelector('dialog.reset-dialog-backdrop')).toBeNull();
    });

    it('cannot be closed while the request is being sent', () => {
      auth.applyPasswordReset.mockReturnValue(new Subject<string>());
      component.openResetPanel();
      component.submitResetRequest();
      component.closeResetPanel();
      expect(component.resetPanelOpen()).toBe(true);
    });

    it('requires a username before sending', () => {
      component.loginForm.setValue({ username: '', password: '' });
      component.openResetPanel();
      component.submitResetRequest();
      expect(auth.applyPasswordReset).not.toHaveBeenCalled();
      expect(component.resetError()).toBe('請輸入登入帳號');
    });

    it('shows a retry message when the request fails', () => {
      auth.applyPasswordReset.mockReturnValue(throwError(() => new Error('offline')));
      component.openResetPanel();
      component.submitResetRequest();
      expect(component.resetMessage()).toBe('');
      expect(component.resetError()).toContain('再試一次');
    });
  });
});
