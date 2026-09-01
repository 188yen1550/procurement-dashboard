/** 檔案用途：審核清單與 `:id` 詳情 lazy routes；由頂層 managerGuard 限制前端導覽。 */
import { Routes } from '@angular/router';
import { ReviewComponent } from './review';
import { ReviewDetail } from './review-detail/review-detail';

export const REVIEW_ROUTES: Routes = [
  { path: '', component: ReviewComponent },
  { path: ':id', component: ReviewDetail },
];
