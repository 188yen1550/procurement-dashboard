import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

export type PricingType = 'NEW' | 'RESALE';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ItemStatus = 'ACTIVE' | 'ARCHIVED';
export type CandidateStatus = 'CANDIDATE' | 'AI_SUGGESTED';
export type PageState = 'default' | 'locked' | 'loading' | 'empty' | 'error';

export interface Product {
  id: number;
  name: string;
  productType: string;
  pricingType: PricingType;
  supplierName: string;
  finalScore: number | null;
  dataCompleteness: number;
  reviewStatus: ReviewStatus;
  itemStatus: ItemStatus;
  candidateStatus: CandidateStatus;
  updatedAt: string;
  submissionCount: number;
  hasReviewRecord: boolean;
}

const MOCK_PRODUCTS: readonly Product[] = [
  [101, '中秋炭烤海陸組合禮盒', '食品／生鮮', 'RESALE', '潮港鮮物有限公司', 92.4, 96, 'APPROVED', 'ACTIVE', 'CANDIDATE', '2026-08-31T09:25:00+08:00', 1, true],
  [102, '輕量智慧溫控電熱杯', '3C／家電', 'NEW', '沐光科技', 81.6, 78, 'PENDING', 'ACTIVE', 'CANDIDATE', '2026-08-30T16:40:00+08:00', 0, false],
  [103, '無香低敏濃縮洗衣紙補充組', '日用品', 'RESALE', '淨好生活實業', 74.8, 88, 'REJECTED', 'ACTIVE', 'CANDIDATE', '2026-08-29T11:15:00+08:00', 1, true],
  [104, '超輕量折疊收納推車', '生活雜貨', 'NEW', '簡居創意工坊', null, 48, 'PENDING', 'ACTIVE', 'CANDIDATE', '2026-08-28T14:08:00+08:00', 0, false],
  [105, '敏弱肌保濕修護組', '美妝保養', 'RESALE', '禾心生技', 86.2, 100, 'APPROVED', 'ARCHIVED', 'CANDIDATE', '2026-08-26T10:30:00+08:00', 1, true],
  [106, '可機洗抗菌涼感被', '寢具家用', 'RESALE', '眠好家紡織', null, 55, 'REJECTED', 'ARCHIVED', 'CANDIDATE', '2026-08-24T13:50:00+08:00', 2, true],
  [107, '旅行用全能轉接充電器', '3C／家電', 'RESALE', '沐光科技', 79.1, 82, 'PENDING', 'ACTIVE', 'AI_SUGGESTED', '2026-08-31T07:10:00+08:00', 0, false],
].map((row) => {
  const [id, name, productType, pricingType, supplierName, finalScore, dataCompleteness, reviewStatus, itemStatus, candidateStatus, updatedAt, submissionCount, hasReviewRecord] = row;
  return { id, name, productType, pricingType, supplierName, finalScore, dataCompleteness, reviewStatus, itemStatus, candidateStatus, updatedAt, submissionCount, hasReviewRecord } as Product;
});

@Component({
  selector: 'app-product-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './product-management.html',
  styleUrl: './product-management.scss',
})
export class ProductManagement implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly mockProducts = MOCK_PRODUCTS.map((product) => ({ ...product }));
  readonly products = signal<Product[]>([]);
  readonly pageState = signal<PageState>('default');
  readonly searchTerm = signal('');
  readonly reviewFilter = signal<ReviewStatus | 'ALL'>('ALL');
  readonly itemFilter = signal<ItemStatus | 'ALL'>('ALL');
  readonly productTypeFilter = signal('ALL');
  readonly dialogProduct = signal<Product | null>(null);
  readonly dialogMode = signal<'delete' | 'resubmit' | 'notice' | null>(null);
  readonly statusMessage = signal('');
  readonly stateOptions: readonly PageState[] = ['default', 'locked', 'loading', 'empty', 'error'];

  readonly productTypes = computed(() => [...new Set(this.products().map((p) => p.productType))].sort());
  readonly candidateProducts = computed(() => this.products().filter((p) => p.candidateStatus === 'CANDIDATE'));
  readonly filteredProducts = computed(() => {
    const keyword = this.searchTerm().trim().toLocaleLowerCase('zh-Hant');
    return this.candidateProducts().filter((p) =>
      (!keyword || p.name.toLocaleLowerCase('zh-Hant').includes(keyword) || p.supplierName.toLocaleLowerCase('zh-Hant').includes(keyword)) &&
      (this.reviewFilter() === 'ALL' || p.reviewStatus === this.reviewFilter()) &&
      (this.itemFilter() === 'ALL' || p.itemStatus === this.itemFilter()) &&
      (this.productTypeFilter() === 'ALL' || p.productType === this.productTypeFilter()),
    );
  });
  readonly hasActiveFilters = computed(() => !!this.searchTerm().trim() || this.reviewFilter() !== 'ALL' || this.itemFilter() !== 'ALL' || this.productTypeFilter() !== 'ALL');
  readonly isLoading = computed(() => this.pageState() === 'loading');
  readonly hasLoadError = computed(() => this.pageState() === 'error');

  ngOnInit(): void { this.resetMockData(); }
  updateSearch(value: string): void { this.searchTerm.set(value); }
  updateReviewFilter(value: string): void { this.reviewFilter.set(value as ReviewStatus | 'ALL'); }
  updateItemFilter(value: string): void { this.itemFilter.set(value as ItemStatus | 'ALL'); }
  updateProductTypeFilter(value: string): void { this.productTypeFilter.set(value); }

  clearFilters(): void {
    this.searchTerm.set(''); this.reviewFilter.set('ALL'); this.itemFilter.set('ALL'); this.productTypeFilter.set('ALL');
    this.statusMessage.set('已清除所有搜尋與篩選條件。');
  }
  setPageState(state: PageState): void {
    this.pageState.set(state); this.closeDialog();
    if (state === 'empty') this.products.set([]); else if (state === 'default' || state === 'locked') this.resetMockData();
    this.statusMessage.set(state === 'error' ? '已模擬本地資料載入失敗。' : `已切換為 ${state} 狀態。`);
  }
  retryLoad(): void { this.resetMockData(); this.pageState.set('default'); this.statusMessage.set('重試成功，已恢復本地 Mock 品項。'); }
  showFeatureNotice(product: Product | null, message: string): void { this.dialogProduct.set(product); this.dialogMode.set('notice'); this.statusMessage.set(message); }
  requestDelete(product: Product): void { if (this.canDelete(product)) { this.dialogProduct.set(product); this.dialogMode.set('delete'); } }
  confirmDelete(): void {
    const p = this.dialogProduct(); if (!p || !this.canDelete(p)) return;
    this.products.update((items) => items.filter((item) => item.id !== p.id)); this.statusMessage.set(`已從本地 Mock 清單移除「${p.name}」，未呼叫 API。`); this.closeDialog();
  }
  requestResubmit(product: Product): void { this.dialogProduct.set(product); this.dialogMode.set('resubmit'); }
  confirmResubmit(): void {
    const p = this.dialogProduct(); if (!p || p.reviewStatus !== 'REJECTED') return;
    this.products.update((items) => items.map((item) => item.id === p.id ? { ...item, reviewStatus: 'PENDING', submissionCount: item.submissionCount + 1 } : item));
    this.statusMessage.set(`「${p.name}」已模擬重新送審，未呼叫 API。`); this.closeDialog();
  }
  closeDialog(): void { this.dialogProduct.set(null); this.dialogMode.set(null); }
  canDelete(p: Product): boolean { return p.reviewStatus === 'PENDING' && !p.hasReviewRecord; }
  deleteDisabledReason(p: Product): string { return p.itemStatus === 'ARCHIVED' ? '已封存品項已保留審核資料，不可刪除' : p.hasReviewRecord ? '已有正式審核紀錄，不可刪除' : '僅未審核且無審核紀錄者可刪除'; }
  reviewStatusLabel(s: ReviewStatus): string { return { PENDING: '未審核', APPROVED: '已通過選品審核', REJECTED: '未通過' }[s]; }
  itemStatusLabel(s: ItemStatus): string { return s === 'ACTIVE' ? '使用中' : '已封存'; }
  pricingTypeLabel(t: PricingType): string { return t === 'NEW' ? '新品 NEW' : '再販售 RESALE'; }

  // 保留其他成員的 API contract；本地原型不會自動呼叫。
  loadProductsFromApi(): void {
    this.pageState.set('loading');
    this.http.get<Product[]>('/api/products').subscribe({ next: (items) => { this.products.set(items); this.pageState.set('default'); }, error: () => { this.pageState.set('error'); this.statusMessage.set('品項載入失敗，請稍後重試。'); } });
  }
  deleteProductFromApi(id: number): void {
    this.http.delete(`/api/products/${id}`).subscribe({ next: () => this.products.update((items) => items.filter((p) => p.id !== id)), error: () => this.statusMessage.set('品項刪除失敗，請重新載入後再試。') });
  }
  private resetMockData(): void { this.products.set(this.mockProducts.map((p) => ({ ...p }))); }
}
