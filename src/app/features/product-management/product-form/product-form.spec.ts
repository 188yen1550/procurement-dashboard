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
import { Router, provideRouter } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { DialogService } from '../../../core/dialog/dialog.service';
import { ProductApiService } from '../api/product-api.service';
import { SettingsApiService } from '../../settings/api/settings-api.service';
import { ProductForm } from './product-form';

describe('ProductForm', () => {
  let fixture: ComponentFixture<ProductForm>;
  let component: ProductForm;
  let dialog: DialogService;

  const productTypes = [
    { id: 100, name: '食品', description: null, isSystemDefault: true, isActive: true, parentId: null, level: 1 },
    { id: 1, name: '食品／生鮮', description: null, isSystemDefault: true, isActive: true, parentId: 100, level: 2 },
    { id: 200, name: '日用', description: null, isSystemDefault: true, isActive: true, parentId: null, level: 1 },
    { id: 2, name: '日用品', description: null, isSystemDefault: true, isActive: true, parentId: 200, level: 2 },
  ];

  const api = {
    getProductForm: vi.fn(),
    listResaleReferenceSuppliers: vi.fn(() => of([])),
    listResaleReferenceProducts: vi.fn(() => of([])),
    create: vi.fn((_payload: unknown) => of({ id: 201 })),
    update: vi.fn((_id: unknown, _payload: unknown) => of({ id: 201 })),
    uploadImage: vi.fn((_id: unknown, _file: unknown) => of({ id: 201 })),
    resubmit: vi.fn((_id: unknown) => of({ id: 201 })),
    // 2026-09-25 補上：選品類後 loadCustomFieldSchema() 會呼叫這支，缺少時每個測試都會丟
    // 「getCustomFieldSchema is not a function」的未處理錯誤（不影響斷言但會污染測試輸出）。
    getCustomFieldSchema: vi.fn((_productTypeId: unknown) => of([])),
  };
  const settingsApi = {
    getProductTypes: vi.fn(() => of(productTypes)),
    getFestiveCampaigns: vi.fn(() =>
      of([
        {
          tags: [
            { tag: 'daily', matchTier: 'CORE' },
            { tag: 'gift', matchTier: 'GENERAL' },
          ],
        },
      ]),
    ),
    // 2026-09-23新增：loadCampaignTags() 改成 forkJoin 合併節慶標籤與天氣
    // 標籤選項兩個來源，這支 mock 沒有的話，forkJoin 會因為呼叫不存在的
    // 方法直接丟例外，讓既有測試全部失敗——不是本次要測的範圍，回傳空陣列
    // 即可，讓 forkJoin 正常完成。
    getWeatherSignalTagOptions: vi.fn(() => of([])),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    api.create.mockReturnValue(of({ id: 201 }));
    api.update.mockReturnValue(of({ id: 201 }));
    api.resubmit.mockReturnValue(of({ id: 201 }));
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
    dialog = TestBed.inject(DialogService);
    fixture.detectChanges();
  });

  it('creates a new product form with NEW pricing by default', () => {
    expect(component).toBeTruthy();
    expect(component.isEditMode).toBe(false);
    expect(component.isResale()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('待訂價');
  });

  it('shows validation errors for an invalid submit', () => {
    component.submit();
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('請輸入 100 字以內的商品名稱');
    // 表單驗證未過時，根本不該打 API。
    expect(api.create).not.toHaveBeenCalled();
    // 所有無效欄位都要透過 DialogService 列出，不能只顯示第一個錯誤。
    const state = dialog.state();
    expect(state).toBeTruthy();
    expect(state?.variant).toBe('error');
    expect(state?.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('商品名稱'),
        expect.stringContaining('供應商名稱'),
        expect.stringContaining('目標客群描述'),
      ]),
    );
    // ⚠️ 對應原本回報的 bug：驗證失敗不該再額外留一句籠統的
    // statusMessage 在畫面上卡住，dialog 開著就是唯一的提醒，
    // 不能兩層同時存在、也不能哪一層永遠不消失。
    expect(component.statusMessage()).toBe('');
    expect(state?.title).toContain('表單有');
  });

  it('requires prices for RESALE products', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 2,
      pricingType: 'RESALE',
      campaignTags: ['daily'],
      targetCustomer: '家庭',
    });
    component.submit();
    expect(component.form.controls.costPrice.hasError('required')).toBe(true);
    expect(api.create).not.toHaveBeenCalled();
    expect(dialog.state()?.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('成本價'),
        expect.stringContaining('預計售價'),
        expect.stringContaining('市售價'),
      ]),
    );
  });

  it('shows a success dialog and returns to the product list only after closing it', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 2,
      campaignTags: ['daily'],
      targetCustomer: '家庭',
    });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');
    component.submit();
    fixture.detectChanges();
    expect(api.create).toHaveBeenCalled();
    expect(component.saved()).toBe(true);
    // 儲存成功一律用 DialogService 呈現，且關閉前不導頁。
    const state = dialog.state();
    expect(state?.variant).toBe('success');
    expect(state?.title).toBe('儲存成功');
    expect(state?.messages[0]).toContain('已儲存品項資料');
    expect(navigateSpy).not.toHaveBeenCalled();

    dialog.handleConfirm();
    expect(dialog.state()).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/products']);
  });

  it('calls POST /resubmit after saving when resubmit is true, not just relabels the toast', () => {
    // ⚠️ 這是這次修正的重點：resubmit=true 之前只換一句顯示文字，
    // 從來沒有真的呼叫過重審這支端點。
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 2,
      campaignTags: ['daily'],
      targetCustomer: '家庭',
    });
    component.submit(true);
    fixture.detectChanges();
    expect(api.create).toHaveBeenCalled();
    expect(api.resubmit).toHaveBeenCalledWith(201);
    expect(component.saved()).toBe(true);
    expect(dialog.state()?.messages[0]).toContain('已儲存並重審');
  });

  it('keeps the saved state and shows a dialog when resubmit itself fails after a successful save', () => {
    api.resubmit.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: '此商品狀態已變更，無法重審' } })),
    );
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 2,
      campaignTags: ['daily'],
      targetCustomer: '家庭',
    });
    component.submit(true);
    fixture.detectChanges();
    // 欄位已經存檔成功，不能因為送審這一步失敗就讓使用者以為整筆都沒存到。
    expect(component.saved()).toBe(true);
    const state = dialog.state();
    expect(state?.title).toBe('重審失敗');
    expect(state?.messages[0]).toContain('此商品狀態已變更');
  });

  it('shows an error dialog and stays on the page when saving fails', () => {
    api.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ error: { message: '伺服器發生錯誤，請稍後再試' }, status: 500 })),
    );
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 2,
      campaignTags: ['daily'],
      targetCustomer: '家庭',
    });
    component.submit();
    fixture.detectChanges();
    expect(component.saved()).toBe(false);
    const state = dialog.state();
    expect(state?.title).toBe('儲存失敗');
    expect(state?.messages[0]).toContain('伺服器發生錯誤');

    dialog.handleConfirm();
    expect(dialog.state()).toBeNull();
  });

  it('sends null marketPrice for NEW pricing, avoiding backend 400', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 1,
      campaignTags: ['daily'],
      targetCustomer: '家庭',
    });
    component.submit();
    const payload = api.create.mock.calls[0][0] as { marketPrice: number | null };
    // NEW 商品送 marketPrice 給後端會被 400 擋下（"市售價格僅適用於再販售商品"）。
    expect(payload.marketPrice).toBeNull();
  });

  it('sends multiple selected campaign tags as a comma-separated payload', () => {
    component.form.patchValue({
      name: '測試商品',
      supplierName: '測試供應商',
      productTypeId: 1,
      campaignTags: ['bbq', 'gift'],
      targetCustomer: '家庭',
    });
    component.submit();
    const payload = api.create.mock.calls[0][0] as { campaignTags: string | null };
    // ScoringService.splitTags() 只吃半形逗號，全形頓號會讓節慶比對整組失效。
    expect(payload.campaignTags).toBe('bbq,gift');
  });

  it('allows saving without campaign tags and supports removing a selection', () => {
    component.form.patchValue({
      name: '無檔期商品',
      supplierName: '測試供應商',
      productTypeId: 1,
      campaignTags: ['daily', 'gift'],
      targetCustomer: '家庭',
    });
    component.removeCampaignTag('daily');
    expect(component.form.controls.campaignTags.value).toEqual(['gift']);
    component.removeCampaignTag('gift');
    component.submit();
    const payload = api.create.mock.calls[0][0] as { campaignTags: string | null };
    expect(payload.campaignTags).toBeNull();
  });

  it('opens an unsaved changes dialog for a dirty form', () => {
    component.form.controls.name.setValue('已修改');
    component.form.markAsDirty();
    component.requestCancel();
    expect(dialog.state()?.variant).toBe('confirm');
    expect(dialog.state()?.title).toContain('放棄未儲存的變更');
  });

  it('blocks route deactivation when unsaved changes are not confirmed', () => {
    component.form.markAsDirty();
    let result: boolean | undefined;
    component.canLeave().subscribe((value) => (result = value));
    expect(dialog.state()?.variant).toBe('confirm');
    dialog.handleCancel();
    expect(result).toBe(false);
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
      campaignTags: ['daily'],
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
    let result: boolean | undefined;
    component.canLeave().subscribe((value) => (result = value));
    dialog.handleCancel();
    expect(result).toBe(false);
  });

  it('keeps basic image editing available while core fields are locked', () => {
    (component as unknown as { lockCoreFields(): void }).lockCoreFields();
    expect(component.form.controls.productTypeId.disabled).toBe(true);
    expect(component.form.controls.name.enabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#product-image').disabled).toBe(false);
  });

  it('shows only the held campaign tags as read-only chips when core fields are locked', () => {
    // 2026-09-25 對齊現行畫面（決議：節慶標籤在無法操作時僅顯示持有標籤）：
    // 鎖定後不再渲染可點擊的 <button>，改為唯讀標籤，只列出已選的標籤。
    // 原本的重點（鎖定後不能再切換標籤）仍然成立——連按鈕都不存在。
    component.form.controls.campaignTags.setValue(['daily']);
    component.isApproved.set(true);
    fixture.detectChanges();
    expect(component.isCoreLocked()).toBe(true);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.tag-toggle-group button.tag-toggle')).toHaveLength(0);
    const chips = Array.from(root.querySelectorAll('.tag-toggle-group .tag-toggle.is-readonly'));
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['daily']);
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
      campaignTags: ['daily'],
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
