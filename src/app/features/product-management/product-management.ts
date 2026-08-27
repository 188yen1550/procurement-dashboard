import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';

export interface Product {
  id?: number;
  name: string;
  price: number;
  status: string;
  reviewStatus?: string;
  itemStatus?: string;
  candidateStatus?: string;
}

@Component({
  selector: 'app-product-management',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-management.html',
  styleUrl: './product-management.scss',
})
export class ProductManagement implements OnInit {
  products: Product[] = [];
  isLoading = false;

  filters = {
    reviewStatus: '',
    itemStatus: '',
    candidateStatus: ''
  };

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // this.loadProducts();  // 後端好了之後，改回這行

    // ↓↓↓ 暫時測試用假資料，後端確認好之後刪掉這段 ↓↓↓
    this.products = [
      { id: 1, name: '測試商品A', price: 100, status: 'ACTIVE', reviewStatus: 'PENDING' },
      { id: 2, name: '測試商品B', price: 200, status: 'ACTIVE', reviewStatus: 'APPROVED' },
      { id: 3, name: '測試商品C', price: 300, status: 'ACTIVE', reviewStatus: 'REJECTED' },
    ];
  }

  loadProducts() {
    this.isLoading = true;
    const params: any = {};
    if (this.filters.reviewStatus) params.reviewStatus = this.filters.reviewStatus;
    if (this.filters.itemStatus) params.itemStatus = this.filters.itemStatus;
    if (this.filters.candidateStatus) params.candidateStatus = this.filters.candidateStatus;

    this.http.get<Product[]>('/api/products', { params }).subscribe({
      next: (data) => {
        this.products = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('載入品項失敗', err);
        this.isLoading = false;
      },
    });
  }

  onFilterChange() {
    this.loadProducts();
  }

  resetFilters() {
    this.filters = { reviewStatus: '', itemStatus: '', candidateStatus: '' };
    this.loadProducts();
  }

  deleteProduct(id: number) {
    this.http.delete(`/api/products/${id}`).subscribe({
      next: () => {
        this.products = this.products.filter((p) => p.id !== id);
      },
      error: (err) => {
        console.error('刪除失敗', err);
      },
    });
  }
}
