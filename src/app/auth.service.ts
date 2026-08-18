import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // 記憶體 Token 變數（絕對不存 localStorage）
  private memoryToken: string | null = null;

  constructor(private http: HttpClient) {}

  // 1. 登入 API
  login(credentials: { username: string; password: string }): Observable<any> {
    return this.http.post<any>('/api/auth/login', credentials).pipe(
      tap(res => {
        // 如果後端有在 JSON 回傳 token，就暫存到記憶體中
        if (res && res.token) {
          this.memoryToken = res.token;
          console.log("Token 已安全存入記憶體變數中");
        }
      })
    );
  }

  // 2. 取得使用者角色 API
  getCurrentUser(): Observable<any> {
    return this.http.get<any>('/api/auth/me');
  }

  // 3. 取得 Token 給 Interceptor 使用
  getToken(): string | null {
    return this.memoryToken;
  }

  // 4. 登出 / 清除 Token
  logout(): void {
    this.memoryToken = null;
    console.log("Token 已從記憶體中清除");
  }

  // 5. 檢查是否登入
  isLoggedIn(): boolean {
    return !!this.memoryToken;
  }
}
