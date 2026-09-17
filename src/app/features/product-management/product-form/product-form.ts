/**
 * 檔案用途：新增／編輯品項、圖片上傳、欄位鎖定、重新送審與未儲存變更保護。
 * NEW 不要求價格；RESALE 要求成本、售價與市價。APPROVED 仍可修改一般資料
 * 與圖片，但核心資料鎖定。新增商品取得 id 後才上傳所選圖片。
 */
import { ListSort, ListSortControls, SortRowsPipe } from '../../../shared/ui/list-sort';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormsModule, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, debounceTime, map, startWith } from 'rxjs/operators';
import { toApiError } from '../../../core/api/api-error';
import { APP_CONFIG } from '../../../core/config/app-config';
import { DialogService } from '../../../core/dialog/dialog.service';
import {
  joinCampaignTags,
  PRICE_COMPETITIVENESS_LEVEL_LABEL,
  splitCampaignTags,
  SUPPLY_STABILITY_LEVEL_LABEL,
} from '../../../core/domain/labels';
import {
  PackageSizeTier,
  PackingType,
  ScoreLevel,
  ShelfLifeTier,
  SupplierLeadTimeTier,
  TemperatureZone,
} from '../../../core/domain/enums';
import { createDismissibleMessage } from '../../../core/ui/auto-dismiss';
import { ProductApiService } from '../api/product-api.service';
import { ProductResponsePayload, ResaleReferenceOptionPayload } from '../api/product-api.contract';
import { SettingsApiService } from '../../settings/api/settings-api.service';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import { GroupBuyApiService } from '../../group-buy/api/group-buy-api.service';
import { GROUP_BUY_RESULT_LABEL, GroupBuyClaimCandidatePayload } from '../../group-buy/api/group-buy-api.contract';
import { Icon } from '../../../shared/components/icon/icon';

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

interface ProductTypeOptionGroup {
  majorName: string;
  minors: ProductTypeOption[];
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
  moq: '最低訂購量',
  supplyStability: '供應穩定性',
  priceCompetitiveness: '價格競爭力',
  targetCustomer: '目標客群描述',
  estimatedPurchaseRate: '預估購買率',
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MOCK_CAMPAIGN_TAGS = ['bbq', 'gift', 'family', 'daily', 'summer', 'winter'] as const;

/** Mock 版的逐層過濾參考商品資料，供 RESALE 挑選小工具 demo 用，不呼叫任何網路請求。 */
const MOCK_RESALE_SUPPLIERS = ['潮港鮮物有限公司', '淨好生活實業'] as const;
const MOCK_RESALE_CANDIDATES: Record<string, readonly ResaleReferenceOptionPayload[]> = {
  '潮港鮮物有限公司': [
    { productId: 501, name: '中秋炭烤海陸組合禮盒（去年款）' },
    { productId: 502, name: '海陸雙拼烤肉禮盒' },
  ],
  '淨好生活實業': [{ productId: 503, name: '無香低敏濃縮洗衣紙補充組（舊版包裝）' }],
};
/** Mock 版：選定候選後回傳的完整商品資料，模擬 getProduct() 的回應供預填 demo。 */
const MOCK_RESALE_REFERENCE_DETAIL: Record<number, Partial<ProductResponsePayload>> = {
  501: {
    name: '中秋炭烤海陸組合禮盒（去年款）',
    description: '適合中秋團購的海陸烤肉組合，去年熱銷。',
    campaignTags: 'bbq,gift',
    supplyStability: 5,
    targetCustomerDescription: '25–45 歲家庭與公司團購',
  },
};

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
  supplyStability: ScoreLevel;
  priceCompetitiveness: ScoreLevel;
  targetCustomer: string;
  estimatedPurchaseRate: number;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

// ⚠️ supplyStability／priceCompetitiveness 是後端 V6 migration 之後的 1–5
// 整數等級（見 ScoreLevel），不再是 0–5 分制小數。estimatedPurchaseRate
// 表單維持 0–100（%）給使用者輸入比較直覺，送出前由
// toEstimatedPurchaseRateDecimal() 換算成後端要的 0–1 小數，見
// ProductService/ScoringService。
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
    supplyStability: 5,
    priceCompetitiveness: 4,
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
    supplyStability: 3,
    priceCompetitiveness: 4,
    targetCustomer: '重視成分與收納便利的家庭',
    estimatedPurchaseRate: 58,
    reviewStatus: 'REJECTED',
  },
};

@Component({
  selector: 'app-product-form',
  imports: [ListSortControls, SortRowsPipe, CommonModule, ReactiveFormsModule, FormsModule, RouterLink, Icon],
  templateUrl: './product-form.html',
  styleUrls: ['./product-form.scss', './product-image.scss'],
})
export class ProductForm implements OnInit {
  readonly claimSort = new ListSort();
  readonly claimSortChoices = [
    { key: 'externalProductName', label: '商品名稱' },
    { key: 'supplierName', label: '供應商' },
    { key: 'nameSimilarity', label: '名稱相似度' },
    { key: 'supplierSimilarity', label: '供應商相似度' },
    { key: 'campaignStartDate:date|campaignEndDate:date', label: '開團日期' },
    { key: 'result', label: '結果' },
  ];
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ProductApiService);
  private readonly settingsApi = inject(SettingsApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);
  private readonly groupBuyApi = inject(GroupBuyApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly productId = this.route.snapshot.paramMap.get('id');
  readonly isEditMode = !!this.productId;

  readonly pageState = signal<FormPageState>('default');
  readonly saved = signal(false);
  readonly isSubmitting = signal(false);
  readonly submitCount = signal(0);
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;
  readonly stateOptions: readonly FormPageState[] = ['default', 'locked', 'loading', 'error'];

  /** 供應穩定性／價格競爭力的 <select> 選項來源，畫面只顯示文字，不顯示數字。 */
  readonly scoreLevels: readonly ScoreLevel[] = [1, 2, 3, 4, 5];
  readonly supplyStabilityLevelLabel = SUPPLY_STABILITY_LEVEL_LABEL;
  readonly priceCompetitivenessLevelLabel = PRICE_COMPETITIVENESS_LEVEL_LABEL;

  constructor() {
    // 自動消失邏輯已內建在 createDismissibleMessage() 裡，不需要另外註冊監看。
  }

  readonly productTypeOptions = signal<readonly ProductTypeOption[]>(
    this.useMockData ? MOCK_PRODUCT_TYPES : [],
  );
  /** 依大類分組後的選項，畫面用 <optgroup> 呈現，不是 productTypeOptions 那條扁平清單。 */
  readonly productTypeGroups = signal<readonly ProductTypeOptionGroup[]>([]);
  readonly priceAboveMarketWarning = signal(false);
  readonly campaignTagOptions = signal<readonly string[]>(
    this.useMockData ? MOCK_CAMPAIGN_TAGS : [],
  );
  /**
   * tag → 這個標籤來自哪些節慶檔期的名稱（逗號分隔），純粹給畫面上的
   * tooltip 用。
   *
   * ⚠️ 商品這裡選的本來就是「節慶標籤」（關鍵字），不是直接選一個節慶——
   * 後端 ScoringService.buildMatchedCampaignSnapshot() 是拿商品的標籤跟
   * 目前 PREPARING／ACTIVE 的檔期各自的標籤做比對，自動找出比對度最高
   * 的檔期，商品本身不綁定單一檔期。這樣同一件商品的標籤能隨著檔期
   * 隨時間輪替（中秋檔期結束、下一個節慶檔期開始）自動比對到新的檔期，
   * 不需要每次都手動改商品去指定新節慶。畫面上這串標籤看起來像跟
   * 節慶無關的關鍵字，容易讓人誤會是隨便打的、應該改成直接選節慶——
   * 這裡不改底層設計（那會讓商品標籤失去跨檔期自動比對的彈性），只補上
   * 這個 tooltip，滑鼠移到標籤上能看到它實際來自哪個／哪些節慶檔期。
   */
  readonly tagCampaignNames = signal<ReadonlyMap<string, string>>(new Map());

  /** 標籤按鈕的 title：告訴使用者這個標籤實際來自哪個節慶檔期，不是憑空存在的關鍵字。 */
  campaignTagTooltip(tag: string): string {
    const names = this.tagCampaignNames().get(tag);
    return names ? `來自節慶檔期：${names}` : '';
  }

  /** 真實模式下由載入的商品決定；Mock 模式由 EDIT_DATA 決定。兩者最終都反映在這兩個 signal。 */
  readonly reviewStatus = signal<'PENDING' | 'APPROVED' | 'REJECTED' | null>(null);
  readonly isApproved = signal(false);
  readonly isRejected = signal(false);

  /**
   * 統一判斷「核心資料現在是不是鎖定的」，不要在樣板裡到處重複寫
   * `isApproved() || pageState() === 'locked'`——這兩個是 lockCoreFields()
   * 實際會被觸發的兩種情境（已核准商品、或 Mock 展示切成 locked 狀態），
   * 語意上是同一件事，只是觸發來源不同。
   */
  readonly isCoreLocked = computed(() => this.isApproved() || this.pageState() === 'locked');

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
    // ⚠️ 後端 V6 migration 已改成 1–5 整數等級（@Min(1) @Max(5)），不再是
    // 0–5 分制小數。用 <select> 而非數字輸入框，選項本身已經限制在 1~5，
    // 不需要再疊加 min/max/pattern validator；預設值 3（普通）是中性起點，
    // 不代表系統預先假設商品供應穩定或價格具競爭力。
    supplyStability: [3 as ScoreLevel, Validators.required],
    priceCompetitiveness: [3 as ScoreLevel, Validators.required],
    targetCustomer: ['', [Validators.required, nonBlank, Validators.maxLength(500)]],
    // 表單維持 0–100（%）輸入，實際送出時要換算成後端要的 0–1 小數
    // （見 toEstimatedPurchaseRateDecimal()）。
    estimatedPurchaseRate: [50, [Validators.required, Validators.min(0), Validators.max(100)]],
    // 以下 8 個欄位供 Gate 判定使用，全部選填——不加 Validators.required，
    // 留空時後端 Gate 判定會依三層繼承規則改用品類層的預設屬性。
    temperatureZone: [null as TemperatureZone | null],
    shelfLifeTier: [null as ShelfLifeTier | null],
    supplierLeadTimeTier: [null as SupplierLeadTimeTier | null],
    packageSizeTier: [null as PackageSizeTier | null],
    packingType: [null as PackingType | null],
    handlingFlags: ['', Validators.maxLength(200)],
    certificationFlags: ['', Validators.maxLength(200)],
    supplierMaxCapacity: [null as number | null, Validators.min(0)],
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

  // ===================== RESALE 逐層過濾參考商品 =====================
  // 取代原本「打字輸入商品名稱、系統模糊比對」的搜尋方式：那個機制把
  // 「幫新商品取名字」跟「找出哪件舊商品是同一件」兩件事綁在同一個輸入框，
  // 命名習慣跟舊商品不同時模糊比對分數過低會完全找不到候選，且無法在
  // 沒有先打字的情況下瀏覽既有商品。改成三層下拉：商品分類（沿用選品核心
  // 資料的 productTypeId 欄位，不重複開一個）→ 供應商（沿用 supplierName
  // 欄位，選定後該欄位自然也是「一般基本資料」要送出的值，不用另外複製
  // 一份）→ 商品名稱（獨立的 resaleReferenceProductId／resaleReferenceName
  // signal，因為這一層選的是「參考的舊商品」，不是「這次新商品的名稱」）。

  /**
   * 使用者選定的參考商品。送出時填入 ProductCreateRequestPayload／
   * ProductUpdateRequestPayload 的 resaleReferenceProductId；編輯模式由 API 回填。
   */
  readonly resaleReferenceProductId = signal<number | null>(null);
  readonly resaleReferenceName = signal<string | null>(null);
  readonly isLoadingReferenceDetail = signal(false);

  readonly resaleSuppliers = signal<readonly string[]>([]);
  readonly isLoadingResaleSuppliers = signal(false);
  readonly resaleSupplierError = signal('');

  readonly resaleCandidateProducts = signal<readonly ResaleReferenceOptionPayload[]>([]);
  readonly isLoadingResaleCandidates = signal(false);
  readonly resaleCandidateError = signal('');

  /**
   * 團購售價高於市價：不阻擋送出（可能是刻意的行銷策略、市價本身滯後
   * 未更新等合理情境，不該由系統武斷認定這是錯誤），但要提醒使用者
   * 注意——這種組合在「團購應該比市價便宜」的一般認知下算是反常，
   * 提醒一下讓使用者能確認這是不是自己打錯了數字，而不是默默放行。
   */
  private wirePriceAboveMarketWarning(): void {
    combineLatest([
      this.form.controls.salePrice.valueChanges.pipe(startWith(this.form.controls.salePrice.value)),
      this.form.controls.marketPrice.valueChanges.pipe(startWith(this.form.controls.marketPrice.value)),
    ])
      .pipe(
        map(([sale, market]) => this.isResale() && !!sale && !!market && sale > market),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((isAbove) => this.priceAboveMarketWarning.set(isAbove));
  }

  /**
   * 監看「訂價分流」＋「商品分類」：切成 RESALE 且分類已選時載入第一層
   * 供應商選單；分類改變、或切回 NEW 時，把後面三層（供應商候選、商品
   * 候選、已選定的參考商品）全部重置——候選池是依分類查的，分類一變
   * 舊的候選清單就不再有意義，留著只會讓使用者誤選。
   */
  private wireResaleReferenceCascade(): void {
    combineLatest([
      this.form.controls.pricingType.valueChanges.pipe(startWith(this.form.controls.pricingType.value)),
      this.form.controls.productTypeId.valueChanges.pipe(startWith(this.form.controls.productTypeId.value)),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([pricingType, productTypeId]) => {
        this.resaleSuppliers.set([]);
        this.resaleCandidateProducts.set([]);
        this.clearResaleReference();
        if (pricingType !== 'RESALE' || !productTypeId) return;
        this.loadResaleSuppliers(productTypeId);
      });

    // 供應商欄位（section 03 的一般基本資料）跟這裡的第二層下拉共用同一個
    // formControlName="supplierName"，選定或手動改動都會觸發重新查第三層。
    // ⚠️ 這代表選定參考商品「之後」若又手動改了供應商名稱，已選定的參考
    // 商品會被清空並重新載入候選——這是刻意的：參考商品是跟著「這個
    // 供應商」查出來的，供應商換了，原本選定的那筆邏輯上也不再成立，
    // 不該讓一筆跟舊供應商綁定的參考商品繼續掛著。
    this.form.controls.supplierName.valueChanges
      .pipe(startWith(this.form.controls.supplierName.value), debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((supplierName) => {
        this.resaleCandidateProducts.set([]);
        this.clearResaleReference();
        const trimmed = supplierName.trim();
        const productTypeId = this.form.controls.productTypeId.value;
        if (!this.isResale() || !trimmed || !productTypeId) return;
        this.loadResaleCandidateProducts(productTypeId, trimmed);
      });
  }

  private loadResaleSuppliers(productTypeId: number): void {
    this.isLoadingResaleSuppliers.set(true);
    this.resaleSupplierError.set('');

    const suppliers$ = this.useMockData
      ? of(MOCK_RESALE_SUPPLIERS as readonly string[])
      : this.api.listResaleReferenceSuppliers(productTypeId).pipe(
          catchError((err: unknown) => {
            this.resaleSupplierError.set(toApiError(err).message);
            return of([] as readonly string[]);
          }),
        );

    suppliers$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((suppliers) => {
      this.isLoadingResaleSuppliers.set(false);
      this.resaleSuppliers.set(suppliers);
    });
  }

  private loadResaleCandidateProducts(productTypeId: number, supplierName: string): void {
    this.isLoadingResaleCandidates.set(true);
    this.resaleCandidateError.set('');

    const candidates$ = this.useMockData
      ? of((MOCK_RESALE_CANDIDATES[supplierName] ?? []) as readonly ResaleReferenceOptionPayload[])
      : this.api
          .listResaleReferenceProducts({
            productTypeId,
            supplierName,
            excludeId: this.productId ? Number(this.productId) : undefined,
          })
          .pipe(
            catchError((err: unknown) => {
              this.resaleCandidateError.set(toApiError(err).message);
              return of([] as readonly ResaleReferenceOptionPayload[]);
            }),
          );

    candidates$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((candidates) => {
      this.isLoadingResaleCandidates.set(false);
      this.resaleCandidateProducts.set(candidates);
    });
  }

  /**
   * 第三層：選定商品名稱。設定 id／name 後立即呼叫既有的 getProduct()
   * 取得完整資料做預填——這支端點回傳的候選選項刻意只有 id／name
   * （見 ResaleReferenceOptionResponse 類別註解），完整資料要另外查。
   */
  onResaleCandidateSelected(productId: number | null): void {
    if (productId === null) {
      this.clearResaleReference();
      return;
    }
    const option = this.resaleCandidateProducts().find((o) => o.productId === productId);
    this.resaleReferenceProductId.set(productId);
    this.resaleReferenceName.set(option?.name ?? null);

    if (this.useMockData) {
      const detail = MOCK_RESALE_REFERENCE_DETAIL[productId];
      if (detail) this.prefillFromReference(detail);
      return;
    }

    this.isLoadingReferenceDetail.set(true);
    this.api
      .getProduct(productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (product) => {
          this.isLoadingReferenceDetail.set(false);
          this.prefillFromReference(product);
        },
        // 查不到完整資料不影響已經選定的參考商品，只是沒有預填效果。
        error: () => this.isLoadingReferenceDetail.set(false),
      });
  }

  clearResaleReference(): void {
    this.resaleReferenceProductId.set(null);
    this.resaleReferenceName.set(null);
  }

  /**
   * 選定參考商品後，依團隊決議的欄位清單預填：「商品固有屬性」（商品說明、
   * 節慶標籤、供貨穩定度、目標客群描述、8 個 Gate 判定屬性）＋商品名稱。
   * 不預填成本價／售價／市價、最低訂購量、價格競爭力、預估購買率——這些
   * 每次進貨成本、每次開團的市場預期都可能不同，照抄容易讓使用者忘記
   * 改成這次真正的數字，跟「商品名稱」不是同一類：再販售賣的是同一件
   * 實體商品，名稱通常就是同一個，沒有理由要求使用者每次都重打一遍；
   * 需要換個名稱行銷包裝是例外情況，而不是預設情況，交給下面的 dirty
   * 判斷處理即可——真的想換掉就自己打字蓋過去。
   *
   * ⚠️ 2026-09-17修正：先前名稱被歸進跟價格／成本一樣「每次都可能不同，
   * 不該自動帶入」那一類，但沒有任何具體理由支持這個歸類，名稱不像
   * 價格會隨時間波動；使用者明確反映「若無特別推薦的因素，請自動帶入」，
   * 查證後找不到站得住腳的理由繼續排除它，改成跟其他固有屬性一樣預填。
   *
   * 只覆蓋使用者「還沒自己動過」的欄位（controls.xxx.dirty 為 false）：
   * 若使用者在選定參考商品之前已經手動填過商品說明，選定參考商品不該
   * 無聲蓋掉他已經輸入的內容。patchValue() 本身不會設定 dirty，所以這個
   * 判斷同時也涵蓋「編輯既有商品、載入時已經帶了資料」的情況——這是
   * 刻意的：使用者在編輯模式下選了一個不同的參考商品，代表他明確想比照
   * 那件商品的資料，預填覆蓋既有值是預期行為，不是副作用。
   */
  private prefillFromReference(product: Partial<ProductResponsePayload>): void {
    const patch: Record<string, unknown> = {};
    if (!this.form.controls.name.dirty && product.name) {
      patch['name'] = product.name;
    }
    if (!this.form.controls.description.dirty && product.description) {
      patch['description'] = product.description;
    }
    if (!this.form.controls.campaignTags.dirty && product.campaignTags) {
      patch['campaignTags'] = splitCampaignTags(product.campaignTags);
    }
    if (!this.form.controls.supplyStability.dirty && product.supplyStability) {
      patch['supplyStability'] = product.supplyStability;
    }
    if (!this.form.controls.targetCustomer.dirty && product.targetCustomerDescription) {
      patch['targetCustomer'] = product.targetCustomerDescription;
    }
    if (!this.form.controls.temperatureZone.dirty && product.temperatureZone) {
      patch['temperatureZone'] = product.temperatureZone;
    }
    if (!this.form.controls.shelfLifeTier.dirty && product.shelfLifeTier) {
      patch['shelfLifeTier'] = product.shelfLifeTier;
    }
    if (!this.form.controls.supplierLeadTimeTier.dirty && product.supplierLeadTimeTier) {
      patch['supplierLeadTimeTier'] = product.supplierLeadTimeTier;
    }
    if (!this.form.controls.packageSizeTier.dirty && product.packageSizeTier) {
      patch['packageSizeTier'] = product.packageSizeTier;
    }
    if (!this.form.controls.packingType.dirty && product.packingType) {
      patch['packingType'] = product.packingType;
    }
    if (!this.form.controls.handlingFlags.dirty && product.handlingFlags) {
      patch['handlingFlags'] = product.handlingFlags;
    }
    if (!this.form.controls.certificationFlags.dirty && product.certificationFlags) {
      patch['certificationFlags'] = product.certificationFlags;
    }
    if (!this.form.controls.supplierMaxCapacity.dirty && product.supplierMaxCapacity) {
      patch['supplierMaxCapacity'] = product.supplierMaxCapacity;
    }
    this.form.patchValue(patch);
  }

  /**
   * 編輯模式下，回填目前已設定的參考商品。
   *
   * ProductResponse 這次已經補上 resaleReferenceProductId（見後端 Gate
   * 判定接線交付），但只回 id、沒有名稱（避免巢狀展開造成遞迴查詢），
   * 所以這裡另外呼叫一次 getProduct() 換取名稱給畫面顯示；查詢失敗
   * （例如參考商品後來被刪除）不視為表單載入失敗，只是顯示「載入失敗」代替，
   * 不再用 `#id` 這種原始編號當成暫時顯示內容。
   */
  private loadExistingResaleReference(referenceId: number | null): void {
    if (referenceId === null) return;

    this.resaleReferenceProductId.set(referenceId);
    this.resaleReferenceName.set('載入中…');

    this.api
      .getProduct(referenceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (product) => this.resaleReferenceName.set(product.name),
        error: () => this.resaleReferenceName.set('（無法載入商品名稱，商品可能已被刪除）'),
      });
  }

  ngOnInit(): void {
    if (!this.useMockData) {
      this.loadProductTypes();
      this.loadCampaignTags();
    }
    // 兩種模式都要，Mock 模式走本地固定候選（見 loadResaleSuppliers／loadResaleCandidateProducts 內判斷）。
    this.wireResaleReferenceCascade();
    this.wirePriceAboveMarketWarning();

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
            supplyStability: model.core.supplyStability ?? 3,
            priceCompetitiveness: model.core.priceCompetitiveness ?? 3,
            targetCustomer: model.core.targetCustomerDescription,
            estimatedPurchaseRate: Math.round((model.core.estimatedPurchaseRate ?? 0.5) * 100),
            temperatureZone: model.core.temperatureZone,
            shelfLifeTier: model.core.shelfLifeTier,
            supplierLeadTimeTier: model.core.supplierLeadTimeTier,
            packageSizeTier: model.core.packageSizeTier,
            packingType: model.core.packingType,
            handlingFlags: model.core.handlingFlags,
            certificationFlags: model.core.certificationFlags,
            supplierMaxCapacity: model.core.supplierMaxCapacity,
          }, { emitEvent: false });
          // ⚠️ emitEvent: false 是刻意的：這是「載入既有資料」而非「使用者
          // 互動」，不該觸發 wireResaleReferenceCascade() 的連鎖反應——那組
          // 監看是設計給使用者互動用的（切分類、切供應商），載入當下若照樣
          // 觸發，第二層的 debounce（300ms）會在 loadExistingResaleReference()
          // 剛設定好參考商品之後才跑完，把剛顯示好的參考商品又清空，兩者互相
          // 競速。下面改成載入完成後才明確呼叫 loadResaleSuppliers()，讓下拉
          // 選單有資料可選，但不觸碰目前已顯示的參考商品狀態。
          if (model.core.pricingType === 'RESALE' && model.core.productTypeId) {
            this.loadResaleSuppliers(model.core.productTypeId);
            if (model.base.supplierName?.trim()) {
              this.loadResaleCandidateProducts(model.core.productTypeId, model.base.supplierName.trim());
            }
          }
          this.currentImageUrl.set(model.base.imageUrl || null);
          if (model.base.imageUrl) {
            this.imagePreviewUrl.set(model.base.imageUrl);
            this.imageState.set('ready');
          }
          this.reviewStatus.set(model.reviewStatus);
          this.isApproved.set(model.actions.isCoreLocked);
          this.isRejected.set(model.reviewStatus === 'REJECTED');
          if (model.actions.isCoreLocked) this.lockCoreFields();
          this.loadExistingResaleReference(model.core.resaleReferenceProductId);
          this.pageState.set('default');
        },
        error: (err) => {
          this.pageState.set('error');
          this.statusMessageState.show(toApiError(err).message);
        },
      });
  }

  private loadProductTypes(): void {
    // 改用 ProductTypeLookupService 而非直接呼叫 settingsApi.getProductTypes()：
    // 一來這個服務有 shareReplay 快取，跟其他頁面共用同一份結果；二來
    // getGroupedOptions() 已經處理好「只留小類可被選、依大類分組」的邏輯，
    // 不用在這裡重新寫一次篩選規則。
    //
    // 商品只能掛在小類（level=2），原本這裡把大類也一併塞進同一條扁平
    // 清單，使用者理論上可以選到大類本身——這批一併修正，productTypeOptions
    // 現在只保留小類。
    this.productTypeLookup
      .getGroupedOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          this.productTypeGroups.set(
            groups
              .filter((g) => g.minors.length > 0)
              .map((g) => ({
                majorName: g.major.name,
                minors: g.minors.map((m) => ({ id: m.id, name: m.name })),
              })),
          );
          this.productTypeOptions.set(groups.flatMap((g) => g.minors.map((m) => ({ id: m.id, name: m.name }))));
        },
        // 分類清單載入失敗不影響其餘表單，下拉維持空白，使用者仍可看到既有值（若編輯模式已回填 id）。
        error: () => {
          this.productTypeGroups.set([]);
          this.productTypeOptions.set([]);
        },
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

          const namesByTag = new Map<string, Set<string>>();
          for (const campaign of campaigns) {
            for (const tag of campaign.tags) {
              const trimmed = tag.tag.trim();
              if (!trimmed) continue;
              const set = namesByTag.get(trimmed) ?? new Set<string>();
              set.add(campaign.campaignName);
              namesByTag.set(trimmed, set);
            }
          }
          this.tagCampaignNames.set(
            new Map([...namesByTag].map(([tag, names]) => [tag, [...names].join('、')])),
          );
        },
        error: () => {
          this.campaignTagOptions.set([]);
          this.tagCampaignNames.set(new Map());
        },
      });
  }

  removeCampaignTag(tag: string): void {
    this.form.controls.campaignTags.setValue(
      this.form.controls.campaignTags.value.filter((selected) => selected !== tag),
    );
    this.form.controls.campaignTags.markAsDirty();
  }

  isCampaignTagSelected(tag: string): boolean {
    return this.form.controls.campaignTags.value.includes(tag);
  }

  /**
   * ⚠️ 改用按鈕群取代 <select multiple>：原生多選下拉技術上支援複選，
   * 但沒有按住 Ctrl/Cmd 直接點第二個選項會「取代」而不是「新增」選取，
   * 使用者很容易誤以為只能選一個。改成點一下加入、再點一下移除的
   * 標籤按鈕，不需要任何隱藏的鍵盤組合鍵。
   */
  toggleCampaignTag(tag: string): void {
    if (this.isCampaignTagSelected(tag)) {
      this.removeCampaignTag(tag);
      return;
    }
    this.form.controls.campaignTags.setValue([...this.form.controls.campaignTags.value, tag]);
    this.form.controls.campaignTags.markAsDirty();
  }

  setState(state: FormPageState): void {
    this.pageState.set(state);
    if (state === 'locked') this.lockCoreFields();
    else if (!this.isApproved()) this.unlockCoreFields();
    this.statusMessageState.show(`已切換為 ${state} 狀態。`);
  }

  /**
   * 驗證並送出表單；`resubmit` 為 true 時，儲存成功後會接著呼叫
   * POST /api/products/{id}/resubmit 真的觸發重審（見
   * maybeResubmitThenFinish()），不是只改顯示文字。
   *
   * 驗證錯誤一律用 dialog 列出「所有」無效欄位，不是只顯示
   * 第一個錯誤或一句籠統的「請修正表單」——使用者不該逐一送出、
   * 逐一被打回才知道還有哪裡沒填對。
   */
  submit(resubmit = false): void {
    // 按鈕已綁定 [disabled]="isSubmitting()"，正常點擊不會走到這裡；
    // 保留 statusMessage 是為了防呆極端情況（例如程式化重複呼叫），
    // 不用 alert()——高頻率跳出視窗式對話框反而干擾使用者，用 toast 就夠。
    if (this.isSubmitting()) {
      this.statusMessageState.show('正在儲存，請勿重複送出。');
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
      // ⚠️ 不要在這裡再 set statusMessage：dialog 本身已經是唯一提醒層，
      // 加上每個無效欄位旁邊 fieldInvalid() 顯示的逐欄錯誤文字就足夠——
      // 這正是原本回報的 bug：使用者後來把欄位都修正了，畫面上卻還留著
      // 一句「請先修正表單中的錯誤」的殘留 toast，因為沒有任何地方會清掉它。
      this.dialog.notify('error', `表單有 ${errors.length} 項欄位需要修正`, errors).subscribe();
      return;
    }

    if (this.useMockData) {
      this.isSubmitting.set(true);
      this.submitCount.update((count) => count + 1);
      this.form.markAsPristine();
      this.imageDirty.set(false);
      const message = resubmit ? '已在本地模擬儲存並重審。' : '已儲存本地 Mock 品項。';
      window.setTimeout(() => {
        this.isSubmitting.set(false);
        this.saved.set(true);
        this.statusMessageState.show(message);
        // 儲存成功一律跳出 dialog 呈現，不分新增／編輯模式；
        // 使用者按下確定後才返回品項管理主頁。
        this.dialog.notify('success', '儲存成功', [message]).subscribe(() => {
          void this.router.navigate(['/products']);
        });
      }, 500);
      return;
    }

    this.isSubmitting.set(true);
    this.statusMessageState.show('');

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
      // 非 RESALE 一律送 null，避免使用者切換訂價分流後殘留舊選擇。
      resaleReferenceProductId: isResale ? this.resaleReferenceProductId() : null,
      temperatureZone: raw.temperatureZone,
      shelfLifeTier: raw.shelfLifeTier,
      supplierLeadTimeTier: raw.supplierLeadTimeTier,
      packageSizeTier: raw.packageSizeTier,
      packingType: raw.packingType,
      handlingFlags: raw.handlingFlags.trim() || null,
      certificationFlags: raw.certificationFlags.trim() || null,
      supplierMaxCapacity: raw.supplierMaxCapacity,
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
        this.dialog.notify('error', '儲存失敗', [message]).subscribe();
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
      this.maybeResubmitThenFinish(productId, resubmit);
      return;
    }

    this.api
      .uploadImage(productId, this.selectedImageFile)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.maybeResubmitThenFinish(productId, resubmit),
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
          this.statusMessageState.show(message);
          this.dialog.notify('error', '圖片上傳失敗', [message]).subscribe();
        },
      });
  }

  /**
   * ⚠️ 修正：resubmit=true 之前只影響「儲存並重審」按鈕的顯示文字，
   * 從來沒有真的呼叫過 POST /api/products/{id}/resubmit——編輯 REJECTED
   * 商品後點下去，欄位確實存了，但 reviewStatus 不會變回 PENDING，
   * 因為改欄位（PUT）跟送審（POST /resubmit）是後端兩支獨立的操作，
   * 不會因為改了欄位就自動觸發送審。這裡補上真正呼叫這支端點的步驟。
   */
  private maybeResubmitThenFinish(productId: number, resubmit: boolean): void {
    if (!resubmit || this.useMockData) {
      this.finishSubmit(resubmit, undefined, productId);
      return;
    }
    this.api
      .resubmit(productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // ⚠️ 之前這裡直接丟棄回應內容，只用「有沒有出錯」判斷成功與否。
        // 回報過「重審後次數沒有更新」的問題——後端邏輯跟這支呼叫本身
        // 都對照過確認沒有錯，但既然回應裡就有真正最新的 submissionCount，
        // 直接秀在這次的成功訊息裡，讓使用者當下就能看到次數真的變了，
        // 不用跳去別的頁面、也不用擔心那邊的畫面剛好沒重新整理才看起來
        // 沒有變化。
        next: (updated) => this.finishSubmit(true, updated.submissionCount, productId),
        error: (err) => {
          // 欄位已經存檔成功，只是送審這一步失敗，不能讓使用者以為
          // 整個操作都沒發生——維持 saved=true，讓使用者知道要重新
          // 觸發送審，而不是重新輸入一次資料。
          this.isSubmitting.set(false);
          const message = `品項資料已儲存，但重審失敗：${toApiError(err).message}`;
          this.saved.set(true);
          this.form.markAsPristine();
          this.statusMessageState.show(message);
          this.dialog.notify('error', '重審失敗', [message]).subscribe();
        },
      });
  }

  private finishSubmit(resubmit: boolean, newSubmissionCount?: number, productId?: number): void {
    this.isSubmitting.set(false);
    this.submitCount.update((count) => count + 1);
    this.saved.set(true);
    this.form.markAsPristine();
    this.imageDirty.set(false);
    this.selectedImageFile = null;
    const message =
      resubmit && newSubmissionCount != null
        ? `已儲存並重審（第 ${newSubmissionCount} 次送審）。`
        : resubmit
          ? '已儲存並重審。'
          : '已儲存品項資料。';
    this.statusMessageState.show(message);

    // 儲存成功一律跳出 dialog 呈現，不分新增／編輯模式；使用者按下確定後
    // 才進到「是否認領歷史紀錄」這一步（若有候選）或直接返回品項管理
    // 主頁，不是存檔當下就直接跳轉，讓使用者能先看清楚儲存結果再離開。
    this.dialog.notify('success', '儲存成功', [message]).subscribe(() => {
      if (productId !== undefined) {
        this.checkClaimCandidatesThenNavigate(productId);
      } else {
        void this.router.navigate(['/products']);
      }
    });
  }

  // ===================== 認領歷史紀錄（選填，不阻擋主流程） =====================
  // 儲存成功後，若是 RESALE 商品，額外查一次有沒有 product_id 為 null 的
  // 歷史開團紀錄跟這件商品名稱／供應商相似——這批紀錄匯入當下多半沒有
  // 對應的系統商品（見 GroupBuyRecord 類別註解），而這張表刻意不提供
  // 單筆編輯，匯入之後就沒有回頭補上連結的機會。新增商品的當下是使用者
  // 最清楚「這是不是同一件舊商品」的時機，藉機把這批連結補上。
  // 查詢失敗或沒有候選都不阻擋、不提示，直接照原本的流程導頁離開。

  readonly claimCandidates = signal<readonly GroupBuyClaimCandidatePayload[]>([]);
  readonly selectedClaimIds = signal<ReadonlySet<number>>(new Set());
  readonly isClaiming = signal(false);
  private claimTargetProductId: number | null = null;

  private checkClaimCandidatesThenNavigate(productId: number): void {
    const productTypeId = this.form.controls.productTypeId.value;
    const name = this.form.controls.name.value.trim();
    if (this.useMockData || !this.isResale() || !productTypeId || name.length < 2) {
      void this.router.navigate(['/products']);
      return;
    }

    this.claimTargetProductId = productId;
    this.groupBuyApi
      .searchUnlinkedCandidates({
        productTypeId,
        name,
        supplierName: this.form.controls.supplierName.value.trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (candidates) => {
          if (candidates.length === 0) {
            void this.router.navigate(['/products']);
            return;
          }
          this.claimCandidates.set(candidates);
        },
        // 候選查詢失敗不影響已經成功的儲存，直接前往清單，不額外跳錯誤提示
        // 打擾使用者——這是加值步驟，失敗了大不了少一個方便，不是問題。
        error: () => void this.router.navigate(['/products']),
      });
  }

  toggleClaimCandidate(id: number): void {
    const next = new Set(this.selectedClaimIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedClaimIds.set(next);
  }

  skipClaim(): void {
    void this.router.navigate(['/products']);
  }

  confirmClaim(): void {
    const productId = this.claimTargetProductId;
    const groupBuyRecordIds = [...this.selectedClaimIds()];
    if (productId === null || groupBuyRecordIds.length === 0) {
      void this.router.navigate(['/products']);
      return;
    }

    this.isClaiming.set(true);
    this.groupBuyApi
      .claim({ productId, groupBuyRecordIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => void this.router.navigate(['/products']),
        error: (err) => {
          this.isClaiming.set(false);
          this.dialog.notify('error', '認領歷史紀錄失敗', [toApiError(err).message]).subscribe();
        },
      });
  }

  /** 供樣板顯示百分比：後端回傳 0~1 的小數（Jaro-Winkler），畫面顯示需要 ×100。 */
  toSimilarityPercent(value: number | null): string {
    return value === null ? '—' : `${Math.round(value * 100)}%`;
  }

  readonly claimResultLabel = GROUP_BUY_RESULT_LABEL;

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
      this.statusMessageState.show(
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
    this.statusMessageState.show('圖片已移除，尚未儲存。');
  }

  formatFileSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  createFileReader(): FileReader {
    return new FileReader();
  }

  requestCancel(): void {
    if (!this.hasUnsavedChanges()) {
      void this.router.navigate(['/products']);
      return;
    }
    this.dialog
      .confirm('放棄未儲存的變更？', ['離開後，目前輸入的本地資料將不會保留。'], '放棄並離開', '繼續編輯')
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.form.markAsPristine();
        this.imageDirty.set(false);
        void this.router.navigate(['/products']);
      });
  }
  retry(): void {
    this.pageState.set('default');
    this.statusMessageState.show(this.useMockData ? '已恢復本地表單資料。' : '');
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
  /**
   * 給 CanDeactivate guard 用（見 product-form.guard.ts）。改成回傳
   * Observable<boolean>——Angular 的 CanDeactivateFn 本來就支援非同步結果，
   * 不需要為了配合 window.confirm() 的同步限制犧牲掉自訂 dialog。
   */
  canLeave(): Observable<boolean> {
    if (!this.hasUnsavedChanges()) return of(true);
    return this.dialog.confirm('尚有未儲存的變更', ['確定要離開嗎？'], '離開', '留在頁面');
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
    this.statusMessageState.show(message);
  }

  /**
   * APPROVED 商品鎖定選品核心資料。⚠️ 這 11 個欄位之外，另外加上 8 個 Gate
   * 判定屬性一併鎖定——後端 assertCoreDataUnchanged()（ProductService.java）
   * 這次把這 8 欄併入同一組核心資料，APPROVED 後異動會整包被 409 拒絕。
   * 若這裡不同步鎖，畫面會讓使用者以為能改溫層／效期級距等屬性，
   * 送出時才發現連同其他有效變更一起被打回，且錯誤訊息不會指出是哪個
   * 欄位造成的（見 onSubmit() 的 409 訊息只有一句通用文案）。
   */
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
      'temperatureZone',
      'shelfLifeTier',
      'supplierLeadTimeTier',
      'packageSizeTier',
      'packingType',
      'handlingFlags',
      'certificationFlags',
      'supplierMaxCapacity',
    ];
    names.forEach((name) => this.form.controls[name].disable());
  }
  private unlockCoreFields(): void {
    this.form.enable();
  }
}
