/**
 * 檔案用途：批次新增選品（CSV／Excel 匯入），對應 POST /api/products/batch。
 *
 * 分工原則：CSV 裡的人類可讀文字（品類名稱、訂價類型中文、溫層中文…）
 * 一定要在前端轉成後端 DTO 要的代碼（productTypeId 數字／enum 字串），
 * 這一步無法留給後端做，後端不知道「生鮮」對應哪個 productTypeId。
 * 但「轉完之後這筆資料本身合不合法」（例如成本價 > 售價、市售價只有
 * 再販售能填）刻意不在前端重複實作一份——那些規則已經在
 * ProductService.createProduct() 裡，前端重寫一份只會造成兩邊regulation
 * 邏輯分岔、日後改一邊忘記改另一邊。前端只做「必要欄位辨識不出來就無法
 * 組出送出用的資料」這一層，其餘一律送到後端，用批次 API 本來就有的
 * 逐列結果回報把錯誤訊息帶回來對應到原始列號。
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { toApiError } from '../../../core/api/api-error';
import {
  PACKAGE_SIZE_TIER_LABEL,
  PACKING_TYPE_LABEL,
  PRICE_COMPETITIVENESS_LEVEL_LABEL,
  PRICING_TYPE_LABEL,
  SHELF_LIFE_TIER_LABEL,
  SUPPLIER_LEAD_TIME_TIER_LABEL,
  SUPPLY_STABILITY_LEVEL_LABEL,
  TEMPERATURE_ZONE_LABEL,
} from '../../../core/domain/labels';
import { PricingType, ScoreLevel } from '../../../core/domain/enums';
import { Icon } from '../../../shared/components/icon/icon';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import { ProductApiService } from '../api/product-api.service';
import {
  ProductBatchItemRequestPayload,
  ProductBatchItemResultPayload,
  ProductCreateRequestPayload,
} from '../api/product-api.contract';

/** CSV／Excel 欄位標題 → 內部 key 的對照，同時定義下載範本要用的欄位順序。 */
const COLUMNS: { header: string; key: string; required: boolean }[] = [
  { header: '商品名稱', key: 'name', required: true },
  { header: '商品分類（可填名稱或數字ID）', key: 'productType', required: true },
  { header: '訂價類型（新品／再販售）', key: 'pricingType', required: true },
  { header: '目標客群描述', key: 'targetCustomerDescription', required: true },
  { header: '供應商', key: 'supplierName', required: false },
  { header: '商品說明', key: 'description', required: false },
  { header: '成本價', key: 'costPrice', required: false },
  { header: '預計售價', key: 'salePrice', required: false },
  { header: '市售價（僅再販售適用）', key: 'marketPrice', required: false },
  { header: '節慶標籤（逗號分隔）', key: 'campaignTags', required: false },
  { header: '最低訂購量', key: 'moq', required: false },
  { header: '供應穩定性（1-5或文字敘述）', key: 'supplyStability', required: false },
  { header: '價格競爭力（1-5或文字敘述）', key: 'priceCompetitiveness', required: false },
  { header: '預估購買率（%，0-100）', key: 'estimatedPurchaseRate', required: false },
  { header: '溫層', key: 'temperatureZone', required: false },
  { header: '效期', key: 'shelfLifeTier', required: false },
  { header: '供應商交期', key: 'supplierLeadTimeTier', required: false },
  { header: '包裝尺寸', key: 'packageSizeTier', required: false },
  { header: '包裝型態', key: 'packingType', required: false },
  { header: '處理注意事項', key: 'handlingFlags', required: false },
  { header: '認證狀態', key: 'certificationFlags', required: false },
  { header: '供應商產能上限', key: 'supplierMaxCapacity', required: false },
  { header: '圖片檔名（需與上傳的圖片檔名完全相同，選填）', key: 'imageFileName', required: false },
];

/** 範本／預覽用的一列示範資料，展示合法欄位值該長怎樣。 */
const SAMPLE_ROW: Record<string, string> = {
  name: '示範商品：即食雞胸肉',
  productType: '冷藏調理食品',
  pricingType: '新品',
  targetCustomerDescription: '注重高蛋白、少烹調時間的上班族',
  supplierName: '示範供應商有限公司',
  description: '低脂高蛋白，加熱即食',
  costPrice: '65',
  salePrice: '99',
  marketPrice: '',
  campaignTags: '健身,即食',
  moq: '100',
  supplyStability: '4',
  priceCompetitiveness: '3',
  estimatedPurchaseRate: '60',
  temperatureZone: '冷藏',
  shelfLifeTier: '8-30天',
  supplierLeadTimeTier: '4-7天',
  packageSizeTier: '小（單手可拿）',
  packingType: '原箱直出',
  handlingFlags: '',
  certificationFlags: '',
  supplierMaxCapacity: '',
  imageFileName: '',
};

interface BatchRow {
  rowNumber: number;
  name: string;
  /** 原始各欄位文字（key 對照 COLUMNS[].key），供「下載失敗清單」完整還原原始內容重新匯入使用。 */
  raw: Record<string, string>;
  /** 這一列組好、可送出的 payload；null 代表必要欄位無法辨識，這一列不會被送出。 */
  payload: ProductCreateRequestPayload | null;
  imageFileName: string | null;
  /** 擋下整列送出的錯誤（必要欄位辨識失敗）。 */
  blockingErrors: string[];
  /** 不擋送出，但值被忽略／需要留意的提示（選填欄位辨識失敗、圖片檔名對不到）。 */
  warnings: string[];
  /** 送出後的伺服器端結果，尚未送出為 undefined。 */
  result?: ProductBatchItemResultPayload;
}

function buildReverseLabelMap<T extends string>(labelMap: Record<T, string>): Map<string, T> {
  const map = new Map<string, T>();
  (Object.keys(labelMap) as T[]).forEach((code) => {
    map.set(code.toUpperCase(), code);
    map.set(labelMap[code], code);
  });
  return map;
}

const PRICING_TYPE_REVERSE = buildReverseLabelMap(PRICING_TYPE_LABEL);
const TEMPERATURE_ZONE_REVERSE = buildReverseLabelMap(TEMPERATURE_ZONE_LABEL);
const SHELF_LIFE_TIER_REVERSE = buildReverseLabelMap(SHELF_LIFE_TIER_LABEL);
const SUPPLIER_LEAD_TIME_TIER_REVERSE = buildReverseLabelMap(SUPPLIER_LEAD_TIME_TIER_LABEL);
const PACKAGE_SIZE_TIER_REVERSE = buildReverseLabelMap(PACKAGE_SIZE_TIER_LABEL);
const PACKING_TYPE_REVERSE = buildReverseLabelMap(PACKING_TYPE_LABEL);

/** ScoreLevel（1-5）的文字敘述沒有共用的反查工具，這裡各自建一份。 */
function buildScoreLevelReverse(labelMap: Record<ScoreLevel, string>): Map<string, ScoreLevel> {
  const map = new Map<string, ScoreLevel>();
  ([1, 2, 3, 4, 5] as ScoreLevel[]).forEach((level) => {
    map.set(String(level), level);
    map.set(labelMap[level], level);
  });
  return map;
}
const SUPPLY_STABILITY_REVERSE = buildScoreLevelReverse(SUPPLY_STABILITY_LEVEL_LABEL);
const PRICE_COMPETITIVENESS_REVERSE = buildScoreLevelReverse(PRICE_COMPETITIVENESS_LEVEL_LABEL);

type PageState = 'idle' | 'parsing' | 'ready' | 'submitting' | 'done' | 'parse-error';

@Component({
  selector: 'app-batch-import',
  imports: [CommonModule, RouterLink, Icon],
  templateUrl: './batch-import.html',
  styleUrl: './batch-import.scss',
})
export class BatchImport implements OnInit {
  private readonly productApi = inject(ProductApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);

  readonly state = signal<PageState>('idle');
  readonly rows = signal<BatchRow[]>([]);
  readonly parseErrorMessage = signal('');
  readonly submitErrorMessage = signal('');
  readonly imageFiles = signal<File[]>([]);
  readonly fileName = signal('');

  private readonly productTypeById = new Set<number>();
  private readonly productTypeByExactName = new Map<string, number>();
  private readonly productTypeByCombinedName = new Map<string, number>();
  readonly productTypesReady = signal(false);

  /** 尚未送出、且沒有 blockingErrors 的列數——可送出的實際筆數。 */
  get submittableCount(): number {
    return this.rows().filter((r) => r.payload !== null).length;
  }

  get blockedCount(): number {
    return this.rows().filter((r) => r.payload === null).length;
  }

  get submittedSuccessCount(): number {
    return this.rows().filter((r) => r.result?.success).length;
  }

  get submittedFailCount(): number {
    return this.rows().filter((r) => r.result && !r.result.success).length;
  }

  get hasAnyFailure(): boolean {
    return this.blockedCount > 0 || this.submittedFailCount > 0;
  }

  ngOnInit(): void {
    this.productTypeLookup.getGroupedOptions().subscribe((groups) => {
      const nameCount = new Map<string, number>();
      for (const group of groups) {
        for (const minor of group.minors) {
          nameCount.set(minor.name, (nameCount.get(minor.name) ?? 0) + 1);
          this.productTypeById.add(minor.id);
          this.productTypeByCombinedName.set(`${group.major.name}/${minor.name}`, minor.id);
        }
      }
      for (const group of groups) {
        for (const minor of group.minors) {
          // 名稱在不同大類下重複時不收進「純名稱」對照表，避免匯入時猜錯類別；
          // 這種情況使用者要改用「大類/小類」或數字 ID 兩種明確寫法。
          if (nameCount.get(minor.name) === 1) {
            this.productTypeByExactName.set(minor.name, minor.id);
          }
        }
      }
      this.productTypesReady.set(true);
    });
  }

  /** 下載 CSV 範本，含欄位標題與一列示範資料，UTF-8 BOM 讓 Excel 開啟時中文不亂碼。 */
  downloadTemplate(): void {
    const headerLine = COLUMNS.map((c) => this.csvEscape(c.header)).join(',');
    const sampleLine = COLUMNS.map((c) => this.csvEscape(SAMPLE_ROW[c.key] ?? '')).join(',');
    const csvContent = '\uFEFF' + headerLine + '\r\n' + sampleLine + '\r\n';
    this.triggerDownload(csvContent, '批次新增選品範本.csv');
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  private triggerDownload(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!this.productTypesReady()) {
      this.parseErrorMessage.set('商品分類清單尚未載入完成，請稍候片刻再重新選擇檔案。');
      this.state.set('parse-error');
      input.value = '';
      return;
    }
    this.fileName.set(file.name);
    this.state.set('parsing');
    this.parseErrorMessage.set('');

    file
      .arrayBuffer()
      .then((buffer) => this.parseWorkbook(buffer))
      .catch(() => {
        this.parseErrorMessage.set('檔案讀取失敗，請確認檔案未損毀。');
        this.state.set('parse-error');
      });
    // 允許重複選同一個檔案時仍觸發 change 事件。
    input.value = '';
  }

  onImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    this.imageFiles.set([...this.imageFiles(), ...files]);
    this.rebuildRowsImageStatus();
    input.value = '';
  }

  removeImage(name: string): void {
    this.imageFiles.set(this.imageFiles().filter((f) => f.name !== name));
    this.rebuildRowsImageStatus();
  }

  private rebuildRowsImageStatus(): void {
    const available = new Set(this.imageFiles().map((f) => f.name));
    this.rows.set(
      this.rows().map((row) => {
        if (!row.imageFileName) return row;
        const warnings = row.warnings.filter((w) => !w.startsWith('圖片檔名'));
        if (!available.has(row.imageFileName)) {
          warnings.push(`圖片檔名「${row.imageFileName}」目前尚未於下方選取對應的圖片檔案`);
        }
        return { ...row, warnings };
      }),
    );
  }

  private async parseWorkbook(buffer: ArrayBuffer): Promise<void> {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        this.parseErrorMessage.set('檔案內沒有可讀取的工作表。');
        this.state.set('parse-error');
        return;
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
      if (rawRows.length === 0) {
        this.parseErrorMessage.set('檔案內沒有資料列（只有標題列，或整份是空的）。');
        this.state.set('parse-error');
        return;
      }
      const headerByKey = this.matchHeaders(Object.keys(rawRows[0]));
      const missingRequired = COLUMNS.filter((c) => c.required && !headerByKey.has(c.key));
      if (missingRequired.length > 0) {
        this.parseErrorMessage.set(
          `檔案缺少必要欄位：${missingRequired.map((c) => c.header).join('、')}，請對照範本檢查標題列文字。`,
        );
        this.state.set('parse-error');
        return;
      }

      const availableImages = new Set(this.imageFiles().map((f) => f.name));
      const rows: BatchRow[] = rawRows.map((raw, index) => {
        const get = (key: string): string => {
          const header = headerByKey.get(key);
          if (!header) return '';
          const value = raw[header];
          return value === undefined || value === null ? '' : String(value).trim();
        };
        return this.buildRow(index + 1, get, availableImages);
      });
      this.rows.set(rows);
      this.state.set('ready');
    } catch {
      this.parseErrorMessage.set('檔案格式無法解析，請確認是有效的 CSV 或 Excel（.xlsx）檔案。');
      this.state.set('parse-error');
    }
  }

  /** 依「標題文字完全相符」比對，找不到就視為該欄位缺席（用 defval 的空字串填補）。 */
  private matchHeaders(actualHeaders: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const column of COLUMNS) {
      if (actualHeaders.includes(column.header)) {
        result.set(column.key, column.header);
      }
    }
    return result;
  }

  private buildRow(rowNumber: number, get: (key: string) => string, availableImages: Set<string>): BatchRow {
    const blockingErrors: string[] = [];
    const warnings: string[] = [];
    const raw: Record<string, string> = {};
    for (const column of COLUMNS) raw[column.key] = get(column.key);

    const name = get('name');
    if (!name) blockingErrors.push('商品名稱未填');
    if (name.length > 100) blockingErrors.push('商品名稱超過 100 字元');

    const targetCustomerDescription = get('targetCustomerDescription');
    if (!targetCustomerDescription) blockingErrors.push('目標客群描述未填');

    const productTypeRaw = get('productType');
    const productTypeId = productTypeRaw ? this.resolveProductTypeId(productTypeRaw) : null;
    if (!productTypeRaw) {
      blockingErrors.push('商品分類未填');
    } else if (productTypeId === null) {
      blockingErrors.push(`無法辨識商品分類「${productTypeRaw}」，請改填正確名稱或數字 ID`);
    }

    const pricingTypeRaw = get('pricingType');
    const pricingType = pricingTypeRaw ? this.resolveEnum(pricingTypeRaw, PRICING_TYPE_REVERSE) : null;
    if (!pricingTypeRaw) {
      blockingErrors.push('訂價類型未填');
    } else if (pricingType === null) {
      blockingErrors.push(`無法辨識訂價類型「${pricingTypeRaw}」，請填「新品」或「再販售」`);
    }

    const imageFileNameRaw = get('imageFileName');
    const imageFileName = imageFileNameRaw || null;
    if (imageFileName && !availableImages.has(imageFileName)) {
      warnings.push(`圖片檔名「${imageFileName}」目前尚未於下方選取對應的圖片檔案`);
    }

    if (blockingErrors.length > 0) {
      return { rowNumber, name, raw, payload: null, imageFileName, blockingErrors, warnings };
    }

    const payload: ProductCreateRequestPayload = {
      productTypeId: productTypeId!,
      pricingType: pricingType as PricingType,
      name,
      targetCustomerDescription,
    };

    this.assignOptionalString(payload, 'description', get('description'));
    this.assignOptionalString(payload, 'supplierName', get('supplierName'));
    this.assignOptionalString(payload, 'campaignTags', get('campaignTags'));
    this.assignOptionalString(payload, 'handlingFlags', get('handlingFlags'));
    this.assignOptionalString(payload, 'certificationFlags', get('certificationFlags'));

    this.assignOptionalNumber(payload, 'costPrice', get('costPrice'), warnings, '成本價');
    this.assignOptionalNumber(payload, 'salePrice', get('salePrice'), warnings, '預計售價');
    if (pricingType === 'RESALE') {
      this.assignOptionalNumber(payload, 'marketPrice', get('marketPrice'), warnings, '市售價');
    } else if (get('marketPrice')) {
      warnings.push('市售價僅再販售商品適用，新品商品這欄已忽略');
    }
    this.assignOptionalInteger(payload, 'moq', get('moq'), warnings, '最低訂購量');
    this.assignOptionalInteger(payload, 'supplierMaxCapacity', get('supplierMaxCapacity'), warnings, '供應商產能上限');

    this.assignScoreLevel(payload, 'supplyStability', get('supplyStability'), SUPPLY_STABILITY_REVERSE, warnings, '供應穩定性');
    this.assignScoreLevel(
      payload,
      'priceCompetitiveness',
      get('priceCompetitiveness'),
      PRICE_COMPETITIVENESS_REVERSE,
      warnings,
      '價格競爭力',
    );

    const purchaseRateRaw = get('estimatedPurchaseRate');
    if (purchaseRateRaw) {
      const percent = Number(purchaseRateRaw);
      if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
        payload.estimatedPurchaseRate = Math.round(percent) / 100;
      } else {
        warnings.push(`預估購買率「${purchaseRateRaw}」不是 0-100 的數字，已忽略`);
      }
    }

    this.assignEnum(payload, 'temperatureZone', get('temperatureZone'), TEMPERATURE_ZONE_REVERSE, warnings, '溫層');
    this.assignEnum(payload, 'shelfLifeTier', get('shelfLifeTier'), SHELF_LIFE_TIER_REVERSE, warnings, '效期');
    this.assignEnum(
      payload,
      'supplierLeadTimeTier',
      get('supplierLeadTimeTier'),
      SUPPLIER_LEAD_TIME_TIER_REVERSE,
      warnings,
      '供應商交期',
    );
    this.assignEnum(payload, 'packageSizeTier', get('packageSizeTier'), PACKAGE_SIZE_TIER_REVERSE, warnings, '包裝尺寸');
    this.assignEnum(payload, 'packingType', get('packingType'), PACKING_TYPE_REVERSE, warnings, '包裝型態');

    return { rowNumber, name, raw, payload, imageFileName, blockingErrors, warnings };
  }

  private assignOptionalString(payload: ProductCreateRequestPayload, key: keyof ProductCreateRequestPayload, value: string): void {
    if (value) (payload as unknown as Record<string, unknown>)[key] = value;
  }

  private assignOptionalNumber(
    payload: ProductCreateRequestPayload,
    key: keyof ProductCreateRequestPayload,
    raw: string,
    warnings: string[],
    label: string,
  ): void {
    if (!raw) return;
    const num = Number(raw);
    if (Number.isFinite(num) && num >= 0) {
      (payload as unknown as Record<string, unknown>)[key] = num;
    } else {
      warnings.push(`${label}「${raw}」不是有效的非負數字，已忽略`);
    }
  }

  private assignOptionalInteger(
    payload: ProductCreateRequestPayload,
    key: keyof ProductCreateRequestPayload,
    raw: string,
    warnings: string[],
    label: string,
  ): void {
    if (!raw) return;
    const num = Number(raw);
    if (Number.isInteger(num) && num >= 0) {
      (payload as unknown as Record<string, unknown>)[key] = num;
    } else {
      warnings.push(`${label}「${raw}」不是有效的非負整數，已忽略`);
    }
  }

  private assignScoreLevel(
    payload: ProductCreateRequestPayload,
    key: keyof ProductCreateRequestPayload,
    raw: string,
    reverseMap: Map<string, ScoreLevel>,
    warnings: string[],
    label: string,
  ): void {
    if (!raw) return;
    const level = reverseMap.get(raw);
    if (level !== undefined) {
      (payload as unknown as Record<string, unknown>)[key] = level;
    } else {
      warnings.push(`${label}「${raw}」無法辨識（需為 1-5 或對應文字敘述），已忽略`);
    }
  }

  private assignEnum<T extends string>(
    payload: ProductCreateRequestPayload,
    key: keyof ProductCreateRequestPayload,
    raw: string,
    reverseMap: Map<string, T>,
    warnings: string[],
    label: string,
  ): void {
    if (!raw) return;
    const resolved = reverseMap.get(raw) ?? reverseMap.get(raw.toUpperCase());
    if (resolved) {
      (payload as unknown as Record<string, unknown>)[key] = resolved;
    } else {
      warnings.push(`${label}「${raw}」無法辨識，已忽略（Gate 判定會改用品類層預設值）`);
    }
  }

  private resolveEnum<T extends string>(raw: string, reverseMap: Map<string, T>): T | null {
    return reverseMap.get(raw) ?? reverseMap.get(raw.toUpperCase()) ?? null;
  }

  private resolveProductTypeId(raw: string): number | null {
    if (/^\d+$/.test(raw)) {
      const id = Number(raw);
      return this.productTypeById.has(id) ? id : null;
    }
    return this.productTypeByCombinedName.get(raw) ?? this.productTypeByExactName.get(raw) ?? null;
  }

  reset(): void {
    this.state.set('idle');
    this.rows.set([]);
    this.imageFiles.set([]);
    this.fileName.set('');
    this.parseErrorMessage.set('');
    this.submitErrorMessage.set('');
  }

  submit(): void {
    const submittableRows = this.rows().filter((r) => r.payload !== null);
    if (submittableRows.length === 0) return;

    this.state.set('submitting');
    this.submitErrorMessage.set('');

    const items: ProductBatchItemRequestPayload[] = submittableRows.map((row) => ({
      rowNumber: row.rowNumber,
      imageFileName: row.imageFileName,
      product: row.payload!,
    }));

    this.productApi
      .createBatch(items, this.imageFiles())
      .pipe(
        catchError((err) => {
          this.submitErrorMessage.set(toApiError(err).message);
          this.state.set('ready');
          return of(null);
        }),
      )
      .subscribe((response) => {
        if (!response) return;
        const resultByRow = new Map(response.results.map((r) => [r.rowNumber, r]));
        this.rows.set(
          this.rows().map((row) => {
            const result = resultByRow.get(row.rowNumber);
            return result ? { ...row, result } : row;
          }),
        );
        this.state.set('done');
      });
  }

  /** 下載「未送出＋伺服器回報失敗」的列，附上原因，方便修正後重新匯入。 */
  downloadFailedRows(): void {
    const failedRows = this.rows().filter(
      (row) => row.payload === null || (row.result && !row.result.success),
    );
    if (failedRows.length === 0) return;

    const headerLine = ['原始列號', '商品名稱', '失敗原因', ...COLUMNS.map((c) => c.header)]
      .map((h) => this.csvEscape(h))
      .join(',');
    const lines = failedRows.map((row) => {
      const reason =
        row.payload === null ? row.blockingErrors.join('；') : (row.result?.errorMessage ?? '');
      const cells = [String(row.rowNumber), row.name, reason, ...COLUMNS.map((c) => row.raw[c.key] ?? '')];
      return cells.map((v) => this.csvEscape(v)).join(',');
    });
    const csvContent = '\uFEFF' + headerLine + '\r\n' + lines.join('\r\n') + '\r\n';
    this.triggerDownload(csvContent, '批次新增選品_失敗清單.csv');
  }
}
