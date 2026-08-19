import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth'; // 請依實際專案路徑調整

export const managerGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // 1. 檢查使用者是否已登入且角色為 MANAGER
  if (authService.isLoggedIn() && authService.getRole() === 'MANAGER') {
    return true;
  }

  // 2. 若權限不足，則攔截並重新導向至首頁或儀表板
  return router.parseUrl('/dashboard');
};
