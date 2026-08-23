import { Routes } from '@angular/router';
import { ProductManagement } from './product-management';
import { ProductForm } from './product-form/product-form';

export const PRODUCT_ROUTES: Routes = [
  { path: '', component: ProductManagement },
  { path: 'new', component: ProductForm },
];
