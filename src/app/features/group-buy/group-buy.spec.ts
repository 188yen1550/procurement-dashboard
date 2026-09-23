/**
 * 檔案用途：驗證歷史開團紀錄頁（2026-09-23 分支整併後）的彙總圖表資料、
 * 已移除整批回退，以及匯入前的確認防呆。API 與品類對照全部以假服務取代，
 * 不發出真實 HTTP 請求。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../core/dialog/dialog.service';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';
import { GroupBuyApiService } from './api/group-buy-api.service';
import { GroupBuyRecordResponsePayload, GroupBuyResultCode } from './api/group-buy-api.contract';
import { GroupBuy } from './group-buy';

function record(id: number, productTypeId: number, result: GroupBuyResultCode): GroupBuyRecordResponsePayload {
  return {
    id,
    productId: null,
    productTypeId,
    externalProductName: `商品${id}`,
    supplierName: '甲供應商',
    campaignStartDate: null,
    campaignEndDate: null,
    moqAtTime: null,
    salePriceAtTime: null,
    costPriceAtTime: null,
    marketPriceAtTime: null,
    targetQuantity: null,
    actualQuantity: null,
    participantCount: null,
    result,
    complaintCount: null,
    returnCount: null,
    isSimulated: false,
    importBatchId: 'B1',
    importedAt: null,
  };
}

describe('GroupBuy', () => {
  let fixture: ComponentFixture<GroupBuy>;
  let component: GroupBuy;
  let api: { list: ReturnType<typeof vi.fn>; importCsv: ReturnType<typeof vi.fn> };
  let dialog: DialogService;

  beforeEach(async () => {
    api = {
      list: vi.fn().mockReturnValue(
        of([
          record(1, 10, 'FULFILLED'),
          record(2, 10, 'FAILED'),
          record(3, 10, 'CANCELLED'),
          record(4, 20, 'FULFILLED'),
        ]),
      ),
      importCsv: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [GroupBuy],
      providers: [
        { provide: GroupBuyApiService, useValue: api },
        {
          provide: ProductTypeLookupService,
          useValue: {
            getGroupedOptions: () => of([]),
            getNameMap: () => of(new Map([[10, '生鮮'], [20, '日用品']])),
          },
        },
      ],
    }).compileComponents();
    dialog = TestBed.inject(DialogService);
    fixture = TestBed.createComponent(GroupBuy);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('computes chart data with the same denominator as the stat cards (cancelled excluded)', () => {
    expect(component.resultDistribution()).toEqual({ FULFILLED: 2, FAILED: 1, CANCELLED: 1 });
    expect(component.fulfillmentByProductType()).toEqual([
      { name: '日用品', rate: 100, effective: 1 },
      { name: '生鮮', rate: 50, effective: 2 },
    ]);
  });

  it('replaces the record table with charts and no longer offers batch rollback', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.chart-panel')).toHaveLength(2);
    expect(root.textContent).not.toContain('整批退回');
    expect(root.textContent).not.toContain('回退此批次');
  });

  it('asks for confirmation before importing and does nothing when cancelled', () => {
    const confirm = vi.spyOn(dialog, 'confirm').mockReturnValue(of(false));
    component.selectedFile.set(new File(['a'], 'records.csv', { type: 'text/csv' }));
    component.submitImport();
    expect(confirm).toHaveBeenCalled();
    expect(api.importCsv).not.toHaveBeenCalled();
  });

  it('imports after confirmation', () => {
    vi.spyOn(dialog, 'confirm').mockReturnValue(of(true));
    api.importCsv.mockReturnValue(of({ success: true, importBatchId: 'B2', totalRows: 1, importedRows: 1, errors: [] }));
    component.selectedFile.set(new File(['a'], 'records.csv', { type: 'text/csv' }));
    component.submitImport();
    expect(api.importCsv).toHaveBeenCalled();
  });
});
