/**
 * 檔案用途：品項詳情的評分拆解、圖片、趨勢、AI、封存／復用與各種本地 UI 狀態。
 * Final Score = Base Score + Festival Boost；APPROVED 顯示 SNAPSHOT，其餘狀態顯示 LIVE。
 */
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ProductApiService } from '../product-api';
import {
  DetailProduct,
  DetailState,
  ItemStatus,
  ReviewStatus,
  toDetailProduct,
} from './product-detail.model';

const APPROVED: DetailProduct = {
  id: 101,
  name: '中秋炭烤海陸組合禮盒',
  category: '食品／生鮮',
  pricingType: 'RESALE',
  supplier: '潮港鮮物有限公司',
  reviewStatus: 'APPROVED',
  itemStatus: 'ACTIVE',
  candidateStatus: 'CANDIDATE',
  submissionCount: 1,
  dataSource: 'SNAPSHOT',
  evaluationModeName: '均衡模式 · Version 1',
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
  imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"%3E%3Crect width="800" height="600" fill="%23e8f2ed"/%3E%3Ccircle cx="400" cy="270" r="150" fill="%2339735c"/%3E%3Cpath d="M290 300h220l-35 125H325z" fill="%23fff"/%3E%3Ctext x="400" y="510" text-anchor="middle" font-family="sans-serif" font-size="38" fill="%23243447"%3EProduct Mock%3C/text%3E%3C/svg%3E',
};
const INCOMPLETE: DetailProduct = {
  ...APPROVED,
  id: 104,
  name: '超輕量折疊收納推車',
  category: '生活雜貨',
  pricingType: 'NEW',
  supplier: '簡居創意工坊',
  reviewStatus: 'PENDING',
  submissionCount: 0,
  dataSource: 'LIVE',
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
  imageUrl: null,
};

@Component({
  selector: 'app-product-detail',
  imports: [CommonModule, RouterLink],
  templateUrl: './product-detail.html',
  styleUrls: ['./product-detail.scss', './product-detail-image.scss'],
})
/** 品項詳情頁元件；Mock 模式使用本地資料，正式模式保留 master 的商品 API 整合。 */
export class ProductDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ProductApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly productId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly useMockData = APP_CONFIG.useMockData;
  readonly stateOptions: readonly DetailState[] = [
    'default',
    'locked',
    'loading',
    'empty',
    'error',
  ];
  readonly pageState = signal<DetailState>('default');
  readonly product = signal<DetailProduct | null>(null);
  readonly syncState = signal<'idle' | 'syncing' | 'success' | 'error'>('idle');
  readonly statusMessage = signal('');
  readonly imageLoadFailed = signal(false);
  readonly incomplete = computed(() => (this.product()?.completeness ?? 0) < 60);
  readonly isLocked = computed(
    () => this.pageState() === 'locked' || this.product()?.itemStatus === 'ARCHIVED',
  );

  ngOnInit(): void {
    this.reload();
  }

  /** Mock 模式沿用本地資料；真實模式呼叫三支 API 並組成同一個 View Model。 */
  reload(): void {
    if (this.useMockData) {
      this.product.set(this.productId === '104' ? INCOMPLETE : APPROVED);
      this.pageState.set('default');
      return;
    }
    this.pageState.set('loading');
    this.api
      .getProduct(this.productId)
      .pipe(
        switchMap((product) =>
          forkJoin({
            product: of(product),
            // 評估與節慶加成屬於可選區塊：單獨失敗時降級，不讓整頁變成 error。
            evaluation: this.api.getEvaluation(this.productId).pipe(catchError(() => of(null))),
            festival: this.api.getFestivalBoost(this.productId).pipe(catchError(() => of(null))),
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ product, evaluation, festival }) => {
          this.product.set(toDetailProduct(product, evaluation, festival));
          this.pageState.set('default');
          if (!evaluation) this.statusMessage.set('評估分數載入失敗，其餘資料仍可檢視。');
        },
        error: () => {
          this.product.set(null);
          this.pageState.set('error');
          this.statusMessage.set('品項詳情載入失敗，請稍後重試。');
        },
      });
  }

  setState(state: DetailState): void {
    this.pageState.set(state);
    if (state === 'empty') this.product.set(null);
    else if (!this.product()) this.product.set(APPROVED);
    this.statusMessage.set(`已切換為 ${state} 狀態。`);
    this.imageLoadFailed.set(false);
  }
  showIncomplete(): void {
    this.product.set(INCOMPLETE);
    this.pageState.set('default');
    this.statusMessage.set('已切換為資料待補範例。');
  }
  restoreDemo(): void {
    if (!this.useMockData) {
      this.reload();
      return;
    }
    this.product.set(APPROVED);
    this.pageState.set('default');
    this.statusMessage.set('已恢復完整 Demo 資料。');
    this.imageLoadFailed.set(false);
  }
  handleImageError(): void {
    this.imageLoadFailed.set(true);
    this.statusMessage.set('商品圖片載入失敗，已顯示替代內容。');
  }
  syncTrend(): void {
    this.syncState.set('syncing');
    this.statusMessage.set('正在模擬同步趨勢資料。');
  }
  completeSync(success: boolean): void {
    this.syncState.set(success ? 'success' : 'error');
    this.statusMessage.set(success ? '趨勢資料已在本地更新。' : '趨勢同步失敗，可再次嘗試。');
  }
  /**
   * 模擬封存或復用：APPROVED／REJECTED 可封存，但只有 APPROVED 且已封存商品可復用。
   * 只更新 product signal，無非同步 API 或需清理的資源。
   */
  toggleArchive(): void {
    const p = this.product();
    if (
      !p ||
      p.reviewStatus === 'PENDING' ||
      (p.itemStatus === 'ARCHIVED' && p.reviewStatus !== 'APPROVED')
    )
      return;
    if (this.useMockData) {
      this.product.set({ ...p, itemStatus: p.itemStatus === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' });
      this.statusMessage.set(
        p.itemStatus === 'ACTIVE' ? '已在本地模擬封存。' : '已在本地模擬復用。',
      );
      return;
    }
    const request = p.itemStatus === 'ACTIVE' ? this.api.archive(p.id) : this.api.restore(p.id);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.reload(),
      error: (err: { status?: number }) =>
        this.statusMessage.set(
          err.status === 409 ? '狀態已被他人變更，請重新整理後再試。' : '操作失敗，請稍後再試。',
        ),
    });
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
