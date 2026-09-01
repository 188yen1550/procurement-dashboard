import { HttpInterceptorFn } from '@angular/common/http';

/**
 * 取代原本的 jwt-interceptor.ts（請一併刪除該檔案跟對應的 spec）。
 *
 * 舊版假設「前端讀 token 字串、手動塞進 Authorization: Bearer header」，
 * 但後端是 httpOnly Cookie 模式（見 AuthController.login()）：token 從
 * 頭到尾不會出現在 JSON 回應裡，前端 JS 設計上就讀不到，也不需要讀到。
 *
 * 這裡要做的只有一件事：確保每個請求都帶 withCredentials，讓瀏覽器
 * 自動夾帶／儲存這個 Cookie。不需要、也不應該手動處理任何 Authorization
 * header。
 */
export const withCredentialsInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};
