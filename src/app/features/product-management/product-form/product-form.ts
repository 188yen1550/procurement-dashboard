/**
 * 檔案用途：新增／編輯品項表單、圖片上傳、欄位鎖定、重複送出與未儲存變更保護。
 * NEW 顯示 PENDING_PRICING 且不要求價格；RESALE 要求成本／售價／市價。APPROVED 仍可改一般資料與圖片，但核心資料鎖定。
 *
 * ## 這次接上真實 API 做了什麼
 *
 * 1. `productType` 從「純文字分類名稱」改成 `productTypeId`（number）。
 *    後端 `ProductCreateRequestPayload.productTypeId` 要的是編號，
 *    選項清單真實模式改讀 `SettingsApiService.getProductTypes()`。
 *
 * 2. ⚠️ 圖片上傳有先後順序限制：`POST /api/products/{id}/image` 需要
 *    商品已存在的 id。新增模式下，使用者選圖片時**只能先本地預覽**，
 *    真正上傳要等 `create()` 成功拿到新 id 之後才能做。編輯模式下
 *    id 已存在，可以在送出時直接上傳。這裡用 `selectedImageFile`
 *    保留使用者選的實際 File 物件（原本的程式碼建完預覽 dataURL 後就
 *    把 File 物件丟了，沒有留著給之後上傳用）。
 *
 * 3. ⚠️ PUT 是整份覆蓋。這個表單沒有「圖片網址」文字欄位可編輯——
 *    圖片只透過檔案選擇器處理，所以更新既有商品時，若不小心把
 *    `imageUrl` 送成空字串，會把使用者原本的圖片覆蓋掉。
 *    用 `currentImageUrl` 保留載入時的原始圖片網址，使用者沒有動圖片時
 *    照樣把原值送回去；按下「移除圖片」才會明確把它設為 null。
 *
 * 4. 已核准商品的鎖定狀態改讀真實 `reviewStatus`（APPROVED），
 *    不再用寫死的商品 id 字串判斷。
 *
 * 5. APPROVED 商品若異動核心資料，後端回 409，這裡單獨處理成
 *    「已核准商品僅能修改一般基本資料與圖片」，不是通用錯誤訊息。
 */
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { APP_CONFIG } from '../../../core/config/app-config';
import { joinCampaignTags } from '../../../core/domain/labels';
import { ProductApiService } from '../api/product-api.service';
import { SettingsApiService } from '../../settings/api/settings-api.service';

type FormPageState = 'default' | 'locked' | 'loading' | 'error';
type ImageState = 'empty' | 'loading' | 'ready' | 'error';
interface ImageInfo {
  name: string;
  type: string;
  size: number;
}
interface ProductTypeOption {
  id: number;
  name: string;
}

/** 送出驗證失敗時，用來把 FormControl 名稱轉成使用者看得懂的欄位標籤。 */
const FIELD_LABELS: Record<string, string> = {
  name: '商品名稱',
  supplierName: '供應商名稱',
  productTypeId: '商品實際分類',
  pricingType: '訂價分流',
  description: '商品說明',
  campaignTags: '節慶標籤',
  costPrice: '成本價',
  salePrice: '預計售價',
  marketPrice: '市售價',
  moq: 'MOQ 最低訂購量',
  supplyStability: '供應穩定性',
  priceCompetitiveness: '價格競爭力',
  targetCustomer: '目標客群描述',
  estimatedPurchaseRate: '預估購買率',
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MOCK_CAMPAIGN_TAGS = ['bbq', 'gift', 'family', 'daily', 'summer', 'winter'] as const;

function nonBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim().length > 0
    ? null
    : { blank: true };
}

/** Mock 模式的固定分類清單，id 只是本地展示用的流水號，不對應真實資料庫。 */
const MOCK_PRODUCT_TYPES: readonly ProductTypeOption[] = [
  { id: 1, name: '食品／生鮮' },
  { id: 2, name: '日用品' },
  { id: 3, name: '3C／家電' },
  { id: 4, name: '生活雜貨' },
  { id: 5, name: '美妝保養' },
  { id: 6, name: '服飾配件' },
  { id: 7, name: '寢具家用' },
  { id: 8, name: '精品禮盒' },
  { id: 9, name: '其他' },
];

interface EditMockEntry {
  name: string;
  supplierName: string;
  productTypeId: number;
  pricingType: 'NEW' | 'RESALE';
  description: string;
  campaignTags: string[];
  costPrice: number;
  salePrice: number;
  marketPrice: number;
  moq: number;
  supplyStability: number;
  priceCompetitiveness: number;
  targetCustomer: string;
  estimatedPurchaseRate: number;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

// supplyStability／priceCompetitiveness 是後端 0–5 分制（ScoringService 內部
// 直接 ×20 換算成 0–100 分數）。estimatedPurchaseRate 表單維持 0–100（%）
// 給使用者輸入比較直覺，送出前由 toEstimatedPurchaseRateDecimal() 換算成
// 後端要的 0–1 小數，見 ProductService/ScoringService。
const EDIT_DATA: Record<string, EditMockEntry> = {
  '101': {
    name: '中秋炭烤海陸組合禮盒',
    supplierName: '潮港鮮物有限公司',
    productTypeId: 1,
    pricingType: 'RESALE',
    description: '適合中秋團購的海陸烤肉組合。',
    campaignTags: ['bbq', 'gift'],
    costPrice: 820,
    salePrice: 1190,
    marketPrice: 1490,
    moq: 50,
    supplyStability: 4.6,
    priceCompetitiveness: 4.4,
    targetCustomer: '25–45 歲家庭與公司團購',
    estimatedPurchaseRate: 76,
    reviewStatus: 'APPROVED',
  },
  '103': {
    name: '無香低敏濃縮洗衣紙補充組',
    supplierName: '淨好生活實業',
    productTypeId: 2,
    pricingType: 'RESALE',
    description: '低敏無香洗衣紙。',
    campaignTags: ['family', 'daily'],
    costPrice: 180,
    salePrice: 299,
    marketPrice: 359,
    moq: 100,
    supplyStability: 3.2,
    priceCompetitiveness: 3.6,
    targetCustomer: '重視成分與收納便利的家庭',
    estimatedPurchaseRate: 58,
    reviewStatus: 'REJECTED',
  },
};

@Component({
  selector: 'app-product-form',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './product-form.html',
  styleUrls: ['./product-form.scss', './product-image.scss'],
})
export class ProductForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ProductApiService);
  private readonly settingsApi = inject(SettingsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly productId = this.route.snapshot.paramMap.get('id');
  readonly isEditMode = !!this.productId;

  readonly pageState = signal<FormPageState>('default');
  readonly saved = signal(false);
  readonly isSubmitting = signal(false);
  readonly submitCount = signal(0);
  readonly leaveDialogOpen = signal(false);
  readonly statusMessage = signal('');
  readonly stateOptions: readonly FormPageState[] = ['default', 'locked', 'loading', 'error'];

  /**
   * 取代原本的 window.alert()。原生 alert() 樣式沒辦法客製、行動裝置上
   * 常常被瀏覽器攔截或顯示成很陽春的系統對話框，跟站內其餘互動風格
   * （dialog-backdrop／role=alertdialog，見下方 leaveDialogOpen 的既有做法）
   * 完全不一致，所以改用同一套 dialog 元件呈現。
   *
   * messages 一律是陣列：只有一則就顯示一句話，多則就顯示成清單，
   * 讓「所有錯誤都要列出」這個需求跟「單一句失敗訊息」共用同一套 UI，
   * 不用為了訊息則數另外分兩套樣板。
   */
  readonly infoDialog = signal<{ variant: 'error' | 'success'; title: string; messages: string[] } | null>(
    null,
  );

  readonly productTypeOptions = signal<readonly ProductTypeOption[]>(
    this.useMockData ? MOCK_PRODUCT_TYPES : [],
  );
  readonly campaignTagOptions = signal<readonly string[]>(
    this.useMockData ? MOCK_CAMPAIGN_TAGS : [],
  );

  /** 真實模式下由載入的商品決定；Mock 模式由 EDIT_DATA 決定。兩者最終都反映在這兩個 signal。 */
  readonly reviewStatus = signal<'PENDING' | 'APPROVED' | 'REJECTED' | null>(null);
  readonly isApproved = signal(false);
  readonly isRejected = signal(false);

  /** 載入時的原始圖片網址；使用者沒有更換圖片時，更新要把這個值原封送回去，不能送空字串。 */
  readonly currentImageUrl = signal<string | null>(null);

  readonly imageState = signal<ImageState>('empty');
  readonly imagePreviewUrl = signal<string | null>(null);
  readonly imageInfo = signal<ImageInfo | null>(null);
  readonly imageError = signal('');
  readonly imageDirty = signal(false);
  readonly maxImageSizeLabel = '5 MB';
  /** 使用者選取的實際檔案；建完預覽後不能丟掉，送出時才要真的上傳。 */
  private selectedImageFile: File | null = null;

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, nonBlank, Validators.maxLength(100)]],
    supplierName: ['', [Validators.required, nonBlank, Validators.maxLength(100)]],
    productTypeId: [null as number | null, Validators.required],
    pricingType: ['NEW', Validators.required],
    description: ['', Validators.maxLength(500)],
    campaignTags: this.fb.nonNullable.control<string[]>([]),
    costPrice: [0, [Validators.min(0), Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    salePrice: [0, [Validators.min(0), Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    marketPrice: [0, [Validators.min(0), Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    moq: [1, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
    // 後端 Product.supplyStability / priceCompetitiveness 是 0–5 分制
    // （precision=5, scale=2），不是 0–100。
    supplyStability: [2.5, [Validators.required, Validators.min(0), Validators.max(5)]],
    priceCompetitiveness: [2.5, [Validators.required, Validators.min(0), Validators.max(5)]],
    targetCustomer: ['', [Validators.required, nonBlank, Validators.maxLength(500)]],
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

  isResale(): boolean {
    return this.form.controls.pricingType.value === 'RESALE';
  }

  ngOnInit(): void {
    if (!this.useMockData) {
      this.loadProductTypes();
      this.loadCampaignTags();
    }

    if (!this.productId) return; // 新增模式，沒有既有資料可載入

    if (this.useMockData) {
      const entry = EDIT_DATA[this.productId];
      if (entry) {
        this.form.patchValue(entry);
        this.reviewStatus.set(entry.reviewStatus);
        this.isApproved.set(entry.reviewStatus === 'APPROVED');
        this.isRejected.set(entry.reviewStatus === 'REJECTED');
        if (this.isApproved()) this.lockCoreFields();
      }
      return;
    }

    this.pageState.set('loading');
    this.api
      .getProductForm(this.productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (model) => {
          this.form.patchValue({
            name: model.base.name,
            supplierName: model.base.supplierName,
            productTypeId: model.core.productTypeId,
            pricingType: model.core.pricingType || 'NEW',
            description: model.base.description,
            campaignTags: model.core.campaignTags,
            costPrice: model.core.costPrice ?? 0,
            salePrice: model.core.salePrice ?? 0,
            marketPrice: model.core.marketPrice ?? 0,
            moq: model.core.moq ?? 1,
            supplyStability: model.core.supplyStability ?? 2.5,
            priceCompetitiveness: model.core.priceCompetitiveness ?? 2.5,
            targetCustomer: model.core.targetCustomerDescription,
            estimatedPurchaseRate: Math.round((model.core.estimatedPurchaseRate ?? 0.5) * 100),
          });
          this.currentImageUrl.set(model.base.imageUrl || null);
          if (model.base.imageUrl) {
            this.imagePreviewUrl.set(model.base.imageUrl);
            this.imageState.set('ready');
          }
          this.reviewStatus.set(model.reviewStatus);
          this.isApproved.set(model.actions.isCoreLocked);
          this.isRejected.set(model.reviewStatus === 'REJECTED');
          if (model.actions.isCoreLocked) this.lockCoreFields();
          this.pageState.set('default');
        },
        error: (err) => {
          this.pageState.set('error');
          this.statusMessage.set(toApiError(err).message);
        },
      });
  }

  private loadProductTypes(): void {
    this.settingsApi
      .getProductTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (types) => {
          this.productTypeOptions.set(
            types.filter((t) => t.isActive !== false).map((t) => ({ id: t.id, name: t.name })),
          );
        },
        // 分類清單載入失敗不影響其餘表單，下拉維持空白，使用者仍可看到既有值（若編輯模式已回填 id）。
        error: () => this.productTypeOptions.set([]),
      });
  }

  private loadCampaignTags(): void {
    this.settingsApi
      .getFestiveCampaigns()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (campaigns) => {
          const tags = campaigns.flatMap((campaign) => campaign.tags.map((tag) => tag.tag.trim()));
          this.campaignTagOptions.set([...new Set(tags.filter(Boolean))].sort());
        },
        error: () => this.campaignTagOptions.set([]),
      });
  }

  removeCampaignTag(tag: string): void {
    this.form.controls.campaignTags.setValue(
      this.form.controls.campaignTags.value.filter((selected) => selected !== tag),
    );
    this.form.controls.campaignTags.markAsDirty();
  }

  setState(state: FormPageState): void {
    this.pageState.set(state);
    if (state === 'locked') this.lockCoreFields();
    else if (!this.isApproved()) this.unlockCoreFields();
    this.statusMessage.set(`已切換為 ${state} 狀態。`);
  }

  /**
   * 驗證並送出表單；`resubmit` 用於 REJECTED 商品的重新送審文案
   * （目前只影響顯示文字，後端重新送審是獨立的 POST /resubmit，
   * 不在這支表單頁觸發——這裡的送出一律是 create/update）。
   *
   * 驗證錯誤一律用 window.alert() 列出「所有」無效欄位，不是只顯示
   * 第一個錯誤或一句籠統的「請修正表單」——使用者不該逐一送出、
   * 逐一被打回才知道還有哪裡沒填對。
   */
  submit(resubmit = false): void {
    // 按鈕已綁定 [disabled]="isSubmitting()"，正常點擊不會走到這裡；
    // 保留 statusMessage 是為了防呆極端情況（例如程式化重複呼叫），
    // 不用 alert()——高頻率跳出視窗式對話框反而干擾使用者，用 toast 就夠。
    if (this.isSubmitting()) {
      this.statusMessage.set('正在儲存，請勿重複送出。');
      return;
    }

    // 再販售必填價格，先設 errors 再一起收進下面的錯誤清單，
    // 不要跟表單本身的驗證錯誤分開顯示成兩套不一致的提示。
    if (
      this.isResale() &&
      (!this.form.controls.costPrice.value ||
        !this.form.controls.salePrice.value ||
        !this.form.controls.marketPrice.value)
    ) {
      this.form.controls.costPrice.setErrors({ required: true });
      this.form.controls.salePrice.setErrors({ required: true });
      this.form.controls.marketPrice.setErrors({ required: true });
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const errors = this.collectFormErrors();
      // ⚠️ 不要在這裡再 set statusMessage：畫面上已經有兩層提醒了
      // （下面即將開啟的 dialog，以及每個無效欄位旁邊 fieldInvalid() 顯示的
      // 逐欄錯誤文字），第三層籠統的 toast 只會變成後續不管使用者怎麼操作
      // 都不會消失的殘留訊息——這正是原本回報的 bug：使用者後來把欄位都
      // 修正了，畫面上卻還留著一句「請先修正表單中的錯誤」，因為沒有任何
      // 地方會把它清掉。
      this.showErrorDialog(
        `表單有 ${errors.length} 項欄位需要修正`,
        errors,
      );
      return;
    }

    if (this.useMockData) {
      this.isSubmitting.set(true);
      this.submitCount.update((count) => count + 1);
      this.saved.set(true);
      this.form.markAsPristine();
      this.imageDirty.set(false);
      this.statusMessage.set(resubmit ? '已在本地模擬儲存並重新送審。' : '已儲存本地 Mock 品項。');
      window.setTimeout(() => {
        this.isSubmitting.set(false);
        // 新增商品（非編輯模式）完成後直接返回品項管理主頁，
        // 不需要使用者再手動點擊「回到清單」連結。
        if (!this.isEditMode) void this.router.navigate(['/products']);
      }, 500);
      return;
    }

    this.isSubmitting.set(true);
    this.statusMessage.set('');

    const raw = this.form.getRawValue();
    const isResale = raw.pricingType === 'RESALE';
    const payload = {
      productTypeId: raw.productTypeId!,
      pricingType: raw.pricingType as 'NEW' | 'RESALE',
      name: raw.name.trim(),
      description: raw.description.trim() || null,
      // 這支表單沒有可編輯的圖片網址欄位；沒動過圖片時原封送回載入時的值，
      // 避免整份覆蓋（PUT）把使用者既有圖片洗成 null。
      imageUrl: this.currentImageUrl(),
      supplierName: raw.supplierName.trim() || null,
      costPrice: raw.costPrice,
      salePrice: raw.salePrice,
      marketPrice: isResale ? raw.marketPrice : null,
      // ⚠️ 一律半形逗號：ScoringService.splitTags() 只吃 split(",")，
      // 全形頓號會讓節慶比對整組失效且不會報錯。
      campaignTags: joinCampaignTags(raw.campaignTags) || null,
      moq: raw.moq,
      supplyStability: raw.supplyStability,
      priceCompetitiveness: raw.priceCompetitiveness,
      targetCustomerDescription: raw.targetCustomer.trim() || null,
      estimatedPurchaseRate: this.toEstimatedPurchaseRateDecimal(),
    };

    const save$ = this.isEditMode
      ? this.api.update(this.productId!, payload)
      : this.api.create(payload);

    save$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (product) => this.afterSaveSuccess(product.id, resubmit),
      error: (err) => {
        this.isSubmitting.set(false);
        const error = toApiError(err);
        const message =
          error.status === 409
            ? `${error.message}（已核准商品僅能修改一般基本資料與圖片）`
            : error.message;
        this.showErrorDialog('儲存失敗', [message]);
      },
    });
  }

  /**
   * 儲存成功後的收尾：若使用者選了新圖片，這裡才是真正呼叫上傳 API 的時機
   * ——新增模式下，商品剛剛才拿到 id，先前選圖片時只能本地預覽，
   * 沒有 id 可以呼叫 `POST /api/products/{id}/image`。
   */
  private afterSaveSuccess(productId: number, resubmit: boolean): void {
    if (!this.selectedImageFile) {
      this.finishSubmit(resubmit);
      return;
    }

    this.api
      .uploadImage(productId, this.selectedImageFile)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.finishSubmit(resubmit),
        error: (err) => {
          // 商品本身已經存過了，圖片上傳失敗不應該讓使用者以為整筆都沒存到，
          // 所以這裡不導頁——讓使用者留在頁面上知道還差圖片這一步。
          this.isSubmitting.set(false);
          const message = `品項已儲存，但圖片上傳失敗：${toApiError(err).message}`;
          this.saved.set(true);
          this.form.markAsPristine();
          // 這裡的 statusMessage 是給「已儲存」成功卡片副標題用的，
          // 不是會卡住不消失的那個籠統 toast——saved() 每次送出都會重新
          // 走一輪，下次儲存成功會被覆蓋成正常文案，不會有殘留問題。
          this.statusMessage.set(message);
          this.showErrorDialog('圖片上傳失敗', [message]);
        },
      });
  }

  private finishSubmit(resubmit: boolean): void {
    this.isSubmitting.set(false);
    this.submitCount.update((count) => count + 1);
    this.saved.set(true);
    this.form.markAsPristine();
    this.imageDirty.set(false);
    this.selectedImageFile = null;
    this.statusMessage.set(resubmit ? '已儲存並重新送審。' : '已儲存品項資料。');

    // 新增商品完成後直接返回品項管理主頁；編輯模式維持原本停留在頁面上
    // 顯示「儲存成功」的行為，讓使用者能確認剛剛改了什麼。
    if (!this.isEditMode) void this.router.navigate(['/products']);
  }

  /**
   * 驗證使用者選取的 JPG／PNG／WebP 與 5 MB 上限，並以 FileReader 建立本地
   * data URL 預覽。實際上傳留到 submit() 成功之後才做（見 afterSaveSuccess）。
   */
  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.saved.set(false);
    this.imageError.set('');
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!SUPPORTED_IMAGE_TYPES.has(file.type) || !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      this.setImageError('不支援的圖片格式，請選擇 JPG、PNG 或 WebP。');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.setImageError('圖片檔案超過 5 MB 上限，請縮小後再試。');
      return;
    }
    this.imageState.set('loading');
    this.imageInfo.set({ name: file.name, type: file.type, size: file.size });
    this.imageDirty.set(true);
    this.selectedImageFile = file;
    const reader = this.createFileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        this.setImageError('圖片讀取失敗，請重新選擇檔案。');
        return;
      }
      this.imagePreviewUrl.set(reader.result);
      this.imageState.set('ready');
      this.statusMessage.set(
        this.useMockData
          ? '圖片已在瀏覽器本地建立預覽，尚未儲存。'
          : '圖片已建立預覽，儲存後才會真正上傳。',
      );
    };
    reader.onerror = () => this.setImageError('圖片讀取失敗，請重新選擇檔案。');
    reader.readAsDataURL(file);
  }

  /** 移除目前圖片並標記未儲存變更；真實模式下會在下次儲存時把 imageUrl 設為 null。 */
  removeImage(): void {
    this.imagePreviewUrl.set(null);
    this.imageInfo.set(null);
    this.imageError.set('');
    this.imageState.set('empty');
    this.imageDirty.set(true);
    this.saved.set(false);
    this.selectedImageFile = null;
    this.currentImageUrl.set(null);
    this.statusMessage.set('圖片已移除，尚未儲存。');
  }

  formatFileSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  createFileReader(): FileReader {
    return new FileReader();
  }

  private showErrorDialog(title: string, messages: string[]): void {
    this.infoDialog.set({ variant: 'error', title, messages });
  }
  closeInfoDialog(): void {
    this.infoDialog.set(null);
  }

  requestCancel(): void {
    if (this.hasUnsavedChanges()) this.leaveDialogOpen.set(true);
    else void this.router.navigate(['/products']);
  }
  discardAndLeave(): void {
    this.form.markAsPristine();
    this.imageDirty.set(false);
    this.leaveDialogOpen.set(false);
    void this.router.navigate(['/products']);
  }
  closeLeaveDialog(): void {
    this.leaveDialogOpen.set(false);
  }
  retry(): void {
    this.pageState.set('default');
    this.statusMessage.set(this.useMockData ? '已恢復本地表單資料。' : '');
    if (!this.useMockData) this.ngOnInit();
  }
  fieldInvalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  /**
   * 把單一欄位的 ValidationErrors 轉成使用者看得懂的一句話。
   * 對照的是這支表單目前實際會出現的錯誤種類（required／blank／maxlength／
   * min／max／pattern），不是 Angular 全部內建驗證器的通用翻譯。
   */
  private describeControlError(name: string, errors: ValidationErrors): string {
    const label = FIELD_LABELS[name] ?? name;
    if (name === 'costPrice' || name === 'salePrice' || name === 'marketPrice') {
      if (errors['required']) return `${label}：再販售品項此欄位必須大於 0`;
    }
    if (errors['required'] || errors['blank']) return `${label}：不可留空`;
    if (errors['maxlength']) {
      return `${label}：不可超過 ${errors['maxlength'].requiredLength} 字（目前 ${errors['maxlength'].actualLength} 字）`;
    }
    if (errors['min']) return `${label}：不可小於 ${errors['min'].min}`;
    if (errors['max']) return `${label}：不可大於 ${errors['max'].max}`;
    if (errors['pattern']) return `${label}：格式不正確，最多至小數點後兩位`;
    return `${label}：請確認輸入內容是否正確`;
  }

  /** 收集目前表單所有無效欄位，依畫面上由上到下的欄位順序排列。 */
  private collectFormErrors(): string[] {
    const fieldOrder: (keyof typeof this.form.controls)[] = [
      'name',
      'supplierName',
      'description',
      'productTypeId',
      'pricingType',
      'campaignTags',
      'costPrice',
      'salePrice',
      'marketPrice',
      'moq',
      'supplyStability',
      'priceCompetitiveness',
      'estimatedPurchaseRate',
      'targetCustomer',
    ];
    const messages: string[] = [];
    for (const name of fieldOrder) {
      const control = this.form.controls[name];
      if (control.invalid && control.errors) {
        messages.push(this.describeControlError(name, control.errors));
      }
    }
    return messages;
  }
  marginRate(): number | null {
    const cost = this.form.controls.costPrice.value;
    const sale = this.form.controls.salePrice.value;
    return sale > 0 && cost >= 0 ? Math.round(((sale - cost) / sale) * 1000) / 10 : null;
  }
  canLeave(): boolean {
    return !this.hasUnsavedChanges() || window.confirm('尚有未儲存的變更，確定要離開嗎？');
  }

  @HostListener('window:beforeunload', ['$event'])
  preventAccidentalLeave(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  private hasUnsavedChanges(): boolean {
    return !this.saved() && (this.form.dirty || this.imageDirty());
  }
  private setImageError(message: string): void {
    this.imagePreviewUrl.set(null);
    this.imageInfo.set(null);
    this.imageState.set('error');
    this.imageError.set(message);
    this.imageDirty.set(false);
    this.selectedImageFile = null;
    this.statusMessage.set(message);
  }

  private lockCoreFields(): void {
    const names: (keyof typeof this.form.controls)[] = [
      'productTypeId',
      'pricingType',
      'campaignTags',
      'costPrice',
      'salePrice',
      'marketPrice',
      'moq',
      'supplyStability',
      'priceCompetitiveness',
      'targetCustomer',
      'estimatedPurchaseRate',
    ];
    names.forEach((name) => this.form.controls[name].disable());
  }
  private unlockCoreFields(): void {
    this.form.enable();
  }
}
