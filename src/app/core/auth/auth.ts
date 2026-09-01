/** 檔案用途：管理目前登入者、角色與 Mock 登入狀態；此服務不是正式 JWT 驗證或後端授權。 */
import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';

export type UserRole = 'PURCHASER' | 'MANAGER';
export type MockUsername = 'purchaser' | 'manager';

export interface MockUser {
  username: MockUsername;
  name: string;
  role: UserRole;
}

interface MockAccount extends MockUser {
  password: string;
}

const MOCK_ACCOUNTS: readonly MockAccount[] = [
  {
    username: 'purchaser',
    password: 'demo123',
    name: '操作測試人員',
    role: 'PURCHASER',
  },
  {
    username: 'manager',
    password: 'demo123',
    name: '管理測試人員',
    role: 'MANAGER',
  },
];

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private readonly currentUserState = signal<MockUser | null>(null);

  readonly currentUser = this.currentUserState.asReadonly();

  constructor(private readonly router: Router) {}

  login(username: string, password: string): MockUser | null {
    const account = MOCK_ACCOUNTS.find(
      (item) => item.username === username.trim().toLowerCase() && item.password === password,
    );

    if (!account) {
      return null;
    }

    const user: MockUser = {
      username: account.username,
      name: account.name,
      role: account.role,
    };

    this.currentUserState.set(user);
    return user;
  }

  isLoggedIn(): boolean {
    return this.currentUser() !== null;
  }

  isManager(): boolean {
    return this.currentUser()?.role === 'MANAGER';
  }

  // API 整合層目前仍由其他成員開發；Mock Auth 不建立或保存正式 token。
  getToken(): string | null {
    return null;
  }

  logout(): void {
    this.currentUserState.set(null);
    void this.router.navigate(['/login']);
  }
}

// 暫時保留 master 既有程式使用的名稱，避免合併期間破壞攔截器引用。
export { Auth as AuthService };
