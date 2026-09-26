import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope, PageEnvelope } from '../../../core/api/api-envelope';
import { buildParams } from '../../../core/api/http-params';
import { CsvExportResult, postForCsv } from '../../../core/api/csv-export';
import { PagedResult, unwrapData, unwrapPage } from '../../../core/api/unwrap';
import { ProductResponsePayload } from '../../product-management/api/product-api.contract';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import { RiskOptionLookupService } from '../../settings/api/risk-option-lookup.service';
import {
  DecisionRecordExportRequestPayload,
  DecisionRecordQuery,
  PendingReviewQuery,
  REVIEW_API,
  ReviewDetailResponsePayload,
  ReviewRecordResponsePayload,
  ReviewSubmitRequestPayload,
} from './review-api.contract';
import {
  PendingReviewItem,
  ReviewDetailModel,
  ReviewRecordModel,
  toPendingReviewItem,
  toReviewDetailModel,
  toReviewRecordModel,
} from './review.mapper';

/**
 * 選品審核 API 的唯一呼叫入口。
 *
 * ⚠️ 這四支端點都是 @PreAuthorize("hasRole('MANAGER')")。
 * 操作層呼叫會收到 **403 不是 401**——用 isForbidden() 判斷後顯示
 * 「權限不足」並留在原頁，**不要導回登入頁**（重登也不會變成 MANAGER）。
 * 前端 Route Guard 應該先擋掉，但後端這道防線才是真正有效的那道。
 */
@Injectable({ providedIn: 'root' })
export class ReviewApiService {
  private readonly http = inject(HttpClient);
  private readonly productTypes = inject(ProductTypeLookupService);
  private readonly riskOptions = inject(RiskOptionLookupService);

  /**
   * 1. GET /api/reviews/pending：待審清單（PENDING + ACTIVE）。
   *
   * ⚠️ 後端已經寫死篩選條件，前端不用也不能再送 reviewStatus／itemStatus，
   * 只吃 Pageable。回傳的是 ProductResponse，欄位與品項清單完全相同。
   */
  listPending(query: PendingReviewQuery = {}): Observable<PagedResult<PendingReviewItem>> {
    return forkJoin({
      page: this.http
        .get<ApiEnvelope<PageEnvelope<ProductResponsePayload>>>(REVIEW_API.pending, {
          params: buildParams(query),
        })
        .pipe(unwrapPage((payload: ProductResponsePayload) => payload)),
      nameById: this.productTypes.getNameMap(),
    }).pipe(
      map(({ page, nameById }) => ({
        ...page,
        items: page.items.map((payload) =>
          toPendingReviewItem(
            payload,
            payload.productTypeId === null ? undefined : nameById.get(payload.productTypeId),
          ),
        ),
      })),
    );
  }

  /**
   * 2. GET /api/reviews/{productId}：審核頁的完整資料。
   *
   * ⚠️ 路徑參數是**商品編號**，不是審核紀錄編號。
   *
   * 這一支回傳審核頁需要的全部內容（商品、分數、節慶、AI、可勾選風險），
   * 不要再另外呼叫 evaluation／festival-boost／ai-analysis 去拼——
   * 那會多三個請求，而且拿到的可能與後端組這頁時的值不一致。
   */
  getDetail(productId: number | string): Observable<ReviewDetailModel> {
    return this.http
      .get<ApiEnvelope<ReviewDetailResponsePayload>>(REVIEW_API.detail(productId))
      .pipe(
        unwrapData(),
        map((payload) => toReviewDetailModel(payload)),
      );
  }

  /**
   * 2b. 需要顯示商品類型中文時用這支；否則用 getDetail() 即可。
   * 分成兩支是因為多數審核畫面以商品名稱為主，類型是次要資訊，
   * 不必為它讓每次載入都等對照表。
   */
  getDetailWithTypeName(productId: number | string): Observable<ReviewDetailModel> {
    return forkJoin({
      payload: this.http
        .get<ApiEnvelope<ReviewDetailResponsePayload>>(REVIEW_API.detail(productId))
        .pipe(unwrapData()),
      nameById: this.productTypes.getNameMap(),
    }).pipe(
      map(({ payload, nameById }) =>
        toReviewDetailModel(
          payload,
          payload.product.productTypeId === null
            ? undefined
            : nameById.get(payload.product.productTypeId),
        ),
      ),
    );
  }

  /**
   * 3. POST /api/reviews：提交審核結果。
   *
   * ⚠️ **一定要處理 409**。後端以條件式 UPDATE
   * `WHERE review_status='PENDING'` 做併發控制，影響筆數 0 時回 409，
   * 代表「你點進來審核時，別人已經先審過了」。這不是 bug，
   * 是多人同時操作待審清單的正常情況。
   *
   * 正確處理：提示「此商品已被其他人審核，請重新整理」→ 導回待審清單 → 重新載入。
   * **不要照原請求重試**，只會再失敗一次。
   *
   * ⚠️ 送出前務必先跑 validateReviewForm()：企劃書的三條規則
   * （必選結果、其他風險需備註、必填留言）後端刻意不擋。
   */
  submit(body: ReviewSubmitRequestPayload): Observable<ReviewRecordModel> {
    return this.http
      .post<ApiEnvelope<ReviewRecordResponsePayload>>(REVIEW_API.submit, body)
      .pipe(
        unwrapData(),
        map((payload) => toReviewRecordModel(payload)),
      );
  }

  /**
   * 4. GET /api/reviews/decision-records：跨商品的審核紀錄彙總（分頁）。
   *
   * 會順帶把 riskOptionIds 對照成名稱——ReviewRecordResponse 只有編號，
   * 直接顯示數字對使用者沒有意義。對照表由 RiskOptionLookupService 快取。
   */
  listDecisionRecords(
    query: DecisionRecordQuery = {},
  ): Observable<PagedResult<ReviewRecordModel>> {
    return forkJoin({
      page: this.http
        .get<ApiEnvelope<PageEnvelope<ReviewRecordResponsePayload>>>(
          REVIEW_API.decisionRecords,
          { params: buildParams(query) },
        )
        .pipe(unwrapPage((payload: ReviewRecordResponsePayload) => payload)),
      nameById: this.riskOptions.getNameMap(),
    }).pipe(
      map(({ page, nameById }) => ({
        ...page,
        items: page.items.map((payload) =>
          toReviewRecordModel(
            payload,
            (payload.riskOptionIds ?? [])
              .map((id) => nameById.get(id))
              .filter((name): name is string => name !== undefined),
          ),
        ),
      })),
    );
  }

  /**
   * POST /api/reviews/decision-records/export [僅管理]（2026-09-26）：決策紀錄唯讀匯出。
   * 回應處理（檔案本體、筆數 header、Blob 錯誤訊息）見 core/api/csv-export.ts。
   */
  exportDecisionRecords(body: DecisionRecordExportRequestPayload): Observable<CsvExportResult> {
    return postForCsv(this.http, REVIEW_API.decisionRecordsExport, body);
  }
}
