import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // 絕對不碰 localStorage，全部用記憶體變數
  private memoryToken: string | null = null;
  private roleSubject = new BehaviorSubject<string | null>(null);
  public role$ = this.roleSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {}

  login(username: string, password: string): Observable<any> {
    return this.http.post<{ token: string; role?: string }>('/api/auth/login', { username, password }).pipe(
      tap(res => {
        if (res && res.token) {
          this.memoryToken = res.token;
        }
        if (res && res.role) {
          this.roleSubject.next(res.role);
        }
      })
    );
  }

  getCurrentUser(): Observable<any> {
    return this.http.get<any>('/api/auth/me').pipe(
      tap(user => {
        if (user && user.role) {
          this.roleSubject.next(user.role);
        }
      })
    );
  }

  // 供假登入測試/或後端直接回傳token時使用，手動塞入token並解析角色
  saveToken(token: string): void {
    this.memoryToken = token;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role) {
        this.roleSubject.next(payload.role);
      }
    } catch (e) {
      console.error('Token解析失敗', e);
    }
  }

  getRole(): string | null {
    return this.roleSubject.value;
  }

  getToken(): string | null {
    return this.memoryToken;
  }

  isLoggedIn(): boolean {
    return !!this.memoryToken;
  }

  logout(): void {
    this.memoryToken = null;
    this.roleSubject.next(null);
    this.router.navigate(['/login']);
  }
}
