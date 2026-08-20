import { Routes } from '@angular/router';
import { ReviewComponent } from './review';
import { ReviewDetail } from './review-detail/review-detail';

export const REVIEW_ROUTES: Routes = [
  { path: '', component: ReviewComponent },
  { path: ':id', component: ReviewDetail }
];
