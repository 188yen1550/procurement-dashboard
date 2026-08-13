import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth-guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadChildren: () => import('./features/login/login.routes').then(m => m.LOGIN_ROUTES)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES)
  },
  {
    path: 'products',
    canActivate: [authGuard],
    loadChildren: () => import('./features/product-management/product-management.routes').then(m => m.PRODUCT_ROUTES)
  },
  { path: '**', redirectTo: 'login' }
];
