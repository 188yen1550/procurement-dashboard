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
    path: ':id/edit',
    canDeactivate: [productFormCanDeactivate],
    loadComponent: () => import('./product-form/product-form').then((m) => m.ProductForm),
  },
  {
    path: ':id',
    loadComponent: () => import('./product-detail/product-detail').then((m) => m.ProductDetail),
  },
];
