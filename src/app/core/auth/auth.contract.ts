export const AUTH_API = {
  login: '/api/auth/login',
  me: '/api/auth/me',
  logout: '/api/auth/logout',
} as const;

/** 對應後端 enums/UserRole.java：ENUM('PURCHASER','MANAGER')。 */
export type UserRole = 'PURCHASER' | 'MANAGER';

export interface LoginRequestBody {
  username: string;
  password: string;
}

/**
 * 對應後端 UserResponse.java：id / username / name / role 四個欄位。
 *
 * 沒有 token 欄位——AuthController.login() 明確註解「Token本身不放進
 * JSON Body：httpOnly Cookie前端JS本來就讀不到，放進Body等於多開一個
 * 管道洩漏它」。token 只活在 httpOnly Cookie 裡，前端不需要、也不可能
 * 拿到這個值，不要在型別裡加一個永遠不會有內容的 token 欄位。
 */
export interface CurrentUser {
  id: number;
  username: string;
  name: string;
  role: UserRole;
}
