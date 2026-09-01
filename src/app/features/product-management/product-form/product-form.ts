/**
 * 檔案用途：新增／編輯品項表單、圖片本地預覽、欄位鎖定、重複送出與未儲存變更保護。
 * NEW 顯示 PENDING_PRICING 且不要求價格；RESALE 要求成本／售價／市價。APPROVED 仍可改一般資料與圖片，但核心資料鎖定。
 */
import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

type FormPageState = 'default' | 'locked' | 'loading' | 'error';
type ImageState = 'empty' | 'loading' | 'ready' | 'error';
interface ImageInfo { name: string; type: string; size: number; }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

// supplyStability／priceCompetitiveness 是後端 0–5 分制（ScoringService 內部
// 直接 ×20 換算成 0–100 分數，不是這裡先前寫的 0–100 輸入尺度）。
// estimatedPurchaseRate 表單維持 0–100（%）給使用者輸入比較直覺，
// 送出前由 toEstimatedPurchaseRateDecimal() 換算成後端要的 0–1 小數，
// 見 ProductService/ScoringService：estimated_purchase_rate × 100 = 購買分數。
const EDIT_DATA: Record<string, Record<string, string | number>> = {
  '101': { name: '中秋炭烤海陸組合禮盒', supplierName: '潮港鮮物有限公司', productType: '食品／生鮮', pricingType: 'RESALE', description: '適合中秋團購的海陸烤肉組合。', campaignTags: 'bbq, gift', costPrice: 820, salePrice: 1190, marketPrice: 1490, moq: 50, supplyStability: 4.6, priceCompetitiveness: 4.4, targetCustomer: '25–45 歲家庭與公司團購', estimatedPurchaseRate: 76 },
  '103': { name: '無香低敏濃縮洗衣紙補充組', supplierName: '淨好生活實業', productType: '日用品', pricingType: 'RESALE', description: '低敏無香洗衣紙。', campaignTags: 'family, daily', costPrice: 180, salePrice: 299, marketPrice: 359, moq: 100, supplyStability: 3.2, priceCompetitiveness: 3.6, targetCustomer: '重視成分與收納便利的家庭', estimatedPurchaseRate: 58 },
};

@Component({
  selector: 'app-product-form',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './product-form.html',
  styleUrls: ['./product-form.scss', './product-image.scss'],
})
/** 品項表單頁元件；所有儲存與圖片預覽皆為本地 Mock，不呼叫圖片或商品 API。 */
export class ProductForm {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly productId = this.route.snapshot.paramMap.get('id');
  readonly isEditMode = !!this.productId;
  readonly isApproved = this.productId === '101';
  readonly isRejected = this.productId === '103';
  readonly pageState = signal<FormPageState>('default');
  readonly saved = signal(false);
  readonly isSubmitting = signal(false);
  readonly submitCount = signal(0);
  readonly leaveDialogOpen = signal(false);
  readonly statusMessage = signal('');
  readonly stateOptions: readonly FormPageState[] = ['default', 'locked', 'loading', 'error'];
  readonly productTypes = ['食品／生鮮', '日用品', '3C／家電', '生活雜貨', '美妝保養', '服飾配件', '寢具家用', '精品禮盒', '其他'];
  readonly imageState = signal<ImageState>('empty');
  readonly imagePreviewUrl = signal<string | null>(null);
  readonly imageInfo = signal<ImageInfo | null>(null);
  readonly imageError = signal('');
  readonly imageDirty = signal(false);
  readonly maxImageSizeLabel = '5 MB';

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    supplierName: ['', [Validators.required, Validators.maxLength(100)]],
    productType: ['', Validators.required],
    pricingType: ['NEW', Validators.required],
    description: ['', Validators.maxLength(500)],
    campaignTags: ['', Validators.required],
    costPrice: [0, [Validators.min(0)]],
    salePrice: [0, [Validators.min(0)]],
    marketPrice: [0, [Validators.min(0)]],
    moq: [1, [Validators.required, Validators.min(1)]],
    // 後端 Product.supplyStability / priceCompetitiveness 是 0–5 分制
    // （precision=5, scale=2），不是 0–100。
    supplyStability: [2.5, [Validators.required, Validators.min(0), Validators.max(5)]],
    priceCompetitiveness: [2.5, [Validators.required, Validators.min(0), Validators.max(5)]],
    targetCustomer: ['', Validators.required],
    // 表單維持 0–100（%）輸入，實際送出時要換算成後端要的 0–1 小數
    // （見 toEstimatedPurchaseRateDecimal()）。
    estimatedPurchaseRate: [50, [Validators.required, Validators.min(0), Validators.max(100)]],
  });

  /**
   * 後端 Product.estimatedPurchaseRate 是 0–1 小數（ScoringService.
   * calculatePurchaseScore() 直接 ×100 當作購買分數）。表單為了輸入體驗
   * 維持 0–100（%），呼叫 API 前務必用這個方法換算，不要直接送表單原始值
   * ——送 76 過去會被當成 7600%，分數會被 clamp 死在滿分，且不會報錯，
   * 是目前最容易被忽略的一個換算陷阱。
   */
  toEstimatedPurchaseRateDecimal(): number {
    return Math.round(this.form.controls.estimatedPurchaseRate.value) / 100;
  }

  isResale(): boolean { return this.form.controls.pricingType.value === 'RESALE'; }

  constructor() {
    if (this.productId && EDIT_DATA[this.productId]) this.form.patchValue(EDIT_DATA[this.productId]);
    if (this.isApproved) this.lockCoreFields();
  }

  setState(state: FormPageState): void {
    this.pageState.set(state);
    if (state === 'locked') this.lockCoreFields();
    else if (!this.isApproved) this.unlockCoreFields();
    this.statusMessage.set(`已切換為 ${state} 狀態。`);
  }

  /**
   * 驗證並模擬儲存表單；`resubmit` 用於 REJECTED 商品的重新送審文案。
   * 方法會更新 saved、isSubmitting、submitCount 與狀態訊息，500ms 後解除送出鎖；不呼叫後端。
   */
  submit(resubmit = false): void {
    if (this.isSubmitting()) { this.statusMessage.set('正在儲存，請勿重複送出。'); return; }
    if (this.form.invalid) { this.form.markAllAsTouched(); this.statusMessage.set('請先修正表單中的錯誤。'); return; }
    if (this.isResale() && (!this.form.controls.costPrice.value || !this.form.controls.salePrice.value || !this.form.controls.marketPrice.value)) {
      this.form.controls.costPrice.setErrors({ required: true });
      this.form.controls.salePrice.setErrors({ required: true });
      this.form.controls.marketPrice.setErrors({ required: true });
      this.statusMessage.set('再販售品項必須完整填寫三種價格。'); return;
    }
    this.isSubmitting.set(true); this.submitCount.update((count) => count + 1);
    this.saved.set(true); this.form.markAsPristine(); this.imageDirty.set(false);
    this.statusMessage.set(resubmit ? '已在本地模擬儲存並重新送審。' : '已儲存本地 Mock 品項。');
    window.setTimeout(() => this.isSubmitting.set(false), 500);
  }

  /**
   * 驗證使用者選取的 JPG／PNG／WebP 與 5 MB 上限，並以 FileReader 建立本地 data URL 預覽。
   * 成功或失敗都更新圖片 signal；讀取為非同步事件，不需持久化或外部資源清理。
   */
  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.saved.set(false); this.imageError.set('');
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!SUPPORTED_IMAGE_TYPES.has(file.type) || !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      this.setImageError('不支援的圖片格式，請選擇 JPG、PNG 或 WebP。'); return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.setImageError('圖片檔案超過 5 MB 上限，請縮小後再試。'); return;
    }
    this.imageState.set('loading');
    this.imageInfo.set({ name: file.name, type: file.type, size: file.size });
    this.imageDirty.set(true);
    const reader = this.createFileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') { this.setImageError('圖片讀取失敗，請重新選擇檔案。'); return; }
      this.imagePreviewUrl.set(reader.result); this.imageState.set('ready');
      this.statusMessage.set('圖片已在瀏覽器本地建立預覽，尚未儲存。');
    };
    reader.onerror = () => this.setImageError('圖片讀取失敗，請重新選擇檔案。');
    reader.readAsDataURL(file);
  }
  /** 移除目前本地圖片並標記未儲存變更；只更新 signal，不刪除伺服器檔案。 */
  removeImage(): void {
    this.imagePreviewUrl.set(null); this.imageInfo.set(null); this.imageError.set('');
    this.imageState.set('empty'); this.imageDirty.set(true); this.saved.set(false);
    this.statusMessage.set('圖片已移除，尚未儲存。');
  }
  formatFileSize(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  createFileReader(): FileReader { return new FileReader(); }

  requestCancel(): void {
    if (this.hasUnsavedChanges()) this.leaveDialogOpen.set(true); else void this.router.navigate(['/products']);
  }
  discardAndLeave(): void { this.form.markAsPristine(); this.imageDirty.set(false); this.leaveDialogOpen.set(false); void this.router.navigate(['/products']); }
  closeLeaveDialog(): void { this.leaveDialogOpen.set(false); }
  retry(): void { this.pageState.set('default'); this.statusMessage.set('已恢復本地表單資料。'); }
  fieldInvalid(name: keyof typeof this.form.controls): boolean { const c = this.form.controls[name]; return c.invalid && (c.touched || c.dirty); }
  marginRate(): number | null { const cost = this.form.controls.costPrice.value; const sale = this.form.controls.salePrice.value; return sale > 0 && cost >= 0 ? Math.round(((sale - cost) / sale) * 1000) / 10 : null; }
  canLeave(): boolean { return !this.hasUnsavedChanges() || window.confirm('尚有未儲存的變更，確定要離開嗎？'); }

  @HostListener('window:beforeunload', ['$event'])
  preventAccidentalLeave(event: BeforeUnloadEvent): void { if (this.hasUnsavedChanges()) event.preventDefault(); }

  private hasUnsavedChanges(): boolean { return !this.saved() && (this.form.dirty || this.imageDirty()); }
  private setImageError(message: string): void {
    this.imagePreviewUrl.set(null); this.imageInfo.set(null); this.imageState.set('error');
    this.imageError.set(message); this.imageDirty.set(false); this.statusMessage.set(message);
  }

  private lockCoreFields(): void {
    const names: (keyof typeof this.form.controls)[] = ['productType','pricingType','campaignTags','costPrice','salePrice','marketPrice','moq','supplyStability','priceCompetitiveness','targetCustomer','estimatedPurchaseRate'];
    names.forEach((name) => this.form.controls[name].disable());
  }
  private unlockCoreFields(): void { this.form.enable(); }
}
