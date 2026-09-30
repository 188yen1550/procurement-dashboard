/**
 * 檔案用途：品項模組路由。
 * `new`、`discoveries` 等靜態路由必須排在 `:id` 前；表單路由套用離頁 Guard 防止未儲存內容遺失。
 *
 * 2026-09-24 職責分離（決策 D1）：清單、新增、編輯、批次新增、AI 商品雷達只給操作層
 * （purchaserGuard）；`:id` 詳情兩個角色都能進，管理層看到的是唯讀模式，
 * 供審核頁「決策紀錄」查看商品完整評估。
 */
import { Routes } from '@angular/router';
import { ProductManagement } from './product-management';
import { productFormCanDeactivate } from './product-form/product-form.guard';
import { purchaserGuard } from '../../core/auth/purchaser-guard';

export const PRODUCT_ROUTES: Routes = [
  { path: '', canActivate: [purchaserGuard], component: ProductManagement },
  {
    path: 'new',
    canActivate: [purchaserGuard],
    canDeactivate: [productFormCanDeactivate],
    loadComponent: () => import('./product-form/product-form').then((m) => m.ProductForm),
  },
  // 2026-09-29：熱度建議清單移除；舊書籤或連結導回品項管理，不讓 'ai-suggestions' 被 `:id` 當成商品編號。
  { path: 'ai-suggestions', redirectTo: '', pathMatch: 'full' },
  {
    // 2026-09-29：AI 商品雷達（操作層；建立商品也是操作層的工作）。
    path: 'discoveries',
    canActivate: [purchaserGuard],
    loadComponent: () => import('./discoveries/discoveries').then((m) => m.Discoveries),
  },
  {
    path: 'batch-import',
    canActivate: [purchaserGuard],
    loadComponent: () => import('./batch-import/batch-import').then((m) => m.BatchImport),
  },
  {
    path: ':id/edit',
    canActivate: [purchaserGuard],
    canDeactivate: [productFormCanDeactivate],
    loadComponent: () => import('./product-form/product-form').then((m) => m.ProductForm),
  },
  {
    path: ':id',
    loadComponent: () => import('./product-detail/product-detail').then((m) => m.ProductDetail),
  },
];
