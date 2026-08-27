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

  logout(): void {
    this.currentUserState.set(null);
    void this.router.navigate(['/login']);
  }
}
