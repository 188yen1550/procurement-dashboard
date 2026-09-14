/**
 * 前端執行期設定。
 * useMockData = true  → 使用本地 Mock 資料，不呼叫後端（展示與測試模式）
 * useMockData = false → 呼叫真實 API
 */
export const APP_CONFIG = {
  useMockData: false,
} as const;
