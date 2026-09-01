/** 檔案用途：宣告 `/login` 對應的 lazy-loaded 登入元件路由。 */
import { Routes } from '@angular/router';
import { Login } from './login';

export const LOGIN_ROUTES: Routes = [{ path: '', component: Login }];
