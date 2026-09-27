import { MonoTypeOperatorFunction, TimeoutError, timeout } from 'rxjs';

/**
 * 會打外部服務、回應時間長的 API，前端各自設逾時上限，不讓畫面無限等待
 * （企劃書 AC-05、第八章「Timeout：超時後 UI 顯示可理解狀態，不無限等待」）。
 *
 * 一般 API 不套用：HttpClient 本身沒有預設逾時，但一般 API 都是毫秒級回應，
 * 真的卡住時通常是後端掛了，會由連線錯誤（status 0）處理。
 */

/**
 * POST /api/products/{id}/trend/sync：後端即時搜尋 PTT 多個看板，實測約 8–10 秒。
 * 設 60 秒保留餘裕（PTT 偶爾變慢、單一看板逾時會等到後端設定的 10 秒）。
 */
export const TREND_SYNC_TIMEOUT_MS = 60_000;

/**
 * POST /api/products/{id}/ai-analysis/generate：後端呼叫 Gemini 的讀取逾時是 90 秒，
 * 逾時會回傳明確的錯誤訊息。前端設 100 秒，刻意比後端長——讓後端的逾時訊息
 * 先回來；只有後端本身也沒回應時，才由前端逾時接手。
 */
export const AI_ANALYSIS_TIMEOUT_MS = 100_000;

/** 在指定時間內沒有收到回應就以 TimeoutError 結束，由 toApiError() 轉成可讀訊息。 */
export function withRequestTimeout<T>(ms: number): MonoTypeOperatorFunction<T> {
  return timeout<T, T>({ first: ms });
}

export function isRequestTimeout(error: unknown): boolean {
  return error instanceof TimeoutError;
}
