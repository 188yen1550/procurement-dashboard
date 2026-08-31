import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

export interface ProductDetailData {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  supplierName?: string;
  pricingType: 'NEW' | 'RESALE';
  costPrice?: number;
  salePrice?: number;
  completenessPercent: number;
  reviewStatus: string;
  itemStatus: string;         // 新增：判斷封存/復用要用
  candidateStatus: string;    // 新增：判斷加入候選要用
  submissionCount: number;    // 新增：判斷刪除要用
}

export interface EvaluationData {
  dataSource: 'SNAPSHOT' | 'LIVE';
  evaluationModeName: string;
  businessScore: number;
  audienceScore: number;
  historicalScore: number;
  purchaseScore: number;
  trendScore: number;
  forecastScore: number;
  totalScore: number;
  dataCompleteness: number;
  festivalBoost: number;
  finalScore: number;
}

export interface MatchedCampaign {
  campaignId: number;
  campaignName: string;
  matchedTags: string[];
  matchWeight?: number;
  urgencyFactor?: number;
}

export interface FestivalBoostData {
  dataSource: 'SNAPSHOT' | 'LIVE';
  matchedCampaign: MatchedCampaign | null;   // 沒命中檔期時是null
  festivalBoost: number;
  finalScore?: number;
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss'
})
export class ProductDetail implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  product: ProductDetailData | null = null;
  evaluation: EvaluationData | null = null;
  festivalBoost: FestivalBoostData | null = null;
  isLoading = false;
  isLoadingEvaluation = false;
  errorMessage = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    // 產品基本資料假資料
    this.product = {
      id: Number(id),
      name: `測試商品${id}`,
      description: '這是一個測試用的商品描述',
      supplierName: '測試供應商',
      pricingType: 'NEW',
      completenessPercent: 45,
      reviewStatus: 'REJECTED',
      itemStatus: 'ACTIVE',
      candidateStatus: 'CANDIDATE',
      submissionCount: 1,
    };

    // 評估分數假資料
    this.evaluation = {
      dataSource: 'LIVE',
      evaluationModeName: '均衡模式',
      businessScore: 70,
      audienceScore: 65,
      historicalScore: 50,
      purchaseScore: 60,
      trendScore: 55,
      forecastScore: 58,
      totalScore: 60,
      dataCompleteness: 45,
      festivalBoost: 10,
      finalScore: 70,
    };

    // 節慶加成假資料
    this.festivalBoost = {
      dataSource: 'LIVE',
      matchedCampaign: {
        campaignId: 1,
        campaignName: '暑期特賣',
        matchedTags: ['夏日', '熱銷']
      },
      festivalBoost: 10,
      finalScore: 70
    };

    if (id) {
      // 後端接通後，再將註解打開改呼叫真實 API
      // this.loadEvaluation(id);
      // this.loadProduct(id);
      // this.loadFestivalBoost(id);
    }
  }

  loadProduct(id: string) {
    this.isLoading = true;
    this.http.get<ProductDetailData>(`/api/products/${id}`).subscribe({
      next: (data) => {
        this.product = data;
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = '載入品項詳情失敗';
        this.isLoading = false;
        console.error(err);
      }
    });
  }

  loadEvaluation(id: string) {
    this.isLoadingEvaluation = true;
    this.http.get<EvaluationData>(`/api/products/${id}/evaluation`).subscribe({
      next: (data) => {
        this.evaluation = data;
        this.isLoadingEvaluation = false;
      },
      error: (err) => {
        console.error('載入評估分數失敗', err);
        this.isLoadingEvaluation = false;
      }
    });
  }

  loadFestivalBoost(id: string) {
    this.http.get<FestivalBoostData>(`/api/products/${id}/festival-boost`).subscribe({
      next: (data) => {
        this.festivalBoost = data;
      },
      error: (err) => {
        console.error('載入節慶加成失敗', err);
      }
    });
  }

  get isLowCompleteness(): boolean {
    return (this.product?.completenessPercent ?? 100) < 60;
  }

  // 前端自己判斷60%門檻，後端不判斷
  get isEvaluationLowCompleteness(): boolean {
    return (this.evaluation?.dataCompleteness ?? 100) < 60;
  }

  get dataSourceLabel(): string {
    return this.evaluation?.dataSource === 'SNAPSHOT' ? '已凍結' : '即時計算';
  }

  // 按鈕顯示條件
  get canResubmit(): boolean {
    const p = this.product;
    return !!p && p.reviewStatus === 'REJECTED' && p.itemStatus === 'ACTIVE';
  }

  get canArchive(): boolean {
    const p = this.product;
    return !!p && p.itemStatus === 'ACTIVE'
      && (p.reviewStatus === 'APPROVED' || p.reviewStatus === 'REJECTED');
  }

  get canRestore(): boolean {
    const p = this.product;
    return !!p && p.itemStatus === 'ARCHIVED'
      && (p.reviewStatus === 'APPROVED' || p.reviewStatus === 'REJECTED');
  }

  get canPromote(): boolean {
    return this.product?.candidateStatus === 'AI_SUGGESTED';
  }

  get canDelete(): boolean {
    const p = this.product;
    return !!p && p.reviewStatus === 'PENDING' && p.submissionCount === 0;
  }

  // 五個動作的呼叫方法
  resubmit(): void {
    this.http.post(`/api/products/${this.product!.id}/resubmit`, {}).subscribe({
      next: () => this.loadProduct(String(this.product!.id)),
      error: (err) => this.handleActionError(err, '重新送審')
    });
  }

  archive(): void {
    this.http.post(`/api/products/${this.product!.id}/archive`, {}).subscribe({
      next: () => this.loadProduct(String(this.product!.id)),
      error: (err) => this.handleActionError(err, '封存')
    });
  }

  restore(): void {
    this.http.post(`/api/products/${this.product!.id}/restore`, {}).subscribe({
      next: () => this.loadProduct(String(this.product!.id)),
      error: (err) => this.handleActionError(err, '復用')
    });
  }

  promote(): void {
    this.http.post(`/api/products/${this.product!.id}/promote-to-candidate`, {}).subscribe({
      next: () => this.loadProduct(String(this.product!.id)),
      error: (err) => this.handleActionError(err, '加入候選')
    });
  }

  deleteProduct(): void {
    this.http.delete(`/api/products/${this.product!.id}`).subscribe({
      next: () => this.router.navigate(['/products']),
      error: (err) => this.handleActionError(err, '刪除')
    });
  }

  private handleActionError(err: any, actionName: string): void {
    if (err.status === 409) {
      this.errorMessage = `${actionName}失敗：狀態已變更，請重新整理後再試`;
    } else {
      this.errorMessage = `${actionName}失敗請稍後再試`;
    }
    console.error(err);
  }
}
