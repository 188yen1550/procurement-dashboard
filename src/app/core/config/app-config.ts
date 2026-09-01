/**
 * 前端執行期設定。
 * useMockData = true  → 使用本地 Mock 資料，不呼叫後端（目前原型階段）
 * useMockData = false → 呼叫真實 API
 *
 * 後端可用之後改成 false 即可，元件與樣板不需要再改。
 */
export const APP_CONFIG = {
  useMockData: false,
} as const;
