/**
 * 檔案用途：正式候選 CANDIDATE 商品主清單、篩選及生命週期操作。
 * AI_SUGGESTED 不在主清單顯示；刪除只允許未審核且從未送審者。
 *
 * ## 這次改寫做了什麼
 *
 * 1. 移除 inject(HttpClient)，改注入 ProductApiService。
 *    原本這個元件與 product-api.ts 各有一份 `/api/products` 的呼叫程式，
 *    contract 一改要改兩處，遲早漏掉。
 *
 * 2. 本地 Product 介面刪除，改用 mapper 的 ProductListItem。
 *    舊介面的 productType（字串名稱）、finalScore、dataCompleteness、
 *    hasReviewRecord 四個欄位後端 ProductResponse 都沒有，是憑空設計的。
 *
 * 3. 篩選改由後端負責。原本是抓全部再前端 filter，
 *    後端已支援 keyword／三種狀態／類型 + 分頁，前端再 filter 一次
 *    會讓分頁完全失效（第 1 頁 20 筆過濾後剩 3 筆，使用者以為只有 3 筆）。
 *    Mock 模式維持前端過濾，因為那裡沒有後端可用。
 *
 * ## 保留的部分
 * 四大 UI 狀態切換器與本地 Mock 完全保留——那是成員 C 的既有交付，
 * demo 仰賴它，不因為接了 API 就砍掉。
 */
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { AuthService } from '../../core/auth/auth';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { ItemStatus, ReviewStatus } from '../../core/domain/enums';
import {
  ITEM_STATUS_LABEL,
  PRICING_TYPE_LABEL,
  REVIEW_STATUS_LABEL,
  isDataIncomplete,
} from '../../core/domain/labels';
import { ProductApiService } from './api/product-api.service';
import { ProductListItem, toProductActionAvailability } from './api/product.mapper';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';

export type PageState = 'default' | 'locked' | 'loading' | 'empty' | 'error';
export type SortOption =
  | 'updatedAt_desc'
  | 'updatedAt_asc'
  | 'finalScore_desc'
  | 'finalScore_asc'
  | 'name_asc'
  | 'name_desc';

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
  candidateStatus: 'CANDIDATE' | 'AI_SUGGESTED',
  updatedAt: string,
  submissionCount: number,
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
    actions: toProductActionAvailability({
      reviewStatus,
      itemStatus,
      candidateStatus,
      submissionCount,
    }),
  };
}

const MOCK_PRODUCTS: readonly ProductListItem[] = [
  mockItem(101, '中秋炭烤海陸組合禮盒', '食品／生鮮', 'RESALE', '潮港鮮物有限公司', 92.4, 96, 'APPROVED', 'ACTIVE', 'CANDIDATE', '2026-08-31T09:25:00+08:00', 1),
  mockItem(102, '輕量智慧溫控電熱杯', '3C／家電', 'NEW', '沐光科技', 81.6, 78, 'PENDING', 'ACTIVE', 'CANDIDATE', '2026-08-30T16:40:00+08:00', 0),
  mockItem(103, '無香低敏濃縮洗衣紙補充組', '日用品', 'RESALE', '淨好生活實業', 74.8, 88, 'REJECTED', 'ACTIVE', 'CANDIDATE', '2026-08-29T11:15:00+08:00', 1),
  mockItem(104, '超輕量折疊收納推車', '生活雜貨', 'NEW', '簡居創意工坊', null, 48, 'PENDING', 'ACTIVE', 'CANDIDATE', '2026-08-28T14:08:00+08:00', 0),
  mockItem(105, '敏弱肌保濕修護組', '美妝保養', 'RESALE', '禾心生技', 86.2, 100, 'APPROVED', 'ARCHIVED', 'CANDIDATE', '2026-08-26T10:30:00+08:00', 1),
  mockItem(106, '可機洗抗菌涼感被', '寢具家用', 'RESALE', '眠好家紡織', null, 55, 'REJECTED', 'ARCHIVED', 'CANDIDATE', '2026-08-24T13:50:00+08:00', 2),
  mockItem(107, '旅行用全能轉接充電器', '3C／家電', 'RESALE', '沐光科技', 79.1, 82, 'PENDING', 'ACTIVE', 'AI_SUGGESTED', '2026-08-31T07:10:00+08:00', 0),
];

@Component({
  selector: 'app-product-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './product-management.html',
  styleUrls: ['./product-management.scss', './product-management-actions.scss'],
})
export class ProductManagement implements OnInit {
  private readonly api = inject(ProductApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly useMockData = APP_CONFIG.useMockData;

  /**
   * 管理層的職責是全面掌握審核狀況，預設看全部；操作層的日常工作是
   * 盯著自己送出去的東西有沒有結果，預設只看待審核——這是初始篩選值
   * 的角色差異，使用者仍然可以自行切換篩選條件，不是鎖死的權限限制。
   */
  readonly isManager = computed(() => this.auth.isManager());

  readonly products = signal<ProductListItem[]>([]);
  readonly pageState = signal<PageState>('default');
  readonly searchTerm = signal('');
  readonly reviewFilter = signal<ReviewStatus | 'ALL'>(this.auth.isManager() ? 'ALL' : 'PENDING');
  readonly itemFilter = signal<ItemStatus | 'ALL'>('ALL');
  readonly productTypeFilter = signal('ALL');
  // date input 原生格式是 'YYYY-MM-DD'，送給後端前補上時分秒——起始日補
  // 00:00:00、結束日補 23:59:59，這樣「選同一天」才會真的涵蓋當天全部
  // 範圍，不是後端拿到年月日相同的兩個時間點做 >= / <= 比對後篩出 0 筆。
  readonly updatedFromDraft = signal('');
  readonly updatedToDraft = signal('');

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

  constructor() {
    // 自動消失邏輯已內建在 createDismissibleMessage() 裡，不需要另外註冊監看。
    // 使用者原地重新點擊「品項管理」連結時 ngOnInit() 不會再被觸發，
    // 要靠這裡才能重新抓最新清單。Mock 模式不套用，避免每次點擊都把
    // 使用者正在操作的展示狀態（篩選、Demo 狀態切換）重置掉。
    if (!this.useMockData) reloadOnRevisit(() => { this.load(); this.loadProductTypes(); });
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
      this.productTypeFilter() !== 'ALL',
  );
  readonly isLoading = computed(() => this.pageState() === 'loading');
  readonly hasLoadError = computed(() => this.pageState() === 'error');

  /**
   * 分數排序只作用在目前這一頁已載入的資料，不是全體品項——見上方
   * sortOption 的說明。時間排序已經由後端 Pageable Sort 排好，這裡不用
   * 再排一次（真實模式再排一次也不會錯，只是白工；Mock 模式本來就要
   * 靠這裡排，因為 Mock 資料沒有經過任何後端排序）。
   */
  readonly sortedProducts = computed(() => {
    const list = this.filteredProducts();
    const sort = this.sortOption();
    if (sort === 'finalScore_desc' || sort === 'finalScore_asc') {
      const direction = sort === 'finalScore_desc' ? -1 : 1;
      return [...list].sort((a, b) => {
        // 尚無分數的品項一律排到最後面，不管是遞增還遞減排序，
        // 不要讓「沒有分數」跟「分數是 0」混在一起排序，語意不同。
        if (a.finalScore === null && b.finalScore === null) return 0;
        if (a.finalScore === null) return 1;
        if (b.finalScore === null) return -1;
        return (a.finalScore - b.finalScore) * direction;
      });
    }
    if (sort === 'updatedAt_asc' && this.useMockData) {
      return [...list].sort((a, b) => {
        const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return at - bt;
      });
    }
    // name 排序在真實模式下由後端 Pageable/Sort 處理，這裡的分支只服務
    // Mock 模式（本地固定陣列，沒有後端可以幫忙排序）。
    if ((sort === 'name_asc' || sort === 'name_desc') && this.useMockData) {
      const direction = sort === 'name_asc' ? 1 : -1;
      return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') * direction);
    }
    return list;
  });

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
    const itemStatus = this.itemFilter();
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
    const productTypeName = this.productTypeFilter();
    this.productTypeLookup
      .getNameMap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((nameById) => {
        const productTypeId =
          productTypeName === 'ALL'
            ? undefined
            : [...nameById.entries()].find(([, name]) => name === productTypeName)?.[0];

        this.api
          .list({
            keyword: this.searchTerm().trim() || undefined,
            reviewStatus: reviewStatus === 'ALL' ? undefined : reviewStatus,
            itemStatus: itemStatus === 'ALL' ? undefined : itemStatus,
            productTypeId,
            updatedFrom: this.updatedFromDraft() ? `${this.updatedFromDraft()}T00:00:00` : undefined,
            updatedTo: this.updatedToDraft() ? `${this.updatedToDraft()}T23:59:59` : undefined,
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

  updateSearch(value: string): void {
    this.searchTerm.set(value);
    this.applyFilterChange();
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
      this.statusMessageState.show(`「${target.name}」已模擬重新送審，未呼叫 API。`);
      this.closeDialog();
      return;
    }

    this.api
      .resubmit(target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.statusMessageState.show(`「${target.name}」已重新送審。`);
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
    if (p.submissionCount > 0) return '已送審過，不可刪除';
    return '僅未審核且從未送審者可刪除';
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
