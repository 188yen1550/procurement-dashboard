/** 檔案用途：驗證 passwordChangeGuard 只在「必須修改密碼」時把導覽限制在 /profile。 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Auth } from './auth';
import { passwordChangeGuard } from './password-change-guard';

describe('passwordChangeGuard', () => {
  let mustChange: boolean;

  const run = (url: string) =>
    TestBed.runInInjectionContext(() =>
      passwordChangeGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  beforeEach(() => {
    mustChange = false;
    TestBed.configureTestingModule({
      providers: [{ provide: Auth, useValue: { mustChangePassword: () => mustChange } }],
    });
  });

  it('allows every page when no password change is required', () => {
    expect(run('/dashboard')).toBe(true);
    expect(run('/settings/scoring')).toBe(true);
  });

  it('redirects other pages to /profile while a password change is required', () => {
    mustChange = true;
    const result = run('/dashboard');
    expect(result instanceof UrlTree).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/profile');
  });

  it('lets the user stay on /profile to change the password', () => {
    mustChange = true;
    expect(run('/profile')).toBe(true);
  });
});
