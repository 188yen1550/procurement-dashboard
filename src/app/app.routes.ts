import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth-guard';
import { managerGuard } from './core/auth/manager-guard';

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
  {
  path: 'review',
  canActivate: [authGuard],
  loadChildren: () => import('./features/review/review.routes').then(m => m.REVIEW_ROUTES)
},
{
  path: 'settings',
  canActivate: [authGuard, managerGuard],
  loadChildren: () => import('./features/settings/settings.routes').then(m => m.SETTINGS_ROUTES)
},
  { path: '**', redirectTo: 'login' }
];
