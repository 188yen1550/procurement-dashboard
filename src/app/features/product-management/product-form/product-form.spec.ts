/**
 * 檔案用途：驗證品項表單的 NEW／RESALE、圖片格式與大小、離頁 dirty、核准欄位鎖定及防重送。
 * TestBed 使用 Router provider 與瀏覽器 FileReader stub；所有案例均為本地 Mock 單元測試。
 */
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
  it('creates a local preview for a supported image', () => {
    const reader = { result: 'data:image/png;base64,mock', readAsDataURL: vi.fn(), onload: null as null | (() => void), onerror: null as null | (() => void) };
    reader.readAsDataURL.mockImplementation(() => reader.onload?.());
    vi.spyOn(component, 'createFileReader').mockReturnValue(reader as unknown as FileReader);
    component.onImageSelected({ target: { files: [new File(['image'], 'demo.png', { type: 'image/png' })], value: 'demo.png' } } as unknown as Event);
    fixture.detectChanges();
    expect(component.imageState()).toBe('ready'); expect(component.imagePreviewUrl()).toContain('data:image/png');
  });
  it('rejects unsupported image formats', () => {
    component.onImageSelected({ target: { files: [new File(['bad'], 'demo.gif', { type: 'image/gif' })], value: 'demo.gif' } } as unknown as Event);
    fixture.detectChanges(); expect(component.imageState()).toBe('error'); expect(fixture.nativeElement.textContent).toContain('不支援的圖片格式');
  });
  it('rejects images larger than five megabytes', () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.webp', { type: 'image/webp' });
    component.onImageSelected({ target: { files: [file], value: 'large.webp' } } as unknown as Event);
    fixture.detectChanges(); expect(component.imageState()).toBe('error'); expect(fixture.nativeElement.textContent).toContain('超過 5 MB');
  });
  it('returns to the empty state after removing an image', () => {
    component.imageState.set('ready'); component.imagePreviewUrl.set('data:image/png;base64,mock'); component.removeImage(); fixture.detectChanges();
    expect(component.imageState()).toBe('empty'); expect(fixture.nativeElement.textContent).toContain('尚未選擇圖片');
  });
  it('shows a read failure and tracks unsaved image changes in the guard', () => {
    const reader = { result: null, readAsDataURL: vi.fn(), onload: null, onerror: null as null | (() => void) };
    reader.readAsDataURL.mockImplementation(() => reader.onerror?.());
    vi.spyOn(component, 'createFileReader').mockReturnValue(reader as unknown as FileReader);
    component.onImageSelected({ target: { files: [new File(['image'], 'demo.jpg', { type: 'image/jpeg' })], value: 'demo.jpg' } } as unknown as Event);
    fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('圖片讀取失敗');
    component.removeImage(); vi.spyOn(window, 'confirm').mockReturnValue(false); expect(component.canLeave()).toBe(false);
  });
  it('keeps basic image editing available while core fields are locked', () => {
    (component as unknown as { lockCoreFields(): void }).lockCoreFields();
    expect(component.form.controls.productType.disabled).toBe(true); expect(component.form.controls.name.enabled).toBe(true); expect(fixture.nativeElement.querySelector('#product-image').disabled).toBe(false);
  });
  it('blocks duplicate submissions while saving', () => {
    component.form.patchValue({ name: '測試商品', supplierName: '測試供應商', productType: '日用品', campaignTags: 'daily', targetCustomer: '家庭' });
    component.submit(); component.submit(); fixture.detectChanges();
    expect(component.submitCount()).toBe(1); expect(component.statusMessage()).toContain('請勿重複送出'); expect(fixture.nativeElement.querySelector('.primary').disabled).toBe(true);
  });
});
