/**
 * 檔案用途：Dashboard 的統計卡片、Top 10、風險與轉換率。
 * 真實模式合併統計、推薦、風險與轉換率 API；展示模式提供本地狀態預覽。
 * AI 推薦只提供決策資訊，不會自動核准商品。
 */
import { ListSort, SortHeader, SortRowsPipe, ListSortControls } from '../../shared/ui/list-sort';
import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import Chart from 'chart.js/auto';
import { APP_CONFIG } from '../../core/config/app-config';
import { AuthService } from '../../core/auth/auth';
import { toApiError } from '../../core/api/api-error';
import { reloadOnRevisit } from '../../core/router/reload-on-revisit';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';
import { DashboardApiService, DashboardData } from './api/dashboard-api.service';
import { DASHBOARD_MOCK_DATA, INCOMPLETE_RECOMMENDATION } from './dashboard.mock-data';
import {
  DashboardMockData,
  DashboardRecommendation,
  DashboardUiState,
  ReviewStatus,
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
    aiSuggestedPending: 0,
    conversionRate: null,
  },
  recommendations: [],
  riskAlerts: [],
};

type RealLoadState = 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-dashboard',
  imports: [ListSortControls, SortHeader, SortRowsPipe, RouterLink],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss', './dashboard-actions.scss'],
})
export class Dashboard implements OnInit, OnDestroy {
  readonly riskListSort = new ListSort();
  readonly riskListSortChoices = [
    { key: 'productName', label: '商品名稱' },
    { key: 'detectedKeyword', label: '命中關鍵字' },
  ];
  readonly recommendationSortChoices = [
    { key: 'rank', label: '排名' },
    { key: 'name|aiReason', label: '商品與推薦理由' },
    { key: 'completeness', label: '完整度' },
    { key: 'finalScore', label: '最終分數' },
  ];
  readonly recommendationSort = new ListSort();
  private readonly api = inject(DashboardApiService);
  private readonly productTypes = inject(ProductTypeLookupService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * 管理層／操作層各自獨立設計的畫面重點：管理層的治理責任是留意風險
   * 提示（審核時要不要特別留意），操作層的日常工作是根據 AI 推薦排序
   * 決定要優先處理哪些候選商品。兩支 API 權限上操作層都能呼叫（後端
   * 沒有限制），這裡純粹是畫面呈現的優先順序決定，不是資料存取限制——
   * 風險提示面板只在管理層畫面出現，操作層畫面把版面讓給更大的推薦清單。
   */
  readonly isManager = computed(() => this.auth.isManager());

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

  // ----- 狀態分布圖表（chart.js）-----
  @ViewChild('statusChartCanvas') private readonly statusChartCanvas?: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  /**
   * 用 effect() 而非在 load() 成功回呼裡手動畫圖，是因為 Mock 模式完全
   * 不會呼叫 load()——讓圖表跟著 data() 這個 computed signal 走，不論
   * 資料從哪個管道更新（Mock 常數／真實 API／使用者切換示範狀態）都會
   * 自動重繪，不需要在每個資料來源各自呼叫一次畫圖方法。
   *
   * ⚠️ 原本這裡用一般的 effect()，實際會有「第一次進頁面圖表是空白的，
   * 要切到別的分頁再切回來才畫得出來」的問題：real 模式下 data() 是在
   * HttpClient 的 subscribe 回呼裡才變成有值，這個時間點跟 Angular 把
   * 樣板從 skeleton 換成正式內容（canvas 元素這時才存在於 DOM 裡）不是
   * 同一個時機——effect() 的排程可能搶在 change detection 真的把 canvas
   * 掛上 DOM、@ViewChild 更新完成「之前」就先跑一次，讀到的 canvas 還是
   * undefined，於是整次被跳過；之後沒有其他事件會再次觸發它，圖表就一直
   * 空著，直到元件被整個銷毀重建（離開頁面再回來）才「湊巧」重新對上。
   *
   * afterRenderEffect() 是 Angular 專門為了這種「effect 內要安全讀 DOM／
   * ViewChild」設計的 API：保證在每次畫面實際渲染「之後」才執行，不會有
   * 上述的競態。專案裡 core/dialog/modal-surface.ts 處理 focus 也是靠同一
   * 家族的 afterNextRender／afterEveryRender，這裡沿用一致的做法。
   */
  private readonly renderStatusChartEffect = afterRenderEffect(() => {
    // 讀取 data() 建立依賴——待審／通過／未通過三個數字任一變動，
    // 圖表都要重新畫。canvas 在 skeleton／empty／error 狀態下不存在，
    // ViewChild 拿到 undefined 時直接跳過，不強行畫圖到不存在的元素上。
    const stats = this.data().statistics;
    const canvas = this.statusChartCanvas?.nativeElement;
    if (!canvas) return;

    const chartData = {
      labels: ['待審核', '已通過', '未通過'],
      datasets: [
        {
          data: [stats.pendingReviews, stats.approvedProducts, stats.rejectedProducts],
          backgroundColor: ['#d19a32', '#379773', '#c76661'],
          borderWidth: 0,
        },
      ],
    };

    if (this.chart) {
      this.chart.data = chartData;
      this.chart.update();
      return;
    }

    this.chart = new Chart(canvas, {
      type: 'doughnut',
      data: chartData,
      options: {
        // ⚠️ maintainAspectRatio 預設是 true，會強迫 canvas 維持固定長寬比，
        // 跟 .status-chart-wrap 用 CSS 明確指定 height: 260px、寬度卻吃滿
        // 較寬的 grid 欄位互相打架——結果是圖只長到跟高度一樣的正方形，
        // 卡在容器左側，右邊留一大塊空白（「明顯偏左」的成因）。容器已經
        // 用 CSS 決定好寬高時，這裡要關掉 maintainAspectRatio，讓 Chart.js
        // 直接吃滿 .status-chart-wrap 的實際框，甜甜圈才會置中。
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        },
      },
    });
  });

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

  constructor() {
    // 使用者原地重新點擊「儀表板」連結時，ngOnInit() 不會再被觸發
    // （元件沒有被銷毀重建），要靠這裡才能重新抓最新數字。Mock 模式
    // 沒有真正的資料來源可以重抓，不套用這個行為，避免每次點擊
    // 都把使用者正在操作的展示狀態重置掉。
    if (!this.useMockData) reloadOnRevisit(() => this.load());
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

  /**
   * 完整度是否可顯示門檻判斷。
   * ⚠️ 一定要先判斷這個，樣板才能安全比較 `< 60`——
   * completeness 為 null 時 `null < 60` 在 JS 是 true，直接比較會誤報「資料待補」。
   */
  public hasCompleteness(item: DashboardRecommendation): boolean {
    return item.completeness !== null;
  }

  /** 跟 hasCompleteness() 同樣的理由：null !== 0，不能直接拿 finalScore 當數字比較或顯示。 */
  public hasFinalScore(item: DashboardRecommendation): boolean {
    return item.finalScore !== null;
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
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
      aiSuggestedPending: result.statistics?.aiSuggestedPendingCount ?? 0,
      // hasData 為 false 時（尚無商品送審過）維持 null，不要顯示成 0%。
      conversionRate:
        result.conversionRate?.hasData ? result.conversionRate.ratePercentage : null,
    },
    recommendations: (result.recommendations ?? []).map((item, index) => ({
      id: item.productId,
      rank: index + 1,
      name: item.productName,
      // 以 productTypeId 對照設定 API 取得中文分類名稱；
      // 對照不到（例如分類被刪除）才顯示 NOT_PROVIDED。
      category:
        item.productTypeId === null
          ? NOT_PROVIDED
          : (productTypeNameById.get(item.productTypeId) ?? NOT_PROVIDED),
      finalScore: item.finalScore,
      // ⚠️ 這裡固定寫 'PENDING'，不是猜測值：後端 getRecommendations() 呼叫
      // findTopRecommendations() 時 reviewStatus 參數寫死傳入 PENDING
      // （見 DashboardService.java 類別註解引用的企劃書 QA4：「只有 CANDIDATE
      // 狀態商品才會出現在推薦清單裡」），查詢條件本身保證這份清單裡
      // 每一筆的審核狀態一定是 PENDING，不需要後端額外提供這個欄位。
      reviewStatus: 'PENDING',
      // dataCompleteness 與 finalScore 來自同一筆已查出的
      // ProductEvaluation，沒有額外查詢成本。找不到評估紀錄時仍可能是 null。
      completeness: item.dataCompleteness,
      // Dashboard 推薦端點未提供推薦理由；拒絕留言保留給重新送審提示。
      aiReason: NOT_PROVIDED,
      submissionCount: item.submissionCount,
      previousRejectionSummary: item.isReentry ? item.lastRejectionComment : undefined,
    })),
    riskAlerts: (result.riskAlerts ?? []).map((item) => ({
      id: item.productId,
      productName: item.productName,
      // aiReasons 是完整 AI 分析文字（可能較長），不是 Mock 那種精簡人工摘要，
      // 但樣板只是把它當一段文字顯示，不影響版面結構。
      message: item.aiReasons,
      // 可能同時命中多個關鍵字，用頓號合併方便單行顯示。
      detectedKeyword: item.matchedKeywords.join('、') || NOT_PROVIDED,
    })),
  };
}
