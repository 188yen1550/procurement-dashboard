/**
 * 檔案用途：呈現 AI_SUGGESTED 商品並提供人工加入 CANDIDATE 的操作。
 * 真實 API 提供推薦理由；趨勢、客群匹配與風險沒有清單欄位，因此只在資料
 * 存在時顯示。商品必須由人工加入 CANDIDATE，AI 不會自行核准。
 */
import { ListSort, ListSortControls, SortRowsPipe } from '../../../shared/ui/list-sort';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { toApiError } from '../../../core/api/api-error';
import { APP_CONFIG } from '../../../core/config/app-config';
import { createDismissibleMessage } from '../../../core/ui/auto-dismiss';
import { reloadOnRevisit } from '../../../core/router/reload-on-revisit';
import { ProductApiService } from '../api/product-api.service';
import { ProductListItem } from '../api/product.mapper';
import { Icon } from '../../../shared/components/icon/icon';
import { GoogleTrendSignal, summarizeGoogleTrend } from '../../settings/api/google-trends-api.service';

type AiState = 'default' | 'disabled' | 'loading' | 'empty' | 'error';

interface Suggestion {
  id: number;
  name: string;
  category: string;
  supplier: string;
  /**
   * 最新一筆熱度分數（PTT 討論量換算）。2026-09-28 起真實模式也有值：
   * 後端 ai-suggested 端點早就回傳 trendScore／trendDirection，只是這頁原本沒接。
   */
  trend: number | null;
  direction: 'UP' | 'DOWN' | 'STABLE' | null;
  /** false＝最新一筆是 PTT 抓不到時的模擬資料，畫面要標出來。 */
  isRealSource: boolean;
  /** 最近最多 3 次同步的方向，舊到新；對應「連續 3 天上升」這個建議條件。 */
  recentDirections: ('UP' | 'DOWN' | 'STABLE')[];
  /** Google 趨勢參考（沒查過為 null），只作參考、不參與建議判定。 */
  google: GoogleTrendSignal | null;
  /** 綜合分數（最終分數）；尚無評估紀錄為 null。 */
  finalScore: number | null;
  /** 真實模式讀取 AI 建議端點的 suggestionReason。 */
  reason: string | null;
  audienceMatch: number | null;
  risk: string | null;
  candidateStatus: 'AI_SUGGESTED';
  selected: boolean;
}

const MOCK_GOOGLE: GoogleTrendSignal = {
  productId: 201,
  keyword: '轉接充電器',
  status: 'OK',
  direction: 'UP',
  growthRate: 21.4,
  recentAvg: 58,
  baselineAvg: 47.8,
  pointCount: 92,
  collectedAt: '2026-09-28T04:00:00',
};

const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 201,
    name: '旅行用全能轉接充電器',
    category: '3C／家電',
    supplier: '沐光科技',
    trend: 88,
    direction: 'UP',
    isRealSource: true,
    recentDirections: ['UP', 'UP', 'UP'],
    google: MOCK_GOOGLE,
    finalScore: 81.2,
    reason: '近 3 日搜尋熱度持續上升，且符合旅遊旺季需求。',
    audienceMatch: 84,
    risk: '需確認安規認證與插座規格。',
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  },
  {
    id: 202,
    name: '超輕量防曬折疊傘',
    category: '生活雜貨',
    supplier: '晴日生活',
    trend: 82,
    direction: 'UP',
    isRealSource: true,
    recentDirections: ['STABLE', 'UP', 'UP'],
    google: { ...MOCK_GOOGLE, productId: 202, keyword: '防曬折疊傘', status: 'NO_DATA', direction: null, growthRate: null, recentAvg: null, baselineAvg: null, pointCount: 0 },
    finalScore: 76.5,
    reason: '熱度分數超過 70，進入夏季防曬高峰。',
    audienceMatch: 78,
    risk: '同類商品競爭者多，需確認差異化。',
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  },
  {
    id: 203,
    name: '親子野餐防水地墊',
    category: '寢具家用',
    supplier: '戶外樂園',
    trend: 76,
    direction: 'STABLE',
    isRealSource: false,
    recentDirections: ['UP', 'STABLE', 'STABLE'],
    google: null,
    finalScore: null,
    reason: '核心客群關鍵字與親子、家庭情境高度吻合。',
    audienceMatch: 92,
    risk: '大型包裝可能提高物流成本。',
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  },
];

/** 後端 ProductListItem → 這頁的顯示模型。 */
function toSuggestion(item: ProductListItem): Suggestion {
  return {
    id: item.id,
    name: item.name,
    category: item.productTypeName,
    supplier: item.supplierName,
    trend: item.suggestionTrend?.popularityScore ?? null,
    direction: item.suggestionTrend?.direction ?? null,
    isRealSource: item.suggestionTrend?.isRealSource ?? true,
    recentDirections: item.suggestionTrend?.recentDirections ?? [],
    google: item.suggestionTrend?.googleTrend ?? null,
    finalScore: item.finalScore,
    // suggestionReason 為 GET /api/products/ai-suggested 專屬欄位。
    reason: item.suggestionReason ?? null,
    audienceMatch: null,
    risk: null,
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  };
}

@Component({
  selector: 'app-ai-suggestions',
  imports: [ListSortControls, SortRowsPipe, FormsModule, RouterLink, Icon],
  templateUrl: './ai-suggestions.html',
  styleUrl: './ai-suggestions.scss',
})
export class AiSuggestions implements OnInit {
  readonly suggestionSort = new ListSort();
  readonly suggestionSortChoices = [
    { key: 'name', label: '商品名稱' },
    { key: 'category', label: '分類' },
    { key: 'supplier', label: '供應商' },
    // 2026-09-23 由 procurement-dashboard-updated 分支整併：補上畫面已顯示的四個欄位。
    { key: 'trend', label: '趨勢' },
    { key: 'audienceMatch', label: '客群匹配' },
    { key: 'reason', label: '推薦理由' },
    { key: 'risk', label: '風險提示' },
  ];
  private readonly api = inject(ProductApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly stateOptions: readonly AiState[] = ['default', 'disabled', 'loading', 'empty', 'error'];
  readonly pageState = signal<AiState>('default');
  readonly query = signal('');
  readonly items = signal<Suggestion[]>(this.useMockData ? SUGGESTIONS.map((i) => ({ ...i })) : []);
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;

  constructor() {
    // 自動消失邏輯已內建在 createDismissibleMessage() 裡，不需要另外註冊監看。
    // 原地重新點擊「AI 建議清單」連結時 ngOnInit() 不會再被觸發，要靠這裡
    // 才能重新抓最新的 AI_SUGGESTED 清單。Mock 模式不套用。
    if (!this.useMockData) reloadOnRevisit(() => this.load());
  }

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.items().filter(
      (i) => !q || i.name.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q),
    );
  });

  ngOnInit(): void {
    if (!this.useMockData) this.load();
  }

  readonly googleSummary = summarizeGoogleTrend;

  /** 方向符號：近 3 次同步用，一眼看出是否連續上升。 */
  directionSymbol(direction: 'UP' | 'DOWN' | 'STABLE' | null): string {
    return direction === 'UP' ? '↗' : direction === 'DOWN' ? '↘' : '→';
  }

  directionLabel(direction: 'UP' | 'DOWN' | 'STABLE' | null): string {
    return direction === 'UP' ? '上升' : direction === 'DOWN' ? '下降' : '持平';
  }

  /** 最近 3 次都上升＝符合「連續 3 天上升」建議條件。 */
  isConsecutiveUp(item: Suggestion): boolean {
    return item.recentDirections.length >= 3 && item.recentDirections.every((d) => d === 'UP');
  }

  /*
   * 2026-09-24 職責分離（決策 D2）：「批次篩選熱門候選」手動觸發按鈕移到
   * 設定 › 演算法參數 › 排程作業（見 settings/tabs/ai-suggestion-batch-panel）。
   * 後端端點本來就只給 MANAGER，管理層不再進入這頁後，這顆按鈕留在這裡
   * 就沒有任何人按得到。這頁回歸純操作層畫面：檢視並轉正 AI 建議。
   */

  load(): void {
    this.pageState.set('loading');
    this.api
      .listAiSuggested({ page: 0, size: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.items.set(result.items.map(toSuggestion));
          this.pageState.set(result.items.length === 0 ? 'empty' : 'default');
        },
        error: (err) => {
          this.pageState.set('error');
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  // ----- UI 狀態切換器（Mock 模式展示用）-----

  setState(state: AiState): void {
    this.pageState.set(state);
    if (state === 'empty') this.items.set([]);
    else if (!this.items().length && state !== 'error' && this.useMockData) this.reset();
    this.statusMessageState.show(`已切換為 ${state} 狀態。`);
  }

  /** Mock 模式恢復固定展示資料；真實模式重新呼叫 API。 */
  reset(): void {
    this.query.set('');
    if (this.useMockData) {
      this.items.set(SUGGESTIONS.map((i) => ({ ...i })));
      this.pageState.set('default');
      this.statusMessageState.show('已恢復 AI 建議 Mock 資料。');
      return;
    }
    this.load();
  }

  toggle(id: number): void {
    this.items.update((items) =>
      items.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)),
    );
  }

  /**
   * POST /api/products/{id}/promote-to-candidate。
   * ⚠️ 409 代表這筆已經不是 AI_SUGGESTED（可能被別人剛剛加入過），
   * 提示後重新整理清單，不要照原請求重試。
   */
  promote(id: number): void {
    if (this.pageState() === 'disabled') return;
    const item = this.items().find((i) => i.id === id);

    if (this.useMockData) {
      this.items.update((items) => items.filter((i) => i.id !== id));
      this.statusMessageState.show(`「${item?.name}」已在本地加入 CANDIDATE 正式候選清單。`);
      return;
    }

    this.api
      .promoteToCandidate(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.items.update((items) => items.filter((i) => i.id !== id));
          this.statusMessageState.show(`「${item?.name}」已加入 CANDIDATE 正式候選清單。`);
        },
        error: (err) => {
          const error = toApiError(err);
          this.statusMessageState.show(
            error.status === 409
              ? `「${item?.name}」的狀態已被他人變更，正在重新整理清單。`
              : error.message,
          );
          if (error.status === 409) this.load();
        },
      });
  }

  /**
   * 批次加入候選。真實模式用 forkJoin 平行送出，任一筆失敗不影響其餘筆——
   * 逐一 catchError 後統計成功筆數，而不是整批失敗就全部沒有反應。
   */
  promoteSelected(): void {
    const selected = this.items().filter((i) => i.selected);
    if (selected.length === 0) return;

    if (this.useMockData) {
      this.items.update((items) => items.filter((i) => !i.selected));
      this.statusMessageState.show(`已在本地將 ${selected.length} 筆加入正式候選。`);
      return;
    }

    forkJoin(
      selected.map((item) =>
        this.api.promoteToCandidate(item.id).pipe(
          // 個別失敗轉成 null，讓 forkJoin 整體仍會完成，不因單筆 409 讓其他成功的筆數也拿不到結果。
          catchError(() => of(null)),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => {
        const succeededIds = selected
          .filter((_, index) => results[index] !== null)
          .map((item) => item.id);
        const failedCount = selected.length - succeededIds.length;

        this.items.update((items) => items.filter((i) => !succeededIds.includes(i.id)));
        this.statusMessageState.show(
          failedCount > 0
            ? `已加入 ${succeededIds.length} 筆，${failedCount} 筆狀態已變更，請重新整理確認。`
            : `已加入 ${succeededIds.length} 筆正式候選。`,
        );
        if (failedCount > 0) this.load();
      });
  }
}
