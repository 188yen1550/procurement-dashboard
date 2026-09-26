/**
 * 檔案用途：定義應用程式頂層路由、登入保護及管理角色的前端顯示範圍。
 * Guard 只改善前端導覽體驗，不能取代後端 RBAC；功能模組採 lazy loading 降低首屏負擔。
 */
import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth-guard';
import { managerGuard } from './core/auth/manager-guard';
import { passwordChangeGuard } from './core/auth/password-change-guard';

/** 靜態登入路由先宣告、受保護殼層居中、wildcard 最後兜底，順序不可任意調換。 */
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadChildren: () => import('./features/login/login.routes').then((m) => m.LOGIN_ROUTES),
  },
  {
    path: '',
    canActivate: [authGuard],
    // V24：管理者設定的密碼尚未被換掉時，只允許停留在 /profile（見 password-change-guard.ts）。
    canActivateChild: [passwordChangeGuard],
    loadComponent: () =>
      import('./shared/components/layout/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        path: 'products',
        loadChildren: () =>
          import('./features/product-management/product-management.routes').then(
            (m) => m.PRODUCT_ROUTES,
          ),
      },
      {
        path: 'review',
        canActivate: [managerGuard],
        loadChildren: () => import('./features/review/review.routes').then((m) => m.REVIEW_ROUTES),
      },
      {
        /**
         * 個人資料。只掛頂層 authGuard，不加 managerGuard——
         * 採購角色也必須能改自己的名字與密碼。
         */
        path: 'profile',
        loadChildren: () =>
          import('./features/profile/profile.routes').then((m) => m.PROFILE_ROUTES),
      },
      {
        /**
         * 歷史開團紀錄。不加 managerGuard——查詢對操作＋管理層都開放，
         * 匯入／整批回退僅管理層可操作，那是畫面內部依 isManager() 決定
         * 按鈕要不要出現，不是整頁層級的權限管制，詳見 group-buy.routes.ts。
         */
        path: 'group-buy',
        loadChildren: () =>
          import('./features/group-buy/group-buy.routes').then((m) => m.GROUP_BUY_ROUTES),
      },
      {
        path: 'settings',
        canActivate: [managerGuard],
        loadChildren: () =>
          import('./features/settings/settings.routes').then((m) => m.SETTINGS_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
