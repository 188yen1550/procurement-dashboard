import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth/auth';

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

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    // TODO: 後端 API 好了之後,把下面這段換成:
    // const { username, password } = this.loginForm.getRawValue();
    // this.auth.login(username!, password!).subscribe({
    //   next: ({ token }) => {
    //     this.auth.saveToken(token);
    //     this.isLoading = false;
    //     this.router.navigate(['/dashboard']);
    //   },
    //   error: () => {
    //     this.errorMessage = '帳號或密碼錯誤';
    //     this.isLoading = false;
    //   },
    // });

    // ↓↓↓ 假登入,先測試路由 ↓↓↓
    setTimeout(() => {
      // 假 JWT,payload 帶 role: 'manager',讓 managerGuard 也測得過
      const fakeToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        btoa(JSON.stringify({ role: 'manager', name: 'test-user' })) +
        '.fake-signature';

      this.auth.saveToken(fakeToken);
      this.isLoading = false;
      this.router.navigate(['/dashboard']);
    }, 500);
  }
}
