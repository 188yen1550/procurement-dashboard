import { HttpParams } from '@angular/common/http';

/**
 * 把查詢物件轉成 HttpParams，略過沒有值的欄位。
 *
 * 為什麼不能直接 `{ params: query }`：
 * 1. HttpClient 會把 undefined 送成空字串，後端收到 `reviewStatus=` 時
 *    Spring 嘗試把空字串轉成 enum 會拋 400，而不是當成「沒有這個條件」。
 * 2. 0 與 false 是合法值（例如 page=0），不能用 truthy 判斷過濾掉——
 *    用 `if (value)` 會讓第一頁的 page 參數消失。
 *
 * 參數型別用 object 而不是 Record<string, unknown>：
 * TypeScript 的 interface 沒有隱含索引簽章，ProductListQuery 這類
 * 以 interface 宣告的查詢型別無法指派給 Record<string, unknown>。
 * 改用 Record 會逼每個呼叫端加 `as Record<string, unknown>`，
 * 那等於用斷言換編譯過，失去型別檢查的意義。
 */
export function buildParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params = params.set(key, String(value));
  }
  return params;
}
