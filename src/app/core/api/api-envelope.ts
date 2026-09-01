/**
 * 後端每一支 API 不分成功/失敗都包這層殼（common/ApiResponse.java）：
 * { success, message, data }。任何直接呼叫 HttpClient 的地方都要拆這層，
 * 這是全站共用的型別，不要在各模組各自重複定義一份。
 */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/** 清單類 API 用 Spring Data Page 包裝，序列化後長這樣。 */
export interface PageEnvelope<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}
