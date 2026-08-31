import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProductForm } from './product-form';

describe('ProductForm', () => {
  let fixture: ComponentFixture<ProductForm>;
  let component: ProductForm;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProductForm], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(ProductForm); component = fixture.componentInstance; fixture.detectChanges();
  });

  it('creates a new product form with NEW pricing by default', () => {
    expect(component).toBeTruthy(); expect(component.isEditMode).toBe(false); expect(component.isResale()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('待訂價 PENDING_PRICING');
  });

  it('shows validation errors for an invalid submit', () => {
    component.submit(); fixture.detectChanges();
    expect(component.form.invalid).toBe(true); expect(fixture.nativeElement.textContent).toContain('請輸入 100 字以內的商品名稱');
  });

  it('requires prices for RESALE products', () => {
    component.form.patchValue({ name: '測試商品', supplierName: '測試供應商', productType: '日用品', pricingType: 'RESALE', campaignTags: 'daily', targetCustomer: '家庭' });
    component.submit(); expect(component.form.controls.costPrice.hasError('required')).toBe(true);
  });

  it('saves valid mock data locally', () => {
    component.form.patchValue({ name: '測試商品', supplierName: '測試供應商', productType: '日用品', campaignTags: 'daily', targetCustomer: '家庭' });
    component.submit(); fixture.detectChanges(); expect(component.saved()).toBe(true); expect(fixture.nativeElement.textContent).toContain('本地 Mock 儲存成功');
  });

  it('opens an unsaved changes dialog for a dirty form', () => {
    component.form.controls.name.setValue('已修改'); component.form.markAsDirty(); component.requestCancel(); fixture.detectChanges();
    expect(component.leaveDialogOpen()).toBe(true); expect(fixture.nativeElement.textContent).toContain('放棄未儲存的變更');
  });

  it('blocks route deactivation when unsaved changes are not confirmed', () => {
    component.form.markAsDirty();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(component.canLeave()).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('renders loading and error states', () => {
    component.setState('loading'); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('正在載入品項表單');
    component.setState('error'); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('無法讀取表單資料');
  });
});
