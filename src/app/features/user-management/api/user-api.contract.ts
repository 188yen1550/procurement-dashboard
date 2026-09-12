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
export interface UserCreateRequestPayload {
  username: string;
  name: string;
  role: UserRole;
  password: string;
}
