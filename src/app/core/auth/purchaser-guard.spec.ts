/** 檔案用途：驗證 purchaserGuard 只放行操作層，管理層導回待審清單。 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Auth } from './auth';
import { purchaserGuard } from './purchaser-guard';

describe('purchaserGuard', () => {
  const auth = { isLoggedIn: vi.fn(() => true), isManager: vi.fn(() => false) };

  const run = () =>
    TestBed.runInInjectionContext(() =>
      purchaserGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Auth, useValue: auth }],
    });
  });

  it('lets purchasers through', () => {
    auth.isManager.mockReturnValue(false);
    expect(run()).toBe(true);
  });

  it('redirects managers to the review queue', () => {
    auth.isManager.mockReturnValue(true);
    const result = run();
    expect(result instanceof UrlTree).toBe(true);
    expect((result as UrlTree).toString()).toBe('/review');
  });
});
