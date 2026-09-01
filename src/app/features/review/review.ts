import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
export interface ReviewItem {
  id: number;
  name: string;
  submittedBy: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  itemStatus: 'ACTIVE' | 'ARCHIVED';
  category: string;
  finalScore: number | null;
  completeness: number;
  submissionCount: number;
  submittedAt: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}
type ReviewState = 'default' | 'disabled' | 'loading' | 'empty' | 'error';
const MOCK: readonly ReviewItem[] = [
  {
    id: 102,
    name: '輕量智慧溫控電熱杯',
    submittedBy: '林小美',
    status: 'PENDING',
    itemStatus: 'ACTIVE',
    category: '3C／家電',
    finalScore: 81.6,
    completeness: 78,
    submissionCount: 1,
    submittedAt: '2026-08-31T09:10:00+08:00',
    riskLevel: 'MEDIUM',
  },
  {
    id: 103,
    name: '無香低敏濃縮洗衣紙補充組',
    submittedBy: '陳家豪',
    status: 'PENDING',
    itemStatus: 'ACTIVE',
    category: '日用品',
    finalScore: 76.1,
    completeness: 88,
    submissionCount: 2,
    submittedAt: '2026-08-30T15:25:00+08:00',
    riskLevel: 'HIGH',
  },
  {
    id: 108,
    name: '年節養生堅果禮盒',
    submittedBy: '林小美',
    status: 'PENDING',
    itemStatus: 'ACTIVE',
    category: '精品禮盒',
    finalScore: 84.3,
    completeness: 94,
    submissionCount: 1,
    submittedAt: '2026-08-29T11:40:00+08:00',
    riskLevel: 'LOW',
  },
  {
    id: 109,
    name: '已封存測試品項',
    submittedBy: '陳家豪',
    status: 'REJECTED',
    itemStatus: 'ARCHIVED',
    category: '其他',
    finalScore: 62,
    completeness: 82,
    submissionCount: 1,
    submittedAt: '2026-08-20T10:00:00+08:00',
    riskLevel: 'LOW',
  },
];
@Component({
  selector: 'app-review',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './review.html',
  styleUrl: './review.scss',
})
export class ReviewComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly stateOptions: readonly ReviewState[] = [
    'default',
    'disabled',
    'loading',
    'empty',
    'error',
  ];
  readonly pageState = signal<ReviewState>('default');
  readonly items = signal<ReviewItem[]>([]);
  readonly query = signal('');
  readonly reviewFilter = signal<'ALL' | ReviewItem['status']>('PENDING');
  readonly itemFilter = signal<'ALL' | ReviewItem['itemStatus']>('ACTIVE');
  readonly view = signal<'pending' | 'records'>('pending');
  readonly statusMessage = signal('');
  pendingItems: ReviewItem[] = [];
  isLoading = false;
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.items().filter(
      (i) =>
        (!q || i.name.toLowerCase().includes(q) || i.submittedBy.toLowerCase().includes(q)) &&
        (this.reviewFilter() === 'ALL' || i.status === this.reviewFilter()) &&
        (this.itemFilter() === 'ALL' || i.itemStatus === this.itemFilter()),
    );
  });
  clearFilters(): void {
    this.query.set('');
    this.reviewFilter.set('PENDING');
    this.itemFilter.set('ACTIVE');
    this.statusMessage.set('已恢復預設篩選：未審核＋使用中。');
  }
  readonly records = [
    {
      id: 501,
      name: '中秋炭烤海陸組合禮盒',
      round: 1,
      result: 'APPROVED',
      reviewer: '管理員 王主任',
      score: 92.4,
      date: '2026/08/28',
      comment: '節慶需求明確，確認冷鏈排程後通過。',
    },
    {
      id: 502,
      name: '可機洗抗菌涼感被',
      round: 1,
      result: 'REJECTED',
      reviewer: '管理員 李經理',
      score: 69.5,
      date: '2026/08/24',
      comment: '供應穩定性不足，請補充備援方案。',
    },
  ];
  ngOnInit(): void {
    this.resetMock();
  }
  setState(s: ReviewState): void {
    this.pageState.set(s);
    if (s === 'empty') {
      this.items.set([]);
      this.pendingItems = [];
    } else if (!this.items().length && s !== 'error') this.resetMock();
    this.statusMessage.set(`已切換為 ${s} 狀態。`);
  }
  resetMock(): void {
    this.items.set(MOCK.map((i) => ({ ...i })));
    this.pendingItems = [...this.items()];
    this.pageState.set('default');
    this.statusMessage.set('已恢復待審核 Mock 清單。');
  }
  /**
   * 保留其他成員的 API 整合方法；原型初始化不會呼叫。
   *
   * ⚠️ 路徑已修正為後端實際的 `GET /api/reviews/pending`（原本寫成單數
   * `/api/review/pending`，後端沒有這支，一定 404——已對照 ReviewController
   * 原始碼確認）。
   *
   * ⚠️ 尚未完成、之後串接時務必處理：
   * 1. 這支回應是分頁殼 `{ content, totalElements, totalPages, number, size }`
   *    包在 `ApiResponse.data` 裡，回傳的是 `ProductResponse[]`（`data.content`），
   *    不是這裡假設的 `ReviewItem[]` 扁平陣列，要先寫 mapper。
   * 2. `ProductResponse` 沒有 `finalScore`／`completeness`（在
   *    `GET /api/products/{id}/evaluation`）、沒有 `category`（只有
   *    `productTypeId`，要對照 `GET /api/settings/product-types`）、沒有
   *    `submittedBy`（只有 `createdBy` 使用者編號，無對應姓名 API）、
   *    也完全沒有 `riskLevel` 這個欄位（後端不存在，是前端自行假設的）。
   *    這幾個欄位目前無法從單一 API 湊齊，需要另外設計聚合方式，
   *    不是把回傳型別改一改就能接上，先留言標記，不在這次一併動。
   */
  loadPendingItems(): void {
    this.isLoading = true;
    this.http.get('/api/reviews/pending').subscribe({
      next: () => {
        // TODO: 對照上方註解完成 ProductResponse → ReviewItem 的 mapper 後再啟用。
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.pageState.set('error');
      },
    });
  }
  // approve()/reject() 已移除：後端沒有 /api/review/approve, /api/review/reject
  // 這兩支端點。實際送審決策是統一的 `POST /api/reviews`（body 帶
  // reviewStatus: 'APPROVED' | 'REJECTED'，見 ReviewSubmitRequest），
  // 這個流程已經在 review-detail 頁面實作，不要在清單頁重新做一份。
}
export { ReviewComponent as Review };
