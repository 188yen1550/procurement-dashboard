/**
 * 檔案用途：驗證批次新增選品的「自訂商品屬性」欄位（2026-09-24，Bug A）。
 * 重點：範本表頭＝生效中題目聯集並註明適用品類；解析時依每列品類只送適用的欄位值；
 * 不適用的值只提示不擋送出；數值轉不成數字才擋下；必填交給後端；失敗清單保留自訂屬性原值。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CustomFieldDefinitionResponsePayload, ProductTypeResponsePayload } from '../../settings/api/settings-api.contract';
import { ProductTypeLookupService } from '../../settings/api/product-type-lookup.service';
import { ProductApiService } from '../api/product-api.service';
import { ProductCreateRequestPayload } from '../api/product-api.contract';
import {
  BatchImport,
  customFieldHeader,
  customFieldLabels,
  matchCustomFieldHeader,
  parseCustomFieldValue,
} from './batch-import';

function field(overrides: Partial<CustomFieldDefinitionResponsePayload>): CustomFieldDefinitionResponsePayload {
  return {
    id: 1,
    fieldCode: 'ORIGIN',
    fieldName: '產地',
    helpText: null,
    fieldType: 'TEXT',
    isRequired: false,
    isActive: true,
    applicableRootProductTypeIds: [],
    scaleLabels: null,
    previousVersionId: null,
    isSuperseded: false,
    ...overrides,
  };
}

function type(id: number, name: string, parentId: number | null): ProductTypeResponsePayload {
  return {
    id,
    name,
    description: null,
    isSystemDefault: false,
    isActive: true,
    parentId,
    level: parentId === null ? 1 : 2,
  } as ProductTypeResponsePayload;
}

const FIELDS = [
  field({ id: 1, fieldCode: 'ORIGIN', fieldName: '產地', isRequired: true, applicableRootProductTypeIds: [1] }),
  field({ id: 2, fieldCode: 'FRESHNESS', fieldName: '新鮮度', fieldType: 'SCALE_1_5', scaleLabels: { '5': '極佳' } }),
  field({ id: 3, fieldCode: 'NET_WEIGHT', fieldName: '淨重', fieldType: 'RAW_NUMBER', applicableRootProductTypeIds: [2] }),
];

const GROUPS = [
  { major: type(1, '食品', null), minors: [type(11, '生鮮', 1)] },
  { major: type(2, '日用品', null), minors: [type(21, '清潔用品', 2)] },
];

const REQUIRED_HEADERS = ['商品名稱', '商品分類（可填名稱或數字ID）', '訂價類型（新品／再販售）', '目標客群描述'];

/** 與實際範本相同帶 UTF-8 BOM；沒有 BOM 時 xlsx 會把 CSV 當成非 UTF-8 解碼，中文表頭對不上。 */
function csv(rows: string[][]): ArrayBuffer {
  const text = '\uFEFF' + rows.map((cells) => cells.join(',')).join('\r\n');
  // TextEncoder 在測試環境（jsdom）回傳的是另一個 realm 的 Uint8Array，xlsx 的 instanceof
  // 判斷會失敗而改走字串解碼；複製進本 realm 的 Uint8Array，行為才與瀏覽器 File.arrayBuffer() 一致。
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return bytes.buffer;
}

interface BatchImportInternals {
  parseWorkbook(buffer: ArrayBuffer): Promise<void>;
  triggerDownload(content: string, filename: string): void;
}

describe('BatchImport custom fields', () => {
  let fixture: ComponentFixture<BatchImport>;
  let component: BatchImport;
  let internals: BatchImportInternals;

  const productApi = {
    getAllActiveCustomFieldSchema: vi.fn(() => of(FIELDS)),
    createBatch: vi.fn(),
  };
  const lookup = { getGroupedOptions: vi.fn(() => of(GROUPS)) };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [BatchImport],
      providers: [
        provideRouter([]),
        { provide: ProductApiService, useValue: productApi },
        { provide: ProductTypeLookupService, useValue: lookup },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BatchImport);
    component = fixture.componentInstance;
    internals = component as unknown as BatchImportInternals;
    fixture.detectChanges();
  });

  const header = (code: string): string => {
    const labels = customFieldLabels(FIELDS);
    const target = FIELDS.find((f) => f.fieldCode === code)!;
    return customFieldHeader(target, labels.get(code)!, new Map([[1, '食品'], [2, '日用品']]));
  };

  it('loads the active custom field union and waits for both lookups', () => {
    expect(productApi.getAllActiveCustomFieldSchema).toHaveBeenCalledTimes(1);
    expect(component.lookupsReady()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('標示「自訂屬性：」開頭的 3 個欄位');
  });

  it('writes the union of custom fields into the template header with scope and required notes', () => {
    const spy = vi.spyOn(internals, 'triggerDownload').mockImplementation(() => undefined);
    component.downloadTemplate();
    const content = spy.mock.calls[0][0] as string;
    const headerLine = content.split('\r\n')[0];
    expect(headerLine).toContain('自訂屬性：產地（適用：食品，必填）');
    expect(headerLine).toContain('自訂屬性：新鮮度（適用：全品類）');
    expect(headerLine).toContain('自訂屬性：淨重（適用：日用品）');
  });

  it('sends only the custom fields that apply to each row and warns about the rest', async () => {
    await internals.parseWorkbook(
      csv([
        [...REQUIRED_HEADERS, header('ORIGIN'), header('FRESHNESS'), header('NET_WEIGHT')],
        ['雞胸肉', '生鮮', '新品', '上班族', '台灣', '極佳', '3'],
        ['洗衣紙', '清潔用品', '新品', '小家庭', '', '4', 'abc'],
        ['鮭魚', '生鮮', '新品', '上班族', '', '', ''],
      ]),
    );
    const [fresh, cleaning, noAnswers] = component.rows();

    expect(fresh.payload?.customFieldValues).toEqual({ ORIGIN: '台灣', FRESHNESS: 5 });
    expect(fresh.warnings).toContain('自訂屬性「淨重」不適用於此商品品類，已忽略');

    // 適用欄位的數值轉不成數字：擋下整列，不送 NaN 給後端
    expect(cleaning.payload).toBeNull();
    expect(cleaning.blockingErrors).toContain('自訂屬性「淨重」必須是數字（目前為「abc」）');

    // 必填未填：前端不擋，交給後端 CUSTOM_FIELD_REQUIRED_MISSING 回顯在該列
    expect(noAnswers.payload).not.toBeNull();
    expect((noAnswers.payload as ProductCreateRequestPayload).customFieldValues).toBeUndefined();
  });

  it('matches older template headers whose scope note has changed', async () => {
    await internals.parseWorkbook(
      csv([
        [...REQUIRED_HEADERS, '自訂屬性：產地（適用：舊的品類名稱）'],
        ['雞胸肉', '生鮮', '新品', '上班族', '日本'],
      ]),
    );
    expect(component.rows()[0].payload?.customFieldValues).toEqual({ ORIGIN: '日本' });
  });

  it('keeps custom field answers in the failed-rows download for re-import', async () => {
    await internals.parseWorkbook(
      csv([
        [...REQUIRED_HEADERS, header('NET_WEIGHT')],
        ['洗衣紙', '清潔用品', '新品', '小家庭', 'abc'],
      ]),
    );
    const spy = vi.spyOn(internals, 'triggerDownload').mockImplementation(() => undefined);
    component.downloadFailedRows();
    const [headerLine, dataLine] = (spy.mock.calls[0][0] as string).replace('\uFEFF', '').split('\r\n');
    expect(headerLine.endsWith(header('NET_WEIGHT'))).toBe(true);
    expect(dataLine.endsWith('abc')).toBe(true);
  });
});

describe('custom field helpers', () => {
  it('disambiguates duplicated field names with the field code', () => {
    const labels = customFieldLabels([
      field({ fieldCode: 'A', fieldName: '等級' }),
      field({ fieldCode: 'B', fieldName: '等級' }),
    ]);
    expect(labels.get('A')).toBe('等級［A］');
    expect(labels.get('B')).toBe('等級［B］');
  });

  it('prefers the longest matching label', () => {
    const codeByLabel = new Map([
      ['產地', 'ORIGIN'],
      ['產地證明', 'ORIGIN_CERT'],
    ]);
    expect(matchCustomFieldHeader('自訂屬性：產地證明（適用：全品類）', codeByLabel)).toBe('ORIGIN_CERT');
    expect(matchCustomFieldHeader('自訂屬性：產地', codeByLabel)).toBe('ORIGIN');
    expect(matchCustomFieldHeader('產地', codeByLabel)).toBeNull();
  });

  it('parses numbers and scale labels, rejecting non-numeric input', () => {
    const scale = field({ fieldType: 'SCALE_1_5', scaleLabels: { '1': '很差', '5': '極佳' } });
    expect(parseCustomFieldValue(scale, '極佳')).toBe(5);
    expect(parseCustomFieldValue(scale, '1 - 很差')).toBe(1);
    expect(parseCustomFieldValue(scale, '3')).toBe(3);
    expect(parseCustomFieldValue(field({ fieldType: 'PERCENT_0_1' }), '0.75')).toBe(0.75);
    expect(parseCustomFieldValue(field({ fieldType: 'RAW_NUMBER' }), '十')).toBeNull();
    expect(parseCustomFieldValue(field({ fieldType: 'TEXT' }), '台灣')).toBe('台灣');
  });
});
