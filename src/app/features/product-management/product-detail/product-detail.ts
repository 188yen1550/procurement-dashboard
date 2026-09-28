/**
 * 檔案用途：品項詳情的評分拆解、圖片、趨勢、AI、封存／復用與各種本地 UI 狀態。
 * Final Score = Base Score + Festival Boost；APPROVED 顯示 SNAPSHOT，其餘狀態顯示 LIVE。
 */
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import Chart from 'chart.js/auto';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toApiError } from '../../../core/api/api-error';
import { AI_ANALYSIS_TIMEOUT_MS, TREND_SYNC_TIMEOUT_MS } from '../../../core/api/request-timeout';
import { createDismissibleMessage } from '../../../core/ui/auto-dismiss';
import { DialogService } from '../../../core/dialog/dialog.service';
import { Auth } from '../../../core/auth/auth';
import {
  GATE_CODE_LABEL,
  GATE_STATUS_LABEL,
  PACKAGE_SIZE_TIER_LABEL,
  PACKING_TYPE_LABEL,
  PRICE_COMPETITIVENESS_LEVEL_LABEL,
  REVIEW_STATUS_LABEL,
  SHELF_LIFE_TIER_LABEL,
  SUPPLIER_LEAD_TIME_TIER_LABEL,
  SUPPLY_STABILITY_LEVEL_LABEL,
  TEMPERATURE_ZONE_LABEL,
} from '../../../core/domain/labels';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import { GoogleTrendSignal, GoogleTrendsApiService, roundGrowthRate } from '../../settings/api/google-trends-api.service';
import { ProductApiService } from '../api/product-api.service';
import { WeatherBoostDetailPayload } from '../api/product-api.contract';
import { Icon } from '../../../shared/components/icon/icon';
import { ReviewRecordModel } from '../../review/api/review.mapper';
import { AiAnalysisModel, TrendHistoryPoint, TrendModel, toProductActionAvailability } from '../api/product.mapper';
import { splitAiReasonLines } from '../../../core/ui/ai-reason-lines';
import { brandColor } from '../../../core/ui/brand-color';
import { ListSort, ListSortControls, SortRowsPipe } from '../../../shared/ui/list-sort';
import { InfoTip } from '../../../shared/components/info-tip/info-tip';
import {
  DetailExtras,
  DetailProduct,
  DetailState,
  ItemStatus,
  ReviewStatus,
  toDetailProduct,
} from './product-detail.model';
import { CandidateStatus } from '../../../core/domain/enums';

/**
 * 把 AiAnalysisModel 轉成 toDetailProduct() 要的 extras 形狀。
 *
 * ⚠️ hasAnalysis 為 false 代表後端回了全欄位 null 的物件（尚未生成過分析），
 * 不是錯誤狀態；這裡統一轉成 aiSummary: null，畫面顯示「尚未產生」的空狀態，
 * 不要顯示成載入失敗。
 *
 * ⚠️ 後端 reasons 是單一字串，不是陣列（跟舊版 Mock 資料的陣列形狀不同）。
 * 依 splitAiReasonLines() 拆成陣列只是為了沿用既有的條列樣式，不是後端
 * 保證的格式——LLM 有時會把「1. …2. …3. …」擠在同一行沒有換行，
 * splitAiReasonLines() 會退而用編號標記拆行（見該檔案註解，說明為何不用
 * 「。」句號判斷）；兩種拆法都拆不出多行時，就是單一元素的陣列，
 * 顯示成一行，這是合理的降級，不是錯誤。
 */
function toAiExtras(
  analysis: AiAnalysisModel | null,
): { aiSummary: string | null; aiReasons: string[] } {
  if (!analysis || !analysis.hasAnalysis) {
    return { aiSummary: null, aiReasons: [] };
  }
  return {
    aiSummary: analysis.summary,
    aiReasons: splitAiReasonLines(analysis.reasons),
  };
}

/**
 * 把 TrendModel（GET /trend 或 POST /trend/sync 的回傳）轉成 extras 的趨勢欄位。
 * 尚無趨勢資料（null）時回傳空物件，由 toDetailProduct() 套預設值。
 */
function toTrendExtras(trend: TrendModel | null): Partial<DetailExtras> {
  if (!trend) return {};
  return {
    trendDirection: trend.trendDirection,
    lastSyncedAt: trend.collectedAt ?? '',
    trendSource: trend.source,
    trendKeyword: trend.keyword,
    popularityScore: trend.popularityScore,
  };
}

/**
 * ⚠️ 2026-09-25 新增：展示模式的熱度趨勢圖示範資料，7 個點模擬「先漲後跌」
 * 的走勢。collectedAt 故意寫死日期字串（不用 new Date() 算相對日期），
 * 保持展示模式輸出穩定、可預期，跟專案裡其他 Mock 常數的一貫做法一致。
 */
const MOCK_TREND_HISTORY: TrendHistoryPoint[] = [
  { collectedAt: '2026-08-26T02:00:00', popularityScore: 52.3, trendDirection: 'STABLE' },
  { collectedAt: '2026-08-27T02:00:00', popularityScore: 58.1, trendDirection: 'UP' },
  { collectedAt: '2026-08-28T02:00:00', popularityScore: 64.7, trendDirection: 'UP' },
  { collectedAt: '2026-08-29T02:00:00', popularityScore: 73.5, trendDirection: 'UP' },
  { collectedAt: '2026-08-30T02:00:00', popularityScore: 84.37, trendDirection: 'UP' },
  { collectedAt: '2026-08-31T02:00:00', popularityScore: 79.2, trendDirection: 'DOWN' },
  { collectedAt: '2026-09-01T02:00:00', popularityScore: 71.0, trendDirection: 'DOWN' },
];

const APPROVED: DetailProduct = {
  id: 101,
  name: '中秋炭烤海陸組合禮盒',
  category: '食品／生鮮',
  pricingType: 'RESALE',
  supplier: '潮港鮮物有限公司',
  reviewStatus: 'APPROVED',
  itemStatus: 'ACTIVE',
  candidateStatus: 'CANDIDATE',
  submissionCount: 1,
  dataSource: 'SNAPSHOT',
  evaluationModeName: '均衡模式 · Version 1',
  completeness: 96,
  baseScore: 88.2,
  festivalBoost: 4.2,
  weatherBoost: 0,
  weatherDetail: null,
  finalScore: 92.4,
  campaign: '中秋節',
  campaignScope: '2026-09-25 · 全國',
  matchedTags: ['bbq', 'gift'],
  matchWeight: 1.0,
  urgencyFactor: 0.84,
  costPrice: 820,
  salePrice: 1190,
  marketPrice: 1490,
  moq: 50,
  // ⚠️ 1–5 整數等級（見 ScoreLevel），不是 0–5 分制小數。
  supplyStability: 5,
  priceCompetitiveness: 4,
  audienceScore: 91,
  audience: '25–45 歲家庭與公司團購',
  historicalScore: 84,
  historicalNote: '去年同類烤肉組合在節前 30 天銷售成長 18%。',
  purchaseScore: 86,
  trendScore: 90,
  trendDirection: 'UP',
  lastSyncedAt: '2026-08-31T09:20:00+08:00',
  trendSource: 'PTT',
  trendKeyword: '中秋炭烤海陸組合禮盒',
  popularityScore: 78,
  aiSummary: '節慶標籤與當前檔期高度吻合，供應穩定且價格具競爭力，建議維持人工確認供貨排程。',
  aiReasons: ['中秋烤肉需求與 bbq 標籤相符', '團購價較市價低 20%', '近期搜尋熱度呈上升'],
  risks: ['最低訂購量 50 組，需確認冷鏈倉儲容量', '節前物流高峰可能延遲'],
  description: '適合中秋家庭與企業團購的海陸烤肉組合。',
  imageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"%3E%3Crect width="800" height="600" fill="%23e8f2ed"/%3E%3Ccircle cx="400" cy="270" r="150" fill="%2339735c"/%3E%3Cpath d="M290 300h220l-35 125H325z" fill="%23fff"/%3E%3Ctext x="400" y="510" text-anchor="middle" font-family="sans-serif" font-size="38" fill="%23243447"%3EProduct Mock%3C/text%3E%3C/svg%3E',
  temperatureZone: 'FROZEN',
  shelfLifeTier: 'D90_PLUS',
  supplierLeadTimeTier: 'D4_7',
  packageSizeTier: 'M',
  packingType: 'WHOLE_CARTON',
  handlingFlags: null,
  certificationFlags: null,
  supplierMaxCapacity: 300,
  gateResults: {
    results: [
      { gateCode: 'GATE_MOQ_FEASIBILITY', status: 'PASSED', reason: '解析後 MOQ 50 組，低於該品類 P75 基準 80 組。', riskCategory: null },
      { gateCode: 'GATE_LEAD_TIME', status: 'PASSED', reason: '前置期 4-7 天，距中秋檔期尚有 18 天，備貨充裕。', riskCategory: null },
      { gateCode: 'GATE_SHELF_LIFE', status: 'PASSED', reason: '效期 90 天以上，高於品類門檻 21 天。', riskCategory: null },
      { gateCode: 'GATE_TEMPERATURE_ZONE', status: 'PASSED', reason: '冷凍溫層在通路支援範圍內。', riskCategory: null },
      { gateCode: 'GATE_DATA_COMPLETENESS', status: 'PASSED', reason: '資料完整度 96%，高於 60% 門檻。', riskCategory: null },
    ],
    passedCount: 5,
    failedCount: 0,
    insufficientDataCount: 0,
    notApplicableCount: 0,
  },
};
const INCOMPLETE: DetailProduct = {
  ...APPROVED,
  id: 104,
  name: '超輕量折疊收納推車',
  category: '生活雜貨',
  pricingType: 'NEW',
  supplier: '簡居創意工坊',
  reviewStatus: 'PENDING',
  submissionCount: 1,
  dataSource: 'LIVE',
  completeness: 48,
  baseScore: null,
  festivalBoost: 0,
  weatherBoost: 0,
  weatherDetail: null,
  finalScore: null,
  campaign: null,
  campaignScope: null,
  matchedTags: [],
  costPrice: null,
  salePrice: null,
  marketPrice: null,
  audienceScore: 0,
  historicalScore: 0,
  purchaseScore: 0,
  trendScore: 0,
  trendDirection: 'STABLE',
  lastSyncedAt: '',
  trendSource: null,
  trendKeyword: null,
  popularityScore: null,
  aiSummary: null,
  aiReasons: [],
  risks: [],
  description: '商品資料尚未補齊，目前僅供編輯與查看。',
  imageUrl: null,
  temperatureZone: null,
  shelfLifeTier: null,
  supplierLeadTimeTier: null,
  packageSizeTier: null,
  packingType: null,
  handlingFlags: null,
  certificationFlags: null,
  supplierMaxCapacity: null,
  gateResults: null,
};

@Component({
  selector: 'app-product-detail',
  imports: [CommonModule, RouterLink, Icon, ListSortControls, SortRowsPipe, InfoTip],
  templateUrl: './product-detail.html',
  styleUrls: [
    './product-detail.scss',
    './product-detail-image.scss',
    './product-detail-history.scss',
    './product-detail-google-trend.scss',
  ],
})
/** 品項詳情頁元件；Mock 模式使用本地資料，正式模式保留 master 的商品 API 整合。 */
export class ProductDetail implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ProductApiService);
  private readonly productTypes = inject(ProductTypeLookupService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly productId = this.route.snapshot.paramMap.get('id') ?? '';
  /**
   * 從哪裡點進來的。review.html 的「歷次決策紀錄」表格點商品名稱會連到
   * 這頁（見 review.html），但返回連結原本寫死 routerLink="/products"，
   * 從決策紀錄點進來的人按返回卻被送去品項管理頁，不是原本的決策紀錄頁籤。
   * 這裡讀取來源頁帶的 query param，讓返回連結能回到真正的來源。
   */
  readonly returnTo = signal<'review-records' | null>(
    this.route.snapshot.queryParamMap.get('returnTo') === 'review-records'
      ? 'review-records'
      : null,
  );
  readonly useMockData = APP_CONFIG.useMockData;

  /**
   * 2026-09-24 職責分離（決策 D1／D3）：管理層可以進這頁，但只能看。
   * 選品資料的建立與維護屬於操作層，後端 ProductController 寫入端點與
   * AI 分析 generate 已限定 PURCHASER；這裡把所有會呼叫寫入 API 的入口
   * （編輯／重審／補齊資料／產生 AI 分析／趨勢更新／封存復用）一併隱藏，
   * 避免管理層按下去才收到 403。
   */
  readonly readOnly = inject(Auth).isManager();
  readonly gateCodeLabel = GATE_CODE_LABEL;
  /** 這件商品自己的歷次審核紀錄，時間新→舊排序，供頁面下方新增的區塊顯示。 */
  readonly reviewHistory = signal<ReviewRecordModel[]>([]);
  readonly trendHistory = signal<TrendHistoryPoint[]>([]);

  // ----- Google 趨勢參考（2026-09-28，SerpApi）-----
  // 獨立參考資訊：只有方向與成長率，不併入上面的熱度分數。讀取兩個角色都可以；
  // 「查詢」會花 SerpApi 額度，限管理層（後端同樣限定 MANAGER）。
  private readonly googleTrendsApi = inject(GoogleTrendsApiService);
  readonly isManager = this.readOnly;
  readonly googleTrend = signal<GoogleTrendSignal | null>(null);
  readonly googleTrendState = signal<'idle' | 'syncing' | 'error'>('idle');
  readonly googleTrendError = signal('');

  // ----- 熱度趨勢圖（chart.js）-----
  // ⚠️ 2026-09-25 新增：跟 dashboard.ts 的狀態分布圖用同一套模式，理由
  // 見該檔案 renderStatusChartEffect 的完整註解——用 afterRenderEffect()
  // 而不是一般 effect() 或在 subscribe 回呼裡手動畫圖，避免「canvas 還
  // 沒掛上 DOM 就先畫、之後沒有其他事件觸發重繪」的競態問題。
  @ViewChild('trendChartCanvas') private readonly trendChartCanvas?: ElementRef<HTMLCanvasElement>;
  private trendChart: Chart | null = null;

  private readonly renderTrendChartEffect = afterRenderEffect(() => {
    const history = this.trendHistory();
    const canvas = this.trendChartCanvas?.nativeElement;
    if (!canvas) return;

    // 少於 2 個點畫不出有意義的折線（1 個點只是一個孤立的圓），
    // 樣板改顯示文字提示，這裡直接不畫、也把舊圖表清掉。
    if (history.length < 2) {
      this.trendChart?.destroy();
      this.trendChart = null;
      return;
    }

    const chartData = {
      // collectedAt 只取到分鐘，避免同一天多次同步時橫軸標籤過長擠在一起。
      labels: history.map((point) => (point.collectedAt ? point.collectedAt.slice(5, 16) : '')),
      datasets: [
        {
          data: history.map((point) => point.popularityScore),
          borderColor: brandColor('--c-brand'),
          backgroundColor: brandColor('--c-brand-tint'),
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    };

    if (this.trendChart && this.trendChart.canvas !== canvas) {
      this.trendChart.destroy();
      this.trendChart = null;
    }
    if (this.trendChart) {
      this.trendChart.data = chartData;
      this.trendChart.update();
      return;
    }

    this.trendChart = new Chart(canvas, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    });
  });

  /**
   * 歷次審核紀錄的排序（2026-09-23 由 procurement-dashboard-updated 分支整併）。
   * 未選擇排序時維持後端的「新→舊」順序。
   *
   * 2026-09 調整（對齊選品審核頁決策紀錄的做法）：「審核結果」「審核時間」改為下方的
   * 篩選條件（結果下拉＋日期起訖），不再提供排序；「審核留言」是自由文字，排序沒有意義，
   * 直接移除。排序只保留送審次數與審核人。
   */
  readonly historySort = new ListSort();
  readonly historySortChoices = [
    { key: 'submissionCount', label: '送審次數' },
    { key: 'reviewerName', label: '審核人' },
  ];
  /** 歷次審核紀錄篩選：審核結果（ALL＝不篩）。 */
  readonly historyResultFilter = signal<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  /** 歷次審核紀錄篩選：審核日期起訖（yyyy-MM-dd，空字串＝不限），閉區間。 */
  readonly historyReviewedFrom = signal('');
  readonly historyReviewedTo = signal('');
  /** 起日晚於迄日：不套用日期篩選並標示欄位錯誤，避免清單莫名其妙變成空的。 */
  readonly historyDateRangeInvalid = computed(
    () => !!this.historyReviewedFrom() && !!this.historyReviewedTo() && this.historyReviewedFrom() > this.historyReviewedTo(),
  );
  readonly hasHistoryFilters = computed(
    () => this.historyResultFilter() !== 'ALL' || !!this.historyReviewedFrom() || !!this.historyReviewedTo(),
  );
  /**
   * 前端篩選即可：這裡是單一商品自己的審核紀錄（筆數＝送審次數，量很小），
   * 跟審核頁全站決策紀錄改由後端分頁篩選的情境不同。
   * reviewedAt 是 ISO 日期時間字串，取前 10 碼（yyyy-MM-dd）跟日期欄位比較；
   * 沒有審核時間的紀錄在設了日期條件時不列入。
   */
  readonly filteredReviewHistory = computed(() => {
    const result = this.historyResultFilter();
    const invalidRange = this.historyDateRangeInvalid();
    const from = invalidRange ? '' : this.historyReviewedFrom();
    const to = invalidRange ? '' : this.historyReviewedTo();
    return this.reviewHistory().filter((record) => {
      if (result !== 'ALL' && record.reviewStatus !== result) return false;
      if (!from && !to) return true;
      const day = (record.reviewedAt ?? '').slice(0, 10);
      if (!day) return false;
      return (!from || day >= from) && (!to || day <= to);
    });
  });

  updateHistoryResultFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.historyResultFilter.set(value === 'APPROVED' || value === 'REJECTED' ? value : 'ALL');
  }

  updateHistoryReviewedFrom(event: Event): void {
    this.historyReviewedFrom.set((event.target as HTMLInputElement).value);
  }

  updateHistoryReviewedTo(event: Event): void {
    this.historyReviewedTo.set((event.target as HTMLInputElement).value);
  }

  clearHistoryFilters(): void {
    this.historyResultFilter.set('ALL');
    this.historyReviewedFrom.set('');
    this.historyReviewedTo.set('');
  }
  readonly gateStatusLabel = GATE_STATUS_LABEL;
  readonly temperatureZoneLabel = TEMPERATURE_ZONE_LABEL;
  readonly shelfLifeTierLabel = SHELF_LIFE_TIER_LABEL;
  readonly supplierLeadTimeTierLabel = SUPPLIER_LEAD_TIME_TIER_LABEL;
  readonly packageSizeTierLabel = PACKAGE_SIZE_TIER_LABEL;
  readonly packingTypeLabel = PACKING_TYPE_LABEL;
  readonly supplyStabilityLevelLabel = SUPPLY_STABILITY_LEVEL_LABEL;
  readonly priceCompetitivenessLevelLabel = PRICE_COMPETITIVENESS_LEVEL_LABEL;
  readonly stateOptions: readonly DetailState[] = [
    'default',
    'locked',
    'loading',
    'empty',
    'error',
  ];
  readonly pageState = signal<DetailState>('default');
  readonly product = signal<DetailProduct | null>(null);
  readonly syncState = signal<'idle' | 'syncing' | 'success' | 'error'>('idle');
  /**
   * 趨勢同步失敗的訊息，留在趨勢區塊直到下次同步。不用 statusMessage：那個會自動消失，
   * 使用者回頭看趨勢區塊時只剩空白的錯誤框，不知道發生什麼事。
   */
  readonly syncError = signal('');
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly imageLoadFailed = signal(false);
  /** 是否正在呼叫 generateAiAnalysis()；期間停用按鈕，避免重複觸發 LLM 費用。 */
  readonly isGeneratingAi = signal(false);
  readonly aiError = signal('');
  readonly incomplete = computed(() => (this.product()?.completeness ?? 0) < 60);
  readonly isLocked = computed(
    () => this.pageState() === 'locked' || this.product()?.itemStatus === 'ARCHIVED',
  );

  /**
   * ⚠️ 補上：這頁原本完全沒有算 canResubmit，「未通過審核」的商品在
   * 這裡只看得到泛用的「編輯品項」連結——跟 product-management.html
   * 清單列（同一條件會顯示「重審」而非「編輯」）、product-form.html
   * 編輯頁（會顯示「此品項上次未通過審核」提示＋「儲存並重審」按鈕）
   * 不一致。而 review.html 決策紀錄表格點進商品名稱時，明確寫著
   * 「可於品項頁重審」——這裡卻沒有對應的重審入口／提示可以兌現這句話，
   * 使用者得先點進「編輯品項」才會第一次看到重審相關字樣。
   * 共用跟清單同一份判斷邏輯（toProductActionAvailability），避免這裡
   * 又長出第二套跟清單不一致的規則。
   */
  readonly actions = computed(() => {
    const p = this.product();
    if (!p) return null;
    return toProductActionAvailability({
      reviewStatus: p.reviewStatus,
      itemStatus: p.itemStatus,
      candidateStatus: p.candidateStatus as CandidateStatus,
      submissionCount: p.submissionCount,
    });
  });

  ngOnInit(): void {
    this.reload();
  }

  /** Mock 模式沿用本地資料；真實模式呼叫三支 API 並組成同一個 View Model。 */
  reload(): void {
    if (this.useMockData) {
      this.product.set(this.productId === '104' ? INCOMPLETE : APPROVED);
      // ⚠️ 2026-09-25 新增：展示模式示範用，數字純粹示意，呈現「逐漸
      // 上升後回落」的走勢，讓展示時看得出圖表真的有畫出波動，不是
      // 一條平線。
      this.trendHistory.set(MOCK_TREND_HISTORY);
      this.pageState.set('default');
      return;
    }
    this.pageState.set('loading');
    this.api
      .getProduct(this.productId)
      .pipe(
        switchMap((product) =>
          forkJoin({
            product: of(product),
            // 評估、節慶加成、AI 分析都屬於可選區塊：單獨失敗時降級，不讓整頁變成 error。
            evaluation: this.api.getEvaluation(this.productId).pipe(catchError(() => of(null))),
            festival: this.api.getFestivalBoost(this.productId).pipe(catchError(() => of(null))),
            // ⚠️ 這支之前完全沒有被呼叫過，導致 AI 摘要／推薦原因區塊無論資料
            // 完整度多高都只會顯示「尚未產生」的空狀態——不是資料完整度判斷，
            // 是這裡漏了這支 API 呼叫。GET 不會觸發生成、不產生 LLM 費用。
            aiAnalysis: this.api.getAiAnalysis(this.productId).pipe(catchError(() => of(null))),
            // 這支 API 存在已久（後端註解明確寫著「唯一操作層也能呼叫的審核
            // 相關 API，可以放在品項詳情頁」），但從未被呼叫過，導致品項
            // 詳情頁完全看不到這件商品自己的歷次審核紀錄——想知道「這件
            // 商品上次為什麼被拒」只能去問管理層或翻決策紀錄分頁自己找。
            reviewHistory: this.api.getReviewHistory(this.productId).pipe(catchError(() => of([]))),
            // 最新一筆趨勢資料（每天 02:00 排程自動抓 PTT）。唯讀，不觸發爬蟲；
            // 以前只能靠「立即更新」拿到趨勢，重新進入頁面就顯示「尚無趨勢資料」。
            trend: this.api.getLatestTrend(this.productId).pipe(catchError(() => of(null))),
            // ⚠️ 2026-09-25 新增：熱度趨勢圖用，跟上面的 trend（只拿最新一筆）
            // 是不同的獨立查詢，各自失敗互不影響——趨勢圖失敗只是圖表區塊
            // 顯示空狀態，不影響上面「最新一筆」的顯示。
            trendHistory: this.api.getTrendHistory(this.productId).pipe(catchError(() => of([]))),
            // 2026-09-28：Google 趨勢參考（最新一筆，唯讀、不花額度）；失敗只讓這一行不顯示。
            googleTrend: this.googleTrendsApi.getLatest(this.productId).pipe(catchError(() => of(null))),
            // 商品類型名稱：ProductResponse 只有 productTypeId，
            // 對照表由 ProductTypeLookupService 以 shareReplay 快取，不會每次重打。
            typeName: this.productTypes.getName(product.productTypeId),
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ product, evaluation, festival, aiAnalysis, reviewHistory, typeName, trend, trendHistory, googleTrend }) => {
          this.googleTrend.set(googleTrend);
          this.product.set(
            toDetailProduct(product, evaluation, festival, typeName, {
              ...toAiExtras(aiAnalysis),
              ...toTrendExtras(trend),
            }),
          );
          this.reviewHistory.set(reviewHistory);
          this.trendHistory.set(trendHistory);
          this.pageState.set('default');
          if (!evaluation) this.statusMessageState.show('評估分數載入失敗，其餘資料仍可檢視。');
        },
        error: () => {
          this.product.set(null);
          this.pageState.set('error');
          this.statusMessageState.show('品項詳情載入失敗，請稍後重試。');
        },
      });
  }

  /**
   * 管理層「查詢 Google 趨勢」：POST /api/products/{id}/google-trend/sync，花 1 次 SerpApi 額度，
   * 所以先二次確認。停用／無金鑰／額度用完（409）與 SerpApi 失敗（502）都只顯示在這一區。
   */
  syncGoogleTrend(): void {
    if (!this.isManager || this.googleTrendState() === 'syncing') return;
    if (this.useMockData) {
      this.dialog.notify('info', '功能限制', ['Mock 模式不會呼叫後端，也不會實際查詢 Google 趨勢。']).subscribe();
      return;
    }
    this.dialog
      .confirm(
        '要查詢這個商品的 Google 趨勢嗎？',
        [
          '會用掉 1 次 SerpApi 額度（查無資料也計入），約需 10 秒。',
          '結果只作為參考資訊，不會改變熱度分數與評估結果。',
        ],
        '查詢',
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.googleTrendState.set('syncing');
        this.googleTrendsApi
          .sync(this.productId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (signal) => {
              this.googleTrend.set(signal);
              this.googleTrendState.set('idle');
            },
            error: (err: unknown) => {
              this.googleTrendError.set(toApiError(err).message);
              this.googleTrendState.set('error');
            },
          });
      });
  }

  /** 成長率文字：+23.5%／-8%；基準期為 0 時沒有成長率。 */
  googleGrowthText(signal: GoogleTrendSignal): string {
    if (signal.growthRate === null) return '前 4 週幾乎沒有搜尋，近期開始出現';
    const rounded = roundGrowthRate(signal.growthRate);
    return `近 7 天比前 4 週 ${rounded > 0 ? '+' : ''}${rounded}%`;
  }

  /**
   * 觸發 POST /api/products/{id}/ai-analysis/generate。
   *
   * ⚠️ 這支會產生 LLM API 費用且有配額限制，因此：
   * 1. 送出前二次確認，避免手滑觸發
   * 2. 期間 disable 按鈕，不讓使用者連點
   * 3. 502（LlmAnalysisException）視為這個區塊自己的錯誤，不影響其餘資料顯示
   */
  generateAiAnalysis(): void {
    if (this.useMockData) {
      this.statusMessageState.show('Mock 模式不會真的呼叫 LLM，此按鈕僅在真實模式生效。');
      return;
    }
    const hasExisting = !!this.product()?.aiSummary;
    const confirmMessage = hasExisting
      ? '重新產生會呼叫外部 LLM 服務並計入配額，且會覆蓋目前的分析結果，確定要繼續嗎？'
      : '產生 AI 分析會呼叫外部 LLM 服務並計入配額，確定要繼續嗎？';

    this.dialog
      .confirm('確認產生 AI 分析', [confirmMessage])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.runGenerateAiAnalysis();
      });
  }

  private runGenerateAiAnalysis(): void {
    this.isGeneratingAi.set(true);
    this.aiError.set('');

    this.api
      .generateAiAnalysis(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (analysis) => {
          this.isGeneratingAi.set(false);
          this.product.update((p) => (p ? { ...p, ...toAiExtras(analysis) } : p));
        },
        error: (err) => {
          this.isGeneratingAi.set(false);
          const error = toApiError(err);
          this.aiError.set(
            error.isTimeout
              ? `AI 分析超過 ${AI_ANALYSIS_TIMEOUT_MS / 1000} 秒仍未回應，已停止等待。請稍後再按一次重試；規則評分與人工審核不受影響。`
              : error.status === 502
                ? 'AI 分析服務暫時無法使用，請稍後再試。'
                : error.message,
          );
        },
      });
  }

  setState(state: DetailState): void {
    this.pageState.set(state);
    if (state === 'empty') this.product.set(null);
    else if (!this.product()) this.product.set(APPROVED);
    this.statusMessageState.show(`已切換為 ${state} 狀態。`);
    this.imageLoadFailed.set(false);
  }
  showIncomplete(): void {
    this.product.set(INCOMPLETE);
    this.pageState.set('default');
    this.statusMessageState.show('已切換為資料待補範例。');
  }
  restoreDemo(): void {
    if (!this.useMockData) {
      this.reload();
      return;
    }
    this.product.set(APPROVED);
    this.pageState.set('default');
    this.statusMessageState.show('已恢復完整 Demo 資料。');
    this.imageLoadFailed.set(false);
  }
  handleImageError(): void {
    this.imageLoadFailed.set(true);
    this.statusMessageState.show('商品圖片載入失敗，已顯示替代內容。');
  }
  /**
   * ⚠️ 修正：這支之前不管真實／Mock 模式都只是本地模擬（syncState 直接設
   * 'syncing'，然後靠畫面上「模擬成功／模擬失敗」兩顆按鈕手動結束），
   * 從來沒有真的呼叫 POST /api/products/{id}/trend/sync——即使
   * ProductApiService.syncTrend() 這支方法本來就已經寫好了。
   */
  syncTrend(): void {
    if (this.useMockData) {
      this.syncState.set('syncing');
      this.statusMessageState.show('正在模擬同步趨勢資料。');
      return;
    }
    this.syncState.set('syncing');
    this.syncError.set('');
    this.statusMessageState.show('正在搜尋 PTT 討論，約需 10 秒，請稍候。');
    this.api
      .syncTrend(this.productId)
      .pipe(
        // 後端同步後會重算整份評估（不只趨勢分），這裡重新讀一次 evaluation 更新畫面分數。
        // ⚠️ 不能拿 sync 回傳的 trendScore 直接蓋掉畫面上的趨勢分：那是 PTT 原始的
        // 「趨勢分」，畫面顯示的是評估裡「趨勢分與熱度平均、再做時效衰減」後的分數，
        // 兩者語意不同（例如行動電源原始趨勢分 12.58，評估趨勢分 48.48）。
        switchMap((trend) =>
          forkJoin({
            trend: of(trend),
            evaluation: this.api.getEvaluation(this.productId).pipe(catchError(() => of(null))),
            // ⚠️ 2026-09-25 新增：同步成功後圖表也要跟著多一個新的點，
            // 不然畫面上分數已經更新、圖表卻還停在上一次的狀態，兩者
            // 看起來不同步。失敗時保留舊的歷史資料，不清空圖表。
            trendHistory: this.api
              .getTrendHistory(this.productId)
              .pipe(catchError(() => of(this.trendHistory()))),
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ trend, evaluation, trendHistory }) => {
          this.syncState.set('success');
          this.trendHistory.set(trendHistory);
          this.statusMessageState.show(
            trend.source === 'PTT'
              ? '趨勢資料已依 PTT 討論量更新。'
              : 'PTT 暫時無法取得資料，本次先以模擬資料更新，可稍後再試。',
          );
          this.product.update((p) =>
            p
              ? {
                  ...p,
                  ...toTrendExtras(trend),
                  trendScore: evaluation?.trendScore ?? p.trendScore,
                  baseScore: evaluation?.totalScore ?? p.baseScore,
                  festivalBoost: evaluation?.festivalBoost ?? p.festivalBoost,
                  weatherBoost: evaluation ? (evaluation.weatherBoost ?? null) : p.weatherBoost,
                  finalScore: evaluation?.finalScore ?? p.finalScore,
                }
              : p,
          );
        },
        error: (err) => {
          const error = toApiError(err);
          this.syncState.set('error');
          this.syncError.set(
            error.isTimeout
              ? `PTT 搜尋超過 ${TREND_SYNC_TIMEOUT_MS / 1000} 秒仍未完成，已停止等待。後端可能仍在處理，稍後重新整理頁面即可看到結果，或按「重試」再同步一次。`
              : error.message,
          );
          this.statusMessageState.show(this.syncError());
        },
      });
  }
  /** 僅 Mock 模式使用：手動結束模擬的同步狀態。真實模式由 syncTrend() 的 subscribe 自行結束。 */
  completeSync(success: boolean): void {
    this.syncState.set(success ? 'success' : 'error');
    this.statusMessageState.show(success ? '趨勢資料已在本地更新。' : '趨勢同步失敗，可再次嘗試。');
  }
  /**
   * 模擬封存或復用：APPROVED／REJECTED 可封存，但只有 APPROVED 且已封存商品可復用。
   * 只更新 product signal，無非同步 API 或需清理的資源。
   */
  toggleArchive(): void {
    const p = this.product();
    if (
      !p ||
      p.reviewStatus === 'PENDING' ||
      (p.itemStatus === 'ARCHIVED' && p.reviewStatus !== 'APPROVED')
    )
      return;
    if (this.useMockData) {
      this.product.set({ ...p, itemStatus: p.itemStatus === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' });
      this.statusMessageState.show(
        p.itemStatus === 'ACTIVE' ? '已在本地模擬封存。' : '已在本地模擬復用。',
      );
      return;
    }
    const request = p.itemStatus === 'ACTIVE' ? this.api.archive(p.id) : this.api.restore(p.id);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.reload(),
      error: (err: unknown) => {
        const error = toApiError(err);
        this.statusMessageState.show(
          error.status === 409
            ? '狀態已被他人變更，請重新整理後再試。'
            : error.message,
        );
        // 409 代表畫面上的狀態已經過期，重新載入讓按鈕回到真實條件。
        if (error.status === 409) this.reload();
      },
    });
  }
  discountRate(p: DetailProduct): number | null {
    return p.marketPrice && p.salePrice
      ? Math.round((1 - p.salePrice / p.marketPrice) * 100)
      : null;
  }
  marginRate(p: DetailProduct): number | null {
    return p.salePrice && p.costPrice !== null
      ? Math.round(((p.salePrice - p.costPrice) / p.salePrice) * 1000) / 10
      : null;
  }
  reviewLabel(s: ReviewStatus): string {
    // 改讀 core/domain/labels.ts：原本的行內物件字面量沒有索引簽章，
    // strict 模式下以 ReviewStatus 索引會被判為隱含 any（TS7053）。
    // 集中管理也讓全站文案一致——先前三個頁面各寫一份，文案已經對不上。
    return REVIEW_STATUS_LABEL[s];
  }

  /**
   * 節慶加成上限（分）。對照後端 ScoringService 的節慶加成公式：
   * matchWeight × urgencyFactor × 5，「5」是固定的系統上限，
   * 不是每個商品各自不同的數字，所以放常數不放進 DetailProduct。
   */
  readonly festivalBoostCap = 5;

  /** V26：天氣分數卡片的小字——命中哪些標籤，或說明為何沒有加成。 */
  weatherBoostCaption(detail: WeatherBoostDetailPayload | null): string {
    if (!detail) return '天氣加成';
    if (detail.combinedScore === null) return '尚無天氣資料';
    return detail.matchedTags.length > 0 ? detail.matchedTags.join('、') : '未命中天氣相關標籤';
  }

  /**
   * matchWeight 只有三個離散值，對照 MatchedCampaignPayload 的註解：
   * CORE=1.0／GENERAL=0.6／WEAK=0.3。轉成白話文字比直接顯示 0.6 這種
   * 數字更容易懂「這代表命中程度高不高」，不需要使用者自己去查對照表。
   */
  matchWeightLabel(matchWeight: number | null): string {
    if (matchWeight === null) return '—';
    if (matchWeight >= 1) return '核心標籤命中';
    if (matchWeight >= 0.6) return '一般標籤命中';
    return '弱相關命中';
  }

  /** urgencyFactor 是連續值（越接近檔期越高），用百分比呈現比原始小數直覺。 */
  urgencyPercent(urgencyFactor: number | null): number | null {
    return urgencyFactor === null ? null : Math.round(urgencyFactor * 100);
  }

  ngOnDestroy(): void {
    this.trendChart?.destroy();
  }
}
