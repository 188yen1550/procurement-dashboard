import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  EvaluationData,
  FestivalBoostData,
  PRODUCT_API,
  ProductDetailData,
  ProductListFilters,
} from './product-api.contract';

/** 品項相關 API 的唯一呼叫入口；元件不直接使用 HttpClient。 */
@Injectable({ providedIn: 'root' })
export class ProductApiService {
  private readonly http = inject(HttpClient);

  list(filters: ProductListFilters = {}): Observable<ProductDetailData[]> {
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => !!value),
    ) as Record<string, string>;
    return this.http.get<ProductDetailData[]>(PRODUCT_API.list, { params });
  }
  getProduct(id: number | string): Observable<ProductDetailData> {
    return this.http.get<ProductDetailData>(PRODUCT_API.detail(id));
  }
  getEvaluation(id: number | string): Observable<EvaluationData> {
    return this.http.get<EvaluationData>(PRODUCT_API.evaluation(id));
  }
  getFestivalBoost(id: number | string): Observable<FestivalBoostData> {
    return this.http.get<FestivalBoostData>(PRODUCT_API.festivalBoost(id));
  }
  resubmit(id: number | string): Observable<unknown> {
    return this.http.post(PRODUCT_API.resubmit(id), {});
  }
  archive(id: number | string): Observable<unknown> {
    return this.http.post(PRODUCT_API.archive(id), {});
  }
  restore(id: number | string): Observable<unknown> {
    return this.http.post(PRODUCT_API.restore(id), {});
  }
  promoteToCandidate(id: number | string): Observable<unknown> {
    return this.http.post(PRODUCT_API.promote(id), {});
  }
  remove(id: number | string): Observable<unknown> {
    return this.http.delete(PRODUCT_API.detail(id));
  }
}
