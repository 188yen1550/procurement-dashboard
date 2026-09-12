import { DialogService } from '../../../core/dialog/dialog.service';
import { finalize } from 'rxjs';
/**
 * 檔案用途：品項編輯頁。一般基本資料永遠可編輯，選品核心資料在 APPROVED 時鎖定；
 * 同時提供刪除／封存／復用三個生命週期操作與評估分數區塊。
 *
 * ## 這次改寫修掉的四個問題
 *
 * 1. **封存／復用打到不存在的端點**
 *    舊碼是 `PATCH /api/products/{id}/item-status`，後端沒有這支，必定 404。
 *    正確是 `POST /api/products/{id}/archive` 與 `.../restore`。
 *
 * 2. **canDelete 永遠是 false**
 *    舊碼判斷 `reviewStatus === 'DRAFT'`，但系統的 ReviewStatus 只有
 *    PENDING／APPROVED／REJECTED，沒有 DRAFT。刪除按鈕在真實資料下不會出現。
 *
 * 3. **自訂的 ProductEvaluation 介面與後端對不上**
 *    舊碼的 marketPotentialScore／costCompetitivenessScore／isFrozenSnapshot
 *    後端 EvaluationResponse 完全沒有。已改用 contract 的型別，
 *    isFrozenSnapshot 對應到真實的 `dataSource === 'SNAPSHOT'`。
 *
 * 4. **大量 any 與缺少拆殼**
 *    `http.get<any>` 讓整頁沒有型別保護，且沒拆 ApiResponse 外殼，
 *    實際拿到的是 { success, message, data } 而不是商品本身。
 *
 * ## 保留
 * editForm / coreForm 兩組表單的切分維持不變——那個設計是對的，
 * APPROVED 只鎖核心那一組，基本資料仍可編輯。
 */
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { ItemStatus, PricingType, ReviewStatus } from '../../../core/domain/enums';
import { DATA_SOURCE_LABEL, joinCampaignTags, splitCampaignTags } from '../../../core/domain/labels';
import { ProductApiService } from '../api/product-api.service';
import { EvaluationResponsePayload } from '../api/product-api.contract';
import { ProductActionAvailability } from '../api/product.mapper';

@Component({
  selector: 'app-product-edit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './product-edit.html',
  styleUrl: './product-edit.scss',
})
export class ProductEdit implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ProductApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly dialog = inject(DialogService);
  isDeleting = false;
  deleteConfirming = false;
  productId!: string;
  reviewStatus: ReviewStatus = 'PENDING';
  itemStatus: ItemStatus = 'ACTIVE';
  submissionCount = 0;
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';

  /** 由 mapper 統一算出的按鈕啟用條件，元件不再自己判斷狀態組合。 */
  actions: ProductActionAvailability = {
    canResubmit: false,
    canArchive: false,
    canRestore: false,
    canPromote: false,
    canDelete: false,
    isCoreLocked: false,
  };

  evaluationData: EvaluationResponsePayload | null = null;
  isEvaluationLoading = false;
  evaluationErrorMessage = '';

  /** 一般基本資料 — 永遠可編輯。 */
  readonly editForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    description: [''],
    imageUrl: [''],
    supplierName: [''],
  });

  /**
   * 選品核心資料 — APPROVED 時鎖定。
   *
   * ⚠️ supplyStability / priceCompetitiveness 型別改成 number：
   * 後端是 BigDecimal(0–5 評分)，舊碼宣告成 string 會讓送出的值被
   * Jackson 拒絕或轉成非預期數字。
   *
   * ⚠️ estimatedPurchaseRate 是 0–1 的小數（0.8 代表 80%），不是百分比。
   * 表單存後端格式，顯示層才 ×100，避免來回轉換出錯。
   *
   * ⚠️ marketPrice 只有 RESALE 能填，NEW 送出會被後端 400 擋下。
   */
  readonly coreForm = this.fb.nonNullable.group({
    productTypeId: [null as number | null, Validators.required],
    pricingType: ['' as PricingType | '', Validators.required],
    costPrice: [null as number | null],
    salePrice: [null as number | null],
    marketPrice: [null as number | null],
    campaignTags: [''],
    moq: [null as number | null],
    supplyStability: [null as number | null],
    priceCompetitiveness: [null as number | null],
    targetCustomerDescription: [''],
    estimatedPurchaseRate: [null as number | null],
  });

  ngOnInit(): void {
    this.productId = this.route.snapshot.paramMap.get('id')!;
    this.loadProduct();
    this.loadProductEvaluation();
  }

  // ----- 載入 -----

  loadProduct(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api
      .getProductForm(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (model) => {
          this.reviewStatus = model.reviewStatus;
          this.itemStatus = model.itemStatus;
          this.submissionCount = model.submissionCount;
          this.actions = model.actions;

          this.editForm.patchValue(model.base);
          this.coreForm.patchValue({
            ...model.core,
            // 表單以逗號字串呈現，送出前再拆回陣列。
            campaignTags: joinCampaignTags(model.core.campaignTags),
          });

          // 只有 APPROVED 鎖核心資料；基本資料那組永遠保持可編輯。
          if (model.actions.isCoreLocked) this.coreForm.disable();
          else this.coreForm.enable();

          this.isLoading = false;
        },
        error: (err) => {
          this.errorMessage = toApiError(err).message;
          this.isLoading = false;
        },
      });
  }

  loadProductEvaluation(): void {
    this.isEvaluationLoading = true;
    this.evaluationErrorMessage = '';

    this.api
      .getEvaluation(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.evaluationData = data;
          this.isEvaluationLoading = false;
        },
        error: (err) => {
          // 分數區塊單獨降級：商品資料還在，沒有理由讓整頁不能編輯。
          this.evaluationErrorMessage = toApiError(err).message;
          this.isEvaluationLoading = false;
        },
      });
  }

  // ----- 顯示輔助 -----

  get isCoreLocked(): boolean {
    return this.actions.isCoreLocked;
  }

  /**
   * 分數是否為審核當下的凍結快照。
   * ⚠️ 讀後端的 dataSource，不要用 reviewStatus 自行反推——
   * 雙軌規則封裝在後端 ScoringService，前端反推會在規則調整時失準。
   */
  get isFrozenSnapshot(): boolean {
    return this.evaluationData?.dataSource === 'SNAPSHOT';
  }

  get dataSourceLabel(): string {
    return this.evaluationData ? DATA_SOURCE_LABEL[this.evaluationData.dataSource] : '';
  }

  /** RESALE 才顯示市售價格欄位；NEW 填了會被後端 400 擋下。 */
  get showMarketPrice(): boolean {
    return this.coreForm.getRawValue().pricingType === 'RESALE';
  }

  get showActionMessage(): boolean {
    return !this.actions.canDelete && !this.actions.canArchive && !this.actions.canRestore;
  }

  // ----- 生命週期操作 -----

  get deleteDisabledReason(): string {
    if (this.isDeleting || this.deleteConfirming) return '正在確認或刪除品項，請稍候。';
    if (this.dialog.state()) return '請先完成目前的對話框操作。';
    if (this.isLoading || this.isSaving) return '資料處理中，請稍候。';
    if (this.itemStatus === 'ARCHIVED') return '已封存的品項不可刪除。';
    if (!this.actions.canDelete) return '僅未審核且從未送審的品項可刪除。';
    return '';
  }

  onDelete(): void {
    if (this.deleteDisabledReason) return;
    const name = this.editForm.controls.name.value;
    this.deleteConfirming = true;
    this.dialog.confirm('確認刪除品項', ['刪除對象：「' + name + '」。', '將永久移除此品項資料，刪除後無法復原。'], '刪除', '取消')
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(ok => {
        this.deleteConfirming = false;
        if (!ok || this.deleteDisabledReason) return;
        this.isDeleting = true;
        this.api.remove(this.productId)
          .pipe(finalize(() => this.isDeleting = false), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => this.dialog.notify('success', '刪除成功', ['已刪除「' + name + '」。'])
              .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.router.navigate(['/products'])),
            error: err => {
              this.handleActionError(err, '刪除');
              this.dialog.notify('error', '刪除失敗', [this.errorMessage]).subscribe();
            },
          });
      });
  }

  /** ⚠️ POST /archive，不是 PATCH /item-status（後端沒有那支端點）。 */
  onArchive(): void {
    if (!this.actions.canArchive) return;

    this.api
      .archive(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.successMessage = '已封存此品項。';
          this.loadProduct();
        },
        error: (err) => this.handleActionError(err, '封存'),
      });
  }

  onRestore(): void {
    if (!this.actions.canRestore) return;

    this.api
      .restore(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.successMessage = '已復用此品項。';
          this.loadProduct();
        },
        error: (err) => this.handleActionError(err, '復用'),
      });
  }

  // ----- 送出 -----

  onSubmit(): void {
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    if (!this.isCoreLocked && this.coreForm.invalid) {
      this.coreForm.markAllAsTouched();
      return;
    }

    const base = this.editForm.getRawValue();
    // getRawValue() 而非 value：coreForm 在 APPROVED 時是 disabled，
    // value 會回空物件，導致整份覆蓋時把核心欄位全部清成 null。
    const core = this.coreForm.getRawValue();
    const isResale = core.pricingType === 'RESALE';

    this.isSaving = true;
    this.errorMessage = '';

    this.api
      .update(this.productId, {
        name: base.name.trim(),
        description: base.description.trim() || null,
        imageUrl: base.imageUrl.trim() || null,
        supplierName: base.supplierName.trim() || null,
        productTypeId: core.productTypeId!,
        pricingType: core.pricingType as PricingType,
        costPrice: core.costPrice,
        salePrice: core.salePrice,
        // NEW 商品一律送 null，避免撞上後端的 400 驗證。
        marketPrice: isResale ? core.marketPrice : null,
        // ⚠️ 一律半形逗號：ScoringService.splitTags() 只吃 split(",")，
        // 全形頓號會讓節慶比對整組失效且不會報錯。
        campaignTags: joinCampaignTags(splitCampaignTags(core.campaignTags)) || null,
        moq: core.moq,
        supplyStability: core.supplyStability,
        priceCompetitiveness: core.priceCompetitiveness,
        targetCustomerDescription: core.targetCustomerDescription.trim() || null,
        estimatedPurchaseRate: core.estimatedPurchaseRate,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.router.navigate(['/products', this.productId]);
        },
        error: (err) => {
          this.isSaving = false;
          const error = toApiError(err);
          // 409 專屬訊息：後端在 APPROVED 商品異動核心資料時回這個狀態碼。
          // 顯示通用錯誤會讓使用者不知道是哪些欄位不能改。
          this.errorMessage =
            error.status === 409
              ? `${error.message}（已核准商品僅能修改名稱、描述、圖片與供應商）`
              : error.message;
        },
      });
  }

  private handleActionError(err: unknown, action: string): void {
    const error = toApiError(err);
    this.errorMessage = `${action}失敗：${error.message}`;
    // 409 代表狀態已被他人變更，重新載入讓畫面回到真實狀態。
    if (error.status === 409) this.loadProduct();
  }
}
