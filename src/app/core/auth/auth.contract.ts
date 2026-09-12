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
  /** PATCH /api/auth/me：修改自己的顯示名稱。與 GET 同路徑、不同 method。 */
  updateProfile: '/api/auth/me',
  changePassword: '/api/auth/me/password',
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

/**
 * 對應後端 UpdateProfileRequest.java（PATCH /api/auth/me）。
 *
 * ⚠️ **只能改 name**。後端 DTO 註解寫明刻意不開放 username 與 role：
 * username 改動牽涉唯一性檢查與「使用者忘記自己改過登入帳號」的問題；
 * role 屬權限層級，讓使用者自行調整等於 PURCHASER 可以把自己升成 MANAGER。
 * 畫面上帳號與角色一律唯讀顯示，不要做成可編輯欄位。
 *
 * 驗證：@NotBlank + @Size(max = 50)。
 */
export interface UpdateProfileRequestPayload {
  name: string;
}

/**
 * 對應後端 ChangePasswordRequest.java（PATCH /api/auth/me/password）。
 *
 * ⚠️ **必須帶 currentPassword**，由後端驗證。後端註解說明這是為了防止
 * 裝置未鎖定時被他人直接改掉密碼、把原使用者鎖死在外。
 *
 * 驗證：currentPassword @NotBlank；newPassword @NotBlank + @Size(min = 8)。
 * 8 碼下限與 UserCreateRequest 是同一套規則，前端驗證請沿用
 * PASSWORD_MIN_LENGTH，不要各處寫死不同數字。
 *
 * ⚠️ 成功後後端會**重發 access_token Cookie**（見 AuthController.changePassword），
 * 所以改密碼不會把自己登出，不需要在前端導回登入頁。
 */
export interface ChangePasswordRequestPayload {
  currentPassword: string;
  newPassword: string;
}

/** 後端 ChangePasswordRequest 的 @Size(min = 8)。前端驗證共用同一個常數。 */
export const PASSWORD_MIN_LENGTH = 8;

/** 後端 UpdateProfileRequest 的 @Size(max = 50)。 */
export const USER_NAME_MAX_LENGTH = 50;
