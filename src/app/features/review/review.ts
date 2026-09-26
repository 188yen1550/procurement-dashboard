/**
 * 檔案用途：管理人員的待審清單與決策紀錄。
 * 待審清單預設顯示 PENDING＋ACTIVE；分類名稱由設定資料對照，分數、完整度與
 * 建立者名稱由待審 API 提供。核准只代表選品決策，不代表上架或銷售。
 */
import {
  ListSort,
  SortHeader,
  SortRowsPipe,
  ListSortControls,
  sortRows,
} from '../../shared/ui/list-sort';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { ItemStatus, ReviewStatus } from '../../core/domain/enums';
import { REVIEW_DECISION_LABEL, REVIEW_STATUS_LABEL } from '../../core/domain/labels';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { PendingReviewItem } from './api/review.mapper';
import { ReviewApiService } from './api/review-api.service';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';
import { DecisionRecordSortKey } from './api/review-api.contract';

/** 待審清單的顯示模型；尚無評估紀錄時，分數與完整度為 null。 */
export interface ReviewItem {
  id: number;
  name: string;
  /** 待審 API 提供的建立者顯示名稱。 */
  submittedBy: string;
  status: ReviewStatus;
  itemStatus: ItemStatus;
  /** 由 productTypeId 對照設定 API 得來。 */
  category: string;
  /** 尚無評估紀錄時為 null。 */
  finalScore: number | null;
  /** 尚無評估紀錄時為 null。 */
  completeness: number | null;
  submissionCount: number;
  /**
   * 送審時間。V25 起讀後端真正的 submittedAt（編輯不會改變它）；V25 前重新送審過、
   * 無法回填的商品為 null，退回 updatedAt（舊行為）顯示，不讓欄位空白。
   */
  submittedAt: string | null;
}

/** 決策紀錄表格的顯示模型。 */
export interface DecisionRecordRow {
  id: number;
  /**
   * 商品 id。後端 ReviewRecordResponse 本來就有 productId 欄位，
   * 只是先前的 mapper 沒有取用——這裡補上，讓決策紀錄可以連回該商品，
   * 管理層看到「未通過」想追蹤後續，不用自己再去品項管理頁搜尋一次商品名稱。
   */
  productId: number;
  name: string;
  round: number;
  result: 'APPROVED' | 'REJECTED';
  /** 2026-09-17後端補上 reviewerName，不再恆為 null，見 review-api.contract.ts。 */
  reviewer: string | null;
  score: number | null;
  date: string | null;
  comment: string;
}

type ReviewState = 'default' | 'disabled' | 'loading' | 'empty' | 'error';

function mock(
  id: number,
  name: string,
  submittedBy: string,
  status: ReviewStatus,
  itemStatus: ItemStatus,
  category: string,
  finalScore: number,
  completeness: number,
  submissionCount: number,
  submittedAt: string,
): ReviewItem {
  return {
    id,
    name,
    submittedBy,
    status,
    itemStatus,
    category,
    finalScore,
    completeness,
    submissionCount,
    submittedAt,
  };
}

const MOCK: readonly ReviewItem[] = [
  mock(102, '輕量智慧溫控電熱杯', '林小美', 'PENDING', 'ACTIVE', '3C／家電', 81.6, 78, 1, '2026-08-31T09:10:00+08:00'),
  mock(103, '無香低敏濃縮洗衣紙補充組', '陳家豪', 'PENDING', 'ACTIVE', '日用品', 76.1, 88, 2, '2026-08-30T15:25:00+08:00'),
  mock(108, '年節養生堅果禮盒', '林小美', 'PENDING', 'ACTIVE', '精品禮盒', 84.3, 94, 1, '2026-08-29T11:40:00+08:00'),
  mock(109, '已封存測試品項', '陳家豪', 'REJECTED', 'ARCHIVED', '其他', 62, 82, 1, '2026-08-20T10:00:00+08:00'),
];

const MOCK_RECORDS: readonly DecisionRecordRow[] = [
  { id: 501, productId: 101, name: '中秋炭烤海陸組合禮盒', round: 1, result: 'APPROVED', reviewer: '管理員 王主任', score: 92.4, date: '2026/08/28', comment: '節慶需求明確，確認冷鏈排程後通過。' },
  { id: 502, productId: 106, name: '可機洗抗菌涼感被', round: 1, result: 'REJECTED', reviewer: '管理員 李經理', score: 69.5, date: '2026/08/24', comment: '供應穩定性不足，請補充備援方案。' },
];

/**
 * 決策紀錄排序欄位 → Mock 模式下本地排序用的列欄位。
 * 真實模式排序交給後端（API 欄位名稱），Mock 沒有後端，只能對 DecisionRecordRow
 * 本地排序，兩邊欄位名稱不同，在這裡集中對照一次。
 */
const RECORD_SORT_ROW_FIELD: Record<DecisionRecordSortKey, string> = {
  reviewedAt: 'date:date',
  submissionCount: 'round',
  finalScore: 'score',
};

const DEFAULT_RECORD_SORT_KEY: DecisionRecordSortKey = 'reviewedAt';

/** 'yyyy/MM/dd'（Mock）或 ISO 日期時間（後端）→ 'yyyy-MM-dd'，供日期區間比較。 */
function toDateKey(value: string | null): string {
  return (value ?? '').replaceAll('/', '-').slice(0, 10);
}

/** PendingReviewItem（後端）→ ReviewItem（畫面）。export 僅供單元測試。 */
export function toReviewItem(item: PendingReviewItem): ReviewItem {
  return {
    id: item.id,
    name: item.name,
    // V25：送審人以真正的送審人為準（重新送審時可能不是原建立者），缺值時退回建立者。
    submittedBy: item.submittedByName ?? item.createdByName,
    status: item.reviewStatus,
    itemStatus: item.itemStatus,
    category: item.productTypeName,
    finalScore: item.finalScore,
    completeness: item.dataCompleteness,
    submissionCount: item.submissionCount,
    submittedAt: item.submittedAt ?? item.updatedAt,
  };
}

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [ListSortControls, SortHeader, SortRowsPipe, CommonModule, FormsModule, RouterLink],
  templateUrl: './review.html',
  styleUrl: './review.scss',
})
export class ReviewComponent implements OnInit {
  readonly pendingSort = new ListSort();
  /**
   * 2026-09-24：只保留數值型排序。商品名稱、分類、送審人、送審時間、狀態改由
   * 上方篩選列處理（搜尋、分類、送審日期、狀態下拉），不再重複提供排序。
   */
  readonly pendingSortChoices = [
    { key: 'finalScore', label: '最終分數' },
    { key: 'completeness', label: '完整度' },
    { key: 'submissionCount', label: '送審次數' },
  ];
  /**
   * 決策紀錄排序（2026-09-24 改為伺服器端排序）：key 直接是 API 的 sort 欄位
   * （DecisionRecordSortKey）。原本表頭排序只排「當頁 20 筆」，跨頁順序不一致；
   * 現在點表頭會觸發 onChange → 回第 1 頁重新查詢。預設審核時間新到舊，
   * 「審核時間」本身不提供表頭排序（改為日期區間篩選）。
   */
  readonly recordTableSort = new ListSort(DEFAULT_RECORD_SORT_KEY, 'desc', () =>
    this.onRecordQueryChange(),
  );
  private readonly api = inject(ReviewApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  readonly useMockData = APP_CONFIG.useMockData;

  readonly stateOptions: readonly ReviewState[] = ['default', 'disabled', 'loading', 'empty', 'error'];
  readonly pageState = signal<ReviewState>('default');
  readonly items = signal<ReviewItem[]>([]);
  readonly records = signal<DecisionRecordRow[]>([]);

  // ----- 歷次決策紀錄：搜尋／篩選／排序 -----
  // 2026-09-24：搜尋、審核結果、審核日期、排序全部交給後端（見
  // loadDecisionRecords()）。原本關鍵字與排序只作用在當頁 20 筆，另外還殘留一層
  // 沒有 UI 的 recordSort（固定日期新到舊）跟表頭排序疊在一起，已一併移除。
  readonly recordSearch = signal('');
  readonly recordResultFilter = signal<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  /** 審核日期區間（yyyy-MM-dd，兩端皆含當天）。 */
  readonly recordReviewedFrom = signal('');
  readonly recordReviewedTo = signal('');

  /**
   * 真實模式：後端已經篩選、排序完成，直接顯示。
   * Mock 模式：沒有後端，在這裡用同一套條件本地篩選與排序，行為與真實模式對齊。
   */
  readonly filteredRecords = computed(() => {
    const records = this.records();
    if (!this.useMockData) return records;

    const keyword = this.recordSearch().trim().toLocaleLowerCase('zh-Hant');
    const result = this.recordResultFilter();
    const from = this.recordReviewedFrom();
    const to = this.recordReviewedTo();
    const list = records.filter(
      (r) =>
        (!keyword || r.name.toLocaleLowerCase('zh-Hant').includes(keyword)) &&
        (result === 'ALL' || r.result === result) &&
        (!from || toDateKey(r.date) >= from) &&
        (!to || toDateKey(r.date) <= to),
    );
    const { key, direction } = this.recordTableSort.state();
    const rowField = RECORD_SORT_ROW_FIELD[key as DecisionRecordSortKey];
    return rowField ? sortRows(list, { key: rowField, direction }) : list;
  });

  /** 審核日期起日晚於迄日：不送出查詢（後端同樣會回 400），直接在篩選列提示。 */
  readonly recordDateRangeInvalid = computed(
    () =>
      !!this.recordReviewedFrom() &&
      !!this.recordReviewedTo() &&
      this.recordReviewedFrom() > this.recordReviewedTo(),
  );

  /**
   * 關鍵字的節流管道，做法與 product-management.ts 的 searchInput$ 相同：
   * 畫面文字即時更新，停手 300ms 才打一次 API；刻意不加 distinctUntilChanged()，
   * 理由見該檔說明（清除後再輸入相同關鍵字會被吞掉）。
   */
  private readonly recordSearchInput$ = new Subject<string>();
  /** 進行中的決策紀錄查詢；新查詢送出前先取消，避免較慢的舊回應覆蓋新結果。 */
  private recordRequest?: Subscription;
  /** 待審清單查詢：新條件送出時取消上一個尚未回來的請求，避免舊結果晚到覆蓋新結果。 */
  private pendingRequest?: Subscription;

  updateRecordSearch(value: string): void {
    this.recordSearch.set(value);
    if (!this.useMockData) this.recordSearchInput$.next(value);
  }

  updateRecordReviewedFrom(value: string): void {
    this.recordReviewedFrom.set(value ?? '');
    this.onRecordQueryChange();
  }

  updateRecordReviewedTo(value: string): void {
    this.recordReviewedTo.set(value ?? '');
    this.onRecordQueryChange();
  }

  /** 任一查詢條件（含排序）改變：回到第 1 頁並重新查詢；Mock 由 filteredRecords() 即時反映。 */
  onRecordQueryChange(): void {
    this.recordPageNumber.set(0);
    if (!this.useMockData) this.loadDecisionRecords();
  }

  clearRecordFilters(): void {
    this.recordTableSort.set(DEFAULT_RECORD_SORT_KEY, 'desc');
    this.recordSearch.set('');
    this.recordResultFilter.set('ALL');
    this.recordReviewedFrom.set('');
    this.recordReviewedTo.set('');
    this.onRecordQueryChange();
  }
  readonly query = signal('');
  /**
   * 審核狀態／品項狀態：真實模式下後端固定只回「未審核＋使用中」，這兩個下拉只在 Mock 模式
   * 顯示（2026-09-26，見 review.html）。選了其他值只會把當頁濾空、分頁卻還顯示有下一頁。
   */
  readonly reviewFilter = signal<'ALL' | ReviewStatus>('PENDING');
  readonly itemFilter = signal<'ALL' | ItemStatus>('ACTIVE');
  /**
   * 分類／送審日期區間。
   *
   * 2026-09-26 修正（待審清單分頁錯亂）：搜尋、分類、送審日期原本只在前端篩「當頁 20 筆」，
   * 分頁資訊卻是未篩選的全量，造成「第 1 頁不足 20 筆，第 2 頁仍有資料」。真實模式改由後端
   * 篩選（loadPendingItems() 帶入條件），條件變更時回到第 1 頁重新查詢；Mock 模式沒有後端，
   * 維持本地篩選（見 filtered）。
   *
   * categoryFilter：真實模式存子類 id（字串，'ALL'＝全部），選項來自完整品類清單；
   * Mock 模式存分類名稱，選項來自 Mock 資料。
   */
  readonly categoryFilter = signal('ALL');
  readonly submittedFrom = signal('');
  readonly submittedTo = signal('');
  /** 真實模式的分類選項：完整的大類／子類清單（跟目前頁面有哪些商品無關）。 */
  readonly groupedCategoryOptions = signal<{ major: { id: number; name: string }; minors: { id: number; name: string }[] }[]>([]);
  /** 送審日期起日晚於迄日：不送查詢（後端同樣回 400），在篩選列提示。 */
  readonly pendingDateRangeInvalid = computed(
    () => !!this.submittedFrom() && !!this.submittedTo() && this.submittedFrom() > this.submittedTo(),
  );
  /** 是否有任何會縮小結果的條件（空結果時決定顯示「找不到符合」或「目前沒有」）。 */
  readonly hasPendingFilters = computed(
    () => !!this.query().trim() || this.categoryFilter() !== 'ALL' || !!this.submittedFrom() || !!this.submittedTo(),
  );
  private readonly pendingSearchInput$ = new Subject<string>();
  /**
   * 預設待審清單；但從 product-detail 的「返回歷次決策紀錄」連結回來時
   * （見 product-detail.html／product-detail.ts 的 returnTo），會帶
   * ?tab=records，這裡要開在決策紀錄頁籤，不能讓使用者回到這頁卻又要
   * 手動點一次頁籤才找得到剛剛看的那筆紀錄。
   */
  readonly view = signal<'pending' | 'records'>(
    this.route.snapshot.queryParamMap.get('tab') === 'records' ? 'records' : 'pending',
  );
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly totalElements = signal(0);
  // 2026-09-16修正：待審清單原本只抓 page 0、size 20，totalElements 雖然
  // 有正確從後端拿回來，但沒有任何畫面元素讀取，也沒有分頁按鈕，使用者
  // 永遠只看得到第 1 頁——跟 product-management.ts 先前的分頁 bug是同一種
  // 模式。補上 pageNumber／totalPages／goToPage()。
  readonly pageNumber = signal(0);
  readonly totalPages = signal(0);

  /**
   * 決策紀錄的分頁——review.html 的分頁列（recordPageNumber／recordTotalPages／
   * goToRecordPage）原本就寫好了，但 loadDecisionRecords() 從來沒有讀取／回填
   * 分頁狀態，一直是寫死 page:0，跟待審清單先前修過的是同一種缺口，這裡一併補上。
   */
  readonly recordPageNumber = signal(0);
  readonly recordTotalPages = signal(0);
  /**
   * 決策紀錄總筆數。2026-09-24 修正：loadDecisionRecords() 原本寫入待審清單
   * 共用的 totalElements，待審清單分頁顯示的「共 N 筆」會依兩支 API 誰晚回來
   * 而變成決策紀錄的筆數，這裡拆成獨立訊號。
   */
  readonly recordTotalElements = signal(0);

  constructor() {
    this.recordSearchInput$
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.onRecordQueryChange());
    // 待審清單關鍵字：同決策紀錄，停手 300ms 才查詢。
    this.pendingSearchInput$
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.onPendingQueryChange());

    // 自動消失邏輯已內建在 createDismissibleMessage() 裡，不需要另外註冊監看。
    // 原地重新點擊「選品審核」連結時 ngOnInit() 不會再被觸發，要靠這裡
    // 才能重新抓最新待審清單。Mock 模式不套用，避免重置展示狀態。
    if (!this.useMockData) reloadOnRevisit(() => this.load());
  }

  isLoading = false;

  /**
   * ⚠️ 真實模式下 GET /api/reviews/pending **已經是 PENDING + ACTIVE**，
   * 後端寫死了條件、不吃篩選參數。前端這裡再濾一次對真實資料是無害的，
   * 但要知道：切換成 ALL 也不會出現已審核的商品，因為後端根本沒回。
   * 篩選器在真實模式下只對關鍵字有實際作用。
   */
  readonly filtered = computed(() => {
    // 2026-09-26：真實模式的條件已在後端套用，這裡不再二次篩選（否則又會回到「當頁被濾掉、
    // 分頁卻不變」的問題）。以下本地篩選只服務 Mock 模式。
    if (!this.useMockData) return this.items();
    const keyword = this.query().trim().toLocaleLowerCase('zh-Hant');
    const category = this.categoryFilter();
    const from = this.submittedFrom();
    const to = this.submittedTo();
    return this.items().filter(
      (item) =>
        (!keyword ||
          item.name.toLocaleLowerCase('zh-Hant').includes(keyword) ||
          (item.submittedBy ?? '').toLocaleLowerCase('zh-Hant').includes(keyword)) &&
        (this.reviewFilter() === 'ALL' || item.status === this.reviewFilter()) &&
        (this.itemFilter() === 'ALL' || item.itemStatus === this.itemFilter()) &&
        (category === 'ALL' || item.category === category) &&
        // submittedAt 是 ISO 日期時間字串，只取日期部分（前10碼）跟
        // <input type="date"> 的 yyyy-MM-dd 格式比較字串大小即可，
        // 不需要真的解析成 Date——ISO 格式本身可以直接字典序比較。
        (!from || (item.submittedAt ?? '').slice(0, 10) >= from) &&
        (!to || (item.submittedAt ?? '').slice(0, 10) <= to),
    );
  });

  /** 分類設定下拉的選項清單：從目前已載入的待審清單裡取不重複的分類，依字母排序。 */
  readonly categoryOptions = computed(() => {
    const categories = new Set(this.items().map((item) => item.category).filter((c) => !!c));
    return Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  });

  ngOnInit(): void {
    this.load();
    if (!this.useMockData) {
      this.productTypeLookup
        .getGroupedOptions()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((groups) => this.groupedCategoryOptions.set(groups));
    }
  }

  // ----- 待審清單篩選（2026-09-26 改後端篩選）-----

  updatePendingQuery(value: string): void {
    this.query.set(value ?? '');
    if (this.useMockData) return;
    this.pendingSearchInput$.next(this.query());
  }

  updateCategoryFilter(value: string): void {
    this.categoryFilter.set(value ?? 'ALL');
    this.onPendingQueryChange();
  }

  updateSubmittedFrom(value: string): void {
    this.submittedFrom.set(value ?? '');
    this.onPendingQueryChange();
  }

  updateSubmittedTo(value: string): void {
    this.submittedTo.set(value ?? '');
    this.onPendingQueryChange();
  }

  /** 篩選條件變更：回到第 1 頁重新查詢（沿用舊頁碼可能超出新條件下的總頁數）。 */
  private onPendingQueryChange(): void {
    if (this.useMockData) return;
    this.pageNumber.set(0);
    this.loadPendingItems(false);
  }

  // ----- 載入 -----

  load(): void {
    if (this.useMockData) {
      this.resetMock();
      return;
    }
    this.loadPendingItems();
    this.loadDecisionRecords();
  }

  /**
   * GET /api/reviews/pending [僅管理]
   *
   * ⚠️ 403 要與 401 分開處理：403 代表已登入但角色不是 MANAGER，
   * 導回登入頁沒有意義（重登也不會變成 MANAGER）。Route Guard 應該先擋掉，
   * 但後端這道才是真正有效的防線，所以這裡仍要正確顯示。
   */
  /**
   * @param showSkeleton 初次載入／重新整理顯示整頁骨架；篩選或換頁時為 false，保留篩選列
   *                     （骨架會把篩選列整個換掉，打字到一半輸入框會消失、失去焦點）。
   */
  loadPendingItems(showSkeleton = true): void {
    if (this.pendingDateRangeInvalid()) {
      // 篩選列已顯示提示；維持上次結果，不送出必定 400 的查詢。
      return;
    }
    this.pendingRequest?.unsubscribe();
    this.isLoading = true;
    if (showSkeleton) this.pageState.set('loading');
    const category = this.categoryFilter();

    this.pendingRequest = this.api
      // V25：依真正的送審時間排序（原本 updatedAt，任何編輯都會把商品往前推）。
      .listPending({
        page: this.pageNumber(),
        size: 20,
        sort: 'submittedAt,desc',
        keyword: this.query().trim() || undefined,
        productTypeId: category === 'ALL' ? undefined : Number(category),
        submittedFrom: this.submittedFrom() || undefined,
        submittedTo: this.submittedTo() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.items.set(result.items.map(toReviewItem));
          this.totalElements.set(result.totalElements);
          this.totalPages.set(result.totalPages);
          this.isLoading = false;
          // 有篩選條件時 0 筆是「找不到符合」，不是「沒有待審品項」：維持 default，
          // 讓篩選列留在畫面上，由樣板顯示「找不到符合」。
          this.pageState.set(result.items.length === 0 && !this.hasPendingFilters() ? 'empty' : 'default');
        },
        error: (err) => {
          this.isLoading = false;
          const error = toApiError(err);
          this.pageState.set(error.status === 403 ? 'disabled' : 'error');
          this.statusMessageState.show(
            error.status === 403 ? '您的角色沒有選品審核權限。' : error.message,
          );
        },
      });
  }

  /** 待審清單分頁：切頁時重新呼叫 API，不是在前端切已抓回來的資料。 */
  goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages() || this.isLoading) return;
    this.pageNumber.set(page);
    this.loadPendingItems(false);
  }

  /** GET /api/reviews/decision-records [僅管理]。失敗只讓紀錄分頁降級，不影響待審清單。 */
  loadDecisionRecords(): void {
    this.recordRequest?.unsubscribe();
    if (this.recordDateRangeInvalid()) {
      // 篩選列已顯示錯誤提示；維持畫面上次的結果，不送出必定 400 的查詢。
      return;
    }
    const reviewResult = this.recordResultFilter();
    const { key, direction } = this.recordTableSort.state();
    this.recordRequest = this.api
      .listDecisionRecords({
        page: this.recordPageNumber(),
        size: 20,
        sort: `${key as DecisionRecordSortKey},${direction}`,
        reviewResult: reviewResult === 'ALL' ? undefined : reviewResult,
        keyword: this.recordSearch().trim() || undefined,
        reviewedFrom: this.recordReviewedFrom() || undefined,
        reviewedTo: this.recordReviewedTo() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.recordTotalElements.set(result.totalElements);
          this.recordTotalPages.set(result.totalPages);
          this.records.set(
            result.items.map((record) => ({
              id: record.id,
              productId: record.productId,
              name: record.productName,
              round: record.submissionCount ?? 1,
              result: record.reviewStatus,
              reviewer: record.reviewerName,
              score: record.finalScore,
              date: record.reviewedAt,
              // 2026-09-20：otherRiskNote 現在是後端獨立欄位（見 review.mapper.ts），
              // 這裡沿用先前併入 reviewComment 的顯示格式組出 comment，
              // 只是資料來源改變——決策紀錄表格畫面不用跟著改。
              comment: record.otherRiskNote
                ? `${record.reviewComment}\n【其他風險說明】${record.otherRiskNote}`
                : record.reviewComment,
            })),
          );
        },
        error: (err) => {
          this.records.set([]);
          this.recordTotalElements.set(0);
          this.recordTotalPages.set(0);
          // 原本失敗時只清空表格、沒有任何提示，使用者會誤以為「查無資料」。
          this.statusMessageState.show(`決策紀錄載入失敗：${toApiError(err).message}`);
        },
      });
  }

  /** 決策紀錄分頁：切頁時重新呼叫 API，比照 goToPage() 對待審清單的既有做法。 */
  goToRecordPage(page: number): void {
    if (page < 0 || page >= this.recordTotalPages() || this.useMockData) return;
    this.recordPageNumber.set(page);
    this.loadDecisionRecords();
  }

  /**
   * 審核結果篩選改變時：真實模式要重新呼叫 API（後端才是真正篩選的地方，
   * 見 loadDecisionRecords() 的說明）；Mock 模式維持原本的純前端篩選，
   * 不需要重新載入。
   */
  updateRecordResultFilter(value: 'ALL' | 'APPROVED' | 'REJECTED'): void {
    this.recordResultFilter.set(value);
    // 換篩選條件時重置回第一頁：沿用舊頁碼可能超出新篩選條件下的總頁數。
    this.onRecordQueryChange();
  }

  retry(): void {
    if (this.useMockData) this.resetMock();
    else this.load();
  }

  // ----- 篩選 -----

  clearFilters(): void {
    this.query.set('');
    this.reviewFilter.set('PENDING');
    this.itemFilter.set('ACTIVE');
    this.categoryFilter.set('ALL');
    this.submittedFrom.set('');
    this.submittedTo.set('');
    this.onPendingQueryChange();
    this.statusMessageState.show('已恢復預設篩選：未審核＋使用中。');
  }

  // ----- UI 狀態切換器（demo 用，不呼叫 API）-----

  setState(state: ReviewState): void {
    this.pageState.set(state);
    if (state === 'empty') {
      this.items.set([]);
    } else if (!this.items().length && state !== 'error') {
      this.resetMock();
      this.pageState.set(state);
    }
    this.statusMessageState.show(`已切換為 ${state} 狀態。`);
  }

  resetMock(): void {
    this.items.set(MOCK.map((item) => ({ ...item })));
    this.records.set(MOCK_RECORDS.map((record) => ({ ...record })));
    this.totalElements.set(MOCK.length);
    this.recordTotalElements.set(MOCK_RECORDS.length);
    this.pageState.set('default');
    this.statusMessageState.show('已恢復待審核 Mock 清單。');
  }

  // ----- 顯示輔助 -----

  decisionLabel(result: 'APPROVED' | 'REJECTED'): string {
    return REVIEW_DECISION_LABEL[result];
  }

  /** 走 core/domain/labels.ts，與品項清單、詳情頁共用同一份文案。 */
  reviewStatusLabel(status: ReviewStatus): string {
    return REVIEW_STATUS_LABEL[status];
  }

  /** 只有未審核且使用中的品項可以進入審核頁；與後端的前置條件一致。 */
  canReview(item: ReviewItem): boolean {
    return (
      this.pageState() !== 'disabled' && item.status === 'PENDING' && item.itemStatus === 'ACTIVE'
    );
  }

  // approve()/reject() 不在這裡：後端沒有 /api/review/approve 或 /reject，
  // 決策是統一的 POST /api/reviews（body 帶 reviewStatus），
  // 且必須先跑 validateReviewForm() 的三條規則，流程在 review-detail 頁。
}

export { ReviewComponent as Review };
