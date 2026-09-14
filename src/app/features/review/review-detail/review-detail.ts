/**
 * 檔案用途：管理人員審核詳情、人工風險、留言與 APPROVED／REJECTED 決策。
 * 送出前驗證必選結果、其他風險備註與審核留言；409 代表商品已由他人審核，
 * 需提示使用者並返回清單。AI 只提供摘要，最終決策由人工選擇。
 */
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { APP_CONFIG } from '../../../core/config/app-config';
import { DialogService } from '../../../core/dialog/dialog.service';
import { ReviewApiService } from '../api/review-api.service';
import { createDismissibleMessage } from '../../../core/ui/auto-dismiss';
import {
  OTHER_RISK_OPTION_NAME,
  ReviewDetailModel,
  ReviewFormModel,
  toReviewSubmitPayload,
  validateReviewForm,
} from '../api/review.mapper';

type DetailState = 'default' | 'disabled' | 'loading' | 'error';
type Decision = '' | 'APPROVED' | 'REJECTED';

/** Mock 展示資料，維持原本兩筆固定內容，形狀對齊 ReviewDetailModel。 */
function mockDetail(productId: string): ReviewDetailModel {
  const isSecond = productId === '103';
  return {
    productId: Number(productId) || 102,
    productName: isSecond ? '無香低敏濃縮洗衣紙補充組' : '輕量智慧溫控電熱杯',
    productTypeId: null,
    productTypeName: isSecond ? '日用品' : '3C／家電',
    pricingType: isSecond ? 'RESALE' : 'NEW',
    supplierName: '—',
    campaignTags: [],
    submissionCount: isSecond ? 2 : 1,
    isResubmission: isSecond,
    scores: {
      businessScore: isSecond ? 74 : 79,
      audienceScore: 84,
      historicalScore: isSecond ? 70 : 76,
      purchaseScore: isSecond ? 71 : 77,
      trendScore: 86,
      forecastScore: isSecond ? 73 : 80,
      totalScore: isSecond ? 72.8 : 78.4,
      festivalBoost: 3.3,
      finalScore: isSecond ? 76.1 : 81.7,
      dataCompleteness: isSecond ? 88 : 78,
      evaluationModeName: '均衡模式',
      evaluationModeVersion: 1,
    },
    matchedCampaign: null,
    ai: {
      hasAnalysis: true,
      summary: '市場熱度與核心客群具中高度匹配，但仍需人工確認供貨穩定性與實際商業條件。',
      recommendation: '建議通過',
      reasons: '節慶標籤命中、客群契合度高，但供應穩定性評分偏低需留意。',
    },
    availableRiskOptions: [
      { id: 1, name: '實際供貨風險', description: null, isSystemDefault: true, alertKeywords: '缺貨、斷貨' },
      { id: 2, name: '商品品質與客訴風險', description: null, isSystemDefault: true, alertKeywords: '瑕疵、客訴' },
      { id: 3, name: '市場不確定性與需求變動風險', description: null, isSystemDefault: true, alertKeywords: '退燒、競品' },
      { id: 9, name: OTHER_RISK_OPTION_NAME, description: null, isSystemDefault: true, alertKeywords: null },
    ],
  };
}

const MOCK_PREVIOUS_COMMENT = '上次因備援供應方案不足而未通過，請確認本次補件。';

@Component({
  selector: 'app-review-detail',
  imports: [FormsModule, RouterLink],
  templateUrl: './review-detail.html',
  styleUrl: './review-detail.scss',
})
export class ReviewDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ReviewApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(DialogService);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly productId = this.route.snapshot.paramMap.get('id') ?? '102';
  readonly stateOptions: readonly DetailState[] = ['default', 'disabled', 'loading', 'error'];
  readonly pageState = signal<DetailState>('default');

  readonly product = signal<ReviewDetailModel | null>(null);
  readonly errorMessage = signal('');

  readonly selectedRiskIds = signal<number[]>([]);
  readonly decision = signal<Decision>('');
  readonly comment = signal('');
  readonly otherNote = signal('');
  readonly submitted = signal(false);
  readonly isSubmitting = signal(false);
  readonly conflictOpen = signal(false);
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;

  constructor() {
    // 自動消失邏輯已內建在 createDismissibleMessage() 裡，不需要另外註冊監看。
  }

  /** 「其他」風險是否已勾選；決定要不要顯示補充說明欄位。 */
  readonly hasOtherSelected = computed(() => {
    const other = this.product()?.availableRiskOptions.find(
      (option) => option.name === OTHER_RISK_OPTION_NAME,
    );
    return other !== undefined && this.selectedRiskIds().includes(other.id);
  });

  /** 上次審核留言，僅 Mock 模式有固定示範文字；真實模式資料來源是決策紀錄，這裡先留空。 */
  readonly previousComment = MOCK_PREVIOUS_COMMENT;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (this.useMockData) {
      this.product.set(mockDetail(this.productId));
      this.pageState.set('default');
      return;
    }

    this.pageState.set('loading');
    this.api
      .getDetailWithTypeName(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.product.set(detail);
          this.pageState.set('default');
        },
        error: (err) => {
          this.pageState.set('error');
          this.errorMessage.set(toApiError(err).message);
        },
      });
  }

  retry(): void {
    this.pageState.set('default');
    this.statusMessageState.show(this.useMockData ? '已恢復審核資料。' : '');
    this.load();
  }

  // ----- UI 狀態切換器（Mock 模式展示用，不呼叫 API）-----

  setState(state: DetailState): void {
    this.pageState.set(state);
    this.statusMessageState.show(`已切換為 ${state} 狀態。`);
  }

  simulateConflict(): void {
    this.conflictOpen.set(true);
    this.statusMessageState.show('模擬 409 Conflict：此品項已由其他管理人員審核。');
  }

  closeConflict(): void {
    this.conflictOpen.set(false);
    if (!this.useMockData) {
      // 真實模式的衝突是實際發生過的事，關閉後應該回到清單重新確認最新狀態，
      // 而不是留在這頁對著一份已經過期的審核快照。
      void this.router.navigate(['/review']);
    }
  }

  // ----- 表單互動 -----

  toggleRisk(id: number): void {
    this.selectedRiskIds.update((items) =>
      items.includes(id) ? items.filter((i) => i !== id) : [...items, id],
    );
  }

  submit(): void {
    const product = this.product();
    if (!product) return;

    const form: ReviewFormModel = {
      productId: product.productId,
      decision: this.decision(),
      selectedRiskOptionIds: this.selectedRiskIds(),
      reviewComment: this.comment(),
      otherNote: this.otherNote(),
    };

    // 三條企劃書規則，後端刻意不驗證，全部由前端把關。
    const validation = validateReviewForm(form, product.availableRiskOptions);
    if (!validation.valid) {
      this.dialog.notify('error', '請確認表單內容', [validation.message ?? '請確認表單內容。']).subscribe();
      return;
    }

    // 核准／拒絕是不可逆的正式決策——畫面本身的提示文字就寫著「送出後將
    // 建立正式審核紀錄，無法覆蓋」，卻沒有任何確認步驟擋在「按下按鈕」
    // 與「決策真正送出」之間，使用者滑鼠稍微一滑、或在填完表單後分心
    // 誤觸，就會讓一筆不能反悔的決策成立。這裡補上最後一道確認關卡，
    // 訊息裡明確覆誦這次的決定是「通過」還是「不通過」，不是泛用的
    // 「確定要送出嗎？」——泛用訊息無法讓使用者核對「我選的是不是我
    // 真正要的那個決定」，這才是誤觸真正會出錯的地方。
    const decisionLabel = this.decision() === 'APPROVED' ? '通過選品審核' : '不通過';
    this.dialog
      .confirm(
        '確認送出審核決策',
        [
          `即將把「${product.productName}」的審核結果送出為：${decisionLabel}。`,
          this.useMockData
            ? '這是本地模擬，不會建立正式紀錄。'
            : '送出後將建立正式審核紀錄，無法覆蓋或撤回，請確認決定無誤。',
        ],
        '確定送出',
        '再檢查一次',
      )
      .subscribe((confirmed) => {
        if (confirmed) this.proceedSubmit(form);
      });
  }

  private proceedSubmit(form: ReviewFormModel): void {
    if (this.useMockData) {
      const message = `已在本地模擬${this.decision() === 'APPROVED' ? '通過' : '不通過'}決策。`;
      this.submitted.set(true);
      this.showSubmittedDialog(message);
      return;
    }

    this.isSubmitting.set(true);
    this.statusMessageState.show('');

    this.api
      .submit(toReviewSubmitPayload(form))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.submitted.set(true);
          this.showSubmittedDialog(
            this.decision() === 'APPROVED'
              ? '已通過選品審核，但不代表已銷售。'
              : '未通過，後續可修改品項後重審。',
          );
        },
        error: (err) => {
          this.isSubmitting.set(false);
          const error = toApiError(err);

          if (error.status === 409) {
            // 409：條件式 UPDATE 影響筆數為 0，代表別人已經先審過這筆。
            // 這不是罕見例外，是多人同時看待審清單的正常情況。
            this.conflictOpen.set(true);
            this.statusMessageState.show('此品項已由其他管理人員完成審核。');
            return;
          }

          this.dialog.notify('error', '送出失敗', [error.message]).subscribe();
        },
      });
  }

  /**
   * 審核送出成功一律跳出 dialog 呈現，不再是內嵌卡片＋要手動點的連結
   * ——跟 product-form.ts「儲存並重審」成功後的樣式與流程統一：
   * 都是 dialog、都是使用者按下確定後才導頁離開，不是送出當下就直接跳轉。
   */
  private showSubmittedDialog(message: string): void {
    const title = this.useMockData ? '審核決策已儲存於本地 Mock' : '審核決策已送出';
    this.dialog.notify('success', title, [message]).subscribe(() => {
      void this.router.navigate(['/review']);
    });
  }
}
