import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope } from '../api/api-envelope';
import { unwrapData } from '../api/unwrap';
import {
  AUTH_API,
  ChangePasswordRequestPayload,
  CurrentUser,
  LoginRequestPayload,
  UpdateProfileRequestPayload,
} from './auth.contract';

/**
 * 登入相關 API 的唯一呼叫入口。
 *
 * ## Cookie 模式的三個關鍵前提（缺一個就會全部 401）
 *
 * 1. **withCredentials: true**
 *    後端 AuthController.login() 以 Set-Cookie 下發 access_token，
 *    不是回應 Body 帶 token。沒有這個設定，瀏覽器不會保存也不會送出 Cookie，
 *    登入本身看起來會成功，但之後每一支 API 都是 401。
 *    這件事由 withCredentialsInterceptor 全域處理，這裡不重複設定。
 *
 * 2. **必須走 proxy.conf.json**
 *    SecurityConfig.java 沒有任何 CORS 設定，且 Cookie 是 SameSite=Strict。
 *    Angular dev server（4200）與後端（8080）在瀏覽器眼中是不同來源，
 *    Cookie 會被擋掉。本機開發一律透過 proxy 把 /api 導到後端，
 *    讓瀏覽器視角下永遠同源。不要為了本機方便去改後端 CORS。
 *
 * 3. **cookie.secure 要設 false**
 *    application.properties 的 cookie.secure 預設 true（安全預設），
 *    但 true 時瀏覽器只在 HTTPS 帶 Cookie。本機跑 http://localhost
 *    需要在後端環境設 COOKIE_SECURE=false，否則同樣全部 401。
 *    這是後端環境設定，前端改不了，遇到時要找後端同事處理。
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  /**
   * POST /api/auth/login
   *
   * 401 有兩種不同語意（見 GlobalExceptionHandler）：
   * InvalidCredentialsException（帳密錯誤）與 AccountDisabledException（帳號已停用）。
   * 兩者狀態碼相同、message 不同，這裡刻意不 catchError，
   * 讓登入畫面自己從 ApiError.message 讀出正確文案，
   * 不要在這層收斂成單一句「登入失敗」——使用者會不知道該找誰處理。
   */
  login(payload: LoginRequestPayload): Observable<CurrentUser> {
    return this.http
      .post<ApiEnvelope<CurrentUser>>(AUTH_API.login, payload)
      .pipe(
        unwrapData(),
        map((user) => {
          if (
            !user ||
            typeof user.username !== 'string' ||
            typeof user.role !== 'string'
          ) {
            throw new Error('Invalid login response');
          }
          return user;
        }),
      );
  }

  /**
   * GET /api/auth/me
   *
   * 用途：頁面重新整理後確認瀏覽器是否仍持有有效 Cookie session。
   * 記憶體裡的使用者狀態會被重整清空，但 Cookie 可能還在，
   * 不能只看本地 state 是 null 就判定沒登入。
   * 401 是正常結果（真的沒登入），不是錯誤，由 Auth 服務降級成 null。
   */
  me(): Observable<CurrentUser> {
    return this.http
      .get<ApiEnvelope<CurrentUser>>(AUTH_API.me)
      .pipe(unwrapData());
  }

  /** POST /api/auth/logout。後端回 data: null，這裡不回傳內容。 */
  logout(): Observable<void> {
    return this.http
      .post<ApiEnvelope<null>>(AUTH_API.logout, {})
      .pipe(map(() => undefined));
  }

  /**
   * PATCH /api/auth/me：修改自己的顯示名稱。
   *
   * 回應是更新後的完整 UserResponse，呼叫端（Auth）應拿它覆蓋 currentUser
   * signal，讓 header 的名字立刻跟著變，不要只更新表單本地狀態。
   */
  updateProfile(payload: UpdateProfileRequestPayload): Observable<CurrentUser> {
    return this.http
      .patch<ApiEnvelope<CurrentUser>>(AUTH_API.updateProfile, payload)
      .pipe(unwrapData());
  }

  /**
   * PATCH /api/auth/me/password：修改自己的密碼。
   *
   * 後端成功後會重發 access_token Cookie（屬性與 login 完全一致），
   * 所以改完密碼不會被登出，呼叫端不需要導回登入頁。
   *
   * 目前密碼填錯時後端回 401，與「未登入」是同一個狀態碼。呼叫端必須
   * 自己從 HttpErrorResponse.error.message 取文案顯示在表單上，不能讓
   * 全域 401 處理把使用者踢回登入頁——那會讓人誤以為 session 過期。
   */
  changePassword(payload: ChangePasswordRequestPayload): Observable<CurrentUser> {
    return this.http
      .patch<ApiEnvelope<CurrentUser>>(AUTH_API.changePassword, payload)
      .pipe(unwrapData());
  }
}
