import { TestBed } from '@angular/core/testing';

import { Auth } from './auth';

describe('Auth', () => {
  let service: Auth;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Auth);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should login a manager mock account', () => {
    const user = service.login('manager', 'demo123');

    expect(user?.role).toBe('MANAGER');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.isManager()).toBe(true);
  });

  it('should login a purchaser mock account', () => {
    const user = service.login('purchaser', 'demo123');

    expect(user?.role).toBe('PURCHASER');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.isManager()).toBe(false);
  });

  it('should reject invalid mock credentials', () => {
    const user = service.login('manager', 'wrong-password');

    expect(user).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
  });
});
