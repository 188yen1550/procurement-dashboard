import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

export interface Product {
  id?: number;
  name: string;
  price: number;
  status: string;
  reviewStatus?: string;   // PENDING / APPROVED / REJECTED
  itemStatus?: string;     // ACTIVE / ARCHIVED
  candidateStatus?: string; // CANDIDATE / AI_SUGGESTED
}

@Component({
  selector: 'app-product-management',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product-management.html',
  styleUrl: './product-management.scss'
})
export class ProductManagement implements OnInit {
  products: Product[] = [];
  isLoading = false;

  // 三欄位篩選條件
  filters = {
    reviewStatus: '',
    itemStatus: '',
    candidateStatus: ''
  };

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadProducts();
  }

  loadProducts() {
    this.isLoading = true;
    // 把篩選條件組成query params
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
      }
    });
  }

  onFilterChange() {
    this.loadProducts(); // 篩選條件一變就重新打API
  }

  resetFilters() {
    this.filters = { reviewStatus: '', itemStatus: '', candidateStatus: '' };
    this.loadProducts();
  }

  deleteProduct(id: number) {
    this.http.delete(`/api/products/${id}`).subscribe({
      next: () => {
        this.products = this.products.filter(p => p.id !== id);
      },
      error: (err) => console.error('刪除失敗', err)
    });
  }
}
