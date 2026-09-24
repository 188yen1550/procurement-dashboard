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
 *
 * ## 自訂商品屬性欄位（2026-09-24，Bug A）
 * 題目依「大類」決定適用範圍，同一份檔案可能涵蓋多個大類，因此範本表頭＝所有生效中題目的
 * 聯集（「自訂屬性：題目名稱（適用：大類…）」）。送出時依每列自己的品類，只把適用的欄位值
 * 放進 customFieldValues；填在不適用欄位的值只提示、不擋匯入（與單筆表單「品類切換後殘留值
 * 不送出」同一原則）。必填與數值範圍一律交給後端檢查，錯誤訊息沿用逐列結果回顯。
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { CustomFieldDefinitionResponsePayload } from '../../settings/api/settings-api.contract';
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

/** 自訂屬性欄位的表頭前綴；範本產生與檔案解析共用，避免兩處字串各自維護。 */
export const CUSTOM_FIELD_HEADER_PREFIX = '自訂屬性：';

/** BatchRow.raw 裡自訂屬性欄位的 key，與 COLUMNS[].key 分開命名避免撞名。 */
export const customFieldRawKey = (fieldCode: string): string => `cf:${fieldCode}`;

/**
 * 自訂屬性欄位在檔案中的識別名稱：預設為題目名稱；生效中題目有同名時改附代碼，
 * 否則兩欄表頭相同無法分辨。
 */
export function customFieldLabels(
  fields: readonly CustomFieldDefinitionResponsePayload[],
): Map<string, string> {
  const nameCount = new Map<string, number>();
  for (const field of fields) nameCount.set(field.fieldName, (nameCount.get(field.fieldName) ?? 0) + 1);
  return new Map(
    fields.map((field) => [
      field.fieldCode,
      (nameCount.get(field.fieldName) ?? 0) > 1 ? `${field.fieldName}［${field.fieldCode}］` : field.fieldName,
    ]),
  );
}

/**
 * 範本表頭：「自訂屬性：題目名稱（適用：大類A、大類B，必填）」。括號內只是說明，
 * 解析時只比對「前綴＋題目名稱」，品類名稱日後改了，舊範本仍能匯入。
 */
export function customFieldHeader(
  field: CustomFieldDefinitionResponsePayload,
  label: string,
  majorNameById: ReadonlyMap<number, string>,
): string {
  const scope =
    field.applicableRootProductTypeIds.length === 0
      ? '全品類'
      : field.applicableRootProductTypeIds.map((id) => majorNameById.get(id) ?? `#${id}`).join('、');
  return `${CUSTOM_FIELD_HEADER_PREFIX}${label}（適用：${scope}${field.isRequired ? '，必填' : ''}）`;
}

/**
 * 實際表頭 → 題目代碼。接受「前綴＋名稱」本身，或其後接全形括號說明；
 * 多個名稱都符合時取最長者（例：「產地」與「產地證明」）。對不到回 null。
 */
export function matchCustomFieldHeader(header: string, codeByLabel: ReadonlyMap<string, string>): string | null {
  if (!header.startsWith(CUSTOM_FIELD_HEADER_PREFIX)) return null;
  const rest = header.slice(CUSTOM_FIELD_HEADER_PREFIX.length).trim();
  let best: { label: string; code: string } | null = null;
  for (const [label, code] of codeByLabel) {
    if (rest === label || rest.startsWith(`${label}（`)) {
      if (!best || label.length > best.label.length) best = { label, code };
    }
  }
  return best?.code ?? null;
}

/**
 * 單一自訂屬性值轉成送出格式。TEXT 原樣；數值型轉 number，SCALE_1_5 另接受設定頁定義的
 * 分數說明文字（與單筆表單下拉選單的選項一致）。轉不成數字回 null，由呼叫端列為擋送出錯誤，
 * 不送 NaN 或字串給後端。範圍（1~5、0~1）由後端檢查。
 */
export function parseCustomFieldValue(
  field: CustomFieldDefinitionResponsePayload,
  raw: string,
): string | number | null {
  if (field.fieldType === 'TEXT') return raw;
  if (field.fieldType === 'SCALE_1_5' && field.scaleLabels) {
    for (const [score, label] of Object.entries(field.scaleLabels)) {
      if (raw === label || raw === `${score} - ${label}`) return Number(score);
    }
  }
  const numeric = Number(raw);
  return raw.trim() !== '' && Number.isFinite(numeric) ? numeric : null;
}

interface BatchRow {
  rowNumber: number;
  name: string;
  /**
   * 原始各欄位文字（key 對照 COLUMNS[].key；自訂屬性為 customFieldRawKey(fieldCode)），
   * 供「下載失敗清單」完整還原原始內容重新匯入使用。
   */
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
  /** 小類 id → 大類 id：自訂屬性題目依大類決定適用範圍。 */
  private readonly rootTypeIdByMinorId = new Map<number, number>();
  /** 大類 id → 名稱：範本表頭的「適用：…」說明用。 */
  private readonly majorNameById = new Map<number, string>();
  readonly productTypesReady = signal(false);

  /** 生效中的自訂商品屬性題目（不限品類的聯集）。 */
  readonly customFieldColumns = signal<readonly CustomFieldDefinitionResponsePayload[]>([]);
  readonly customFieldsReady = signal(false);
  /** 題目清單載入失敗：仍可匯入，但自訂屬性欄位無法辨識，畫面提示使用者。 */
  readonly customFieldsLoadFailed = signal(false);
  /** 範本與解析都要等品類與題目兩份清單就緒。 */
  readonly lookupsReady = computed(() => this.productTypesReady() && this.customFieldsReady());

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
    this.productApi
      .getAllActiveCustomFieldSchema()
      .pipe(
        catchError(() => {
          this.customFieldsLoadFailed.set(true);
          return of([] as CustomFieldDefinitionResponsePayload[]);
        }),
      )
      .subscribe((fields) => {
        this.customFieldColumns.set(fields);
        this.customFieldsReady.set(true);
      });

    this.productTypeLookup.getGroupedOptions().subscribe((groups) => {
      const nameCount = new Map<string, number>();
      for (const group of groups) {
        this.majorNameById.set(group.major.id, group.major.name);
        for (const minor of group.minors) {
          this.rootTypeIdByMinorId.set(minor.id, group.major.id);
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

  /** 範本／失敗清單的自訂屬性欄位（表頭＋raw key），依題目順序。 */
  private customFieldTemplateColumns(): { header: string; key: string }[] {
    const fields = this.customFieldColumns();
    const labels = customFieldLabels(fields);
    return fields.map((field) => ({
      header: customFieldHeader(field, labels.get(field.fieldCode) ?? field.fieldName, this.majorNameById),
      key: customFieldRawKey(field.fieldCode),
    }));
  }

  /**
   * 下載 CSV 範本，含欄位標題與一列示範資料，UTF-8 BOM 讓 Excel 開啟時中文不亂碼。
   * 自訂屬性欄位接在固定欄位後面，示範列留空（各品類適用的題目不同，填了反而誤導）。
   */
  downloadTemplate(): void {
    const columns = [...COLUMNS, ...this.customFieldTemplateColumns()];
    const headerLine = columns.map((c) => this.csvEscape(c.header)).join(',');
    const sampleLine = columns.map((c) => this.csvEscape(SAMPLE_ROW[c.key] ?? '')).join(',');
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
    if (!this.lookupsReady()) {
      this.parseErrorMessage.set('商品分類與自訂屬性清單尚未載入完成，請稍候片刻再重新選擇檔案。');
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

  /**
   * 固定欄位依「標題文字完全相符」比對；自訂屬性欄位依「前綴＋題目名稱」比對（見
   * matchCustomFieldHeader）。找不到就視為該欄位缺席（用 defval 的空字串填補）。
   * 自訂屬性一律不是檔案層級的必要欄位——是否必填要看每一列的品類，由後端判斷。
   */
  private matchHeaders(actualHeaders: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const column of COLUMNS) {
      if (actualHeaders.includes(column.header)) {
        result.set(column.key, column.header);
      }
    }
    const labels = customFieldLabels(this.customFieldColumns());
    const codeByLabel = new Map([...labels].map(([code, label]) => [label, code]));
    for (const header of actualHeaders) {
      const code = matchCustomFieldHeader(header, codeByLabel);
      if (code && !result.has(customFieldRawKey(code))) result.set(customFieldRawKey(code), header);
    }
    return result;
  }

  private buildRow(rowNumber: number, get: (key: string) => string, availableImages: Set<string>): BatchRow {
    const blockingErrors: string[] = [];
    const warnings: string[] = [];
    const raw: Record<string, string> = {};
    for (const column of COLUMNS) raw[column.key] = get(column.key);
    for (const field of this.customFieldColumns()) {
      raw[customFieldRawKey(field.fieldCode)] = get(customFieldRawKey(field.fieldCode));
    }

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

    const customFieldValues =
      productTypeId === null ? {} : this.buildCustomFieldValues(productTypeId, get, blockingErrors, warnings);

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

    if (Object.keys(customFieldValues).length > 0) {
      payload.customFieldValues = customFieldValues;
    }

    return { rowNumber, name, raw, payload, imageFileName, blockingErrors, warnings };
  }

  /**
   * 依這一列的品類（小類 → 大類）挑出適用的自訂屬性值。
   * - 適用且有填：轉成送出格式；數值型轉不成數字時擋下整列（不送 NaN／字串給後端）。
   * - 不適用卻有填：只提示「已忽略」，不擋匯入。
   * - 必填未填：不在這裡判斷，交給後端 CUSTOM_FIELD_REQUIRED_MISSING，錯誤回顯在該列結果。
   */
  private buildCustomFieldValues(
    productTypeId: number,
    get: (key: string) => string,
    blockingErrors: string[],
    warnings: string[],
  ): Record<string, unknown> {
    const rootTypeId = this.rootTypeIdByMinorId.get(productTypeId) ?? null;
    const values: Record<string, unknown> = {};
    for (const field of this.customFieldColumns()) {
      const raw = get(customFieldRawKey(field.fieldCode));
      if (!raw) continue;
      const scope = field.applicableRootProductTypeIds;
      const applicable = scope.length === 0 || (rootTypeId !== null && scope.includes(rootTypeId));
      if (!applicable) {
        warnings.push(`自訂屬性「${field.fieldName}」不適用於此商品品類，已忽略`);
        continue;
      }
      const value = parseCustomFieldValue(field, raw);
      if (value === null) {
        blockingErrors.push(`自訂屬性「${field.fieldName}」必須是數字（目前為「${raw}」）`);
        continue;
      }
      values[field.fieldCode] = value;
    }
    return values;
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

    // 自訂屬性欄位也要帶上，修正後重新匯入才不會遺失原本填的答案。
    const columns = [...COLUMNS, ...this.customFieldTemplateColumns()];
    const headerLine = ['原始列號', '商品名稱', '失敗原因', ...columns.map((c) => c.header)]
      .map((h) => this.csvEscape(h))
      .join(',');
    const lines = failedRows.map((row) => {
      const reason =
        row.payload === null ? row.blockingErrors.join('；') : (row.result?.errorMessage ?? '');
      const cells = [String(row.rowNumber), row.name, reason, ...columns.map((c) => row.raw[c.key] ?? '')];
      return cells.map((v) => this.csvEscape(v)).join(',');
    });
    const csvContent = '\uFEFF' + headerLine + '\r\n' + lines.join('\r\n') + '\r\n';
    this.triggerDownload(csvContent, '批次新增選品_失敗清單.csv');
  }
}
