import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { Auth } from './auth';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return true;
  }

  // Mock 模式沒有 session 可以還原，signal 是 null 就真的是沒登入。
  // 真實模式下，頁面重新整理會清空記憶體裡的 signal，但瀏覽器可能仍
  // 持有有效的 httpOnly Cookie，先呼叫一次 restoreSession() 確認，
  // 不要一看到 signal 是 null 就直接導去登入頁。
  const check$ = auth.useMockData ? of(null) : auth.restoreSession();

  return check$.pipe(
    map((user) => {
      if (user || auth.isLoggedIn()) {
        return true;
      }
      router.navigate(['/login']);
      return false;
    }),
  );
};
