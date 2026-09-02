/** 檔案用途：驗證正式模式登入會透過後端 Cookie Session 更新目前使用者狀態。 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { Auth } from './auth';

describe('Auth', () => {
  let service: Auth;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should login a manager account through the API', async () => {
    const result = firstValueFrom(service.login('manager', 'demo123'));
    http.expectOne('/api/auth/login').flush({
      data: { id: 2, username: 'manager', name: '管理測試人員', role: 'MANAGER' },
    });
    const user = await result;

    expect(user.role).toBe('MANAGER');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.isManager()).toBe(true);
  });

  it('should login a purchaser account through the API', async () => {
    const result = firstValueFrom(service.login('purchaser', 'demo123'));
    http.expectOne('/api/auth/login').flush({
      data: { id: 1, username: 'purchaser', name: '操作測試人員', role: 'PURCHASER' },
    });
    const user = await result;

    expect(user.role).toBe('PURCHASER');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.isManager()).toBe(false);
  });

  it('should preserve a backend login rejection', async () => {
    const result = firstValueFrom(service.login('manager', 'wrong-password'));
    http.expectOne('/api/auth/login').flush(
      { message: '帳號或密碼錯誤' },
      { status: 401, statusText: 'Unauthorized' },
    );
    await expect(result).rejects.toBeTruthy();
    expect(service.isLoggedIn()).toBe(false);
  });

  it('should preserve successful mock login without an HTTP request', async () => {
    Object.defineProperty(service, 'useMockData', { value: true });
    const user = await firstValueFrom(service.login('manager', 'demo123'));
    expect(user.role).toBe('MANAGER');
    expect(service.isLoggedIn()).toBe(true);
  });

  it('should preserve failed mock login without an HTTP request', async () => {
    Object.defineProperty(service, 'useMockData', { value: true });
    await expect(firstValueFrom(service.login('manager', 'wrong-password'))).rejects.toBeTruthy();
    expect(service.isLoggedIn()).toBe(false);
  });
});
