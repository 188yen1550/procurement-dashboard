import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiEnvelope } from '../../../core/api/api-envelope';
import { unwrapData } from '../../../core/api/unwrap';
import {
  DASHBOARD_API,
  DashboardConversionRateResponsePayload,
  DashboardRecommendationResponsePayload,
  DashboardRiskAlertResponsePayload,
  DashboardStatisticsResponsePayload,
} from './dashboard-api.contract';
import {
  ConversionRateModel,
  RecommendationItem,
  RiskAlertItem,
  toConversionRateModel,
  toRecommendationItem,
  toRiskAlertItem,
} from './dashboard.mapper';

/** loadAll() 的結果。任一區塊失敗時該欄位為 null，其餘照常顯示。 */
export interface DashboardData {
  statistics: DashboardStatisticsResponsePayload | null;
  recommendations: RecommendationItem[] | null;
  riskAlerts: RiskAlertItem[] | null;
  conversionRate: ConversionRateModel | null;
}

/** 儀表板 API 的唯一呼叫入口。 */
@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);

  /** 1. GET /api/dashboard/statistics */
  getStatistics(): Observable<DashboardStatisticsResponsePayload> {
    return this.http
      .get<ApiEnvelope<DashboardStatisticsResponsePayload>>(DASHBOARD_API.statistics)
      .pipe(unwrapData());
  }

  /** 2. GET /api/dashboard/recommendations：依 Final Score 排序的前 10 名。 */
  getRecommendations(): Observable<RecommendationItem[]> {
    return this.http
      .get<ApiEnvelope<DashboardRecommendationResponsePayload[]>>(
        DASHBOARD_API.recommendations,
      )
      .pipe(
        unwrapData(),
        map((items) => items.map(toRecommendationItem)),
      );
  }

  /** 3. GET /api/dashboard/risk-alerts：⚠️ 不限審核狀態，含已核准／已拒絕商品。 */
  getRiskAlerts(): Observable<RiskAlertItem[]> {
    return this.http
      .get<ApiEnvelope<DashboardRiskAlertResponsePayload[]>>(DASHBOARD_API.riskAlerts)
      .pipe(
        unwrapData(),
        map((items) => items.map(toRiskAlertItem)),
      );
  }

  /** 4. GET /api/dashboard/conversion-rate：⚠️ ratePercentage 可能為 null。 */
  getConversionRate(): Observable<ConversionRateModel> {
    return this.http
      .get<ApiEnvelope<DashboardConversionRateResponsePayload>>(DASHBOARD_API.conversionRate)
      .pipe(unwrapData(), map(toConversionRateModel));
  }

  /**
   * 一次載入四個區塊。
   *
   * ## 為什麼每一支都要 catchError
   *
   * forkJoin 的語意是「任一來源 error 就整個 error」。若不各自 catchError，
   * 儀表板任何一支 API 掛掉（例如 AI 分析服務暫時不可用導致 risk-alerts 500），
   * 整個儀表板就會空白——但統計卡片、轉換率其實都拿得到。
   *
   * 企劃書明確要求「任一支失敗只影響對應卡片，不應讓整頁空白」，
   * 這裡把失敗降級成 null，由樣板針對 null 顯示該卡片的 error 狀態。
   *
   * ## 為什麼不用 Promise.allSettled 的等價寫法
   * forkJoin + catchError 已經是 RxJS 的等價做法，且保留 Observable 語意，
   * 可以被 takeUntilDestroyed() 正常取消，不會在元件銷毀後還寫入 signal。
   */
  loadAll(): Observable<DashboardData> {
    return forkJoin({
      statistics: this.getStatistics().pipe(catchError(() => of(null))),
      recommendations: this.getRecommendations().pipe(catchError(() => of(null))),
      riskAlerts: this.getRiskAlerts().pipe(catchError(() => of(null))),
      conversionRate: this.getConversionRate().pipe(catchError(() => of(null))),
    });
  }
}
