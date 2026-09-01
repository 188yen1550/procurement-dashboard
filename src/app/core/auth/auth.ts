/** 檔案用途：依環境設定提供本地 Mock 或後端 Cookie Session 登入，並管理目前使用者狀態。 */
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { AuthApiService } from './auth-api';
import { CurrentUser, UserRole } from './auth.contract';

export type MockUsername = 'purchaser' | 'manager';

interface MockAccount {
  id: number;
  username: MockUsername;
  password: string;
  name: string;
  role: UserRole;
}

// id 是為了跟真實模式共用同一個 CurrentUser 型別，不需要另外寫 union type。
const MOCK_ACCOUNTS: readonly MockAccount[] = [
  { id: 1, username: 'purchaser', password: 'demo123', name: '操作測試人員', role: 'PURCHASER' },
  { id: 2, username: 'manager', password: 'demo123', name: '管理測試人員', role: 'MANAGER' },
];

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private readonly router = inject(Router);
  private readonly api = inject(AuthApiService);
  readonly useMockData = APP_CONFIG.useMockData;

  private readonly currentUserState = signal<CurrentUser | null>(null);
  readonly currentUser = this.currentUserState.asReadonly();

  /**
   * Mock 模式本地比對，不呼叫任何網路請求。
   * 真實模式呼叫 POST /api/auth/login；帳密錯誤或帳號被停用都是後端
   * 回 401，訊息內容不同（見 GlobalExceptionHandler），這裡刻意不吞掉
   * 錯誤、讓呼叫端（登入畫面）自己從 HttpErrorResponse.error.message
   * 讀出正確文案，不要在這裡收斂成單一句「登入失敗」。
   */
  login(username: string, password: string): Observable<CurrentUser> {
    if (this.useMockData) {
      const account = MOCK_ACCOUNTS.find(
        (item) => item.username === username.trim().toLowerCase() && item.password === password,
      );
      if (!account) {
        return throwError(() => ({ error: { message: '測試帳號或密碼錯誤' } }));
      }
      const user: CurrentUser = {
        id: account.id,
        username: account.username,
        name: account.name,
        role: account.role,
      };
      this.currentUserState.set(user);
      return of(user);
    }

    return this.api.login({ username, password }).pipe(tap((user) => this.currentUserState.set(user)));
  }

  /**
   * 供 authGuard 在頁面重新整理後使用：記憶體裡的 signal 會被重整清空，
   * 但瀏覽器仍可能持有有效的 httpOnly Cookie session，不能只看 signal
   * 是 null 就直接當作沒登入，要實際呼叫一次 GET /api/auth/me 確認。
   * 401（真的沒登入）視為正常結果，降級回傳 null，不當作錯誤。
   */
  restoreSession(): Observable<CurrentUser | null> {
    if (this.useMockData) {
      return of(this.currentUserState());
    }
    return this.api.me().pipe(
      tap((user) => this.currentUserState.set(user)),
      catchError(() => {
        this.currentUserState.set(null);
        return of(null);
      }),
    );
  }

  isLoggedIn(): boolean {
    return this.currentUser() !== null;
  }

  isManager(): boolean {
    return this.currentUser()?.role === 'MANAGER';
  }

  logout(): void {
    if (this.useMockData) {
      this.currentUserState.set(null);
      void this.router.navigate(['/login']);
      return;
    }
    // 就算 logout API 本身失敗（例如網路問題），前端仍應清掉本地狀態
    // 並導回登入頁——留在已登出但畫面還顯示已登入的狀態沒有意義。
    this.api.logout().pipe(catchError(() => of(undefined))).subscribe(() => {
      this.currentUserState.set(null);
      void this.router.navigate(['/login']);
    });
  }
}

// 暫時保留 master 既有程式使用的名稱，避免合併期間破壞既有引用。
export { Auth as AuthService };
