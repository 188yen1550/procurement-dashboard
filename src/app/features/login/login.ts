/** 檔案用途：登入頁互動、可恢復的非同步狀態與安全錯誤訊息呈現。 */
import { AfterViewInit, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { defer, finalize } from 'rxjs';
import { Auth, MockUsername } from '../../core/auth/auth';
import { APP_CONFIG } from '../../core/config/app-config';
import { Icon } from '../../shared/components/icon/icon';
import { ModalSurface } from '../../core/dialog/modal-surface';

interface LoginErrorLike {
  status?: number;
  error?: { message?: unknown } | string | null;
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, Icon, ModalSurface],
  templateUrl: './login.html',
  styleUrls: ['./login.scss', './login-reset.scss'],
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
  /** 密碼欄位目前是否以明文顯示（2026-09-27 新增顯示／隱藏切換）。 */
  readonly showPassword = signal(false);
  readonly errorMessage = signal('');

  // ----- 忘記密碼：申請重設（V27）-----
  // 忘記密碼的人無法登入，所以申請入口在登入頁。管理者只能重設「本人已申請」的帳號，
  // 處理後會透過其他管道（口頭、通訊軟體）提供臨時密碼，登入後必須先改掉。
  readonly resetPanelOpen = signal(false);
  readonly resetUsername = signal('');
  readonly resetSubmitting = signal(false);
  /** 送出後的訊息：不論帳號是否存在，後端都回同一段文字（不透露帳號是否存在）。 */
  readonly resetMessage = signal('');
  readonly resetError = signal('');

  openResetPanel(): void {
    // 帶入登入欄位已輸入的帳號，少打一次字。
    this.resetUsername.set(this.loginForm.controls.username.value?.trim() ?? '');
    this.resetMessage.set('');
    this.resetError.set('');
    this.resetPanelOpen.set(true);
  }

  closeResetPanel(): void {
    // 送出中不可關閉（appModal 的 modalBusy 也會擋 Esc 與點背景）。
    if (this.resetSubmitting()) return;
    this.resetPanelOpen.set(false);
  }

  submitResetRequest(): void {
    const username = this.resetUsername().trim();
    if (!username) {
      this.resetError.set('請輸入登入帳號');
      return;
    }
    if (this.resetSubmitting()) return;
    this.resetError.set('');
    this.resetSubmitting.set(true);
    this.auth
      .applyPasswordReset(username)
      .pipe(finalize(() => this.resetSubmitting.set(false)))
      .subscribe({
        next: (message) => this.resetMessage.set(message),
        error: () => this.resetError.set('申請送出失敗，請確認網路連線後再試一次。'),
      });
  }

  loginForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  useMockAccount(username: MockUsername): void {
    this.loginForm.setValue({ username, password: 'demo123' });
    this.errorMessage.set('');
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((visible) => !visible);
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
