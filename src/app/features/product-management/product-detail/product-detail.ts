import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';

export interface ProductDetailData {   // 改名，加上Data後綴
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

  product: ProductDetailData | null = null;   // 這裡跟著改
  isLoading = false;
  errorMessage = '';

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    this.product = {
      id: Number(id),
      name: `測試商品${id}`,
      description: '這是一個測試用的商品描述',
      supplierName: '測試供應商',
      pricingType: 'NEW',
      completenessPercent: 45,
      reviewStatus: 'PENDING'
    };
  }

  loadProduct(id: string) {
    this.isLoading = true;
    this.http.get<ProductDetailData>(`/api/products/${id}`).subscribe({   // 這裡也改
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

  get isLowCompleteness(): boolean {
    return (this.product?.completenessPercent ?? 100) < 60;
  }
}
