import { UserRole } from '../domain/enums';

/**
 * 重新匯出 UserRole。
 *
 * UserRole 的單一定義來源是 core/domain/enums.ts（後端 enum 的鏡像），
 * 但 auth.ts 等既有檔案是從 auth.contract 匯入它的。這裡轉出一次，
 * 讓既有 import 路徑不用改，同時避免在兩個地方各定義一份角色型別。
 */
export type { UserRole };

/** 對應後端 AuthController（@RequestMapping("/api/auth")）。 */
export const AUTH_API = {
  login: '/api/auth/login',
  me: '/api/auth/me',
  logout: '/api/auth/logout',
} as const;

/** 對應後端 LoginRequest.java。兩個欄位都是 @NotBlank。 */
export interface LoginRequestPayload {
  username: string;
  password: string;
}

/**
 * 對應後端 UserResponse.java，login 與 me 共用同一格式。
 *
 * ⚠️ 沒有 token 欄位，這是刻意設計。AuthController.login() 的註解寫得很明白：
 * 「Token本身不放進JSON Body：httpOnly Cookie前端JS本來就讀不到，
 * 放進Body等於多開一個管道洩漏它」。前端不需要、也不可能拿到 token，
 * 不要在型別裡加一個永遠是 undefined 的 token 欄位。
 *
 * ⚠️ role 只回英文代碼。UserResponse.java 註解說明後端刻意不外露
 * UserRole enum 建構子裡的中文名稱，顯示文案請用 core/domain/labels.ts。
 */
export interface CurrentUserResponsePayload {
  id: number;
  username: string;
  name: string;
  role: UserRole;
}

/** 前端使用的名稱，與後端 payload 形狀相同故直接沿用，不另做 mapper。 */
export type CurrentUser = CurrentUserResponsePayload;
