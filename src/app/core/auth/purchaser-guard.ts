/**
 * 檔案用途：限制操作層專屬畫面（品項管理清單／新增／編輯／批次新增、AI 建議清單）
 * 的前端導覽。
 *
 * 2026-09-24 職責分離（決策 D1／D3）：建立與維護選品（maker）屬於操作層，
 * 審核（checker）屬於管理層，管理層不再進入這些畫面。跟 managerGuard 一樣，
 * 這裡只改善導覽體驗，真正的防線是後端 ProductController 寫入端點上的
 * @PreAuthorize("hasRole('PURCHASER')")。
 *
 * 管理層被擋下時導回待審清單而不是儀表板：從書籤或舊連結打開品項管理的管理層，
 * 最可能想做的事是審核，直接送到審核頁比多繞一次儀表板省一步。
 *
 * ⚠️ /products/:id（品項詳情）刻意不掛這個 guard——管理層要從審核頁「決策紀錄」
 * 以唯讀方式查看商品完整評估，詳見 product-detail.ts 的 readOnly。
 */
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const purchaserGuard: CanActivateFn = () => {
  const authService = inject(Auth);
  const router = inject(Router);

  if (authService.isLoggedIn() && !authService.isManager()) {
    return true;
  }
  return router.parseUrl('/review');
};
