import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const managerGuard: CanActivateFn = (route, state) => {
  const authService = inject(Auth);
  const router = inject(Router);

  // 1. 檢查使用者是否已登入且角色為 MANAGER
  if (authService.isLoggedIn() && authService.isManager()) {
    return true;
  }

  // 2. 若權限不足，則攔截並重新導向至首頁或儀表板
  return router.parseUrl('/dashboard');
};
