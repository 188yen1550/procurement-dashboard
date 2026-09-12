/**
 * 檔案用途：宣告 `/profile` lazy route。
 *
 * ⚠️ 刻意**不掛 managerGuard**。改自己的名字與密碼是每個登入者都該有的
 * 功能，掛上去等於採購角色永遠改不了自己的密碼。頂層 authGuard 已足夠。
 */
import { Routes } from '@angular/router';
import { Profile } from './profile';

export const PROFILE_ROUTES: Routes = [{ path: '', component: Profile }];
