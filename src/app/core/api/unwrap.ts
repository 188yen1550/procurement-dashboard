import { OperatorFunction } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope, PageEnvelope } from './api-envelope';

/**
 * 拆掉 ApiResponse 這層殼。
 *
 * 為什麼抽成共用 operator 而不是各 service 自己寫 `.pipe(map(r => r.data))`：
 * 這個專案已經出現過「auth-api.ts 有拆、product-api.ts 沒拆」的不一致，
 * 而 http.get<T>() 的泛型不做執行期驗證，漏拆時編譯完全會過、
 * 只有跑起來才會發現每個欄位都是 undefined。統一走這裡之後，
 * 「有沒有拆殼」變成 code review 掃得出來的一行。
 *
 * 這裡刻意不檢查 success === false：後端失敗一律回非 2xx
 * （見 GlobalExceptionHandler），會直接進 error 分支。若日後後端改成
 * 200 + success:false，要在這裡補 throwError，而不是散在各元件各判一次。
 */
export function unwrapData<T>(): OperatorFunction<ApiEnvelope<T>, T> {
  return map((response) => response.data);
}

/** 分頁查詢結果。刻意保留 total，否則呼叫端算不出頁數也顯示不了「共 N 筆」。 */
export interface PagedResult<T> {
  items: T[];
  totalElements: number;
  totalPages: number;
  /** ⚠️ 從 0 開始，顯示給使用者時要 +1。 */
  pageNumber: number;
  pageSize: number;
}

/** 清單端點共用的分頁參數。後端 @PageableDefault(size = 20)。 */
export interface PageQuery {
  page?: number;
  size?: number;
  /** Spring 格式，例如 'updatedAt,desc'。 */
  sort?: string;
}

/**
 * 拆掉 ApiResponse + Page 兩層殼，並把 content 映射成前端 View Model。
 *
 * 接一個 mapper 參數而不是回傳原始 payload 陣列，是為了避免呼叫端寫成
 * `.pipe(unwrapPage(), map(p => ({...p, items: p.items.map(toXxx)})))`
 * 這種每支 API 都要重抄一次的樣板。
 */
export function unwrapPage<TPayload, TModel>(
  mapItem: (payload: TPayload) => TModel,
): OperatorFunction<ApiEnvelope<PageEnvelope<TPayload>>, PagedResult<TModel>> {
  return map((response) => ({
    items: response.data.content.map(mapItem),
    totalElements: response.data.totalElements,
    totalPages: response.data.totalPages,
    pageNumber: response.data.number,
    pageSize: response.data.size,
  }));
}
