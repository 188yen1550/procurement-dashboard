/**
 * 檔案用途：Dashboard 的統計卡片、Top 10、風險與轉換率。
 * AI 推薦只提供排序與理由，永遠不會在此元件自動把商品核准。
 *
 * ## 這次接上真實 API 做了什麼
 *
 * 1. Mock 模式完全不動——`uiState` 的四個示範狀態（一般／鎖定／載入／例外）
 *    是給 PM／利害關係人展示畫面樣貌用的，跟真實資料無關，繼續保留。
 *
 * 2. 真實模式走一條獨立的載入流程（`realLoadState`），呼叫
 *    `DashboardApiService.loadAll()` 後，把四支 API 的結果組成
 *    跟 Mock 同一個形狀（`DashboardMockData`），這樣樣板幾乎不用改——
 *    只需要在後端真的沒有的欄位（category／completeness／reviewStatus／level）
 *    補上 null 的安全判斷。
 *
 * 3. `retry()` 在真實模式下改成真的重新呼叫 API，不是原本純本地的
 *    setTimeout 模擬。
 *
 * ## ⚠️ 真實模式下的資料落差（已知限制，非本次能修正）
 *
 * 後端 DashboardRecommendationItem／DashboardRiskAlertItem 遠比 Mock 單薄：
 * - Top10 項目沒有 productTypeId、dataCompleteness、reviewStatus
 * - 風險項目沒有 HIGH/MEDIUM 分級，只有命中關鍵字與 AI 全文
 *
 * 這些欄位在真實模式下一律顯示為「—」或隱藏對應的樣式判斷，
 * 不去猜測或假造數值。若要補齊，需要後端在對應 DTO 加欄位——
 * 例如 productTypeId 這種其他端點已有的欄位，遷移成本應該很低。
 */
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { toApiError } from '../../core/api/api-error';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';
import { DashboardApiService, DashboardData } from './api/dashboard-api.service';
import { DASHBOARD_MOCK_DATA, INCOMPLETE_RECOMMENDATION } from './dashboard.mock-data';
import {
  DashboardMockData,
  DashboardRecommendation,
  DashboardUiState,
  ReviewStatus,
  RiskLevel,
} from './dashboard.models';

/** 後端真的沒有這個資訊時的統一顯示字串，避免跟真的空字串混淆。 */
const NOT_PROVIDED = '—';

/** 真實模式尚未載入完成時的預設空殼，避免樣板在載入瞬間讀到 undefined。 */
const EMPTY_DASHBOARD: DashboardMockData = {
  generatedAt: '',
  statistics: {
    totalProducts: 0,
    pendingReviews: 0,
    approvedProducts: 0,
    rejectedProducts: 0,
    conversionRate: null,
  },
  recommendations: [],
  riskAlerts: [],
};

type RealLoadState = 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss', './dashboard-actions.scss'],
})
export class Dashboard implements OnInit {
  private readonly api = inject(DashboardApiService);
  private readonly productTypes = inject(ProductTypeLookupService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;

  /** 只在 Mock 模式下有意義的示範狀態；真實模式一律走 realLoadState。 */
  readonly uiState = signal<DashboardUiState>('default');
  readonly conflictDialogOpen = signal(false);
  readonly incompleteRecommendation = INCOMPLETE_RECOMMENDATION;

  readonly realLoadState = signal<RealLoadState>('loading');
  readonly realData = signal<DashboardMockData>(EMPTY_DASHBOARD);
  readonly errorMessage = signal('');

  /** 兩種模式共用的畫面資料來源，樣板只認這一個 signal。 */
  readonly data = computed<DashboardMockData>(() =>
    this.useMockData ? DASHBOARD_MOCK_DATA : this.realData(),
  );

  readonly recommendations = computed<readonly DashboardRecommendation[]>(() => {
    // 鎖定示範只在 Mock 模式下才需要模擬「全部變成已核准」的畫面。
    if (!this.useMockData || this.uiState() !== 'locked') return this.data().recommendations;

    return this.data().recommendations.map((item) => ({
      ...item,
      reviewStatus: 'APPROVED' as const,
    }));
  });

  ngOnInit(): void {
    if (!this.useMockData) this.load();
  }

  /**
   * GET 四支 dashboard 端點 + 商品類型對照表。
   * ⚠️ 對照表查詢不進 loadAll() 的降級邏輯：ProductTypeLookupService.getNameMap()
   * 本身已有 catchError 降級成空 Map，失敗時分類只會顯示「—」，不影響其餘資料。
   */
  load(): void {
    this.realLoadState.set('loading');
    forkJoin({
      dashboard: this.api.loadAll(),
      productTypeNameById: this.productTypes.getNameMap(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ dashboard: result, productTypeNameById }) => {
          this.realData.set(toDashboardPageData(result, productTypeNameById));
          this.realLoadState.set('loaded');

          const failedParts = [
            result.statistics === null && '統計卡片',
            result.recommendations === null && 'AI 推薦',
            result.riskAlerts === null && '風險提示',
            result.conversionRate === null && '轉換率',
          ].filter((label): label is string => Boolean(label));

          this.errorMessage.set(
            failedParts.length > 0 ? `${failedParts.join('、')}載入失敗，其餘資料仍可檢視。` : '',
          );
        },
        error: (err) => {
          this.realLoadState.set('error');
          this.errorMessage.set(toApiError(err).message);
        },
      });
  }

  // ----- Mock 模式的示範狀態切換（不呼叫 API）-----

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

  /** Mock 模式模擬重新載入的動畫；真實模式改為真的重打四支 API。 */
  public retry(): void {
    if (!this.useMockData) {
      this.load();
      return;
    }
    this.uiState.set('loading');
    setTimeout(() => this.uiState.set('default'), 700);
  }

  public statusLabel(status: ReviewStatus | null): string {
    if (status === null) return NOT_PROVIDED;
    const labels: Record<ReviewStatus, string> = {
      PENDING: '未審核',
      APPROVED: '已通過選品審核',
      REJECTED: '未通過',
    };
    return labels[status];
  }

  /**
   * 完整度是否可顯示門檻判斷。
   * ⚠️ 一定要先判斷這個，樣板才能安全比較 `< 60`——
   * completeness 為 null 時 `null < 60` 在 JS 是 true，直接比較會誤報「資料待補」。
   */
  public hasCompleteness(item: DashboardRecommendation): boolean {
    return item.completeness !== null;
  }

  public riskLevelLabel(level: RiskLevel | null): string {
    if (level === 'HIGH') return '高風險';
    if (level === 'MEDIUM') return '需留意';
    return '示警';
  }
}

/**
 * DashboardApiService.loadAll() 的結果 → 樣板要的 DashboardMockData 形狀。
 *
 * 任一區塊為 null（該支 API 失敗）時填入空集合／預設值，讓樣板不用另外
 * 判斷「這一區是不是失敗了」，統一交給 load() 的 errorMessage 提示使用者。
 */
function toDashboardPageData(
  result: DashboardData,
  productTypeNameById: Map<number, string>,
): DashboardMockData {
  return {
    generatedAt: new Date().toLocaleString('zh-Hant'),
    statistics: {
      totalProducts: result.statistics?.totalProducts ?? 0,
      pendingReviews: result.statistics?.pendingCount ?? 0,
      approvedProducts: result.statistics?.approvedCount ?? 0,
      rejectedProducts: result.statistics?.rejectedCount ?? 0,
      // hasData 為 false 時（尚無商品送審過）維持 null，不要顯示成 0%。
      conversionRate:
        result.conversionRate?.hasData ? result.conversionRate.ratePercentage : null,
    },
    recommendations: (result.recommendations ?? []).map((item, index) => ({
      id: item.productId,
      rank: index + 1,
      name: item.productName,
      // 後端這次補上 productTypeId，對照設定 API 取得中文分類名稱；
      // 對照不到（例如分類被刪除）才顯示 NOT_PROVIDED。
      category:
        item.productTypeId === null
          ? NOT_PROVIDED
          : (productTypeNameById.get(item.productTypeId) ?? NOT_PROVIDED),
      finalScore: item.finalScore ?? 0,
      // ⚠️ 這裡固定寫 'PENDING'，不是猜測值：後端 getRecommendations() 呼叫
      // findTopRecommendations() 時 reviewStatus 參數寫死傳入 PENDING
      // （見 DashboardService.java 類別註解引用的企劃書 QA4：「只有 CANDIDATE
      // 狀態商品才會出現在推薦清單裡」），查詢條件本身保證這份清單裡
      // 每一筆的審核狀態一定是 PENDING，不需要後端額外提供這個欄位。
      reviewStatus: 'PENDING',
      // 後端這次補上：dataCompleteness 與 finalScore 來自同一個已查出的
      // ProductEvaluation，沒有額外查詢成本。找不到評估紀錄時仍可能是 null。
      completeness: item.dataCompleteness,
      // ⚠️ 後端沒有「為什麼推薦」這段文字欄位。之前一度誤用
      // lastRejectionComment 頂替，但那是「上次被拒絕的原因」，
      // 語意完全不同，繼續沿用會讓使用者誤以為系統在說明推薦理由，
      // 實際上讀到的是拒絕理由。誠實顯示沒有資料即可。
      aiReason: NOT_PROVIDED,
      submissionCount: item.submissionCount,
      previousRejectionSummary: item.isReentry ? item.lastRejectionComment : undefined,
    })),
    riskAlerts: (result.riskAlerts ?? []).map((item) => ({
      id: item.productId,
      productName: item.productName,
      // 後端沒有風險嚴重度分級概念，不自行假造 HIGH/MEDIUM。
      level: null,
      // aiReasons 是完整 AI 分析文字（可能較長），不是 Mock 那種精簡人工摘要，
      // 但樣板只是把它當一段文字顯示，不影響版面結構。
      message: item.aiReasons,
      // 可能同時命中多個關鍵字，用頓號合併方便單行顯示。
      detectedKeyword: item.matchedKeywords.join('、') || NOT_PROVIDED,
    })),
  };
}
