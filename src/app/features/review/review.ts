/**
 * 檔案用途：管理人員的待審清單與決策紀錄。
 * 待審清單預設顯示 PENDING＋ACTIVE；分類名稱由設定資料對照，分數、完整度與
 * 建立者名稱由待審 API 提供。核准只代表選品決策，不代表上架或銷售。
 */
import { ListSort, SortHeader, SortRowsPipe, ListSortControls } from '../../shared/ui/list-sort';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../core/api/api-error';
import { APP_CONFIG } from '../../core/config/app-config';
import { ItemStatus, ReviewStatus } from '../../core/domain/enums';
import { REVIEW_DECISION_LABEL, REVIEW_STATUS_LABEL } from '../../core/domain/labels';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { PendingReviewItem } from './api/review.mapper';
import { ReviewApiService } from './api/review-api.service';

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
  /** ⚠️ 實際是 updatedAt。ProductResponse 沒有「送審時間」這個欄位。 */
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
  /** ⚠️ 恆為 null：ReviewRecordResponse 只有 reviewerId，無姓名。 */
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

/** PendingReviewItem（後端）→ ReviewItem（畫面）。 */
function toReviewItem(item: PendingReviewItem): ReviewItem {
  return {
    id: item.id,
    name: item.name,
    submittedBy: item.createdByName,
    status: item.reviewStatus,
    itemStatus: item.itemStatus,
    category: item.productTypeName,
    finalScore: item.finalScore,
    completeness: item.dataCompleteness,
    submissionCount: item.submissionCount,
    submittedAt: item.updatedAt,
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
  readonly pendingSortChoices = [
    { key: 'name', label: '商品名稱' },
    { key: 'submittedBy', label: '送審人' },
    { key: 'finalScore', label: '最終分數' },
    { key: 'completeness', label: '完整度' },
    { key: 'submissionCount', label: '送審次數' },
  ];
  readonly recordTableSort = new ListSort();
  private readonly api = inject(ReviewApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly useMockData = APP_CONFIG.useMockData;

  readonly stateOptions: readonly ReviewState[] = ['default', 'disabled', 'loading', 'empty', 'error'];
  readonly pageState = signal<ReviewState>('default');
  readonly items = signal<ReviewItem[]>([]);
  readonly records = signal<DecisionRecordRow[]>([]);

  // ----- 歷次決策紀錄：搜尋／篩選／排序 -----
  readonly recordSearch = signal('');
  readonly recordResultFilter = signal<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  readonly recordSort = signal<'date_desc' | 'date_asc' | 'score_desc' | 'score_asc'>('date_desc');

  readonly filteredRecords = computed(() => {
    const keyword = this.recordSearch().trim().toLocaleLowerCase('zh-Hant');
    // resultFilter 不在這裡再篩一次：真實模式下 loadDecisionRecords() 已經把
    // recordResultFilter 當成查詢參數送給後端了，這裡再篩會跟 product-management.ts
    // 的真實模式原則不一致（篩選交給後端，前端只處理關鍵字/排序這類無法送後端
    // 的操作），也可能因為只抓了一頁而誤刪掉本來就該顯示的資料。
    const list = this.records().filter(
      (r) => !keyword || r.name.toLocaleLowerCase('zh-Hant').includes(keyword),
    );

    const sort = this.recordSort();
    const sorted = [...list];
    if (sort === 'date_desc' || sort === 'date_asc') {
      const direction = sort === 'date_desc' ? -1 : 1;
      sorted.sort((a, b) => {
        const at = a.date ? new Date(a.date).getTime() : 0;
        const bt = b.date ? new Date(b.date).getTime() : 0;
        return (at - bt) * direction;
      });
    } else {
      const direction = sort === 'score_desc' ? -1 : 1;
      sorted.sort((a, b) => {
        // 沒有分數的紀錄一律排到最後，不管排序方向，語意跟
        // product-management.ts 的 finalScore 排序保持一致。
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return (a.score - b.score) * direction;
      });
    }
    return sorted;
  });

  clearRecordFilters(): void {
    this.recordTableSort.set('', 'asc');
    this.recordSearch.set('');
    const shouldReload = this.recordResultFilter() !== 'ALL';
    this.recordResultFilter.set('ALL');
    this.recordSort.set('date_desc');
    // 篩選條件變了，換頁的基準跟著變，回到第 1 頁避免停在一個現在
    // 可能已經不存在的頁碼上（例如原本在第 3 頁，篩掉大部分資料後
    // 只剩 1 頁）。
    this.recordPageNumber.set(0);
    if (shouldReload && !this.useMockData) this.loadDecisionRecords();
  }
  readonly query = signal('');
  readonly reviewFilter = signal<'ALL' | ReviewStatus>('PENDING');
  readonly itemFilter = signal<'ALL' | ItemStatus>('ACTIVE');
  /** 分類設定篩選——'ALL' 代表不篩選；選項由目前已載入的待審品項動態算出。 */
  readonly categoryFilter = signal<'ALL' | string>('ALL');
  /** 送審起訖時間篩選（yyyy-MM-dd，date input 原生格式）；空字串代表不限制該端。 */
  readonly submittedFrom = signal('');
  readonly submittedTo = signal('');
  /** 分類篩選下拉選單的選項：只列出目前這頁待審品項實際出現過的分類，不去問設定 API 拿全部類型清單。 */
  readonly categoryOptions = computed(() =>
    [...new Set(this.items().map((item) => item.category).filter(Boolean))].sort(),
  );
  readonly view = signal<'pending' | 'records'>('pending');
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly totalElements = signal(0);
  /**
   * ⚠️ 修正：跟 product-management.ts 先前同一種 bug——totalElements()
   * 有從 API 正確設值，但沒有任何畫面元素讀取，待審清單永遠只顯示第一頁
   * 20 筆，使用者以為「選品審核的商品數僅有 20 筆」。這裡補上跟
   * product-management.ts 同一套 pageNumber／totalPages／goToPage()。
   */
  readonly pageNumber = signal(0);
  readonly totalPages = signal(0);
  /** 決策紀錄分頁另外算一份，跟待審清單的分頁狀態互不影響。 */
  readonly recordPageNumber = signal(0);
  readonly recordTotalPages = signal(0);

  constructor() {
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
    const keyword = this.query().trim().toLocaleLowerCase('zh-Hant');
    const from = this.submittedFrom();
    const to = this.submittedTo();
    return this.items().filter((item) => {
      // submittedAt 是完整的 ISO 時間字串（實際存的是 updatedAt，見 ReviewItem
      // 註解），日期輸入框只給到「日」的精度，取前 10 碼（yyyy-MM-dd）比對即可。
      const submittedDate = item.submittedAt?.slice(0, 10) ?? '';
      return (
        (!keyword ||
          item.name.toLocaleLowerCase('zh-Hant').includes(keyword) ||
          (item.submittedBy ?? '').toLocaleLowerCase('zh-Hant').includes(keyword)) &&
        (this.reviewFilter() === 'ALL' || item.status === this.reviewFilter()) &&
        (this.itemFilter() === 'ALL' || item.itemStatus === this.itemFilter()) &&
        (this.categoryFilter() === 'ALL' || item.category === this.categoryFilter()) &&
        (!from || (submittedDate !== '' && submittedDate >= from)) &&
        (!to || (submittedDate !== '' && submittedDate <= to))
      );
    });
  });

  ngOnInit(): void {
    this.load();
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
  loadPendingItems(): void {
    this.isLoading = true;
    this.pageState.set('loading');

    this.api
      .listPending({ page: this.pageNumber(), size: 20, sort: 'updatedAt,desc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.items.set(result.items.map(toReviewItem));
          this.totalElements.set(result.totalElements);
          this.totalPages.set(result.totalPages);
          this.isLoading = false;
          this.pageState.set(result.items.length === 0 ? 'empty' : 'default');
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

  goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages()) return;
    this.pageNumber.set(page);
    this.loadPendingItems();
  }

  /** GET /api/reviews/decision-records [僅管理]。失敗只讓紀錄分頁降級，不影響待審清單。 */
  loadDecisionRecords(): void {
    const reviewResult = this.recordResultFilter();
    this.api
      .listDecisionRecords({
        page: this.recordPageNumber(),
        size: 20,
        sort: 'reviewedAt,desc',
        reviewResult: reviewResult === 'ALL' ? undefined : reviewResult,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
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
              comment: record.reviewComment,
            })),
          );
          this.recordTotalPages.set(result.totalPages);
        },
        error: () => this.records.set([]),
      });
  }

  goToRecordPage(page: number): void {
    if (page < 0 || page >= this.recordTotalPages()) return;
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
    this.recordPageNumber.set(0);
    if (!this.useMockData) this.loadDecisionRecords();
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
