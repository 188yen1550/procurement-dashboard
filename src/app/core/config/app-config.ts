/**
 * 前端執行期設定。
 * useMockData = true  → 使用本地 Mock 資料，不呼叫後端（目前原型階段）
 * useMockData = false → 呼叫真實 API
 *
 * 後端可用之後改成 false 即可，元件與樣板不需要再改。
 */
import { InjectionToken } from '@angular/core';

export const APP_CONFIG = {
  useMockData: true,
} as const;

/** 測試與展示明確指定資料來源，不取代或刪除既有 API。 */
export const APP_RUNTIME_CONFIG = new InjectionToken<{ useMockData: boolean }>('APP_RUNTIME_CONFIG', {
  providedIn: 'root', factory: () => APP_CONFIG,
});
