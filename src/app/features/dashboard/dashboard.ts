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

  // 1. 統計卡片資料 (例如：總品項數、待審核數...)
  statsData = {
    totalProducts: 1250,
    pendingReview: 8,
    activeAlerts: 3
  };

  // 2. AI 推薦 Top 10 假資料
  aiRecommendations = [
    { rank: 1, name: '精選商品 A', score: 95 },
    { rank: 2, name: '精選商品 B', score: 92 },
    { rank: 3, name: '精選商品 C', score: 89 }
    // 可以依需求補到 10 筆
  ];

  // 3. 高風險示警假資料
  riskAlerts = [
    { id: 1, message: '品項 X 庫存偏低，建議即時補貨', level: 'high' },
    { id: 2, message: '品項 Y 近期退貨率異常升高', level: 'medium' }
  ];

  // 4. 選品轉換率資料
  conversionData = {
    rate: 15.8,
    trend: '+2.4%' // 相比上週
  };

  constructor(public authService: AuthService) {}
}
