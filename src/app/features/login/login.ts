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

    // 純前端原型：延遲只用來展示登入中的 UI 狀態，不會呼叫任何 API。
    setTimeout(() => {
      const { username, password } = this.loginForm.getRawValue();
      const user = this.auth.login(username ?? '', password ?? '');

      if (!user) {
        this.errorMessage = '測試帳號或密碼錯誤';
        this.isLoading = false;
        return;
      }

      this.isLoading = false;
      void this.router.navigate(['/dashboard']);
    }, 500);
  }
}
