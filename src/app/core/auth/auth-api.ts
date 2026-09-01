import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope } from '../api/api-envelope';
import { AUTH_API, CurrentUser, LoginRequestBody } from './auth.contract';

/**
 * 登入相關 API 的唯一呼叫入口。
 *
 * withCredentials: true 是這支能不能用的關鍵：後端用 httpOnly Cookie 存
 * token（AuthController.login() 設定 Set-Cookie: access_token），不是
 * 回應 Body 帶 token 讓前端存進 localStorage 再手動加 header。沒有這個
 * 設定，瀏覽器不會保存、也不會送出這個 Cookie，登入後呼叫其他 API會
 * 全部變成 401——即使登入本身看起來成功。
 *
 * 開發環境注意：後端目前沒有設定 CORS，且 Cookie 是 SameSite=Strict，
 * Angular dev server 與後端不同 port 直接視為不同來源，瀏覽器會擋下這個
 * Cookie。本機開發請透過 proxy.conf.json 讓 Angular dev server 代理
 * /api 請求到後端，讓瀏覽器視角下永遠是同一個來源，不要改後端 CORS
 * 設定來繞過（那是正式環境的事，不要為了本機開發混進正式安全設定）。
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  login(body: LoginRequestBody): Observable<CurrentUser> {
    return this.http
      .post<ApiEnvelope<CurrentUser>>(AUTH_API.login, body, { withCredentials: true })
      .pipe(map((res) => res.data));
  }

  /** 用來在頁面重新整理後確認瀏覽器仍持有有效的 Cookie session。 */
  me(): Observable<CurrentUser> {
    return this.http
      .get<ApiEnvelope<CurrentUser>>(AUTH_API.me, { withCredentials: true })
      .pipe(map((res) => res.data));
  }

  logout(): Observable<void> {
    return this.http
      .post<ApiEnvelope<null>>(AUTH_API.logout, {}, { withCredentials: true })
      .pipe(map(() => undefined));
  }
}
