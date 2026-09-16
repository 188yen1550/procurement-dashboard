/**
 * 檔案用途：歷史開團紀錄頁面——唯讀查詢（操作+管理）、CSV 匯入與整批回退
 * （僅管理）。這個模組先前只有 API 合約與 Service，完全沒有頁面，是「歷史
 * 銷售紀錄沒有實質作用」這個問題的直接成因，這支檔案補上缺的那一半。
 *
 * 職責邊界（對照後端 GroupBuyRecordController 的既有限制）：沒有單筆
 * CRUD，只有「整批匯入」「整批回退」兩種寫入路徑——不要因為使用者想改
 * 一筆資料就在這裡加編輯功能，那不是這個系統的職責範圍。
 */
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { AuthService } from '../../core/auth/auth';
import { DialogService } from '../../core/dialog/dialog.service';
import { createDismissibleMessage } from '../../core/ui/auto-dismiss';
import { toApiError } from '../../core/api/api-error';
import { ProductTypeLookupService } from '../settings/api/product-type-lookup.service';
import { GroupBuyApiService } from './api/group-buy-api.service';
import {
  GROUP_BUY_CSV_KNOWN_HEADERS,
  GROUP_BUY_RESULT_LABEL,
  GroupBuyRecordResponsePayload,
  GroupBuyResultCode,
} from './api/group-buy-api.contract';

type PageState = 'default' | 'loading' | 'error';

interface GroupBuyRecordVM extends GroupBuyRecordResponsePayload {
  productTypeName: string;
}

interface ProductTypeFilterOption {
  id: number;
  name: string;
}

interface ProductTypeFilterGroup {
  majorName: string;
  minors: ProductTypeFilterOption[];
}

@Component({
  selector: 'app-group-buy',
  imports: [FormsModule],
  templateUrl: './group-buy.html',
  styleUrl: './group-buy.scss',
})
export class GroupBuy implements OnInit {
  private readonly api = inject(GroupBuyApiService);
  private readonly productTypeLookup = inject(ProductTypeLookupService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  /** 匯入／整批回退僅管理層可操作；操作層看得到清單但看不到這兩顆按鈕。 */
  readonly isManager = computed(() => this.auth.isManager());

  readonly pageState = signal<PageState>('default');
  readonly records = signal<GroupBuyRecordVM[]>([]);
  private readonly statusMessageState = createDismissibleMessage();
  readonly statusMessage = this.statusMessageState.signal;

  // ----- 篩選 -----
  // ⚠️ 原本這裡是兩個要求使用者自己輸入數字 ID 的欄位（品類 ID、商品 ID）
  // ——一般使用者不會知道「生鮮食品」在資料庫裡是編號幾號，形同要求他們
  // 先另外查過才能用這個篩選功能。這次改成品類名稱下拉選單；「商品 ID」
  // 篩選直接移除，沒有好的名稱式替代方案（要嘛做一個商品名稱搜尋框，
  // 但這個頁面拿不到「商品名稱」與「開團紀錄裡的商品」之間乾淨的對照
  // 關係，勉強做只會做出另一個容易選錯的介面）。後端 API 本身仍支援
  // productId 篩選（見 GroupBuyApiService.list()），保留給未來可能的
  // 「從商品詳情頁連結過來，帶著 productId 查詢參數」這種情境使用。
  //
  // ⚠️ 商品類型與供應商都改成「一次抓全部、前端即時篩選」，不再對後端送
  // productTypeId 查詢參數：後端 list() 完全沒有供應商篩選的參數，
  // supplierName 只是紀錄上的自由文字欄位，本來就只能前端比對；商品類型
  // 篩選如果繼續留在後端查、供應商留在前端比對，會變成「兩個下拉、兩套
  // 篩選時機」的不一致體驗，選了以後還要另外按「套用」才生效。乾脆兩個
  // 都用前端 computed 即時篩選，選了就直接看到結果。
  readonly filterProductTypeId = signal<number | null>(null);
  readonly filterSupplierName = signal<string | null>(null);
  readonly productTypeFilterGroups = signal<readonly ProductTypeFilterGroup[]>([]);

  /** 供應商下拉選項——沒有獨立的供應商主檔，只能從目前已載入的紀錄裡去重取得。 */
  readonly supplierOptions = computed(() => {
    const names = new Set<string>();
    for (const r of this.records()) {
      if (r.supplierName) names.add(r.supplierName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  });

  readonly filteredRecords = computed(() => {
    const typeId = this.filterProductTypeId();
    const supplier = this.filterSupplierName();
    return this.records().filter(
      (r) =>
        (typeId === null || r.productTypeId === typeId) &&
        (supplier === null || r.supplierName === supplier),
    );
  });

  setFilterProductTypeId(value: number | null): void {
    this.filterProductTypeId.set(value);
  }

  setFilterSupplierName(value: string | null): void {
    this.filterSupplierName.set(value);
  }

  clearFilters(): void {
    this.filterProductTypeId.set(null);
    this.filterSupplierName.set(null);
  }

  // ----- 統計（成團率，分母僅計 FULFILLED+FAILED，對齊後端計分邏輯） -----
  // 統計數字反映「目前篩選後看到的資料」，跟表格內容一致——換一個供應商
  // 或商品類型，上面的成團率也要跟著變，不然使用者會分不清楚統計是算全部
  // 還是算篩選後的範圍。
  readonly effectiveCount = computed(
    () => this.filteredRecords().filter((r) => r.result === 'FULFILLED' || r.result === 'FAILED').length,
  );
  readonly fulfilledCount = computed(
    () => this.filteredRecords().filter((r) => r.result === 'FULFILLED').length,
  );
  readonly fulfillmentRate = computed(() => {
    const eff = this.effectiveCount();
    return eff === 0 ? null : Math.round((this.fulfilledCount() / eff) * 1000) / 10;
  });
  readonly resultLabel = GROUP_BUY_RESULT_LABEL;

  resultBadgeClass(result: GroupBuyResultCode): string {
    if (result === 'FULFILLED') return 'badge-success';
    if (result === 'FAILED') return 'badge-error';
    return 'badge-muted';
  }

  ngOnInit(): void {
    this.loadProductTypeFilterOptions();
    this.load();
  }

  private loadProductTypeFilterOptions(): void {
    this.productTypeLookup
      .getGroupedOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          this.productTypeFilterGroups.set(
            groups
              .filter((g) => g.minors.length > 0)
              .map((g) => ({
                majorName: g.major.name,
                minors: g.minors.map((m) => ({ id: m.id, name: m.name })),
              })),
          );
        },
        // 篩選選單載入失敗不影響清單本身，下拉維持空白，使用者仍能看到未篩選的全部紀錄。
        error: () => this.productTypeFilterGroups.set([]),
      });
  }

  private load(): void {
    this.pageState.set('loading');
    this.productTypeLookup
      .getNameMap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((nameById) => {
        this.api
          .list()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (list) => {
              this.records.set(
                list.map((r) => ({
                  ...r,
                  productTypeName:
                    r.productTypeId !== null
                      ? (nameById.get(r.productTypeId) ?? `#${r.productTypeId}`)
                      : '—',
                })),
              );
              this.pageState.set('default');
            },
            error: (err) => {
              this.pageState.set('error');
              this.statusMessageState.show(toApiError(err).message);
            },
          });
      });
  }

  // ----- CSV 匯入 -----
  readonly csvRequiredHeaders = GROUP_BUY_CSV_KNOWN_HEADERS;
  readonly isImportDialogOpen = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly isImporting = signal(false);
  readonly importResult = signal<{
    success: boolean;
    totalRows: number;
    importedRows: number;
    errors: { rowNumber: number; field: string; message: string }[];
  } | null>(null);

  openImportDialog(): void {
    this.selectedFile.set(null);
    this.importResult.set(null);
    this.isImportDialogOpen.set(true);
  }

  closeImportDialog(): void {
    if (this.isImporting()) return;
    this.isImportDialogOpen.set(false);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  /**
   * 送出匯入。⚠️ HTTP 200 不代表成功，要看 body 的 success 欄位——這是
   * 後端刻意的設計（失敗結果本身就是使用者要看的資料，不該用 400 蓋掉），
   * 所以這裡不管 success 是 true 或 false 都停在 next callback 裡處理，
   * 只有真正的請求層錯誤（沒選檔案、檔案讀不到）才會進 error callback。
   */
  submitImport(): void {
    const file = this.selectedFile();
    if (!file || this.isImporting()) return;

    this.isImporting.set(true);
    this.api
      .importCsv(file)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          this.isImporting.set(false);
          this.statusMessageState.show(toApiError(err).message);
          return of(null);
        }),
      )
      .subscribe((result) => {
        this.isImporting.set(false);
        if (!result) return;
        this.importResult.set(result);
        if (result.success) {
          this.statusMessageState.show(`匯入成功，共 ${result.importedRows} 筆。`);
          this.load();
        }
        // 失敗時保留對話框開啟，讓使用者看得到逐列錯誤訊息，不自動關閉。
      });
  }

  // ----- 整批回退 -----
  readonly isDeletingBatch = signal(false);
  /** 上方「整批退回」下拉選單目前選到的批次；改用獨立區塊取代逐列重複按鈕，
   *  同一個批次不管有幾筆資料，選單裡都只會出現一次。 */
  readonly selectedBatchId = signal<string | null>(null);

  setSelectedBatchId(value: string | null): void {
    this.selectedBatchId.set(value);
  }

  retractSelectedBatch(): void {
    const batchId = this.selectedBatchId();
    if (!batchId) return;
    this.confirmDeleteBatch(batchId);
  }

  /**
   * 整批回退是不可復原的破壞性操作，且影響範圍可能是上百筆——確認訊息
   * 裡明確寫出這個批次目前有幾筆資料，不是只顯示一個 batchId 讓使用者
   * 自己猜範圍多大。
   */
  confirmDeleteBatch(batchId: string): void {
    if (this.isDeletingBatch()) return;
    const count = this.records().filter((r) => r.importBatchId === batchId).length;

    this.dialog
      .confirm(
        '整批回退確認',
        [
          `即將刪除批次「${batchId}」，共 ${count} 筆歷史開團紀錄。`,
          '此操作無法復原，刪除後這批資料在系統內將完全消失。',
        ],
        '確定刪除',
        '取消',
      )
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.isDeletingBatch.set(true);
        this.api
          .deleteBatch(batchId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isDeletingBatch.set(false);
              this.statusMessageState.show(`已回退批次「${batchId}」，共 ${count} 筆。`);
              if (this.selectedBatchId() === batchId) {
                this.selectedBatchId.set(null);
              }
              this.load();
            },
            error: (err) => {
              this.isDeletingBatch.set(false);
              this.statusMessageState.show(toApiError(err).message);
            },
          });
      });
  }

  /** 目前清單裡出現過的匯入批次，供「整批回退」下拉選單使用。 */
  readonly availableBatches = computed(() => {
    const seen = new Map<string, number>();
    for (const r of this.records()) {
      if (!r.importBatchId) continue;
      seen.set(r.importBatchId, (seen.get(r.importBatchId) ?? 0) + 1);
    }
    return Array.from(seen.entries()).map(([batchId, count]) => ({ batchId, count }));
  });
}
