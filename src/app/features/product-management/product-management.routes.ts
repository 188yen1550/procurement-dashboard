/**
 * 檔案用途：品項模組路由。
 * `new`、`ai-suggestions` 等靜態路由必須排在 `:id` 前；表單路由套用離頁 Guard 防止未儲存內容遺失。
 */
import { Routes } from '@angular/router';
import { ProductManagement } from './product-management';
import { productFormCanDeactivate } from './product-form/product-form.guard';

export const PRODUCT_ROUTES: Routes = [
  { path: '', component: ProductManagement },
  {
    path: 'new',
    canDeactivate: [productFormCanDeactivate],
    loadComponent: () => import('./product-form/product-form').then((m) => m.ProductForm),
  },
  {
    path: 'ai-suggestions',
    loadComponent: () => import('./ai-suggestions/ai-suggestions').then((m) => m.AiSuggestions),
  },
  {
    path: 'batch-import',
    loadComponent: () => import('./batch-import/batch-import').then((m) => m.BatchImport),
  },
  {
    path: ':id/edit',
    canDeactivate: [productFormCanDeactivate],
    loadComponent: () => import('./product-form/product-form').then((m) => m.ProductForm),
  },
  {
    path: ':id',
    loadComponent: () => import('./product-detail/product-detail').then((m) => m.ProductDetail),
  },
];
