import { HttpInterceptorFn } from '@angular/common/http';

/**
 * ⚠️ 這個攔截器目前**沒有註冊，也建議不要註冊**。
 *
 * 放在這裡是為了：如果團隊日後真的決定要統一設定 Content-Type，
 * 請直接用這份，不要臨時手寫一個沒有 FormData 例外的版本。
 *
 * ## 先問一句：不加會怎樣？
 *
 * Angular 的 HttpClient 本來就會依 body 型別自動決定 Content-Type：
 * - 物件／陣列  → application/json
 * - FormData    → multipart/form-data; boundary=...（瀏覽器補 boundary）
 * - 字串        → text/plain
 *
 * 所以答案通常是「不會怎樣」。加了反而多一個會壞掉的地方。
 * 真的要加之前，先確認是解決了什麼實際問題。
 *
 * ## 如果還是要加，FormData 必須跳過
 *
 * 見下方 early return。少了那三行，POST /api/products/{id}/image 會壞，
 * 而且只有上傳功能壞、錯誤訊息完全不提 boundary，很難查。
 */
export const jsonContentTypeInterceptor: HttpInterceptorFn = (req, next) => {
  // FormData 一律跳過：boundary 只有瀏覽器產得出來，
  // 這裡一旦設了 Content-Type，瀏覽器就不會補 boundary，
  // 後端解不出檔案，POST /api/products/{id}/image 直接 400。
  if (req.body instanceof FormData) {
    return next(req);
  }

  // 已經有值就不覆蓋：呼叫端若刻意指定了特殊型別，攔截器不該蓋掉它。
  if (req.headers.has('Content-Type')) {
    return next(req);
  }

  // body 為 null 的請求（GET／DELETE／無 body 的 POST）不需要 Content-Type，
  // 硬加會讓某些代理伺服器對 GET 帶 Content-Type 產生非預期行為。
  if (req.body === null || req.body === undefined) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { 'Content-Type': 'application/json' } }));
};
