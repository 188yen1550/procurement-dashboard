/**
 * 檔案用途：品項表單 CanDeactivate Guard。
 * 離頁時委派元件檢查表單或圖片 dirty 狀態並提示使用者；這是資料遺失防護，不是安全授權。
 */
import { CanDeactivateFn } from '@angular/router';
import type { ProductForm } from './product-form';

export const productFormCanDeactivate: CanDeactivateFn<ProductForm> = (component) =>
  component.canLeave();
