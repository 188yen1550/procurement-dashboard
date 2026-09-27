import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ApiEnvelope, PageEnvelope } from '../../../core/api/api-envelope';
import { buildParams } from '../../../core/api/http-params';
import { CsvExportResult, postForCsv } from '../../../core/api/csv-export';
import { PagedResult, unwrapData, unwrapPage } from '../../../core/api/unwrap';
import {
  AI_ANALYSIS_TIMEOUT_MS,
  TREND_SYNC_TIMEOUT_MS,
  withRequestTimeout,
} from '../../../core/api/request-timeout';
import { ReviewRecordResponsePayload } from '../../review/api/review-api.contract';
import { ReviewRecordModel, toReviewRecordModel } from '../../review/api/review.mapper';
import { CustomFieldDefinitionResponsePayload } from '../../settings/api/settings-api.contract';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import {
  AiAnalysisResponsePayload,
  AiSuggestionBatchResultPayload,
  EvaluationResponsePayload,
  FestivalBoostResponsePayload,
  PRODUCT_API,
  ProductBatchCreateResponsePayload,
  ProductExportRequestPayload,
  ProductBatchItemRequestPayload,
  ProductCreateRequestPayload,
  ProductListQuery,
  ProductResponsePayload,
  ProductUpdateRequestPayload,
  ResaleReferenceOptionPayload,
  ResaleReferenceProductQuery,
  SimilarCandidateQuery,
  SimilarProductCandidatePayload,
  SubmissionBatchResponsePayload,
  TrendHistoryPointPayload,
  TrendSnapshotPayload,
} from './product-api.contract';

/** CSV 匯出結果（型別沿用共用的 CsvExportResult，保留原名供既有呼叫端使用）。 */
export type ProductExportResult = CsvExportResult;
import {
  AiAnalysisModel,
  ProductDetailModel,
  ProductFormModel,
  ProductListItem,
  TrendHistoryPoint,
  TrendModel,
  toAiAnalysisModel,
  toProductDetailModel,
  toProductFormModel,
  toProductListItem,
  toTrendHistoryPoint,
  toTrendModel,
} from './product.mapper';

/**
 * 品項相關 API 的唯一呼叫入口。元件不直接使用 HttpClient。
 *
 * 方法順序對齊後端 Controller，方便 review 時逐支對照：
 * ProductController → ScoringController → TrendController → AiSelectionController。
 *
 * ## 錯誤處理的分工
 * 這一層**不 catchError**（詳情頁的可選區塊除外，見 getDetail()）。
 * 呼叫端需要區分 409（狀態被別人改了）與 400（欄位錯誤）與 403（權限不足），
 * 這裡若統一吞掉，上層就只剩「失敗了」三個字可用。
 * 錯誤轉換請在元件用 core/api/api-error.ts 的 toApiError()。
 */
@Injectable({ providedIn: 'root' })
export class ProductApiService {
  private readonly http = inject(HttpClient);
  private readonly productTypes = inject(ProductTypeLookupService);

  // ----- ProductController -----

  /**
   * 1. GET /api/products：品項主清單。
   *
   * candidateStatus 不帶時後端預設 CANDIDATE，所以主清單通常不用送。
   * 這裡會順帶把 productTypeId 對照成中文名稱：ProductResponse 只有編號，
   * 對照表由 ProductTypeLookupService 快取（shareReplay），
   * 不會每次查清單就多打一次 settings API。
   */
  list(query: ProductListQuery = {}): Observable<PagedResult<ProductListItem>> {
    return this.listWithTypeNames(PRODUCT_API.list, query);
  }

  /**
   * 2. GET /api/products/ai-suggested：AI 建議清單。
   *
   * ⚠️ 後端這支**只吃 Pageable，不吃任何篩選參數**
   * （ProductController.searchAiSuggested 的簽名只有 Pageable），
   * 送 keyword／reviewStatus 過去不會有作用也不會報錯，會靜默被忽略。
   * 所以參數型別刻意收窄成只有分頁，避免呼叫端誤以為可以篩選。
   */
  listAiSuggested(
    query: { page?: number; size?: number; sort?: string } = {},
  ): Observable<PagedResult<ProductListItem>> {
    return this.listWithTypeNames(PRODUCT_API.aiSuggested, query);
  }

  /** 3. GET /api/products/{id}：商品核心資料（原始 payload）。 */
  getProduct(id: number | string): Observable<ProductResponsePayload> {
    return this.http
      .get<ApiEnvelope<ProductResponsePayload>>(PRODUCT_API.detail(id))
      .pipe(unwrapData());
  }

  /** 4. 編輯表單用的 View Model。同一支 API，只是換成表單要的形狀。 */
  getProductForm(id: number | string): Observable<ProductFormModel> {
    return this.getProduct(id).pipe(map(toProductFormModel));
  }

  /**
   * 5. POST /api/products：手動新增品項，後端直接建為 CANDIDATE。
   *
   * ⚠️ 後端不檢查商品名稱重複，防止使用者手滑送兩次是前端責任——
   * 送出後立即 disable 按鈕，成功前不要恢復。
   */
  create(body: ProductCreateRequestPayload): Observable<ProductResponsePayload> {
    return this.http
      .post<ApiEnvelope<ProductResponsePayload>>(PRODUCT_API.create, body)
      .pipe(unwrapData());
  }

  /**
   * 5b. POST /api/products/batch：批次新增品項（CSV／Excel 匯入）。
   *
   * ⚠️ 這支不是 JSON 而是 multipart/form-data，跟 uploadImage() 一樣
   * **不要自己設 Content-Type header**，交給瀏覽器自動產生含 boundary 的
   * multipart/form-data，否則後端解不出 items／images 兩個 part。
   *
   * items 這個 part 本身要以 Blob（type: 'application/json'）而不是純字串
   * 附加，否則後端 @RequestPart("items") 收到的 Content-Type 會被瀏覽器
   * 判成 text/plain，Spring 找不到對應的 HttpMessageConverter 反序列化成
   * ProductBatchCreateRequest，會直接 415。
   *
   * images 用同一個欄位名重複 append 多次，後端用
   * List&lt;MultipartFile&gt; 依 part 名稱 "images" 收集成陣列，不是每個
   * 檔案要用不同的欄位名。
   */
  createBatch(
    items: ProductBatchItemRequestPayload[],
    images: File[],
  ): Observable<ProductBatchCreateResponsePayload> {
    const formData = new FormData();
    const itemsBlob = new Blob([JSON.stringify({ items })], { type: 'application/json' });
    formData.append('items', itemsBlob);
    for (const file of images) {
      formData.append('images', file, file.name);
    }
    return this.http
      .post<ApiEnvelope<ProductBatchCreateResponsePayload>>(PRODUCT_API.batchCreate, formData)
      .pipe(unwrapData());
  }

  /**
   * 6. PUT /api/products/{id}：整份覆蓋更新。
   *
   * ⚠️ 沒送的欄位會變成 null，一定要先 GET 再改再整份送回。
   * ⚠️ APPROVED 商品異動選品核心資料會收到 409，呼叫端要單獨處理這個狀態碼，
   *    顯示「已核准商品的核心資料不可修改」而不是通用錯誤。
   */
  update(
    id: number | string,
    body: ProductUpdateRequestPayload,
  ): Observable<ProductResponsePayload> {
    return this.http
      .put<ApiEnvelope<ProductResponsePayload>>(PRODUCT_API.detail(id), body)
      .pipe(unwrapData());
  }

  /**
   * 7. DELETE /api/products/{id}
   * 前置條件：reviewStatus === 'PENDING' 且 submissionCount === 1（1 起算：第 1 次送審、尚未被審核）。
   */
  remove(id: number | string): Observable<void> {
    return this.http
      .delete<ApiEnvelope<null>>(PRODUCT_API.detail(id))
      .pipe(map(() => undefined));
  }

  /**
   * 8. POST /api/products/{id}/resubmit
   * 前置條件：REJECTED **且** ACTIVE。已封存的要先復用。
   */
  resubmit(id: number | string): Observable<ProductResponsePayload> {
    return this.postAction(PRODUCT_API.resubmit(id));
  }

  /**
   * 9. POST /api/products/{id}/archive
   * 前置條件：ACTIVE **且** (APPROVED 或 REJECTED)。PENDING 不能封存。
   *
   * ⚠️ 不是 PATCH /api/products/{id}/item-status——後端沒有那支端點。
   */
  archive(id: number | string): Observable<ProductResponsePayload> {
    return this.postAction(PRODUCT_API.archive(id));
  }

  /**
   * 10. POST /api/products/{id}/restore
   * 前置條件：ARCHIVED **且** (APPROVED 或 REJECTED)。
   * ⚠️ REJECTED 也可以復用，不是只有 APPROVED。
   */
  restore(id: number | string): Observable<ProductResponsePayload> {
    return this.postAction(PRODUCT_API.restore(id));
  }

  /** 11. POST /api/products/{id}/promote-to-candidate：AI_SUGGESTED → CANDIDATE。 */
  promoteToCandidate(id: number | string): Observable<ProductResponsePayload> {
    return this.postAction(PRODUCT_API.promote(id));
  }

  /**
   * 13. GET /api/products/similar-candidates：RESALE 商品搜尋相似參考商品。
   *
   * 純唯讀查詢，不會修改任何資料。後端只負責排序建議，**不做自動合併判定**——
   * 回傳的清單要交給使用者人工挑選，選定的 productId 再填進
   * ProductCreateRequest／ProductUpdateRequest 的 resaleReferenceProductId 送出。
   *
   * ⚠️ productTypeId 與 name 是必填（後端沒有 required = false），
   * 兩者任一為空時**不要發請求**，否則收到的是 400 而不是空清單。
   *
   * ⚠️ 編輯既有商品時務必帶 excludeId = 自己的 id，
   * 否則第一名永遠是商品自己（名稱 100% 相同）。
   */
  findSimilarCandidates(query: SimilarCandidateQuery): Observable<SimilarProductCandidatePayload[]> {
    return this.http
      .get<ApiEnvelope<SimilarProductCandidatePayload[]>>(PRODUCT_API.similarCandidates, {
        params: buildParams({
          productTypeId: query.productTypeId,
          name: query.name,
          supplierName: query.supplierName,
          excludeId: query.excludeId,
        }),
      })
      .pipe(unwrapData());
  }

  /**
   * 13b. GET /api/products/resale-reference/suppliers：逐層過濾參考商品第一層。
   *
   * 取代 findSimilarCandidates() 在品項表單的用途（見 PRODUCT_API.similarCandidates
   * 註解）：不再依賴打字模糊比對，改成先選品類、再從這支端點列出的供應商裡選一個，
   * 最後呼叫 findResaleReferenceProducts() 列出商品名稱。
   */
  listResaleReferenceSuppliers(productTypeId: number): Observable<string[]> {
    return this.http
      .get<ApiEnvelope<string[]>>(PRODUCT_API.resaleReferenceSuppliers, {
        params: buildParams({ productTypeId }),
      })
      .pipe(unwrapData());
  }

  /**
   * 13c. GET /api/products/resale-reference/products：逐層過濾參考商品第二層。
   *
   * ⚠️ 回傳的是精簡選項（僅 id／name），選定之後要另外呼叫 getProduct(id)
   * 取得完整資料做表單預填，這支端點本身不含 description／campaignTags 等欄位。
   */
  listResaleReferenceProducts(
    query: ResaleReferenceProductQuery,
  ): Observable<ResaleReferenceOptionPayload[]> {
    return this.http
      .get<ApiEnvelope<ResaleReferenceOptionPayload[]>>(PRODUCT_API.resaleReferenceProducts, {
        params: buildParams({
          productTypeId: query.productTypeId,
          supplierName: query.supplierName,
          excludeId: query.excludeId,
        }),
      })
      .pipe(unwrapData());
  }

  /**
   * GET /api/products/custom-field-schema：依 productTypeId 取得目前生效中、
   * 適用這個品類的自訂商品屬性題目，供品項表單動態渲染。2026-09-20新增，
   * 「開新計分因子資料源」Phase 2。
   */
  getCustomFieldSchema(productTypeId: number): Observable<CustomFieldDefinitionResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<CustomFieldDefinitionResponsePayload[]>>(PRODUCT_API.customFieldSchema, {
        params: buildParams({ productTypeId }),
      })
      .pipe(unwrapData());
  }

  /**
   * GET /api/products/custom-field-schema/all [操作+管理]（2026-09-24 新增）：不限品類，
   * 只回傳生效中的自訂商品屬性題目。批次匯入一份檔案可能涵蓋多個品類，
   * 用這支組出範本的「自訂屬性」聯集欄位；單筆表單仍用上面依品類過濾的那支。
   */
  getAllActiveCustomFieldSchema(): Observable<CustomFieldDefinitionResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<CustomFieldDefinitionResponsePayload[]>>(PRODUCT_API.customFieldSchemaAll)
      .pipe(unwrapData());
  }

  /**
   * 14. POST /api/products/ai-suggested/batch-generate [僅管理]
   *
   * 手動觸發 AI 主動選品批次。正式排程是 AiSuggestionBatchService 的
   * @Scheduled（每日凌晨三點），這支端點存在的理由是 demo／開發時
   * 不用乾等到凌晨三點才看得到效果。
   *
   * ⚠️ **這支會實際呼叫 Gemini 並消耗配額**，且執行時間隨商品數量增加，
   *    不是瞬間回應。畫面上必須：
   *    1. 觸發前要二次確認（避免誤點）
   *    2. 執行中把按鈕 disable（避免連點送出多批）
   *    3. 完成後用回傳的 checkedCount／suggestedCount 給明確回饋
   *
   * ⚠️ 後端 Controller 上有 @PreAuthorize("hasRole('MANAGER')")，
   *    採購角色呼叫會是 403。前端要一併隱藏按鈕，但**不能只靠前端隱藏**
   *    ——後端那道檢查才是真正的防線。
   */
  triggerAiSuggestionBatch(): Observable<AiSuggestionBatchResultPayload> {
    return this.http
      .post<ApiEnvelope<AiSuggestionBatchResultPayload>>(PRODUCT_API.aiSuggestedBatchGenerate, {})
      .pipe(unwrapData());
  }

  /**
   * 12. POST /api/products/{id}/image：上傳／替換商品圖片。
   *
   * ⚠️ 這支不是 JSON 而是 multipart/form-data，欄位名固定 file。
   * ⚠️ **不要自己設 Content-Type header**——瀏覽器需要自行產生含 boundary 的
   *    multipart/form-data; boundary=----xxx，手動設定會讓後端解不出檔案。
   * ⚠️ 限制 jpg／jpeg／png／webp、單檔 5MB，超過會收到 400。
   * ⚠️ 重複上傳會取代舊圖，舊網址變成 404，畫面要用新的 imageUrl 覆蓋。
   */
  uploadImage(id: number | string, file: File): Observable<ProductResponsePayload> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<ApiEnvelope<ProductResponsePayload>>(PRODUCT_API.image(id), formData)
      .pipe(unwrapData());
  }

  // ----- ScoringController -----

  /** 13. GET /api/products/{id}/evaluation：六大分項與 Base/Final Score。 */
  getEvaluation(id: number | string): Observable<EvaluationResponsePayload> {
    return this.http
      .get<ApiEnvelope<EvaluationResponsePayload>>(PRODUCT_API.evaluation(id))
      .pipe(unwrapData());
  }

  /** 14. GET /api/products/{id}/festival-boost：命中檔期明細。matchedCampaign 可為 null。 */
  getFestivalBoost(id: number | string): Observable<FestivalBoostResponsePayload> {
    return this.http
      .get<ApiEnvelope<FestivalBoostResponsePayload>>(PRODUCT_API.festivalBoost(id))
      .pipe(unwrapData());
  }

  // ----- TrendController -----

  /**
   * GET /api/products/{id}/trend：讀取最新一筆趨勢資料（每天 02:00 排程自動抓 PTT）。
   * 純讀取、不觸發爬蟲，可以在頁面載入時呼叫。尚無資料時回傳 null。
   */
  getLatestTrend(id: number | string): Observable<TrendModel | null> {
    return this.http
      .get<ApiEnvelope<TrendSnapshotPayload | null>>(PRODUCT_API.trend(id))
      .pipe(
        unwrapData(),
        map((payload) => (payload ? toTrendModel(payload) : null)),
      );
  }

  /**
   * GET /api/products/{id}/trend/history：最近 30 天的趨勢歷史序列，
   * 依時間正序回傳，供品項詳情頁畫趨勢圖用。
   *
   * ⚠️ 2026-09-25 新增：純讀取、不觸發爬蟲，可以在頁面載入時呼叫，
   * 跟 getLatestTrend() 一樣安全（不像 syncTrend() 那樣會打外部 PTT）。
   */
  getTrendHistory(id: number | string): Observable<TrendHistoryPoint[]> {
    return this.http
      .get<ApiEnvelope<TrendHistoryPointPayload[]>>(PRODUCT_API.trendHistory(id))
      .pipe(
        unwrapData(),
        map((items) => items.map(toTrendHistoryPoint)),
      );
  }

  /**
   * 15. POST /api/products/{id}/trend/sync：手動同步趨勢資料。
   *
   * ⚠️ 後端會即時搜尋 PTT 多個看板（每次請求間隔 1 秒），每個商品約需 8–10 秒才回應，
   * 畫面必須顯示讀取中狀態並停用按鈕，避免使用者重複點擊。
   * 超過 TREND_SYNC_TIMEOUT_MS 以 TimeoutError 結束，toApiError() 會標記 isTimeout。
   *
   * ⚠️ 這支會呼叫外部資料源，**絕對不要在頁面載入時自動觸發**
   * （企劃書第八節：不要在一般頁面載入時無條件觸發大量 crawler request）。
   * 只綁在使用者明確點擊的「同步」按鈕上。
   */
  syncTrend(id: number | string): Observable<TrendModel> {
    return this.http
      .post<ApiEnvelope<TrendSnapshotPayload>>(PRODUCT_API.trendSync(id), {})
      .pipe(withRequestTimeout(TREND_SYNC_TIMEOUT_MS), unwrapData(), map(toTrendModel));
  }

  // ----- AiSelectionController -----

  /**
   * 16. GET /api/products/{id}/ai-analysis：純讀取已快取的分析。
   *
   * ⚠️ 無快取時回 200 + 全 null 物件，不是 404。
   * toAiAnalysisModel() 會把它轉成 hasAnalysis: false，
   * 呼叫端據此顯示「尚無 AI 分析，點擊生成」的 Empty 狀態。
   * ⚠️ GET 不觸發 LLM 生成，不會產生費用。
   */
  getAiAnalysis(id: number | string): Observable<AiAnalysisModel> {
    return this.http
      .get<ApiEnvelope<AiAnalysisResponsePayload>>(PRODUCT_API.aiAnalysis(id))
      .pipe(unwrapData(), map(toAiAnalysisModel));
  }

  /**
   * 17. POST /api/products/{id}/ai-analysis/generate：觸發生成新分析。
   *
   * ⚠️ **這支會產生 LLM API 費用**，且後端有配額限制。
   * 前端必須：二次確認對話框 + 送出後 disable 按鈕直到回應，
   * 不要讓使用者連點。失敗時後端回 502（LlmAnalysisException），
   * 用 isLlmFailure() 判斷後讓 AI 區塊單獨降級，不要讓整頁變 error。
   * 超過 AI_ANALYSIS_TIMEOUT_MS 以 TimeoutError 結束，toApiError() 會標記 isTimeout。
   */
  generateAiAnalysis(id: number | string): Observable<AiAnalysisModel> {
    return this.http
      .post<ApiEnvelope<AiAnalysisResponsePayload>>(PRODUCT_API.aiAnalysisGenerate(id), {})
      .pipe(withRequestTimeout(AI_ANALYSIS_TIMEOUT_MS), unwrapData(), map(toAiAnalysisModel));
  }

  // ----- ReviewController（審核歷史，操作層也可看）-----

  /**
   * 18. GET /api/products/{id}/reviews：單一商品的歷次審核紀錄。
   *
   * ⚠️ 這支回的是 **List 不是 Page**（ReviewController 的簽名是 List），
   * 跟 /api/reviews/decision-records 不同，不要用 unwrapPage()。
   * ⚠️ 這是唯一「操作層也能呼叫」的審核相關 API，可以放在品項詳情頁。
   */
  getReviewHistory(id: number | string): Observable<ReviewRecordModel[]> {
    return this.http
      .get<ApiEnvelope<ReviewRecordResponsePayload[]>>(PRODUCT_API.reviewHistory(id))
      .pipe(unwrapData(), map((records) => records.map((r) => toReviewRecordModel(r))));
  }

  // ----- 組合查詢 -----

  /**
   * 19. 詳情頁的一次性載入：基本資料 + 評估 + 節慶加成。
   *
   * 設計取捨：
   * - 基本資料失敗 → 整個 Observable error，頁面顯示 error 狀態（沒有商品就沒有頁面）
   * - 評估／節慶失敗 → catchError 降級成 null，頁面照常渲染其餘區塊
   *
   * 為什麼先 getProduct 再 forkJoin 而不是三支一起 forkJoin：
   * forkJoin 任一支 error 就全部 error，商品不存在時三支都會打出去、
   * 浪費兩個必然失敗的請求，也拿不到「是哪一支失敗」的資訊。
   *
   * AI 分析與審核歷史刻意**不**放進來：那兩塊是使用者展開才需要的，
   * 一併載入等於每次進詳情頁都多兩個請求。
   */
  getDetail(id: number | string): Observable<ProductDetailModel> {
    return this.getProduct(id).pipe(
      switchMap((product) =>
        forkJoin({
          product: of(product),
          evaluation: this.getEvaluation(id).pipe(catchError(() => of(null))),
          festival: this.getFestivalBoost(id).pipe(catchError(() => of(null))),
          typeName: this.productTypes.getName(product.productTypeId),
        }),
      ),
      map(({ product, evaluation, festival, typeName }) =>
        toProductDetailModel(product, evaluation, festival, typeName),
      ),
    );
  }

  // ----- private -----

  /** 四支狀態轉換端點形狀相同，抽出來避免四份幾乎一樣的程式碼。 */
  private postAction(url: string): Observable<ProductResponsePayload> {
    return this.http
      .post<ApiEnvelope<ProductResponsePayload>>(url, {})
      .pipe(unwrapData());
  }

  /**
   * 清單查詢共用流程：拆兩層殼 + 對照商品類型名稱。
   *
   * 商品類型對照表整份取回後在記憶體 join，不是每筆打一次 API——
   * 類型只有個位數筆、且 ProductTypeLookupService 有 shareReplay 快取。
   */
  private listWithTypeNames(
    url: string,
    query: object,
  ): Observable<PagedResult<ProductListItem>> {
    return forkJoin({
      page: this.http
        .get<ApiEnvelope<PageEnvelope<ProductResponsePayload>>>(url, {
          params: buildParams(query),
        })
        .pipe(unwrapPage((payload: ProductResponsePayload) => payload)),
      nameById: this.productTypes.getNameMap(),
    }).pipe(
      map(({ page, nameById }) => ({
        ...page,
        items: page.items.map((payload) =>
          toProductListItem(
            payload,
            payload.productTypeId === null
              ? undefined
              : nameById.get(payload.productTypeId),
          ),
        ),
      })),
    );
  }

  // ----- 2026-09 CSV 匯出（V25） -----

  /** GET /api/products/submission-batches：送審批次下拉選項（新到舊，最後可能有一筆 NONE）。 */
  listSubmissionBatches(): Observable<SubmissionBatchResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<SubmissionBatchResponsePayload[]>>(PRODUCT_API.submissionBatches)
      .pipe(unwrapData());
  }

  /**
   * POST /api/products/export [僅操作]：匯出審核通過商品 CSV。
   *
   * 成功時回應本體是檔案（blob），不是 ApiEnvelope；筆數讀 X-Export-Count header。
   * Blob 形式的錯誤回應處理見 core/api/csv-export.ts（2026-09-26 抽出共用）。
   */
  exportApproved(body: ProductExportRequestPayload): Observable<ProductExportResult> {
    return postForCsv(this.http, PRODUCT_API.exportApproved, body);
  }
}
