/**
 * 檔案用途：POST 取回 CSV 檔案的共用流程（2026-09-26 由 ProductApiService.exportApproved() 抽出，
 * 決策紀錄匯出一起使用）。
 *
 * 後端匯出端點成功時回傳檔案本體（text/csv），筆數放在 X-Export-Count header；
 * 失敗時仍回 ApiResponse JSON（400／409）。
 *
 * ⚠️ responseType 為 blob 時，錯誤回應的 body 也會是 Blob（JSON 被包在裡面），toApiError()
 * 讀不到 message。這裡先把錯誤 body 解回 JSON 再往上拋，呼叫端照常用 toApiError() 處理。
 */
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

/** 後端匯出端點共用的筆數 header（ProductController／ReviewController）。 */
export const EXPORT_COUNT_HEADER = 'X-Export-Count';

/** 匯出結果：檔案內容與後端回報的資料列數（不含表頭）。 */
export interface CsvExportResult {
  blob: Blob;
  rowCount: number;
}

export function postForCsv(http: HttpClient, url: string, body: unknown): Observable<CsvExportResult> {
  return http.post(url, body, { observe: 'response', responseType: 'blob' }).pipe(
    map((response) => ({
      blob: response.body ?? new Blob([], { type: 'text/csv' }),
      rowCount: Number(response.headers.get(EXPORT_COUNT_HEADER) ?? 0),
    })),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) {
        return throwError(() => error);
      }
      return from(error.error.text()).pipe(
        switchMap((text) =>
          throwError(
            () =>
              new HttpErrorResponse({
                error: parseJsonOrNull(text),
                headers: error.headers,
                status: error.status,
                statusText: error.statusText,
                url: error.url ?? undefined,
              }),
          ),
        ),
      );
    }),
  );
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
