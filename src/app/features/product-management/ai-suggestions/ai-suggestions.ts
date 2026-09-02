/**
 * 檔案用途：呈現 AI_SUGGESTED 商品並提供人工加入 CANDIDATE 的操作。
 * 只有人工轉為 CANDIDATE 後才可進入評分、Top 10 與審核；AI 不會自行核准商品。
 *
 * ## 這次接上真實 API 做了什麼
 *
 * 1. Mock 模式完全保留——固定的三筆展示資料、UI 狀態切換器都不動。
 *
 * 2. 真實模式呼叫 `ProductApiService.listAiSuggested()`。
 *
 * ## ⚠️ 真實模式下的資料落差（誠實顯示，不假造）
 *
 * `GET /api/products/ai-suggested` 回的還是 `ProductResponse`，跟正式候選清單
 * 同一個 DTO，**完全沒有** `trend`／`direction`／`audienceMatch`／`risk`／`reason`
 * 這些欄位——那些原本就是 Mock 資料自己編的展示內容，不是真的有 API 對應。
 * 真實模式下這些欄位一律為 null，樣板改成有資料才顯示對應區塊，
 * 不顯示假的「上升／穩定」箭頭或編造的風險提示文字。
 *
 * 若要讓這頁真正有這些資訊，需要後端要嘛在這支端點併帶 TrendSnapshot／
 * AI 分析摘要，要嘛前端逐筆呼叫 /trend/sync 與 /ai-analysis——後者是
 * N+1，且 /trend/sync 有外部呼叫成本，不能在頁面載入時自動觸發，
 * 這頁不會這樣做。
 */
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { toApiError } from '../../../core/api/api-error';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ProductApiService } from '../api/product-api.service';
import { ProductListItem } from '../api/product.mapper';

type AiState = 'default' | 'disabled' | 'loading' | 'empty' | 'error';

interface Suggestion {
  id: number;
  name: string;
  category: string;
  supplier: string;
  /** ⚠️ 真實模式恆為 null：後端這支端點沒有趨勢資料。 */
  trend: number | null;
  direction: 'UP' | 'STABLE' | null;
  /** ⚠️ 真實模式恆為 null：後端沒有「為什麼推薦」這段文字。 */
  reason: string | null;
  audienceMatch: number | null;
  risk: string | null;
  candidateStatus: 'AI_SUGGESTED';
  selected: boolean;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 201,
    name: '旅行用全能轉接充電器',
    category: '3C／家電',
    supplier: '沐光科技',
    trend: 88,
    direction: 'UP',
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
    reason: '核心客群關鍵字與親子、家庭情境高度吻合。',
    audienceMatch: 92,
    risk: '大型包裝可能提高物流成本。',
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  },
];

/** 後端 ProductListItem → 這頁的顯示模型；trend/reason/audienceMatch/risk 一律 null。 */
function toSuggestion(item: ProductListItem): Suggestion {
  return {
    id: item.id,
    name: item.name,
    category: item.productTypeName,
    supplier: item.supplierName,
    trend: null,
    direction: null,
    reason: null,
    audienceMatch: null,
    risk: null,
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  };
}

@Component({
  selector: 'app-ai-suggestions',
  imports: [FormsModule, RouterLink],
  templateUrl: './ai-suggestions.html',
  styleUrl: './ai-suggestions.scss',
})
export class AiSuggestions implements OnInit {
  private readonly api = inject(ProductApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly stateOptions: readonly AiState[] = ['default', 'disabled', 'loading', 'empty', 'error'];
  readonly pageState = signal<AiState>('default');
  readonly query = signal('');
  readonly items = signal<Suggestion[]>(this.useMockData ? SUGGESTIONS.map((i) => ({ ...i })) : []);
  readonly statusMessage = signal('');

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.items().filter(
      (i) => !q || i.name.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q),
    );
  });

  ngOnInit(): void {
    if (!this.useMockData) this.load();
  }

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
          this.statusMessage.set(toApiError(err).message);
        },
      });
  }

  // ----- UI 狀態切換器（Mock 模式展示用）-----

  setState(state: AiState): void {
    this.pageState.set(state);
    if (state === 'empty') this.items.set([]);
    else if (!this.items().length && state !== 'error' && this.useMockData) this.reset();
    this.statusMessage.set(`已切換為 ${state} 狀態。`);
  }

  /** Mock 模式恢復固定展示資料；真實模式重新呼叫 API。 */
  reset(): void {
    this.query.set('');
    if (this.useMockData) {
      this.items.set(SUGGESTIONS.map((i) => ({ ...i })));
      this.pageState.set('default');
      this.statusMessage.set('已恢復 AI 建議 Mock 資料。');
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
      this.statusMessage.set(`「${item?.name}」已在本地加入 CANDIDATE 正式候選清單。`);
      return;
    }

    this.api
      .promoteToCandidate(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.items.update((items) => items.filter((i) => i.id !== id));
          this.statusMessage.set(`「${item?.name}」已加入 CANDIDATE 正式候選清單。`);
        },
        error: (err) => {
          const error = toApiError(err);
          this.statusMessage.set(
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
      this.statusMessage.set(`已在本地將 ${selected.length} 筆加入正式候選。`);
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
        this.statusMessage.set(
          failedCount > 0
            ? `已加入 ${succeededIds.length} 筆，${failedCount} 筆狀態已變更，請重新整理確認。`
            : `已加入 ${succeededIds.length} 筆正式候選。`,
        );
        if (failedCount > 0) this.load();
      });
  }
}
