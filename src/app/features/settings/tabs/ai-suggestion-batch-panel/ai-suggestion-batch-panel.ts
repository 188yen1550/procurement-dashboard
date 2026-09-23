/**
 * 檔案用途：系統設定 › 演算法參數 › 排程作業：「AI 主動選品批次」手動觸發面板。
 *
 * 2026-09-24 職責分離（決策 D2）：這顆按鈕原本在 AI 建議清單頁，後端
 * AiSuggestionBatchController 只允許 MANAGER 呼叫；管理層不再進入 AI 建議清單
 * 之後，按鈕留在原處就沒有人按得到。移到這裡的理由：它本質上是「替每日
 * 03:00 排程手動補跑一次」的系統層操作，還會消耗 Gemini 配額，性質屬於
 * 系統設定，不是日常選品動作。
 *
 * 邏輯原樣搬自 ai-suggestions.ts 的 triggerBatch()／runBatch()，三道防呆不變：
 * 執行前二次確認、執行中鎖住按鈕、完成後回報具體數字。差別只有結果改成
 * 顯示在面板內（最後一次執行結果），不用 toast——這頁很長，toast 在頁首，
 * 使用者往下捲到這裡操作時會看不到。
 */
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { ProductApiService } from '../../../product-management/api/product-api.service';

interface BatchRunSummary {
  checkedCount: number;
  suggestedCount: number;
  finishedAt: Date;
}

@Component({
  selector: 'app-ai-suggestion-batch-panel',
  templateUrl: './ai-suggestion-batch-panel.html',
})
export class AiSuggestionBatchPanel {
  private readonly api = inject(ProductApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly isRunning = signal(false);
  readonly lastRun = signal<BatchRunSummary | null>(null);

  trigger(): void {
    if (this.isRunning()) return;

    if (this.useMockData) {
      this.dialog
        .notify('info', '功能限制', ['Mock 模式不會實際觸發批次，也不會消耗 Gemini 配額。'])
        .subscribe();
      return;
    }

    this.dialog
      .confirm(
        '要執行 AI 主動選品批次嗎？',
        [
          '系統會掃描現有商品並產生新的 AI 建議候選。',
          '這個動作會實際呼叫 Gemini 並消耗 API 配額，商品數量多時需要一段時間。',
          '正式排程每日凌晨三點會自動執行，手動觸發通常只在需要立即看到結果時使用。',
        ],
        '開始執行',
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) this.run();
      });
  }

  private run(): void {
    this.isRunning.set(true);
    this.api
      .triggerAiSuggestionBatch()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isRunning.set(false);
          this.lastRun.set({
            checkedCount: result.checkedCount,
            suggestedCount: result.suggestedCount,
            finishedAt: new Date(),
          });
        },
        error: (err: unknown) => {
          this.isRunning.set(false);
          this.dialog.notify('error', '批次執行失敗', [toApiError(err).message]).subscribe();
        },
      });
  }
}
