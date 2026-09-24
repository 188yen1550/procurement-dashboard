/*
 * 檔案用途：個人資料頁。承載 PATCH /api/auth/me 與 PATCH /api/auth/me/password。
 *
 * ## 為什麼是獨立路由而不是放進設定
 * /settings 掛了 managerGuard，採購角色進不去。但「改自己的名字與密碼」
 * 是每個登入者都該有的功能，放進設定頁等於採購永遠改不了自己的密碼。
 * 因此獨立成 /profile，只掛 authGuard。
 *
 * ## 兩張表單刻意分開送出
 * 改名字與改密碼是兩支不同的端點、失敗原因也完全不同（名稱太長 vs
 * 目前密碼不對）。合併成一張表單的話，改名字失敗會連帶讓使用者以為
 * 密碼也沒改成功，反之亦然。分開送出，各自顯示各自的結果。
 */
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth/auth';
import { PASSWORD_MIN_LENGTH, USER_NAME_MAX_LENGTH } from '../../core/auth/auth.contract';
import { USER_ROLE_LABEL } from '../../core/domain/labels';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';

@Component({
  selector: 'app-profile',
  imports: [FormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  private readonly auth = inject(Auth);
  private readonly destroyRef = inject(DestroyRef);

  readonly nameMaxLength = USER_NAME_MAX_LENGTH;
  readonly passwordMinLength = PASSWORD_MIN_LENGTH;

  readonly currentUser = this.auth.currentUser;

  /** 角色顯示用中文。後端 UserResponse 只回英文代碼，是刻意設計。 */
  readonly roleLabel = computed(() => {
    const role = this.currentUser()?.role;
    return role ? USER_ROLE_LABEL[role] : '—';
  });

  // ----- 顯示名稱 -----

  readonly nameDraft = signal(this.currentUser()?.name ?? '');
  readonly isSavingName = signal(false);
  readonly nameError = signal('');
  private readonly nameSuccess = createDismissibleMessage();
  readonly nameMessage = this.nameSuccess.signal;

  /**
   * 名稱的前端驗證，與後端 @NotBlank + @Size(max = 50) 對齊。
   * 前端先擋是為了即時回饋，後端那道才是真正的防線。
   */
  readonly nameValidation = computed(() => {
    const value = this.nameDraft().trim();
    if (!value) return '顯示名稱不可空白';
    if (value.length > this.nameMaxLength) return `顯示名稱不可超過 ${this.nameMaxLength} 個字`;
    return '';
  });

  /** 沒改動就不讓按送出——避免送出一個什麼都沒變的請求。 */
  readonly isNameUnchanged = computed(() => this.nameDraft().trim() === (this.currentUser()?.name ?? ''));

  readonly canSubmitName = computed(
    () => !this.nameValidation() && !this.isNameUnchanged() && !this.isSavingName(),
  );

  submitName(): void {
    if (!this.canSubmitName()) return;
    this.nameError.set('');
    this.isSavingName.set(true);

    this.auth
      .updateProfile(this.nameDraft())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSavingName.set(false);
          this.nameSuccess.show('顯示名稱已更新');
        },
        error: (err: unknown) => {
          this.isSavingName.set(false);
          this.nameError.set(readErrorMessage(err, '顯示名稱更新失敗，請稍後再試'));
        },
      });
  }

  resetName(): void {
    this.nameDraft.set(this.currentUser()?.name ?? '');
    this.nameError.set('');
  }

  // ----- 密碼 -----

  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly isSavingPassword = signal(false);
  readonly passwordError = signal('');
  private readonly passwordSuccess = createDismissibleMessage();
  readonly passwordMessage = this.passwordSuccess.signal;

  /**
   * 確認欄位只在使用者開始輸入後才顯示不符的提示，
   * 否則一打第一個字就跳紅字，體感像是在被責備。
   */
  readonly confirmMismatch = computed(
    () => this.confirmPassword().length > 0 && this.confirmPassword() !== this.newPassword(),
  );

  readonly newPasswordTooShort = computed(
    () => this.newPassword().length > 0 && this.newPassword().length < this.passwordMinLength,
  );

  /**
   * 擋掉「新密碼與目前密碼相同」。後端沒有這道檢查，但送出去會是一次
   * 什麼都沒改變的成功，使用者會以為改好了。前端先擋掉比較誠實。
   */
  readonly newPasswordSameAsCurrent = computed(
    () => this.newPassword().length > 0 && this.newPassword() === this.currentPassword(),
  );

  readonly canSubmitPassword = computed(
    () =>
      this.currentPassword().length > 0 &&
      this.newPassword().length >= this.passwordMinLength &&
      this.confirmPassword() === this.newPassword() &&
      !this.newPasswordSameAsCurrent() &&
      !this.isSavingPassword(),
  );

  submitPassword(): void {
    if (!this.canSubmitPassword()) return;
    this.passwordError.set('');
    this.isSavingPassword.set(true);

    this.auth
      .changePassword({
        currentPassword: this.currentPassword(),
        newPassword: this.newPassword(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSavingPassword.set(false);
          this.clearPasswordFields();
          // 後端會重發 Cookie，這個瀏覽器的 session 不中斷，所以不需要導回
          // 登入頁——但密碼變更會讓其他裝置／瀏覽器上原本的登入狀態失效
          // （單一登入機制的必然結果），這裡明確告知，避免使用者之後在
          // 別的裝置上突然被登出卻不知道原因，誤以為是系統異常。
          this.passwordSuccess.show('密碼已更新，這個裝置的登入不會中斷；其他裝置需要重新登入。');
        },
        error: (err: unknown) => {
          this.isSavingPassword.set(false);
          this.passwordError.set(readErrorMessage(err, '密碼更新失敗，請確認目前密碼是否正確'));
        },
      });
  }

  clearPasswordFields(): void {
    this.currentPassword.set('');
    this.newPassword.set('');
    this.confirmPassword.set('');
  }
}

/**
 * 從 HttpErrorResponse 取後端訊息。
 *
 * 後端 GlobalExceptionHandler 把可讀訊息放在 error.message，
 * 直接顯示它比顯示「發生錯誤（400）」有用得多——使用者需要知道
 * 是哪裡填錯，而不是知道狀態碼。
 */
function readErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { error?: { message?: unknown } })?.error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
