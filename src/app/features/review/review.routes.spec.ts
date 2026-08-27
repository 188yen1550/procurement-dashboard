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
