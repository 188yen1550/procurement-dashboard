import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';

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
  isLoading = false;
  errorMessage = '';

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
     // ↓↓↓ 暫時測試用，之後改回 this.loadProduct(); ↓↓↓
  this.reviewStatus = 'APPROVED';

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

  // this.loadProduct();
  }

  loadProduct() {
    this.isLoading = true;
    this.http.get<any>(`/api/products/${this.productId}`).subscribe({
      next: (data) => {
        this.reviewStatus = data.reviewStatus;

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

  get isCoreLocked(): boolean {
    return this.reviewStatus === 'APPROVED';
  }

  onSubmit(): void {
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    // 用 getRawValue() 而不是 value，
    // 因為 disable 的欄位用 .value 拿不到值，但PUT可能還是要把原值一起送回去
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
