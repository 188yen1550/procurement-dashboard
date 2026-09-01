import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { Auth } from './auth';

describe('Auth', () => {
  let service: Auth;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(Auth);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should login a manager mock account', async () => {
    const user = await firstValueFrom(service.login('manager', 'demo123'));

    expect(user.role).toBe('MANAGER');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.isManager()).toBe(true);
  });

  it('should login a purchaser mock account', async () => {
    const user = await firstValueFrom(service.login('purchaser', 'demo123'));

    expect(user.role).toBe('PURCHASER');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.isManager()).toBe(false);
  });

  it('should reject invalid mock credentials', async () => {
    await expect(firstValueFrom(service.login('manager', 'wrong-password'))).rejects.toBeTruthy();
    expect(service.isLoggedIn()).toBe(false);
  });
});
