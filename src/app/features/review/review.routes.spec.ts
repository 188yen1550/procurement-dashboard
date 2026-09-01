/** 檔案用途：驗證審核路由保留清單與動態詳情配置，不改變路由順序。 */
import { Review } from './review';
import { ReviewDetail } from './review-detail/review-detail';
import { REVIEW_ROUTES } from './review.routes';

describe('REVIEW_ROUTES', () => {
  it('should expose the review list route', () => {
    expect(REVIEW_ROUTES).toContainEqual({ path: '', component: Review });
  });

  it('should expose the review detail route', () => {
    expect(REVIEW_ROUTES).toContainEqual({ path: ':id', component: ReviewDetail });
  });
});
