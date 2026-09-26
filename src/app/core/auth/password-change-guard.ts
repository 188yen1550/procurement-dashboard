/**
 * 檔案用途：V24 強制修改密碼的前端導覽限制。
 *
 * 管理者建立帳號或代重設密碼後，使用者第一次登入必須先改掉管理者給的密碼
 * （避免管理者長期知道使用者正在使用的密碼）。這個 guard 掛在受保護殼層的
 * canActivateChild：mustChangePassword=true 時，除了 /profile 以外的頁面一律導去 /profile。
 *
 * ⚠️ 這只是導覽體驗，不是權限邊界。真正的限制在後端 JwtAuthenticationFilter：
 * 帶著 mustChangePassword claim 的 token 只能呼叫 /api/auth/**，其餘 API 回 403。
 *
 * 執行順序：父層 canActivate（authGuard，負責頁面重整後還原 session）會先於父層
 * canActivateChild 執行，所以這裡讀到的 currentUser 已經是還原後的值。
 */
import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { Auth } from './auth';

/** 強制修改密碼期間唯一允許停留的頁面。 */
export const PASSWORD_CHANGE_ROUTE = '/profile';

export const passwordChangeGuard: CanActivateChildFn = (_childRoute, state) => {
  const auth = inject(Auth);
  if (!auth.mustChangePassword()) return true;
  if (state.url === PASSWORD_CHANGE_ROUTE || state.url.startsWith(`${PASSWORD_CHANGE_ROUTE}?`)) return true;
  return inject(Router).parseUrl(PASSWORD_CHANGE_ROUTE);
};
