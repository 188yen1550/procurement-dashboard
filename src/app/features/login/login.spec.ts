/** 驗證登入成功、各類錯誤、Loading 收尾、可重試及重複提交防護。 */
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
  const auth = { login: vi.fn<(username: string, password: string) => Observable<CurrentUser>>() };

  beforeEach(async () => {
    auth.login.mockReset();
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
});
