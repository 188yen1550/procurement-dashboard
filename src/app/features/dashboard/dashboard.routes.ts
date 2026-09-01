/** 檔案用途：宣告登入後 `/dashboard` 的 lazy-loaded 儀表板路由。 */
import { Routes } from '@angular/router';
import { Dashboard } from './dashboard';

export const DASHBOARD_ROUTES: Routes = [{ path: '', component: Dashboard }];
