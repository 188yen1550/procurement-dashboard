import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

type FormPageState = 'default' | 'locked' | 'loading' | 'error';

const EDIT_DATA: Record<string, Record<string, string | number>> = {
  '101': { name: '中秋炭烤海陸組合禮盒', supplierName: '潮港鮮物有限公司', productType: '食品／生鮮', pricingType: 'RESALE', description: '適合中秋團購的海陸烤肉組合。', campaignTags: 'bbq, gift', costPrice: 820, salePrice: 1190, marketPrice: 1490, moq: 50, supplyStability: 92, priceCompetitiveness: 88, targetCustomer: '25–45 歲家庭與公司團購', estimatedPurchaseRate: 76 },
  '103': { name: '無香低敏濃縮洗衣紙補充組', supplierName: '淨好生活實業', productType: '日用品', pricingType: 'RESALE', description: '低敏無香洗衣紙。', campaignTags: 'family, daily', costPrice: 180, salePrice: 299, marketPrice: 359, moq: 100, supplyStability: 64, priceCompetitiveness: 72, targetCustomer: '重視成分與收納便利的家庭', estimatedPurchaseRate: 58 },
};

@Component({
  selector: 'app-product-form',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './product-form.html',
  styleUrl: './product-form.scss',
})
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
  readonly leaveDialogOpen = signal(false);
  readonly statusMessage = signal('');
  readonly stateOptions: readonly FormPageState[] = ['default', 'locked', 'loading', 'error'];
  readonly productTypes = ['食品／生鮮', '日用品', '3C／家電', '生活雜貨', '美妝保養', '服飾配件', '寢具家用', '精品禮盒', '其他'];

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
    supplyStability: [50, [Validators.required, Validators.min(0), Validators.max(100)]],
    priceCompetitiveness: [50, [Validators.required, Validators.min(0), Validators.max(100)]],
    targetCustomer: ['', Validators.required],
    estimatedPurchaseRate: [50, [Validators.required, Validators.min(0), Validators.max(100)]],
  });

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

  submit(resubmit = false): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); this.statusMessage.set('請先修正表單中的錯誤。'); return; }
    if (this.isResale() && (!this.form.controls.costPrice.value || !this.form.controls.salePrice.value || !this.form.controls.marketPrice.value)) {
      this.form.controls.costPrice.setErrors({ required: true });
      this.form.controls.salePrice.setErrors({ required: true });
      this.form.controls.marketPrice.setErrors({ required: true });
      this.statusMessage.set('再販售品項必須完整填寫三種價格。'); return;
    }
    this.saved.set(true); this.form.markAsPristine();
    this.statusMessage.set(resubmit ? '已在本地模擬儲存並重新送審。' : '已儲存本地 Mock 品項。');
  }

  requestCancel(): void {
    if (this.form.dirty && !this.saved()) this.leaveDialogOpen.set(true); else void this.router.navigate(['/products']);
  }
  discardAndLeave(): void { this.form.markAsPristine(); this.leaveDialogOpen.set(false); void this.router.navigate(['/products']); }
  closeLeaveDialog(): void { this.leaveDialogOpen.set(false); }
  retry(): void { this.pageState.set('default'); this.statusMessage.set('已恢復本地表單資料。'); }
  fieldInvalid(name: keyof typeof this.form.controls): boolean { const c = this.form.controls[name]; return c.invalid && (c.touched || c.dirty); }
  marginRate(): number | null { const cost = this.form.controls.costPrice.value; const sale = this.form.controls.salePrice.value; return sale > 0 && cost >= 0 ? Math.round(((sale - cost) / sale) * 1000) / 10 : null; }
  canLeave(): boolean { return this.form.pristine || this.saved() || window.confirm('尚有未儲存的變更，確定要離開嗎？'); }

  @HostListener('window:beforeunload', ['$event'])
  preventAccidentalLeave(event: BeforeUnloadEvent): void { if (this.form.dirty && !this.saved()) event.preventDefault(); }

  private lockCoreFields(): void {
    const names: (keyof typeof this.form.controls)[] = ['productType','pricingType','campaignTags','costPrice','salePrice','marketPrice','moq','supplyStability','priceCompetitiveness','targetCustomer','estimatedPurchaseRate'];
    names.forEach((name) => this.form.controls[name].disable());
  }
  private unlockCoreFields(): void { this.form.enable(); }
}
