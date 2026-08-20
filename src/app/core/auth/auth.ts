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

  getRole(): string | null {
    return this.roleSubject.value;
  }

  getToken(): string | null {
    return this.memoryToken;
  }

  isLoggedIn(): boolean {
    return !!this.memoryToken;   // 只看token，不要用currentRole判斷
  }

  logout(): void {
    this.memoryToken = null;
    this.roleSubject.next(null);
    this.router.navigate(['/login']);
  }
}
