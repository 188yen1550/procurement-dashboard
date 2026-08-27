import { Routes } from '@angular/router';
import { ProductManagement } from './product-management';
import { ProductForm } from './product-form/product-form';
import { ProductDetail } from './product-detail/product-detail'; // 確保路徑與類別名稱正確
import { ProductEdit } from './product-edit/product-edit';

export const PRODUCT_ROUTES: Routes = [
  { path: '', component: ProductManagement },
  { path: 'new', component: ProductForm },
  { path: ':id/edit', component: ProductEdit },   // 加這行，注意順序要在 :id 前面！
  { path: ':id', component: ProductDetail },
];

