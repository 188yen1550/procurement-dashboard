import { HttpErrorResponse } from '@angular/common/http';

/**
 * 後端錯誤回應的語意對照（實際取自 GlobalExceptionHandler.java）：
 *
 * | 狀態碼 | 後端來源                                   | 前端該做什麼                         |
 * |--------|--------------------------------------------|--------------------------------------|
 * | 400    | MethodArgumentNotValidException（欄位驗證）| 顯示 message 在表單旁                |
 * | 400    | IllegalArgumentException                   | 顯示 message                          |
 * | 401    | InvalidCredentialsException（帳密錯誤）    | 登入頁顯示 message                    |
 * | 401    | AccountDisabledException（帳號已停用）     | 登入頁顯示 message                    |
 * | 401    | 未帶／過期 Cookie                          | 導回登入頁                            |
 * | 403    | AuthorizationDeniedException（角色不符）   | 顯示「權限不足」，不要導回登入頁      |
 * | 409    | IllegalStateException（狀態機衝突）        | 提示重新整理，**不要重試原請求**      |
 * | 502    | LlmAnalysisException                       | AI 區塊單獨降級，不影響整頁            |
 * | 500    | 其他                                       | 通用錯誤訊息                          |
 *
 * ⚠️ 最重要的一點：**「資料不存在」是 400 不是 404**。
 * ProductService.getProductOrThrow() 用的是 IllegalArgumentException("商品不存在")，
 * 經 GlobalExceptionHandler 轉成 400。前端若寫 `if (err.status === 404)` 來判斷
 * 「這筆資料被刪了」，永遠不會成立。要判斷就看 message，或統一以 400 處理。
 */
export interface ApiError {
  status: number;
  /** 後端 ApiResponse.message。取不到時給通用文案，不會是 undefined。 */
  message: string;
  /** 網路斷線／CORS 等連 HTTP 回應都沒拿到的情況。 */
  isNetworkError: boolean;
}

const FALLBACK_MESSAGE = '系統發生錯誤，請稍後再試';
const NETWORK_MESSAGE = '無法連線到伺服器，請確認網路狀態';

/**
 * 把 HttpErrorResponse 轉成統一的 ApiError。
 *
 * 為什麼需要這層：後端錯誤 body 是 ApiResponse.failure(message)，
 * 也就是 `err.error.message`；但網路層失敗時 err.error 是 ProgressEvent，
 * 直接讀 `err.error.message` 會拿到瀏覽器的英文訊息或 undefined。
 * 各元件各自寫 `err?.error?.message ?? '失敗'` 會漏掉這個差異。
 */
export function toApiError(error: unknown): ApiError {
  if (!(error instanceof HttpErrorResponse)) {
    return { status: 0, message: FALLBACK_MESSAGE, isNetworkError: false };
  }

  // status 0 代表請求根本沒送達（斷網、被 CORS 擋、伺服器沒起來）。
  if (error.status === 0) {
    return { status: 0, message: NETWORK_MESSAGE, isNetworkError: true };
  }

  const body = error.error as { message?: string } | null;
  return {
    status: error.status,
    message: body?.message?.trim() || FALLBACK_MESSAGE,
    isNetworkError: false,
  };
}

/** 401：未登入或 Cookie 過期。呼叫端應導回登入頁。 */
export function isUnauthorized(error: ApiError): boolean {
  return error.status === 401;
}

/** 403：已登入但角色不足。⚠️ 不要導回登入頁——重登也不會變成 MANAGER。 */
export function isForbidden(error: ApiError): boolean {
  return error.status === 403;
}

/**
 * 409：狀態衝突。這是本系統最需要被正確處理的錯誤。
 *
 * 三個典型情境：
 * 1. 兩位管理人員同時審核同一商品，後到的那位收到 409
 * 2. 已核准商品嘗試修改選品核心資料
 * 3. 一次性動作重複點擊（封存兩次、加入候選兩次）
 *
 * 正確處理是「提示 + 重新載入」，不是重試——重試只會再失敗一次。
 */
export function isConflict(error: ApiError): boolean {
  return error.status === 409;
}

/** 502：LLM 呼叫失敗。AI 區塊自己降級即可，不要讓整頁變 error。 */
export function isLlmFailure(error: ApiError): boolean {
  return error.status === 502;
}
