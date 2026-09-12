/** 檔案用途：登入頁互動、可恢復的非同步狀態與安全錯誤訊息呈現。 */
import { AfterViewInit, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { defer, finalize } from 'rxjs';
import { Auth, MockUsername } from '../../core/auth/auth';
import { APP_CONFIG } from '../../core/config/app-config';

interface LoginErrorLike {
  status?: number;
  error?: { message?: unknown } | string | null;
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements AfterViewInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private auth = inject(Auth);
  readonly useMockData = APP_CONFIG.useMockData;

  // 進頁面直接把游標放在帳號欄位——不用原生 autofocus 屬性，因為 Angular
  // 的變更偵測時機不穩定，autofocus 在某些路由切換情境下不會確實觸發；
  // AfterViewInit 這個時間點保證輸入框已經渲染完成，focus() 才會真的生效。
  @ViewChild('usernameInput') private readonly usernameInput?: ElementRef<HTMLInputElement>;

  ngAfterViewInit(): void {
    this.usernameInput?.nativeElement.focus();
  }

  readonly isLoading = signal(false);
  readonly errorMessage = signal('');

  loginForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  useMockAccount(username: MockUsername): void {
    this.loginForm.setValue({ username, password: 'demo123' });
    this.errorMessage.set('');
  }

  onSubmit(): void {
    if (this.isLoading()) return;
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    const { username, password } = this.loginForm.getRawValue();
    // defer 同時涵蓋 login() 同步拋錯與 Observable 非同步 error；finalize 保證所有結束路徑都解除 Loading。
    defer(() => this.auth.login(username ?? '', password ?? ''))
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
      next: () => {
        void this.router.navigate(['/dashboard']);
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.loginErrorMessage(error));
      },
    });
  }

  private loginErrorMessage(error: unknown): string {
    const candidate = error as LoginErrorLike | null;
    const backendMessage =
      typeof candidate?.error === 'object' && candidate.error !== null
        ? candidate.error.message
        : undefined;
    if (typeof backendMessage === 'string' && backendMessage.trim()) return backendMessage.trim();

    switch (candidate?.status) {
      case 0: return '無法連線至伺服器，請檢查網路後重試。';
      case 401: return '帳號或密碼錯誤。';
      case 403: return '帳號沒有登入權限或已停用。';
      default:
        return candidate?.status && candidate.status >= 500
          ? '系統暫時無法處理登入，請稍後再試。'
          : '登入失敗，請稍後再試。';
    }
  }
}
