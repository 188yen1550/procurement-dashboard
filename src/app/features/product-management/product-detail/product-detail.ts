import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

type DetailState = 'default' | 'locked' | 'loading' | 'empty' | 'error';
type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type ItemStatus = 'ACTIVE' | 'ARCHIVED';

interface DetailProduct {
  id: number;
  name: string;
  category: string;
  pricingType: 'NEW' | 'RESALE';
  supplier: string;
  reviewStatus: ReviewStatus;
  itemStatus: ItemStatus;
  completeness: number;
  baseScore: number | null;
  festivalBoost: number;
  finalScore: number | null;
  campaign: string | null;
  matchedTags: string[];
  costPrice: number | null;
  salePrice: number | null;
  marketPrice: number | null;
  moq: number;
  supplyStability: number;
  priceCompetitiveness: number;
  audienceScore: number;
  audience: string;
  historicalScore: number;
  historicalNote: string;
  purchaseScore: number;
  trendScore: number;
  trendDirection: 'UP' | 'STABLE' | 'DOWN';
  lastSyncedAt: string;
  aiSummary: string | null;
  aiReasons: string[];
  risks: string[];
  description: string;
}

const APPROVED: DetailProduct = {
  id: 101,
  name: '中秋炭烤海陸組合禮盒',
  category: '食品／生鮮',
  pricingType: 'RESALE',
  supplier: '潮港鮮物有限公司',
  reviewStatus: 'APPROVED',
  itemStatus: 'ACTIVE',
  completeness: 96,
  baseScore: 88.2,
  festivalBoost: 4.2,
  finalScore: 92.4,
  campaign: '中秋節',
  matchedTags: ['bbq', 'gift'],
  costPrice: 820,
  salePrice: 1190,
  marketPrice: 1490,
  moq: 50,
  supplyStability: 92,
  priceCompetitiveness: 88,
  audienceScore: 91,
  audience: '25–45 歲家庭與公司團購',
  historicalScore: 84,
  historicalNote: '去年同類烤肉組合在節前 30 天銷售成長 18%。',
  purchaseScore: 86,
  trendScore: 90,
  trendDirection: 'UP',
  lastSyncedAt: '2026-08-31T09:20:00+08:00',
  aiSummary: '節慶標籤與當前檔期高度吻合，供應穩定且價格具競爭力，建議維持人工確認供貨排程。',
  aiReasons: ['中秋烤肉需求與 bbq 標籤相符', '團購價較市價低 20%', '近期搜尋熱度呈上升'],
  risks: ['MOQ 50 組，需確認冷鏈倉儲容量', '節前物流高峰可能延遲'],
  description: '適合中秋家庭與企業團購的海陸烤肉組合。',
};
const INCOMPLETE: DetailProduct = {
  ...APPROVED,
  id: 104,
  name: '超輕量折疊收納推車',
  category: '生活雜貨',
  pricingType: 'NEW',
  supplier: '簡居創意工坊',
  reviewStatus: 'PENDING',
  completeness: 48,
  baseScore: null,
  festivalBoost: 0,
  finalScore: null,
  campaign: null,
  matchedTags: [],
  costPrice: null,
  salePrice: null,
  marketPrice: null,
  audienceScore: 0,
  historicalScore: 0,
  purchaseScore: 0,
  trendScore: 0,
  trendDirection: 'STABLE',
  aiSummary: null,
  aiReasons: [],
  risks: [],
  description: '商品資料尚未補齊，目前僅供編輯與查看。',
};

@Component({
  selector: 'app-product-detail',
  imports: [CommonModule, RouterLink],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss',
})
export class ProductDetail {
  private readonly route = inject(ActivatedRoute);
  readonly stateOptions: readonly DetailState[] = [
    'default',
    'locked',
    'loading',
    'empty',
    'error',
  ];
  readonly pageState = signal<DetailState>('default');
  readonly product = signal<DetailProduct | null>(
    this.route.snapshot.paramMap.get('id') === '104' ? INCOMPLETE : APPROVED,
  );
  readonly syncState = signal<'idle' | 'syncing' | 'success' | 'error'>('idle');
  readonly statusMessage = signal('');
  readonly incomplete = computed(() => (this.product()?.completeness ?? 0) < 60);
  readonly isLocked = computed(
    () => this.pageState() === 'locked' || this.product()?.itemStatus === 'ARCHIVED',
  );

  setState(state: DetailState): void {
    this.pageState.set(state);
    if (state === 'empty') this.product.set(null);
    else if (!this.product()) this.product.set(APPROVED);
    this.statusMessage.set(`已切換為 ${state} 狀態。`);
  }
  showIncomplete(): void {
    this.product.set(INCOMPLETE);
    this.pageState.set('default');
    this.statusMessage.set('已切換為資料待補範例。');
  }
  restoreDemo(): void {
    this.product.set(APPROVED);
    this.pageState.set('default');
    this.statusMessage.set('已恢復完整 Demo 資料。');
  }
  syncTrend(): void {
    this.syncState.set('syncing');
    this.statusMessage.set('正在模擬同步趨勢資料。');
  }
  completeSync(success: boolean): void {
    this.syncState.set(success ? 'success' : 'error');
    this.statusMessage.set(success ? '趨勢資料已在本地更新。' : '趨勢同步失敗，可再次嘗試。');
  }
  toggleArchive(): void {
    const p = this.product();
    if (
      !p ||
      p.reviewStatus === 'PENDING' ||
      (p.itemStatus === 'ARCHIVED' && p.reviewStatus !== 'APPROVED')
    )
      return;
    this.product.set({ ...p, itemStatus: p.itemStatus === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' });
    this.statusMessage.set(p.itemStatus === 'ACTIVE' ? '已在本地模擬封存。' : '已在本地模擬復用。');
  }
  discountRate(p: DetailProduct): number | null {
    return p.marketPrice && p.salePrice
      ? Math.round((1 - p.salePrice / p.marketPrice) * 100)
      : null;
  }
  marginRate(p: DetailProduct): number | null {
    return p.salePrice && p.costPrice !== null
      ? Math.round(((p.salePrice - p.costPrice) / p.salePrice) * 1000) / 10
      : null;
  }
  reviewLabel(s: ReviewStatus): string {
    return { PENDING: '未審核', APPROVED: '已通過選品審核', REJECTED: '未通過' }[s];
  }
}
