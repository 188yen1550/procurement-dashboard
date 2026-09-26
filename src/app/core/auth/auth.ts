/** 檔案用途：依環境設定提供本地 Mock 或後端 Cookie Session 登入，並管理目前使用者狀態。 */
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { AuthApiService } from './auth-api';
import { ChangePasswordRequestPayload, CurrentUser, UserRole } from './auth.contract';

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
        // Mock 帳號是固定的示範帳號，沒有「管理者代設密碼」的情境。
        mustChangePassword: false,
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

  /** V24：管理者設定的密碼尚未被使用者換掉，只能停留在個人資料頁修改密碼。 */
  mustChangePassword(): boolean {
    return this.currentUser()?.mustChangePassword === true;
  }

  /**
   * 修改自己的顯示名稱。成功後直接把回應寫回 currentUser signal，
   * header 與側欄的名字會立刻更新，不需要重新整理或再打一次 /api/auth/me。
   *
   * Mock 模式下只改本地 signal，不發請求——沒有後端可以持久化，
   * 但畫面行為要跟真實模式一致，否則 demo 時看不出這個功能有沒有做。
   */
  updateProfile(name: string): Observable<CurrentUser> {
    const trimmed = name.trim();

    if (this.useMockData) {
      const current = this.currentUserState();
      if (!current) {
        return throwError(() => ({ error: { message: '尚未登入' } }));
      }
      const updated: CurrentUser = { ...current, name: trimmed };
      this.currentUserState.set(updated);
      return of(updated);
    }

    return this.api.updateProfile({ name: trimmed }).pipe(tap((user) => this.currentUserState.set(user)));
  }

  /**
   * 修改自己的密碼。
   *
   * 後端成功後會重發 Cookie，session 不中斷，所以這裡不做任何導向。
   * 錯誤（目前密碼不符）一律往上拋，讓表單自己顯示在對應欄位旁邊。
   *
   * 回應寫回 currentUser 之後 mustChangePassword 會變成 false，passwordChangeGuard
   * 就不再限制導覽（「強制改密碼後導去哪裡」由呼叫端 Profile 決定）。
   *
   * Mock 模式比對 MOCK_ACCOUNTS 的固定密碼，但**不會真的改掉它**——
   * mock 帳號是常數，改了下次登入反而登不進去。這裡只驗證目前密碼正確，
   * 讓「填錯目前密碼會被擋下」這條防呆在 demo 時也看得到。
   */
  changePassword(payload: ChangePasswordRequestPayload): Observable<CurrentUser> {
    if (this.useMockData) {
      const current = this.currentUserState();
      if (!current) {
        return throwError(() => ({ error: { message: '尚未登入' } }));
      }
      const account = MOCK_ACCOUNTS.find((item) => item.username === current.username);
      if (!account || account.password !== payload.currentPassword) {
        return throwError(() => ({ error: { message: '目前密碼不正確' } }));
      }
      return of(current);
    }

    return this.api.changePassword(payload).pipe(tap((user) => this.currentUserState.set(user)));
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
