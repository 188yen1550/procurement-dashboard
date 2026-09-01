import { HttpInterceptorFn } from '@angular/common/http';

/**
 * 全站唯一的 HTTP 攔截器。取代舊的 jwt-interceptor.ts（該檔與其 spec 應一併刪除）。
 *
 * ## 它只做一件事
 *
 * 確保每個請求都帶 withCredentials，讓瀏覽器自動夾帶／儲存 access_token Cookie。
 * 後端 AuthController.login() 以 httpOnly Cookie 下發 token，
 * token 從頭到尾不會出現在 JSON 回應裡，前端 JS 設計上就讀不到，也不需要讀到。
 * 不要在這裡手動處理任何 Authorization header。
 *
 * ## ⚠️ 為什麼這裡刻意不設 Content-Type
 *
 * 看起來「順手統一加 Content-Type: application/json」很合理，但會把
 * POST /api/products/{id}/image 直接打壞。
 *
 * multipart 請求需要一條隨機的 boundary 分隔線來切開檔案與其他欄位，
 * 而這串字只有瀏覽器產得出來：
 *
 *   Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxk
 *                                              ↑ 瀏覽器自動產生
 *
 * 瀏覽器看到 body 是 FormData 才會自動補上 boundary。一旦這裡先寫死了
 * Content-Type，瀏覽器就不再補，後端收到一個宣稱是 multipart 卻找不到
 * 分隔線的請求，@RequestParam("file") 會是空的，回 400。
 *
 * 而且這個錯誤很難查：其他 API 全部正常，只有上傳功能壞掉，
 * 錯誤訊息也不會提到 boundary。
 *
 * 另外 Angular 的 HttpClient 本來就會依 body 型別自動決定 Content-Type，
 * 多數情況根本不需要攔截器來設它。真的需要時請見同目錄的
 * json-content-type.interceptor.ts，那份有 FormData 的例外處理。
 *
 * ## 開發環境前提
 *
 * 後端 SecurityConfig 沒有任何 CORS 設定，且 Cookie 是 SameSite=Strict。
 * 本機開發必須透過 proxy.conf.json 把 /api 代理到後端，讓瀏覽器視角下同源；
 * 同時後端需設 COOKIE_SECURE=false，否則 http://localhost 收不到 Cookie。
 * 不要為了本機方便去改後端 CORS 設定。
 */
export const withCredentialsInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};
