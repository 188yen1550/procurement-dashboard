/** 檔案用途：宣告 `/group-buy` 的 lazy-loaded 歷史開團紀錄路由。
 *
 * ⚠️ 不加 managerGuard——查詢是操作＋管理層都能用的（後端 GET 端點沒有
 * @PreAuthorize），只有匯入／整批回退這兩個動作僅管理層可操作，那是畫面
 * 內部依 isManager() 決定按鈕要不要出現，不是整頁層級的權限管制。
 */
import { Routes } from '@angular/router';
import { GroupBuy } from './group-buy';

export const GROUP_BUY_ROUTES: Routes = [{ path: '', component: GroupBuy }];
