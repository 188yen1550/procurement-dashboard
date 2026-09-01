/** 檔案用途：宣告管理專用 `/settings` lazy route；頂層 managerGuard 只負責前端導覽。 */
import { Routes } from '@angular/router';
import { Settings } from './settings';

export const SETTINGS_ROUTES: Routes = [{ path: '', component: Settings }];
