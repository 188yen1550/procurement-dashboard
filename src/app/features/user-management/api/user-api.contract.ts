import { IsoDateTime } from '../../../core/api/api-envelope';
import { UserRole } from '../../../core/domain/enums';

/**
 * 帳號管理的 API contract，對應後端 UserController（@RequestMapping("/api/users")）。
 * 三支全部是 @PreAuthorize("hasRole('MANAGER')")。
 *
 * ⚠️ **沒有「刪除帳號」端點，也不會有**。UserController 的註解說明：
 * app_users 被 review_records.reviewer_id 參照，實體刪除會讓歷史稽核紀錄
 * 失去對應人員。畫面上不要做刪除按鈕。
 *
 * ⚠️ 本系統**不開放公開自我註冊**，帳號一律由管理層代辦建立
 * （Admin Provisioning）。不要做註冊頁。
 */

export const USER_API = {
  list: '/api/users',
  create: '/api/users',
  disable: (id: number | string) => `/api/users/${id}/disable`,
  /** 對應 UserController.enableUser()。畫面上稱「復用」，端點是 /enable。 */
  enable: (id: number | string) => `/api/users/${id}/enable`,
  /** V24：對應 UserController.resetPassword()，管理者代重設密碼。 */
  resetPassword: (id: number | string) => `/api/users/${id}/reset-password`,
  /** V27：駁回使用者的重設密碼申請（UserController.rejectPasswordResetRequest()）。 */
  rejectPasswordResetRequest: (id: number | string) => `/api/users/${id}/password-reset-request/reject`,
} as const;

/**
 * 對應後端 UserAccountResponse.java。
 * ⚠️ 回應絕對不含密碼欄位（明文或雜湊都沒有），前端不用處理遮蔽顯示。
 */
export interface UserAccountResponsePayload {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  /** false 的帳號要用灰階或「已停用」標籤區隔。 */
  enabled: boolean | null;
  /**
   * V24：true＝密碼仍是管理者設定的（新建帳號或代重設後），使用者尚未自行修改。
   * 帳號管理表格以「待修改密碼」標示。
   */
  mustChangePassword: boolean;
  /**
   * V27：使用者本人在登入頁提出、尚待處理的重設密碼申請時間；沒有申請為 null。
   * 只有這個欄位有值的帳號才能被重設密碼（後端沒有申請會回 409）。
   */
  passwordResetRequestedAt?: IsoDateTime | null;
  createdAt: IsoDateTime | null;
}

/**
 * 對應後端 UserCreateRequest.java，四個欄位全部必填。
 *
 * 後端驗證規則（前端建議做同樣的即時驗證，減少送出後才被退回）：
 * - username：@NotBlank + @Size(max = 50)，且**必須唯一**（重複回 400）
 * - name：@NotBlank + @Size(max = 50)
 * - role：@NotNull
 * - password：@NotBlank + @Size(min = 8)
 */
/**
 * 對應後端 UserPasswordResetRequest.java（PUT /api/users/{id}/reset-password）。
 * newPassword：@NotBlank + @Size(min = 8)，與建立帳號／自行修改密碼同一套規則。
 *
 * ⚠️ 後端規則：不可重設自己（409，請改用個人資料頁）；重設後對方現有登入立即失效，
 * 且對方下次登入必須先修改密碼。
 */
export interface UserPasswordResetRequestPayload {
  newPassword: string;
}

export interface UserCreateRequestPayload {
  username: string;
  name: string;
  role: UserRole;
  password: string;
}
