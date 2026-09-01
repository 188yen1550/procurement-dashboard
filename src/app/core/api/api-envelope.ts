/**
 * 後端統一回應殼，對應 common/ApiResponse.java。
 *
 * 後端每一支端點（不分成功／失敗）都包這層：
 *   { success: boolean, message: string, data: T | null }
 *
 * 失敗時 GlobalExceptionHandler 一律以「非 2xx 狀態碼 + ApiResponse.failure(message)」回應，
 * 所以 success === false 的情況在前端會直接進 HttpClient 的 error 分支，
 * 不會走到成功的 map 裡（詳見 core/api/api-error.ts）。
 */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/**
 * Spring Data Page 序列化後的形狀。
 *
 * 只列出前端實際會用到的欄位——Page 序列化後其實還有 first / last / empty /
 * numberOfElements / pageable / sort 等，全部列進來只會讓型別檔變長，
 * 且那些欄位可由 totalPages / number 推導，不需要依賴後端的序列化細節。
 *
 * ⚠️ number 是「目前頁碼」且從 0 開始，顯示給使用者時要 +1。
 */
export interface PageEnvelope<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

/**
 * 後端 BigDecimal 經 Jackson 序列化後是 JSON number，對應 TS 的 number。
 * 但欄位本身多半可為 null（例如新品沒有 costPrice），因此統一用這個別名，
 * 讓「這是分數／金額，且可能沒有值」在型別上看得出來。
 */
export type Decimal = number | null;

/**
 * 後端 LocalDateTime 序列化後是不含時區的 ISO 字串，例如 "2026-08-22T14:30:00"。
 *
 * ⚠️ 沒有 Z 也沒有 +08:00。瀏覽器把這種格式視為「本地時間」解析，
 * 而後端 JDBC 連線設定是 serverTimezone=Asia/Taipei，
 * 使用者也在同一時區，所以直接 new Date(value) 是正確的；
 * 但若日後有跨時區使用者，這裡會是第一個出問題的地方。
 */
export type IsoDateTime = string;

/** 後端 LocalDate 序列化後的形狀，例如 "2026-12-28"。 */
export type IsoDate = string;
