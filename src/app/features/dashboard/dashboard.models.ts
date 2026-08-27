export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type DashboardUiState = 'default' | 'locked' | 'loading' | 'edge';
export type RiskLevel = 'HIGH' | 'MEDIUM';

export interface DashboardStatistics {
  totalProducts: number;
  pendingReviews: number;
  approvedProducts: number;
  rejectedProducts: number;
  conversionRate: number;
}

export interface DashboardRecommendation {
  id: number;
  rank: number;
  name: string;
  category: string;
  finalScore: number;
  reviewStatus: ReviewStatus;
  completeness: number;
  aiReason: string;
  submissionCount: number;
  previousRejectionSummary?: string;
}

export interface DashboardRiskAlert {
  id: number;
  productName: string;
  level: RiskLevel;
  message: string;
  detectedKeyword: string;
}

export interface DashboardMockData {
  generatedAt: string;
  statistics: DashboardStatistics;
  recommendations: readonly DashboardRecommendation[];
  riskAlerts: readonly DashboardRiskAlert[];
}
