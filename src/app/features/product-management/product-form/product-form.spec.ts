/**
 * 檔案用途：驗證品項表單的 NEW／RESALE、圖片格式與大小、離頁 dirty、核准欄位鎖定及防重送。
 *
 * ⚠️ 這次接上真實 API 後才發現：useMockData 目前是 false（見 app-config.ts），
 * 代表元件一定會走真實模式——ngOnInit() 會呼叫 SettingsApiService.getProductTypes()，
 * submit() 會呼叫 ProductApiService.create()/update()。跟 product-detail.spec.ts
 * 用同一套策略：整個 mock 掉這兩個 Service，不依賴全域設定值。
 *
 * 商品分類欄位從 `productType`（字串名稱）改成 `productTypeId`（數字），
 * 舊測試裡所有 `productType: '日用品'` 都要改成對應的數字 id。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { ProductApiService } from '../api/product-api.service';
import { SettingsApiService } from '../../settings/api/settings-api.service';
import { ProductForm } from './product-form';

describe('ProductForm', () => {
  let fixture: ComponentFixture<ProductForm>;
  let component: ProductForm;

  const productTypes = [
    { id: 1, name: '食品／生鮮', description: null, isSystemDefault: true, isActive: true },
    { id: 2, name: '日用品', description: null, isSystemDefault: true, isActive: true },
  ];

  const api = {
    getProductForm: vi.fn(),
    create: vi.fn((_payload: unknown) => of({ id: 201 })),
    update: vi.fn((_id: unknown, _payload: unknown) => of({ id: 201 })),
    uploadImage: vi.fn((_id: unknown, _file: unknown) => of({ id: 201 })),
  };
  const settingsApi = {
    getProductTypes: vi.fn(() => of(productTypes)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    api.create.mockReturnValue(of({ id: 201 }));
    api.update.mockReturnValue(of({ id: 201 }));
    settingsApi.getProductTypes.mockReturnValue(of(productTypes));

    await TestBed.configureTestingModule({
      imports: [ProductForm],
      providers: [
        provideRouter([]),
        { provide: ProductApiService, useValue: api },
        { provide: SettingsApiService, useValue: settingsApi },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates a new product form with NEW pricing by default', () => {
    expect(component).toBeTruthy();
    expect(component.isEditMode).toBe(false);
    expect(component.isResale()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('待訂價 PENDING_PRICING');
  });

  it('shows validation errors for an invalid submit', () => {
    component.submit();
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('請輸入 100 字以內的商品名稱');
    // 表單驗證未過時，根本不該打 API。
    expect(api.create).not.toHaveBeenCalled();
  });

  it('requires prices for RESALE products', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 2,
      pricingType: 'RESALE',
      campaignTags: 'daily',
      targetCustomer: '家庭',
    });
    component.submit();
    expect(component.form.controls.costPrice.hasError('required')).toBe(true);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('saves product data via the API', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 2,
      campaignTags: 'daily',
      targetCustomer: '家庭',
    });
    component.submit();
    fixture.detectChanges();
    expect(api.create).toHaveBeenCalled();
    expect(component.saved()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('儲存成功');
    expect(fixture.nativeElement.textContent).toContain('已儲存品項資料');
  });

  it('sends null marketPrice for NEW pricing, avoiding backend 400', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 1,
      campaignTags: 'daily',
      targetCustomer: '家庭',
    });
    component.submit();
    const payload = api.create.mock.calls[0][0] as { marketPrice: number | null };
    // NEW 商品送 marketPrice 給後端會被 400 擋下（"市售價格僅適用於再販售商品"）。
    expect(payload.marketPrice).toBeNull();
  });

  it('normalizes campaign tags to half-width commas before sending', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 1,
      campaignTags: 'bbq、 gift',
      targetCustomer: '家庭',
    });
    component.submit();
    const payload = api.create.mock.calls[0][0] as { campaignTags: string | null };
    // ScoringService.splitTags() 只吃半形逗號，全形頓號會讓節慶比對整組失效。
    expect(payload.campaignTags).toBe('bbq,gift');
  });

  it('opens an unsaved changes dialog for a dirty form', () => {
    component.form.controls.name.setValue('已修改');
    component.form.markAsDirty();
    component.requestCancel();
    fixture.detectChanges();
    expect(component.leaveDialogOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('放棄未儲存的變更');
  });

  it('blocks route deactivation when unsaved changes are not confirmed', () => {
    component.form.markAsDirty();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(component.canLeave()).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('renders loading and error states', () => {
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入品項表單');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('無法讀取表單資料');
  });

  it('creates a local preview for a supported image', () => {
    const reader = {
      result: 'data:image/png;base64,mock',
      readAsDataURL: vi.fn(),
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    reader.readAsDataURL.mockImplementation(() => reader.onload?.());
    vi.spyOn(component, 'createFileReader').mockReturnValue(reader as unknown as FileReader);
    component.onImageSelected({
      target: { files: [new File(['image'], 'demo.png', { type: 'image/png' })], value: 'demo.png' },
    } as unknown as Event);
    fixture.detectChanges();
    expect(component.imageState()).toBe('ready');
    expect(component.imagePreviewUrl()).toContain('data:image/png');
  });

  it('rejects unsupported image formats', () => {
    component.onImageSelected({
      target: { files: [new File(['bad'], 'demo.gif', { type: 'image/gif' })], value: 'demo.gif' },
    } as unknown as Event);
    fixture.detectChanges();
    expect(component.imageState()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('不支援的圖片格式');
  });

  it('rejects images larger than five megabytes', () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.webp', { type: 'image/webp' });
    component.onImageSelected({ target: { files: [file], value: 'large.webp' } } as unknown as Event);
    fixture.detectChanges();
    expect(component.imageState()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('超過 5 MB');
  });

  it('returns to the empty state after removing an image', () => {
    component.imageState.set('ready');
    component.imagePreviewUrl.set('data:image/png;base64,mock');
    component.removeImage();
    fixture.detectChanges();
    expect(component.imageState()).toBe('empty');
    expect(fixture.nativeElement.textContent).toContain('尚未選擇圖片');
  });

  it('uploads the selected image only after the product itself is saved', () => {
    const reader = {
      result: 'data:image/png;base64,mock',
      readAsDataURL: vi.fn(),
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    reader.readAsDataURL.mockImplementation(() => reader.onload?.());
    vi.spyOn(component, 'createFileReader').mockReturnValue(reader as unknown as FileReader);
    component.onImageSelected({
      target: { files: [new File(['image'], 'demo.png', { type: 'image/png' })], value: 'demo.png' },
    } as unknown as Event);

    // 新增模式此時還沒有商品 id，不應該呼叫上傳。
    expect(api.uploadImage).not.toHaveBeenCalled();

    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 1,
      campaignTags: 'daily',
      targetCustomer: '家庭',
    });
    component.submit();

    // create() 回傳新 id（201）之後，才是真正呼叫上傳的時機。
    expect(api.uploadImage).toHaveBeenCalledWith(201, expect.any(File));
  });

  it('shows a read failure and tracks unsaved image changes in the guard', () => {
    const reader = {
      result: null,
      readAsDataURL: vi.fn(),
      onload: null,
      onerror: null as null | (() => void),
    };
    reader.readAsDataURL.mockImplementation(() => reader.onerror?.());
    vi.spyOn(component, 'createFileReader').mockReturnValue(reader as unknown as FileReader);
    component.onImageSelected({
      target: { files: [new File(['image'], 'demo.jpg', { type: 'image/jpeg' })], value: 'demo.jpg' },
    } as unknown as Event);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('圖片讀取失敗');
    component.removeImage();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(component.canLeave()).toBe(false);
  });

  it('keeps basic image editing available while core fields are locked', () => {
    (component as unknown as { lockCoreFields(): void }).lockCoreFields();
    expect(component.form.controls.productTypeId.disabled).toBe(true);
    expect(component.form.controls.name.enabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#product-image').disabled).toBe(false);
  });

  it('blocks duplicate submissions while saving', () => {
    // create() 故意用 NEVER：模擬請求還在飛行中，讓第二次 submit() 真的會被
    // isSubmitting() 的防重送guard擋下。若這裡改用 of(...)（同步立即完成），
    // 第一次呼叫會在同一輪同步執行完 finishSubmit()、isSubmitting() 早已變回
    // false，第二次呼叫就不會被擋，測試會變成偽陽性。
    api.create.mockReturnValue(NEVER);
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 1,
      campaignTags: 'daily',
      targetCustomer: '家庭',
    });
    component.submit();
    component.submit();
    fixture.detectChanges();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(component.statusMessage()).toContain('請勿重複送出');
    expect(fixture.nativeElement.querySelector('.primary').disabled).toBe(true);
  });
});
