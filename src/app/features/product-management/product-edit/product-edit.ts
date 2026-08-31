import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';

// 1. 定義 Day 10 評估分數的資料結構型別
export interface ProductEvaluation {
  totalScore: number;
  marketPotentialScore: number;
  costCompetitivenessScore: number;
  supplyStabilityScore: number;
  isFrozenSnapshot: boolean; // APPROVED 時為凍結快照
  evaluatedAt: string;
}

@Component({
  selector: 'app-product-edit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './product-edit.html',
  styleUrl: './product-edit.scss'
})
export class ProductEdit implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  productId!: string;
  reviewStatus = '';
  itemStatus = '';         // 品項狀態 ('ACTIVE' 或 'ARCHIVED')
  submissionCount = 0;     // 送審次數
  isLoading = false;
  errorMessage = '';

  // Day 10：評估分數區塊相關狀態
  evaluationData: ProductEvaluation | null = null;
  isEvaluationLoading = false;
  evaluationErrorMessage = '';

  // 一般基本資料 — 永遠可編輯
  editForm = this.fb.group({
    name: ['', Validators.required],
    description: [''],
    imageUrl: [''],
    supplierName: [''],
  });

  // 選品核心資料 — 依review_status動態鎖定
  coreForm = this.fb.group({
    productTypeId: [null as number | null, Validators.required],
    pricingType: ['' as 'NEW' | 'RESALE' | '', Validators.required],
    costPrice: [0],
    salePrice: [0],
    campaignTags: [''],
    moq: [0],
    supplyStability: [''],
    priceCompetitiveness: [''],
    targetCustomerDescription: [''],
    estimatedPurchaseRate: [0],
  });

  ngOnInit(): void {
    this.productId = this.route.snapshot.paramMap.get('id')!;
    // ↓↓↓ 暫時測試用，之後改回這支 ↓↓↓
    this.reviewStatus = 'APPROVED';
    this.itemStatus = 'ACTIVE';
    this.submissionCount = 1;

    this.editForm.patchValue({
      name: '測試商品1',
      description: '測試描述',
      imageUrl: '',
      supplierName: '測試供應商',
    });

    this.coreForm.patchValue({
      productTypeId: 1,
      pricingType: 'NEW',
      costPrice: 100,
      salePrice: 200,
    });

    this.coreForm.disable();  // 因為reviewStatus是APPROVED，應該要鎖定

    // 正式串接時解除註解
    // this.loadProduct();
    // this.loadProductEvaluation();
  }

  loadProduct() {
    this.isLoading = true;
    this.http.get<any>(`/api/products/${this.productId}`).subscribe({
      next: (data) => {
        this.reviewStatus = data.reviewStatus;
        this.itemStatus = data.itemStatus;
        this.submissionCount = data.submissionCount;

        this.editForm.patchValue({
          name: data.name,
          description: data.description,
          imageUrl: data.imageUrl,
          supplierName: data.supplierName,
        });

        this.coreForm.patchValue({
          productTypeId: data.productTypeId,
          pricingType: data.pricingType,
          costPrice: data.costPrice,
          salePrice: data.salePrice,
          campaignTags: data.campaignTags,
          moq: data.moq,
          supplyStability: data.supplyStability,
          priceCompetitiveness: data.priceCompetitiveness,
          targetCustomerDescription: data.targetCustomerDescription,
          estimatedPurchaseRate: data.estimatedPurchaseRate,
        });

        // 核心：只有 APPROVED 狀態才鎖定核心資料
        if (this.reviewStatus === 'APPROVED') {
          this.coreForm.disable();
        } else {
          this.coreForm.enable();
        }

        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = '載入品項資料失敗';
        this.isLoading = false;
        console.error(err);
      }
    });
  }

  // Day 10：取得評估分數區塊資料
  loadProductEvaluation(): void {
    this.isEvaluationLoading = true;
    this.http.get<ProductEvaluation>(`/api/products/${this.productId}/evaluation`).subscribe({
      next: (data) => {
        this.evaluationData = data;
        this.isEvaluationLoading = false;
      },
      error: (err) => {
        this.evaluationErrorMessage = '載入評估分數失敗';
        this.isEvaluationLoading = false;
        console.error(err);
      }
    });
  }

  get isCoreLocked(): boolean {
    return this.reviewStatus === 'APPROVED';
  }

  // ==========================================
  // D9 邏輯：按鈕顯示條件判斷
  // ==========================================

  get hasReviewResult(): boolean {
    return this.reviewStatus === 'APPROVED' || this.reviewStatus === 'REJECTED';
  }

  get canDelete(): boolean {
    return this.reviewStatus === 'DRAFT' && this.submissionCount === 0;
  }

  get canArchive(): boolean {
    return this.itemStatus === 'ACTIVE' && this.hasReviewResult;
  }

  get canRestore(): boolean {
    return this.itemStatus === 'ARCHIVED' && this.hasReviewResult;
  }

  get showActionMessage(): boolean {
    return !this.canDelete && !this.canArchive && !this.canRestore;
  }

  // ==========================================
  // D9 邏輯：按鈕觸發的 API 動作
  // ==========================================

  onDelete(): void {
    if (!confirm('確定要刪除這個品項嗎？')) {
      return;
    }

    this.http.delete(`/api/products/${this.productId}`).subscribe({
      next: () => {
        this.router.navigate(['/products']);
      },
      error: (err) => {
        this.errorMessage = '刪除失敗';
        console.error(err);
      }
    });
  }

  onArchive(): void {
    this.http.patch(`/api/products/${this.productId}/item-status`, { itemStatus: 'ARCHIVED' }).subscribe({
      next: (res: any) => {
        this.itemStatus = res.itemStatus || 'ARCHIVED';
      },
      error: (err) => {
        this.errorMessage = '封存失敗';
        console.error(err);
      }
    });
  }

  onRestore(): void {
    this.http.patch(`/api/products/${this.productId}/item-status`, { itemStatus: 'ACTIVE' }).subscribe({
      next: (res: any) => {
        this.itemStatus = res.itemStatus || 'ACTIVE';
      },
      error: (err) => {
        this.errorMessage = '復用失敗';
        console.error(err);
      }
    });
  }

  onSubmit(): void {
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    const payload = {
      ...this.editForm.value,
      ...this.coreForm.getRawValue(),
    };

    this.http.put(`/api/products/${this.productId}`, payload).subscribe({
      next: () => {
        this.router.navigate(['/products', this.productId]);
      },
      error: (err) => {
        this.errorMessage = '更新失敗，請稍後再試';
        console.error(err);
      }
    });
  }
}
