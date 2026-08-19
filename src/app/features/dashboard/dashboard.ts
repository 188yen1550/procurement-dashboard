import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/auth/auth';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class DashboardComponent {
  // 準備好讓畫面綁定的統計數據
  stats = {
    totalProducts: 24,
    pendingReview: 5,
    aiSuggestions: 12
  };

  constructor(public authService: AuthService) {}
}
