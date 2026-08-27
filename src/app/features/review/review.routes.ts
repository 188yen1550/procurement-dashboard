import { Routes } from '@angular/router';
import { Review } from './review';
import { ReviewDetail } from './review-detail/review-detail';

export const REVIEW_ROUTES: Routes = [
  { path: '', component: Review },
  { path: ':id', component: ReviewDetail },
];
