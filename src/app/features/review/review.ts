/**
 * 檔案用途：管理人員的待審清單與決策紀錄。
 * 預設範圍是 PENDING＋ACTIVE；核准只是選品決策，不代表上架、簽約、銷售或營收。
 *
 * ## 這次改寫做了什麼
 *
 * 舊碼的 loadPendingItems() 是一支打不通的死碼——註解已經正確指出
 * ProductResponse 湊不齊 ReviewItem 的欄位，但方法還留著且會 404。
 * 現在改為真的接上 ReviewApiService，並且對「後端沒有的欄位」誠實處理。
 *
 * ## ⚠️ 後端拿不到／已補上的欄位，處理方式
 *
 * | 欄位          | 後端狀況                                          | 這次的處理              |
 * |---------------|----------------------------------------------------|--------------------------|
 * | category      | 只有 productTypeId                                | 對照設定 API 取得名稱   |
 * | finalScore    | 後端已在清單端點併帶（批次查詢，不逐筆呼叫 /evaluation） | 有值就顯示，該商品尚無評估紀錄時為 null，畫面顯示「—」 |
 * | completeness  | 同上                                              | 同上 |
 * | riskLevel     | **後端完全沒有這個概念**                          | 已移除                  |
 *
 * riskLevel 直接刪掉而不是填假值：那是舊原型自行發明的欄位，
 * 系統的風險是審核時由主管勾選 risk_options，不是商品的屬性。
 * 留著它會讓人以為後端有風險分級，是錯誤的心智模型。
 *
 * 分數與完整度後端已在清單端點批次補上，不需要前端再逐筆呼叫 /evaluation。
 *
 * ## ⚠️ submittedBy 這次已接上真實資料，不再是死欄位
 *
 * 後端補了 ProductResponse.createdByName（ProductService／ReviewService
 * 批次查 app_users 後填入），現在直接讀 PendingReviewItem.createdByName，
 * 不再需要「恆為 null」的特殊處理。找不到對應帳號時後端回 fallback 字串，
 * 前端不再需要另外判斷 null。
 */
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

/** 待審清單的顯示模型。可為 null 的欄位代表後端目前提供不了。 */
export interface ReviewItem {
  id: number;
  name: string;
  /** 後端已批次查好；找不到對應帳號時為 fallback 字串，不會是 null。 */
  submittedBy: string;
  status: ReviewStatus;
  itemStatus: ItemStatus;
  /** 由 productTypeId 對照設定 API 得來。 */
  category: string;
  /** ⚠️ 恆為 null：分數在 /evaluation，清單端點沒有。 */
  finalScore: number | null;
  /** ⚠️ 恆為 null，理由同上。 */
  completeness: number | null;
  submissionCount: number;
  /** ⚠️ 實際是 updatedAt。ProductResponse 沒有「送審時間」這個欄位。 */
  submittedAt: string | null;
}

/** 決策紀錄表格的顯示模型。 */
export interface DecisionRecordRow {
  id: number;
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
  { id: 501, name: '中秋炭烤海陸組合禮盒', round: 1, result: 'APPROVED', reviewer: '管理員 王主任', score: 92.4, date: '2026/08/28', comment: '節慶需求明確，確認冷鏈排程後通過。' },
  { id: 502, name: '可機洗抗菌涼感被', round: 1, result: 'REJECTED', reviewer: '管理員 李經理', score: 69.5, date: '2026/08/24', comment: '供應穩定性不足，請補充備援方案。' },
];

/** PendingReviewItem（後端）→ ReviewItem（畫面）。 */
function toReviewItem(item: PendingReviewItem): ReviewItem {
  return {
    id: item.id,
    name: item.name,
    // 後端已批次查好 createdByName，不再需要「恆為 null」的特殊處理。
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
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './review.html',
  styleUrl: './review.scss',
})
export class ReviewComponent implements OnInit {
  private readonly api = inject(ReviewApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly useMockData = APP_CONFIG.useMockData;

  readonly stateOptions: readonly ReviewState[] = ['default', 'disabled', 'loading', 'empty', 'error'];
  readonly pageState = signal<ReviewState>('default');
  readonly items = signal<ReviewItem[]>([]);
  readonly records = signal<DecisionRecordRow[]>([]);

  // ----- 歷次決策紀錄：搜尋／篩選／排序 -----
  // 原本這個分頁完全沒有任何互動控制，只是把 API 回來的資料原樣攤平成
  // 一張表——資料量一多，要從裡面找特定商品或特定結果的紀錄只能用瀏覽器
  // 內建的 Ctrl+F，體驗跟「待審核清單」分頁（已經有搜尋/篩選）完全不對稱。
  readonly recordSearch = signal('');
  readonly recordResultFilter = signal<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  readonly recordSort = signal<'date_desc' | 'date_asc' | 'score_desc' | 'score_asc'>('date_desc');

  readonly filteredRecords = computed(() => {
    const keyword = this.recordSearch().trim().toLocaleLowerCase('zh-Hant');
    const resultFilter = this.recordResultFilter();
    const list = this.records().filter(
      (r) =>
        (!keyword || r.name.toLocaleLowerCase('zh-Hant').includes(keyword)) &&
        (resultFilter === 'ALL' || r.result === resultFilter),
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
    this.recordSearch.set('');
    this.recordResultFilter.set('ALL');
    this.recordSort.set('date_desc');
  }
  readonly query = signal('');
  readonly reviewFilter = signal<'ALL' | ReviewStatus>('PENDING');
  readonly itemFilter = signal<'ALL' | ItemStatus>('ACTIVE');
  readonly view = signal<'pending' | 'records'>('pending');
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly totalElements = signal(0);

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
    return this.items().filter(
      (item) =>
        (!keyword ||
          item.name.toLocaleLowerCase('zh-Hant').includes(keyword) ||
          (item.submittedBy ?? '').toLocaleLowerCase('zh-Hant').includes(keyword)) &&
        (this.reviewFilter() === 'ALL' || item.status === this.reviewFilter()) &&
        (this.itemFilter() === 'ALL' || item.itemStatus === this.itemFilter()),
    );
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
      .listPending({ page: 0, size: 20, sort: 'updatedAt,desc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.items.set(result.items.map(toReviewItem));
          this.totalElements.set(result.totalElements);
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

  /** GET /api/reviews/decision-records [僅管理]。失敗只讓紀錄分頁降級，不影響待審清單。 */
  loadDecisionRecords(): void {
    this.api
      .listDecisionRecords({ page: 0, size: 20, sort: 'reviewedAt,desc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.records.set(
            result.items.map((record) => ({
              id: record.id,
              name: record.productName,
              round: record.submissionCount ?? 1,
              result: record.reviewStatus,
              reviewer: record.reviewerName,
              score: record.finalScore,
              date: record.reviewedAt,
              comment: record.reviewComment,
            })),
          );
        },
        error: () => this.records.set([]),
      });
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
