/**
 * 檔案用途：正式候選 CANDIDATE 商品主清單、篩選及生命週期操作。
 * 真實模式由後端處理搜尋、篩選與分頁；展示模式使用本地資料。
 * 刪除只允許尚未審核過（第 1 次送審中）的商品。
 * 2026-09-29：熱度建議清單移除，商品名稱下方改以「連續上升」標記提醒最近 3 次熱度同步都上升。
 */
import { ListSort, ListSortControls, SortHeader, sortRows } from '../../shared/ui/list-sort';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject } from 'rxjs';
import { debounceTime, finalize, map, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { FileDownloadService } from '../../core/ui/file-download.service';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { ItemStatus, ReviewStatus } from '../../core/domain/enums';
import {
  ITEM_STATUS_LABEL,
  PRICING_TYPE_LABEL,
  REVIEW_STATUS_LABEL,
  isDataIncomplete,
} from '../../core/domain/labels';
import { ProductApiService } from './api/product-api.service';
import {
  ProductExportRequestPayload,
  SUBMISSION_BATCH_NONE,
  SubmissionBatchResponsePayload,
} from './api/product-api.contract';
import { ProductListItem, RecentTrend, toProductActionAvailability } from './api/product.mapper';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';
import { Icon } from '../../shared/components/icon/icon';

export type PageState = 'default' | 'locked' | 'loading' | 'empty' | 'error';
export type SortOption =
  | 'updatedAt_desc'
  | 'updatedAt_asc'
  | 'finalScore_desc'
  | 'finalScore_asc'
  | 'name_asc'
  | 'name_desc'
  | `${'productTypeName|pricingType' | 'supplierName' | 'dataCompleteness' | 'reviewStatus|itemStatus'}_${'asc' | 'desc'}`;

/** 本地 Mock：欄位形狀與 ProductListItem 一致，切換模式時樣板不用改。 */
function mockItem(
  id: number,
  name: string,
  productTypeName: string,
  pricingType: 'NEW' | 'RESALE',
  supplierName: string,
  finalScore: number | null,
  dataCompleteness: number,
  reviewStatus: ReviewStatus,
  itemStatus: ItemStatus,
  candidateStatus: 'CANDIDATE',
  updatedAt: string,
  submissionCount: number,
  consecutiveRise = false,
): ProductListItem {
  return {
    id,
    name,
    productTypeId: null,
    productTypeName,
    pricingType,
    supplierName,
    // Mock 模式沒有對應的送審人資料，固定顯示這個假名字即可，
    // 反映的是「後端已提供這個欄位」的正常情況，不是缺值狀態。
    createdByName: '林小美',
    campaignTags: [],
    finalScore,
    dataCompleteness,
    // Mock 模式刻意給 true：本地資料是完整的，可以展示評分欄位的正常樣貌。
    hasScoreData: true,
    reviewStatus,
    itemStatus,
    candidateStatus,
    pricingStatus: pricingType === 'NEW' ? 'PENDING_PRICING' : 'PRICED',
    submissionCount,
    updatedAt,
    submittedAt: updatedAt,
    submittedByName: '林小美',
    actions: toProductActionAvailability({
      reviewStatus,
      itemStatus,
      candidateStatus,
      submissionCount,
    }),
    recentTrend: consecutiveRise
      ? { popularityScore: 74, direction: 'UP', isRealSource: true, recentDirections: ['UP', 'UP', 'UP'], consecutiveRise: true }
      : null,
  };
}

// submissionCount 為 1 起算（建立即第 1 次送審，2026-09-24 修正）；≥ 2 代表曾被拒絕後重送。
const MOCK_PRODUCTS: readonly ProductListItem[] = [
  mockItem(101, '中秋炭烤海陸組合禮盒', '食品／生鮮', 'RESALE', '潮港鮮物有限公司', 92.4, 96, 'APPROVED', 'ACTIVE', 'CANDIDATE', '2026-08-31T09:25:00+08:00', 2),
  mockItem(102, '輕量智慧溫控電熱杯', '3C／家電', 'NEW', '沐光科技', 81.6, 78, 'PENDING', 'ACTIVE', 'CANDIDATE', '2026-08-30T16:40:00+08:00', 1, true),
  mockItem(103, '無香低敏濃縮洗衣紙補充組', '日用品', 'RESALE', '淨好生活實業', 74.8, 88, 'REJECTED', 'ACTIVE', 'CANDIDATE', '2026-08-29T11:15:00+08:00', 2),
  mockItem(104, '超輕量折疊收納推車', '生活雜貨', 'NEW', '簡居創意工坊', null, 48, 'PENDING', 'ACTIVE', 'CANDIDATE', '2026-08-28T14:08:00+08:00', 1),
  mockItem(105, '敏弱肌保濕修護組', '美妝保養', 'RESALE', '禾心生技', 86.2, 100, 'APPROVED', 'ARCHIVED', 'CANDIDATE', '2026-08-26T10:30:00+08:00', 2),
  mockItem(106, '可機洗抗菌涼感被', '寢具家用', 'RESALE', '眠好家紡織', null, 55, 'REJECTED', 'ARCHIVED', 'CANDIDATE', '2026-08-24T13:50:00+08:00', 3),
];

/** 進階篩選的條件群組（清除單一條件時使用；日期區間起訖一起清除）。 */
type AdvancedFilterKey = 'updated' | 'reviewed' | 'batch' | 'neverExported' | 'createdByMe';

@Component({
  selector: 'app-product-management',
  standalone: true,
  imports: [ListSortControls, SortHeader, CommonModule, FormsModule, RouterLink, Icon],
  templateUrl: './product-management.html',
  styleUrls: ['./product-management.scss', './product-management-actions.scss', './product-management-filters.scss'],
})
export class ProductManagement implements OnInit {
  readonly productSortChoices = [
    { key: 'name', label: '商品名稱' },
    { key: 'productTypeName|pricingType', label: '分類／訂價分流' },
    { key: 'supplierName', label: '供應商' },
    { key: 'finalScore', label: '最終分數' },
    { key: 'dataCompleteness', label: '資料完整度' },
    { key: 'reviewStatus|itemStatus', label: '審核／品項狀態' },
    { key: 'updatedAt:date', label: '更新時間' },
  ];
  readonly productSort = new ListSort('updatedAt:date', 'desc', (state) =>
    this.updateSort(state.key.replace(':date', '') + '_' + state.direction));
  private readonly api = inject(ProductApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fileDownload = inject(FileDownloadService);
  private readonly route = inject(ActivatedRoute);
  readonly useMockData = APP_CONFIG.useMockData;


  readonly products = signal<ProductListItem[]>([]);
  readonly pageState = signal<PageState>('default');
  readonly searchTerm = signal('');
  /**
   * 預設只看待審核：操作層的日常工作是盯著自己送出去的東西有沒有結果。
   * 2026-09-24 職責分離後管理層不再進入這頁（purchaserGuard），原本「管理層
   * 預設看全部」的角色分支已無作用，一併移除。使用者仍可自行切換篩選條件。
   *
   * 2026-09-27：從儀表板統計卡點進來時帶有 ?reviewStatus=，constructor 依卡片語意
   * 覆蓋預設值（候選商品總數 → ALL；待審／通過／拒絕 → 對應狀態）。參數不存在或
   * 不是合法值時維持「預設看待審核」。
   */
  readonly reviewFilter = signal<ReviewStatus | 'ALL'>('PENDING');
  readonly itemFilter = signal<ItemStatus | 'ALL'>('ALL');
  readonly productTypeFilter = signal('ALL');
  // date input 原生格式是 'YYYY-MM-DD'，送給後端前補上時分秒——起始日補
  // 00:00:00、結束日補 23:59:59，這樣「選同一天」才會真的涵蓋當天全部
  // 範圍，不是後端拿到年月日相同的兩個時間點做 >= / <= 比對後篩出 0 筆。
  readonly updatedFromDraft = signal('');
  readonly updatedToDraft = signal('');

  // ----- 2026-09 送審批次／審核日期／未曾匯出（V25，品項清單與 CSV 匯出共用）-----
  // 這三組條件同時套用在清單與匯出：畫面上看到的清單（加上「審核通過」）就是匯出的內容，
  // 使用者不會遇到「清單顯示 12 筆、匯出卻是 30 筆」的落差。

  /** 送審批次下拉的值：'ALL'＝不篩；其餘是後端給的 batchId（含 'NONE'），原樣帶回。 */
  readonly submissionBatchFilter = signal('ALL');
  readonly submissionBatches = signal<SubmissionBatchResponsePayload[]>([]);
  readonly reviewedFromDraft = signal('');
  readonly reviewedToDraft = signal('');
  readonly neverExportedFilter = signal(false);
  /**
   * 2026-09-29：只看我建立的。儀表板操作層統計卡（個人口徑）連過來時帶 ?createdByMe=true，
   * 清單筆數才會與卡片數字一致；同時套用在匯出（currentFilterQuery 共用）。
   */
  readonly createdByMeFilter = signal(false);
  readonly isExporting = signal(false);

  /** 審核狀態選了「未審核／審核拒絕」時，匯出按鈕停用——這顆按鈕只匯出審核通過的商品。 */
  readonly exportBlockedByReviewFilter = computed(
    () => this.reviewFilter() === 'PENDING' || this.reviewFilter() === 'REJECTED',
  );
  readonly canExport = computed(
    () => !this.useMockData && !this.isExporting() && !this.isLoading() && !this.exportBlockedByReviewFilter(),
  );
  readonly exportDisabledReason = computed(() => {
    if (this.useMockData) return 'Mock 模式不支援匯出';
    if (this.exportBlockedByReviewFilter()) return '僅可匯出審核通過的商品，請將審核狀態切換為「全部」或「審核通過」';
    return null;
  });

  batchOptionLabel(batch: SubmissionBatchResponsePayload): string {
    if (batch.batchId === SUBMISSION_BATCH_NONE) return `（無批次資料）${batch.productCount} 筆`;
    return `${batch.submittedDate ?? ''} ${batch.submitterName ?? ''}（${batch.productCount} 筆）`.trim();
  }

  updateSubmissionBatchFilter(value: string): void {
    this.submissionBatchFilter.set(value);
    this.applyFilterChange();
  }
  updateReviewedFrom(value: string): void {
    this.reviewedFromDraft.set(value ?? '');
    this.applyFilterChange();
  }
  updateReviewedTo(value: string): void {
    this.reviewedToDraft.set(value ?? '');
    this.applyFilterChange();
  }
  updateNeverExported(value: boolean): void {
    this.neverExportedFilter.set(value);
    this.applyFilterChange();
  }
  updateCreatedByMe(value: boolean): void {
    this.createdByMeFilter.set(value);
    this.applyFilterChange();
  }

  private loadSubmissionBatches(): void {
    if (this.useMockData) return;
    this.api
      .listSubmissionBatches()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batches) => this.submissionBatches.set(batches),
        // 批次選項載入失敗不影響清單本身，只是下拉少了選項；不打斷使用者。
        error: () => this.submissionBatches.set([]),
      });
  }

  /**
   * 目前畫面上的篩選條件（不含審核狀態與分頁／排序）。清單查詢與匯出共用，
   * 確保兩邊條件一致。審核日期起日晚於迄日時不送日期條件（後端會回 400），
   * 由畫面提示使用者修正。
   */
  private currentFilterQuery(productTypeId: number | undefined): ProductExportRequestPayload {
    const itemStatus = this.itemFilter();
    const batch = this.submissionBatchFilter();
    const reviewedRangeValid = !this.reviewedDateRangeInvalid();
    return {
      keyword: this.searchTerm().trim() || undefined,
      itemStatus: itemStatus === 'ALL' ? undefined : itemStatus,
      productTypeId,
      updatedFrom: this.updatedFromDraft() ? `${this.updatedFromDraft()}T00:00:00` : undefined,
      updatedTo: this.updatedToDraft() ? `${this.updatedToDraft()}T23:59:59` : undefined,
      submissionBatch: batch === 'ALL' ? undefined : batch,
      reviewedFrom: reviewedRangeValid ? this.reviewedFromDraft() || undefined : undefined,
      reviewedTo: reviewedRangeValid ? this.reviewedToDraft() || undefined : undefined,
      neverExported: this.neverExportedFilter() || undefined,
      createdByMe: this.createdByMeFilter() || undefined,
    };
  }

  readonly reviewedDateRangeInvalid = computed(
    () => !!this.reviewedFromDraft() && !!this.reviewedToDraft() && this.reviewedFromDraft() > this.reviewedToDraft(),
  );

  /** 分類篩選存的是名稱（畫面顯示用），後端要 id：用 ProductTypeLookupService 的對照表反查。 */
  private resolveProductTypeId(): Observable<number | undefined> {
    const productTypeName = this.productTypeFilter();
    return this.productTypeLookup.getNameMap().pipe(
      map((nameById) =>
        productTypeName === 'ALL'
          ? undefined
          : [...nameById.entries()].find(([, name]) => name === productTypeName)?.[0],
      ),
    );
  }

  /**
   * 匯出審核通過商品 CSV（後端全量匯出，不受每頁 20 筆限制）。
   *
   * 匯出的是「目前篩選條件＋審核通過」的全部商品。成功後後端已在同一個請求內寫入
   * 匯出紀錄；若畫面正在看「未曾匯出」的清單，這批商品已不再符合條件，要重新查詢。
   */
  exportCsv(): void {
    if (!this.canExport()) return;
    this.isExporting.set(true);
    this.resolveProductTypeId()
      .pipe(
        switchMap((productTypeId) => this.api.exportApproved(this.currentFilterQuery(productTypeId))),
        finalize(() => this.isExporting.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ blob, rowCount }) => {
          if (rowCount === 0) {
            this.statusMessageState.show('沒有符合目前篩選條件的審核通過商品，未產生檔案。');
            return;
          }
          this.fileDownload.save(blob, exportFilename(new Date()));
          this.statusMessageState.show(`已匯出 ${rowCount} 筆審核通過商品。`);
          if (this.neverExportedFilter()) this.load();
        },
        error: (err) => this.statusMessageState.show(toApiError(err).message),
      });
  }

  updateUpdatedFrom(value: string): void {
    this.updatedFromDraft.set(value);
    this.applyFilterChange();
  }
  updateUpdatedTo(value: string): void {
    this.updatedToDraft.set(value);
    this.applyFilterChange();
  }
  /**
   * 排序。
   *
   * ⚠️ 「時間」跟「分數」不是同一種排序，不能用同一套機制處理：
   * - updatedAt 是 Product 實體的真實欄位，交給後端 Pageable Sort
   *   （ProductRepository.search() 直接用 JPA 排序），支援全部分頁。
   * - finalScore／dataCompleteness 不是 Product 實體欄位，是
   *   ProductService.searchProducts() 分頁查完後才另外批次查
   *   ProductEvaluation 補上去的（resolveEvaluations()，避免 N+1）。
   *   Spring Data 的 Pageable Sort 只能排序 JPA 查詢當下就有的欄位，
   *   對這種查完才合併進來的欄位送 sort=finalScore 只會讓後端噴
   *   PropertyReferenceException（400），不能假裝它跟時間排序一樣可靠。
   *   這裡改成「當前頁面資料」的前端排序，不是全體品項的排序，
   *   UI 上要清楚讓使用者知道這個差異，不要假裝是全域排序。
   */
  readonly sortOption = signal<SortOption>('updatedAt_desc');
  readonly dialogProduct = signal<ProductListItem | null>(null);
  readonly dialogMode = signal<'delete' | 'resubmit' | 'notice' | null>(null);
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly stateOptions: readonly PageState[] = ['default', 'locked', 'loading', 'empty', 'error'];

  /**
   * 搜尋框的節流管道（2026-09-23 由 procurement-dashboard-updated 分支整併）：
   * 輸入時 searchTerm 照樣即時更新（畫面文字不延遲），真正打 API 的
   * applyFilterChange() 等使用者停手 300ms 才執行一次，不再每個按鍵都
   * 打一次後端。
   *
   * ⚠️ 刻意不加 distinctUntilChanged()（分支原本有）：使用者輸入「abc」後按
   * 「清除篩選」（清除本身會立即重新查詢），再輸入同樣的「abc」時，
   * distinctUntilChanged 會因為跟上一次送進管道的值相同而把它吞掉，畫面
   * 就停在未篩選的清單。多打一次相同條件的查詢，代價遠小於查詢結果錯誤。
   */
  private readonly searchInput$ = new Subject<string>();

  constructor() {
    this.reviewFilter.set(
      ProductManagement.resolveInitialReviewFilter(this.route.snapshot.queryParamMap.get('reviewStatus')),
    );
    this.createdByMeFilter.set(this.route.snapshot.queryParamMap.get('createdByMe') === 'true');

    this.searchInput$
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.applyFilterChange());

    // 自動消失邏輯已內建在 createDismissibleMessage() 裡，不需要另外註冊監看。
    // 使用者原地重新點擊「品項管理」連結時 ngOnInit() 不會再被觸發，
    // 要靠這裡才能重新抓最新清單。Mock 模式不套用，避免每次點擊都把
    // 使用者正在操作的展示狀態（篩選、Demo 狀態切換）重置掉。
    if (!this.useMockData) reloadOnRevisit(() => { this.load(); this.loadProductTypes(); this.loadSubmissionBatches(); });
  }

  /** 網址 ?reviewStatus= 的值，只接受 ALL 與三種審核狀態，其他值一律回到預設「待審核」。 */
  private static resolveInitialReviewFilter(raw: string | null): ReviewStatus | 'ALL' {
    return raw === 'ALL' || raw === 'PENDING' || raw === 'APPROVED' || raw === 'REJECTED' ? raw : 'PENDING';
  }

  /** 分頁狀態。後端 @PageableDefault(size = 20)，前端沿用同一個預設值。 */
  readonly pageNumber = signal(0);
  readonly pageSize = signal(20);
  readonly totalElements = signal(0);
  readonly totalPages = signal(0);

  /**
   * 商品分類篩選選項——依大類分組的完整清單，跟目前頁面顯示的商品完全
   * 無關。原本這裡是從「目前這一頁的商品裡有出現過的分類名稱」動態算出來
   * 的，代表某個分類如果剛好在目前頁面／篩選條件下沒有任何商品，篩選
   * 選單裡就不會出現這個選項——使用者想篩選一個目前查無資料的分類，
   * 卻連選項都選不到，本末倒置。改成直接載入完整的品類清單，
   * 篩選選項應該要能涵蓋「所有存在的分類」，不是「剛好正在顯示的分類」。
   */
  readonly groupedProductTypes = signal<
    { major: { id: number; name: string }; minors: { id: number; name: string }[] }[]
  >([]);
  /** id → 說明文字，供品類名稱懸停顯示用（見 #23：懸停 1 秒以上才顯示，沒有說明則不顯示）。 */
  readonly productTypeDescriptions = signal<Map<number, string>>(new Map());

  private loadProductTypes(): void {
    this.productTypeLookup
      .getGroupedOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((groups) => this.groupedProductTypes.set(groups));
    this.productTypeLookup
      .getDescriptionMap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((map) => this.productTypeDescriptions.set(map));
  }

  /**
   * 「連續上升」標記的滑鼠提示：附上最新熱度，並說明只是提醒。
   * 後端只在最近 3 筆都是真實資料時才標連續上升（2026-09-29），所以這裡不需要再區分模擬資料。
   */
  riseTitle(trend: RecentTrend): string {
    const score = trend.popularityScore === null ? '' : `，最新熱度 ${trend.popularityScore} 分`;
    return `最近 3 次熱度同步都上升${score}。僅提醒，不影響評分與審核。`;
  }

  /**
   * 主清單只顯示 CANDIDATE。
   *
   * 真實模式其實後端已經預設過濾（candidateStatus 不帶時內部帶入 CANDIDATE），
   * 這裡再濾一次是給 Mock 模式用的，且對真實資料是無害的 no-op。
   */
  readonly candidateProducts = computed(() =>
    this.products().filter((p) => p.candidateStatus === 'CANDIDATE'),
  );

  /**
   * ⚠️ 真實模式下不做前端過濾：篩選條件已經送給後端了，
   * 這裡再濾一次會讓分頁數字對不上（後端說共 47 筆，畫面只顯示 3 筆）。
   * Mock 模式沒有後端可用，才走本地過濾。
   */
  readonly filteredProducts = computed(() => {
    const list = this.candidateProducts();
    if (!this.useMockData) return list;

    const keyword = this.searchTerm().trim().toLocaleLowerCase('zh-Hant');
    return list.filter(
      (p) =>
        (!keyword ||
          p.name.toLocaleLowerCase('zh-Hant').includes(keyword) ||
          p.supplierName.toLocaleLowerCase('zh-Hant').includes(keyword)) &&
        (this.reviewFilter() === 'ALL' || p.reviewStatus === this.reviewFilter()) &&
        (this.itemFilter() === 'ALL' || p.itemStatus === this.itemFilter()) &&
        (this.productTypeFilter() === 'ALL' || p.productTypeName === this.productTypeFilter()),
    );
  });

  readonly hasActiveFilters = computed(
    () =>
      !!this.searchTerm().trim() ||
      this.reviewFilter() !== 'ALL' ||
      this.itemFilter() !== 'ALL' ||
      this.productTypeFilter() !== 'ALL' ||
      // ⚠️ 修正：這裡原本沒有把修改時間（起/迄）算進去——設定日期區間後
      // hasActiveFilters() 仍然回 false，「清除篩選」按鈕維持 disabled，
      // 使用者設完篩選卻按不到清除按鈕。
      !!this.updatedFromDraft() ||
      !!this.updatedToDraft() ||
      this.submissionBatchFilter() !== 'ALL' ||
      !!this.reviewedFromDraft() ||
      !!this.reviewedToDraft() ||
      this.neverExportedFilter() ||
      this.createdByMeFilter(),
  );
  readonly isLoading = computed(() => this.pageState() === 'loading');

  // ----- 進階篩選（2026-09-26 版面整理，方案 A）-----
  // 常用條件（關鍵字、審核狀態、品項狀態、商品分類）留在第一列；修改時間、審核日期、
  // 送審批次、只看未曾匯出收進可展開的「進階篩選」。收合時條件照樣生效：按鈕上顯示生效
  // 數量，下方以小標籤列出（可單獨移除），使用者不會因為看不到而誤以為沒有套用。
  readonly advancedFiltersOpen = signal(false);

  /** 進階篩選中目前生效的條件（標籤文字＋移除用的 key）。日期區間各算一個條件。 */
  readonly advancedFilterChips = computed(() => {
    const chips: { key: AdvancedFilterKey; label: string }[] = [];
    const range = (from: string, to: string) => `${from || '不限'} ～ ${to || '不限'}`;
    if (this.updatedFromDraft() || this.updatedToDraft()) {
      chips.push({ key: 'updated', label: `修改時間：${range(this.updatedFromDraft(), this.updatedToDraft())}` });
    }
    if (this.reviewedFromDraft() || this.reviewedToDraft()) {
      chips.push({ key: 'reviewed', label: `審核日期：${range(this.reviewedFromDraft(), this.reviewedToDraft())}` });
    }
    const batchId = this.submissionBatchFilter();
    if (batchId !== 'ALL') {
      const batch = this.submissionBatches().find((item) => item.batchId === batchId);
      chips.push({ key: 'batch', label: `送審批次：${batch ? this.batchOptionLabel(batch) : batchId}` });
    }
    if (this.neverExportedFilter()) {
      chips.push({ key: 'neverExported', label: '只看未曾匯出' });
    }
    if (this.createdByMeFilter()) {
      chips.push({ key: 'createdByMe', label: '只看我建立的' });
    }
    return chips;
  });

  toggleAdvancedFilters(): void {
    this.advancedFiltersOpen.update((open) => !open);
  }

  /** 移除單一進階條件（小標籤上的 ×）。 */
  clearAdvancedFilter(key: AdvancedFilterKey): void {
    switch (key) {
      case 'updated':
        this.updatedFromDraft.set('');
        this.updatedToDraft.set('');
        break;
      case 'reviewed':
        this.reviewedFromDraft.set('');
        this.reviewedToDraft.set('');
        break;
      case 'batch':
        this.submissionBatchFilter.set('ALL');
        break;
      case 'neverExported':
        this.neverExportedFilter.set(false);
        break;
      case 'createdByMe':
        this.createdByMeFilter.set(false);
        break;
    }
    this.applyFilterChange();
  }
  readonly hasLoadError = computed(() => this.pageState() === 'error');

  /** All columns sort the loaded page; name/date also request the corresponding server order. */
  readonly sortedProducts = computed(() => sortRows(this.filteredProducts(), this.productSort.state()));

  /**
   * 商品名稱欄位的排序箭頭——點擊直接在正序/倒序間切換，不用另外選單
   * 選擇「商品名稱（A→Z）」再選「商品名稱（Z→A）」兩個選項，欄位本身
   * 就是排序目標，箭頭只是方向切換，操作路徑更短。
   */
  toggleNameSort(): void {
    const next: SortOption = this.sortOption() === 'name_asc' ? 'name_desc' : 'name_asc';
    this.updateSort(next);
  }

  toggleFinalScoreSort(): void {
    const next: SortOption = this.sortOption() === 'finalScore_desc' ? 'finalScore_asc' : 'finalScore_desc';
    this.updateSort(next);
  }

  toggleUpdatedAtSort(): void {
    const next: SortOption = this.sortOption() === 'updatedAt_desc' ? 'updatedAt_asc' : 'updatedAt_desc';
    this.updateSort(next);
  }

  ngOnInit(): void {
    this.load();
    this.loadProductTypes();
    this.loadSubmissionBatches();
  }

  // ----- 載入 -----

  /** Mock 模式讀本地資料；真實模式呼叫 GET /api/products 並把篩選送給後端。 */
  load(): void {
    if (this.useMockData) {
      this.resetMockData();
      this.pageState.set('default');
      return;
    }

    this.pageState.set('loading');
    // 'ALL' 是前端的「不篩選」哨兵值，不是後端的合法 enum。
    // 若原樣送出去，Spring 轉 enum 會失敗並回 400。
    const reviewStatus = this.reviewFilter();
    // finalScore 排序不是合法的後端 sort 欄位（見 sortOption 說明），
    // 這個選項一律退回後端預設的 updatedAt,desc，實際的分數排序
    // 交給 sortedProducts() 在前端對目前頁面做。
    // name 則是 Product entity 的真實欄位，Spring Data 的 Pageable/Sort
    // 機制原生支援，不需要額外的後端程式碼就能直接送 name,asc / name,desc。
    let sort: string;
    if (this.sortOption() === 'updatedAt_asc') {
      sort = 'updatedAt,asc';
    } else if (this.sortOption() === 'name_asc') {
      sort = 'name,asc';
    } else if (this.sortOption() === 'name_desc') {
      sort = 'name,desc';
    } else {
      sort = 'updatedAt,desc';
    }

    // ⚠️ 修正：「商品實際分類」篩選之前完全沒有送給後端，選了任何分類都
    // 等同沒選——filteredProducts() 在真實模式下直接回傳 list（假設篩選
    // 都交給後端做），但 load() 從來沒有把 productTypeFilter 塞進查詢參數，
    // 導致這個篩選條件在真實模式下形同虛設。這裡的 select 選項存的是
    // 分類「名稱」（畫面顯示用），後端要的是「id」，用 ProductTypeLookupService
    // 的 id→name 對照表反查一次再送出。
    this.resolveProductTypeId()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((productTypeId) => {
        this.api
          .list({
            // 篩選條件與 CSV 匯出共用同一個組法（currentFilterQuery），兩邊不會對不上。
            ...this.currentFilterQuery(productTypeId),
            reviewStatus: reviewStatus === 'ALL' ? undefined : reviewStatus,
            page: this.pageNumber(),
            size: this.pageSize(),
            sort,
          })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (result) => {
              this.products.set(result.items);
              this.totalElements.set(result.totalElements);
              this.totalPages.set(result.totalPages);
              this.pageState.set(result.items.length === 0 ? 'empty' : 'default');
            },
            error: (err) => {
              this.pageState.set('error');
              this.statusMessageState.show(toApiError(err).message);
            },
          });
      });
  }

  retryLoad(): void {
    this.load();
    this.statusMessageState.show(this.useMockData ? '已恢復本地 Mock 品項。' : '正在重新載入。');
  }

  goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) return;
    this.pageNumber.set(page);
    this.load();
  }

  // ----- 篩選 -----

  /**
   * 篩選變更後要回到第 1 頁。
   *
   * 少了這行會出現典型的分頁 bug：使用者在第 3 頁改篩選條件，
   * 新條件只有 1 頁資料，但請求仍送 page=2，後端回空陣列，
   * 畫面顯示「查無資料」——但其實有資料，只是在第 1 頁。
   */
  private applyFilterChange(): void {
    this.pageNumber.set(0);
    if (!this.useMockData) this.load();
  }

  /**
   * 搜尋框輸入。真實模式交給 searchInput$ 的 debounce 延遲觸發查詢（見上方
   * 說明）；Mock 模式是本地即時過濾，沒有 API 成本，維持立即套用。
   *
   * ⚠️ 分支版本同時在輸入框加了 [disabled]="isLoading()"，會在查詢進行中
   * 把輸入框鎖住、打字打到一半被打斷，跟 debounce 的目的相反，整併時沒有採用。
   */
  updateSearch(value: string): void {
    this.searchTerm.set(value);
    if (this.useMockData) {
      this.applyFilterChange();
      return;
    }
    this.searchInput$.next(value);
  }
  updateReviewFilter(value: string): void {
    this.reviewFilter.set(value as ReviewStatus | 'ALL');
    this.applyFilterChange();
  }
  updateItemFilter(value: string): void {
    this.itemFilter.set(value as ItemStatus | 'ALL');
    this.applyFilterChange();
  }
  updateProductTypeFilter(value: string): void {
    this.productTypeFilter.set(value);
    this.applyFilterChange();
  }

  /**
   * 切換排序。「時間」兩個選項要重新跟後端要資料（改變的是伺服器端排序），
   * 「分數」兩個選項不用重新載入——資料沒變，只是同一批資料換個順序看，
   * sortedProducts() 這個 computed 會自動反映。
   */
  updateSort(value: string): void {
    this.sortOption.set(value as SortOption);
    const separator = value.lastIndexOf('_');
    const key = value.slice(0, separator);
    this.productSort.set(key === 'updatedAt' ? 'updatedAt:date' : key, value.endsWith('_desc') ? 'desc' : 'asc');
    // 原本只有 updatedAt_desc/asc 這兩個分支會觸發 load()，name_asc/desc
    // 是 #4 那批新增的排序選項，卻漏了同步加進這個判斷——導致點擊商品
    // 名稱的排序箭頭，圖示會換、但清單順序從來沒有真的重新抓取過，
    // 使用者會覺得這顆按鈕「按了跟沒按一樣」。這裡補上遺漏的分支。
    if (
      value === 'updatedAt_desc' ||
      value === 'updatedAt_asc' ||
      value === 'name_asc' ||
      value === 'name_desc'
    ) {
      this.pageNumber.set(0);
      if (!this.useMockData) this.load();
    }
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.reviewFilter.set('ALL');
    this.itemFilter.set('ALL');
    this.productTypeFilter.set('ALL');
    this.updatedFromDraft.set('');
    this.updatedToDraft.set('');
    this.submissionBatchFilter.set('ALL');
    this.reviewedFromDraft.set('');
    this.reviewedToDraft.set('');
    this.neverExportedFilter.set(false);
    this.createdByMeFilter.set(false);
    this.statusMessageState.show('已清除所有搜尋與篩選條件。');
    this.applyFilterChange();
  }

  // ----- UI 狀態切換器（demo 用，不呼叫 API）-----

  setPageState(state: PageState): void {
    this.pageState.set(state);
    this.closeDialog();
    if (state === 'empty') this.products.set([]);
    else if (state === 'default' || state === 'locked') this.resetMockData();
    this.statusMessageState.show(
      state === 'error' ? '已模擬資料載入失敗。' : `已切換為 ${state} 狀態。`,
    );
  }

  // ----- 操作 -----

  showFeatureNotice(product: ProductListItem | null, message: string): void {
    this.dialogProduct.set(product);
    this.dialogMode.set('notice');
    this.statusMessageState.show(message);
  }

  requestDelete(product: ProductListItem): void {
    if (!product.actions.canDelete) return;
    this.dialogProduct.set(product);
    this.dialogMode.set('delete');
  }

  confirmDelete(): void {
    const target = this.dialogProduct();
    if (!target || !target.actions.canDelete) return;

    if (this.useMockData) {
      this.products.update((items) => items.filter((item) => item.id !== target.id));
      this.statusMessageState.show(`已從本地 Mock 清單移除「${target.name}」，未呼叫 API。`);
      this.closeDialog();
      return;
    }

    this.api
      .remove(target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.statusMessageState.show(`已刪除「${target.name}」。`);
          this.closeDialog();
          this.load();
        },
        error: (err) => this.handleActionError(err),
      });
  }

  requestResubmit(product: ProductListItem): void {
    this.dialogProduct.set(product);
    this.dialogMode.set('resubmit');
  }

  confirmResubmit(): void {
    const target = this.dialogProduct();
    if (!target || !target.actions.canResubmit) return;

    if (this.useMockData) {
      this.products.update((items) =>
        items.map((item) =>
          item.id === target.id
            ? {
                ...item,
                reviewStatus: 'PENDING' as ReviewStatus,
                submissionCount: item.submissionCount + 1,
                actions: toProductActionAvailability({
                  ...item,
                  reviewStatus: 'PENDING',
                  submissionCount: item.submissionCount + 1,
                }),
              }
            : item,
        ),
      );
      this.statusMessageState.show(`「${target.name}」已模擬重審，未呼叫 API。`);
      this.closeDialog();
      return;
    }

    this.api
      .resubmit(target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.statusMessageState.show(`「${target.name}」已重審。`);
          this.closeDialog();
          this.load();
        },
        error: (err) => this.handleActionError(err),
      });
  }

  closeDialog(): void {
    this.dialogProduct.set(null);
    this.dialogMode.set(null);
  }

  /**
   * 一次性動作的錯誤處理。
   *
   * 409 要單獨處理：代表狀態已被他人變更（或這個動作已經做過一次），
   * 正確反應是提示 + 重新載入，讓畫面回到真實狀態，
   * 而不是顯示通用錯誤讓使用者對著過期的按鈕繼續點。
   */
  private handleActionError(err: unknown): void {
    const error = toApiError(err);
    this.statusMessageState.show(
      error.status === 409 ? `${error.message}（已重新載入最新狀態）` : error.message,
    );
    this.closeDialog();
    if (error.status === 409) this.load();
  }

  // ----- 顯示輔助 -----

  /**
   * 是否顯示「資料待補」。
   *
   * ⚠️ 一定要先判斷 hasScoreData。樣板若直接寫 `dataCompleteness < 60`，
   * 值為 null 時 `null < 60` 在 JavaScript 是 true，
   * 會讓每一列都顯示「資料待補」——把「後端沒回這個欄位」
   * 誤報成「這個商品資料不完整」，是會誤導採購決策的假訊息。
   */
  isIncomplete(product: ProductListItem): boolean {
    return product.hasScoreData && isDataIncomplete(product.dataCompleteness);
  }

  /** 分數與完整度欄位是否有資料可顯示；false 時整欄顯示「—」。 */
  hasScore(product: ProductListItem): boolean {
    return product.hasScoreData;
  }

  deleteDisabledReason(p: ProductListItem): string {
    if (p.itemStatus === 'ARCHIVED') return '已封存，無法刪除';
    // 2026-09-24：submissionCount 1 起算，> 1 代表曾被審核（拒絕後重送），與後端刪除條件一致。
    if (p.submissionCount > 1) return '已審核過，不可刪除';
    return '僅尚未審核過的商品可刪除';
  }

  reviewStatusLabel(s: ReviewStatus): string {
    return REVIEW_STATUS_LABEL[s];
  }
  itemStatusLabel(s: ItemStatus): string {
    return ITEM_STATUS_LABEL[s];
  }
  pricingTypeLabel(t: 'NEW' | 'RESALE'): string {
    return PRICING_TYPE_LABEL[t];
  }

  private resetMockData(): void {
    this.products.set(MOCK_PRODUCTS.map((p) => ({ ...p })));
    this.totalElements.set(MOCK_PRODUCTS.length);
    this.totalPages.set(1);
  }

}

/** 下載檔名：審核通過商品_20260925-1530.csv（本地時間）。 */
function exportFilename(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `審核通過商品_${stamp}.csv`;
}
