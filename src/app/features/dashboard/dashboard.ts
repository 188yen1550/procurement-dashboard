import { Component, computed, signal } from '@angular/core';
import { DASHBOARD_MOCK_DATA, INCOMPLETE_RECOMMENDATION } from './dashboard.mock-data';
import { DashboardRecommendation, DashboardUiState, ReviewStatus } from './dashboard.models';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  readonly data = DASHBOARD_MOCK_DATA;
  readonly incompleteRecommendation = INCOMPLETE_RECOMMENDATION;
  readonly uiState = signal<DashboardUiState>('default');
  readonly conflictDialogOpen = signal(false);

  readonly recommendations = computed<readonly DashboardRecommendation[]>(() => {
    if (this.uiState() !== 'locked') return this.data.recommendations;

    return this.data.recommendations.map((item) => ({
      ...item,
      reviewStatus: 'APPROVED' as const,
    }));
  });

  public setUiState(state: DashboardUiState): void {
    this.uiState.set(state);
    this.conflictDialogOpen.set(false);
  }

  public openConflictDialog(): void {
    this.conflictDialogOpen.set(true);
  }

  public closeConflictDialog(): void {
    this.conflictDialogOpen.set(false);
  }

  public retry(): void {
    this.uiState.set('loading');
    setTimeout(() => this.uiState.set('default'), 700);
  }

  public statusLabel(status: ReviewStatus): string {
    const labels: Record<ReviewStatus, string> = {
      PENDING: '未審核',
      APPROVED: '已通過選品審核',
      REJECTED: '未通過',
    };
    return labels[status];
  }
}
