/** 檔案用途：登入頁互動與角色原型切換；只寫入 Auth 的本地 Mock 狀態，不是正式 JWT 登入。 */
import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, MockUsername } from '../../core/auth/auth';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private auth = inject(Auth);

  isLoading = false;
  errorMessage = '';

  loginForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  useMockAccount(username: MockUsername): void {
    this.loginForm.setValue({ username, password: 'demo123' });
    this.errorMessage = '';
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const { username, password } = this.loginForm.getRawValue();
    this.auth.login(username ?? '', password ?? '').subscribe({
      next: () => {
        this.isLoading = false;
        void this.router.navigate(['/dashboard']);
      },
      error: (err: { error?: { message?: string } }) => {
        this.isLoading = false;
        // 後端 401 時 ApiResponse.message 會是「帳號或密碼錯誤」或
        // 「帳號已被停用」兩種不同文案（見 GlobalExceptionHandler），
        // 直接顯示後端訊息，不要自己收斂成單一句籠統文字。
        this.errorMessage = err?.error?.message ?? '登入失敗，請稍後再試';
      },
    });
  }
}
