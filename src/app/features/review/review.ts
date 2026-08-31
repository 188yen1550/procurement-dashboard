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
  // 保留其他成員的 API 整合方法；原型初始化不會呼叫。
  loadPendingItems(): void {
    this.isLoading = true;
    this.http.get<ReviewItem[]>('/api/review/pending').subscribe({
      next: (data) => {
        this.pendingItems = data;
        this.items.set(data);
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.pageState.set('error');
      },
    });
  }
  approve(id: number): void {
    this.http.post(`/api/review/approve/${id}`, {}).subscribe({
      next: () => {
        this.pendingItems = this.pendingItems.filter((i) => i.id !== id);
        this.items.set(this.pendingItems);
      },
      error: () => this.statusMessage.set('審核通過失敗。'),
    });
  }
  reject(id: number): void {
    this.http.post(`/api/review/reject/${id}`, {}).subscribe({
      next: () => {
        this.pendingItems = this.pendingItems.filter((i) => i.id !== id);
        this.items.set(this.pendingItems);
      },
      error: () => this.statusMessage.set('審核駁回失敗。'),
    });
  }
}
export { ReviewComponent as Review };
