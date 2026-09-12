import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ProductForm } from './product-form';
import { PRODUCT_TYPES, CAMPAIGN_TAGS } from '../../../core/domain/frontend-options';
import { DialogService } from '../../../core/dialog/dialog.service';
describe('商品表單本地原型', () => {
  beforeEach(() => {vi.useFakeTimers();TestBed.configureTestingModule({providers:[provideHttpClient(),provideRouter([])]});});
  afterEach(() => vi.useRealTimers());
  function create(){const f=TestBed.createComponent(ProductForm);f.detectChanges();f.componentInstance.form.patchValue({name:'茶飲',supplierName:'供應商',productTypeId:13,targetCustomer:'家庭'});return f;}
  it('新品隱藏價格，再販售顯示價格並動態清除隱藏錯誤，不清除資料', () => {
    const f=create(),c=f.componentInstance;c.form.controls.pricingType.setValue('RESALE');c.form.controls.costPrice.setValue(-10);f.detectChanges();
    expect(c.form.invalid).toBe(true);expect((f.nativeElement as HTMLElement).querySelector('[formControlName=costPrice]')).toBeTruthy();
    c.form.controls.pricingType.setValue('NEW');f.detectChanges();expect(c.form.valid).toBe(true);expect(c.form.controls.costPrice.value).toBe(-10);
    expect((f.nativeElement as HTMLElement).querySelector('[formControlName=costPrice]')).toBeNull();
    c.form.controls.pricingType.setValue('RESALE');expect(c.form.invalid).toBe(true);
  }, 15000);
  it('中文節慶下拉不可重複選擇，不包含移除選項與分類', () => {
    const f=create(),c=f.componentInstance;c.addCampaignTag('gift');c.addCampaignTag('gift');f.detectChanges();expect(c.form.controls.campaignTags.value).toEqual(['gift']);
    const select=(f.nativeElement as HTMLElement).querySelector('select#campaign-select')!;
    expect(select.textContent).toContain('節慶送禮');expect(select.textContent).not.toContain('gift');
    expect(JSON.stringify(CAMPAIGN_TAGS)).not.toContain('雙11');expect(JSON.stringify(PRODUCT_TYPES)).not.toContain('家電');
    for(const name of ['零食','生鮮','冷凍食品','常溫食品','飲料'])expect(PRODUCT_TYPES.some(t=>t.name===name)).toBe(true);
  });
  it('百分比範圍、正整數最低量、空白字串與金額精度會阻止送出', () => {
    const c=create().componentInstance;
    for(const rate of [-1,101]) {c.form.controls.estimatedPurchaseRate.setValue(rate);expect(c.form.invalid).toBe(true);}
    c.form.controls.estimatedPurchaseRate.setValue(100);
    for(const moq of [0,-1,1.5,1000001]){c.form.controls.moq.setValue(moq);expect(c.form.invalid).toBe(true);}
    c.form.controls.moq.setValue(1);c.form.controls.name.setValue('   ');expect(c.form.invalid).toBe(true);
    c.form.controls.name.setValue('商品');c.form.patchValue({pricingType:'RESALE',costPrice:1.234,salePrice:10,marketPrice:20});expect(c.form.invalid).toBe(true);
  });
  it('低於成本或高於市價只警告，不禁止合法數值送出', () => {
    const c=create().componentInstance;c.form.patchValue({pricingType:'RESALE',costPrice:20,salePrice:10,marketPrice:5});
    expect(c.priceWarnings().length).toBe(2);expect(c.form.valid).toBe(true);
  });
  it('模擬失敗保留內容與未儲存提醒，重試只儲存一次', () => {
    const c=create().componentInstance;c.form.markAsDirty();c.mockSaveFailure.set(true);c.submit();c.submit();vi.advanceTimersByTime(500);
    expect(c.saved()).toBe(false);expect(c.form.dirty).toBe(true);expect(c.form.controls.name.value).toBe('茶飲');
    TestBed.inject(DialogService).handleConfirm();c.mockSaveFailure.set(false);c.submit();c.submit();vi.advanceTimersByTime(500);
    expect(c.productPrototype.items().length).toBe(1);expect(c.saved()).toBe(true);
  });
  it('圖片上傳失敗保留預覽，讀取中不能送出', () => {
    const c=create().componentInstance;c.imageState.set('loading');c.submit();expect(c.isSubmitting()).toBe(false);
    c.imageState.set('ready');c.imagePreviewUrl.set('data:image/png;base64,test');c.mockUploadFailure.set(true);c.submit();vi.advanceTimersByTime(500);
    expect(c.saved()).toBe(false);expect(c.imagePreviewUrl()).toContain('data:image/png');
  });
  it('無效送出關閉摘要後聚焦第一個錯誤欄位', () => {
    const f=create(),c=f.componentInstance;c.form.controls.productTypeId.setValue(null);c.form.controls.name.setValue('');c.submit();f.detectChanges();
    TestBed.inject(DialogService).handleConfirm();
    expect(document.activeElement?.getAttribute('formControlName')).toBe('productTypeId');
  });
});
