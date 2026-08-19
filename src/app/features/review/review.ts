import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

export interface ReviewItem {
  id: number;
  name: string;
  submittedBy: string;
  status: string;
}

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './review.html',
  styleUrl: './review.scss'
})
export class ReviewComponent implements OnInit {
  pendingItems: ReviewItem[] = [];
  isLoading = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadPendingItems();
  }

  // 1. 取得待審核清單
  loadPendingItems() {
    this.isLoading = true;
    this.http.get<ReviewItem[]>('/api/review/pending').subscribe({
      next: (data) => {
        this.pendingItems = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('載入審核清單失敗', err);
        this.isLoading = false;
      }
    });
  }

  // 2. 審核通過
  approve(id: number) {
    this.http.post(`/api/review/approve/${id}`, {}).subscribe({
      next: () => {
        this.pendingItems = this.pendingItems.filter(item => item.id !== id);
      },
      error: (err) => console.error('審核通過失敗', err)
    });
  }

  // 3. 審核駁回
  reject(id: number) {
    this.http.post(`/api/review/reject/${id}`, {}).subscribe({
      next: () => {
        this.pendingItems = this.pendingItems.filter(item => item.id !== id);
      },
      error: (err) => console.error('駁回失敗', err)
    });
  }
}
