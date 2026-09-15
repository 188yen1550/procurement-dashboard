/**
 * 檔案用途：品項詳情的評分拆解、圖片、趨勢、AI、封存／復用與各種本地 UI 狀態。
 * Final Score = Base Score + Festival Boost；APPROVED 顯示 SNAPSHOT，其餘狀態顯示 LIVE。
 */
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toApiError } from '../../../core/api/api-error';
import { createDismissibleMessage } from '../../../core/ui/auto-dismiss';
import { DialogService } from '../../../core/dialog/dialog.service';
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
import { ProductApiService } from '../api/product-api.service';
import { Icon } from '../../../shared/components/icon/icon';
import { ReviewRecordModel } from '../../review/api/review.mapper';
import { AiAnalysisModel } from '../api/product.mapper';
import {
  DetailProduct,
  DetailState,
  ItemStatus,
  ReviewStatus,
  toDetailProduct,
} from './product-detail.model';

/**
 * 把 AiAnalysisModel 轉成 toDetailProduct() 要的 extras 形狀。
 *
 * ⚠️ hasAnalysis 為 false 代表後端回了全欄位 null 的物件（尚未生成過分析），
 * 不是錯誤狀態；這裡統一轉成 aiSummary: null，畫面顯示「尚未產生」的空狀態，
 * 不要顯示成載入失敗。
 *
 * ⚠️ 後端 reasons 是單一字串，不是陣列（跟舊版 Mock 資料的陣列形狀不同）。
 * 依換行拆成陣列只是為了沿用既有的條列樣式，不是後端保證的格式——
 * 若這段文字沒有換行，拆完就是單一元素的陣列，會顯示成一行，
 * 這是合理的降級，不是錯誤。
 */
function toAiExtras(
  analysis: AiAnalysisModel | null,
): { aiSummary: string | null; aiReasons: string[] } {
  if (!analysis || !analysis.hasAnalysis) {
    return { aiSummary: null, aiReasons: [] };
  }
  return {
    aiSummary: analysis.summary,
    aiReasons: analysis.reasons
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

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
  finalScore: 92.4,
  campaign: '中秋節',
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
  submissionCount: 0,
  dataSource: 'LIVE',
  completeness: 48,
  baseScore: null,
  festivalBoost: 0,
  finalScore: null,
  campaign: null,
  matchedTags: [],
  costPrice: null,
  salePrice: null,
  marketPrice: null,
  audienceScore: 0,
  historicalScore: 0,
  purchaseScore: 0,
  trendScore: 0,
  trendDirection: 'STABLE',
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
  imports: [CommonModule, RouterLink, Icon],
  templateUrl: './product-detail.html',
  styleUrls: ['./product-detail.scss', './product-detail-image.scss'],
})
/** 品項詳情頁元件；Mock 模式使用本地資料，正式模式保留 master 的商品 API 整合。 */
export class ProductDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ProductApiService);
  private readonly productTypes = inject(ProductTypeLookupService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly productId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly useMockData = APP_CONFIG.useMockData;
  readonly gateCodeLabel = GATE_CODE_LABEL;
  /** 這件商品自己的歷次審核紀錄，時間新→舊排序，供頁面下方新增的區塊顯示。 */
  readonly reviewHistory = signal<ReviewRecordModel[]>([]);
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

  ngOnInit(): void {
    this.reload();
  }

  /** Mock 模式沿用本地資料；真實模式呼叫三支 API 並組成同一個 View Model。 */
  reload(): void {
    if (this.useMockData) {
      this.product.set(this.productId === '104' ? INCOMPLETE : APPROVED);
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
            // 商品類型名稱：ProductResponse 只有 productTypeId，
            // 對照表由 ProductTypeLookupService 以 shareReplay 快取，不會每次重打。
            typeName: this.productTypes.getName(product.productTypeId),
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ product, evaluation, festival, aiAnalysis, reviewHistory, typeName }) => {
          this.product.set(
            toDetailProduct(product, evaluation, festival, typeName, toAiExtras(aiAnalysis)),
          );
          this.reviewHistory.set(reviewHistory);
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
            error.status === 502 ? 'AI 分析服務暫時無法使用，請稍後再試。' : error.message,
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
    this.statusMessageState.show('正在同步趨勢資料，請稍候。');
    this.api
      .syncTrend(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (trend) => {
          this.syncState.set('success');
          this.statusMessageState.show('趨勢資料已同步更新。');
          this.product.update((p) =>
            p
              ? {
                  ...p,
                  trendScore: trend.trendScore ?? p.trendScore,
                  trendDirection: trend.trendDirection,
                  lastSyncedAt: trend.collectedAt ?? p.lastSyncedAt,
                }
              : p,
          );
        },
        error: (err) => {
          this.syncState.set('error');
          this.statusMessageState.show(toApiError(err).message);
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
}
