/**
 * 檔案用途：歷史開團紀錄頁面——唯讀查詢（操作+管理）、CSV 匯入（僅管理）。
 * 這個模組先前只有 API 合約與 Service，完全沒有頁面，是「歷史
 * 銷售紀錄沒有實質作用」這個問題的直接成因，這支檔案補上缺的那一半。
 *
 * 職責邊界（對照後端 GroupBuyRecordController 的既有限制）：沒有單筆
 * CRUD，只有「整批匯入」這一種寫入路徑——不要因為使用者想改
 * 一筆資料就在這裡加編輯功能，那不是這個系統的職責範圍。
 *
 * 2026-09-23 分支整併（procurement-dashboard-updated，依決策 A 採分支做法）：
 * - 移除「整批回退」。這個頁面的資料是「歷史成團率」計分因子的唯一來源，
 *   回退功能讓管理層可以憑一時判斷把整批已經影響過評分的歷史資料刪除、
 *   且無法復原——對選品決策而言，這比「多一筆錯誤資料」更危險（錯誤資料
 *   至少可追查，刪除後連錯在哪都無法回溯）。只拿掉畫面按鈕不構成實際
 *   管控，所以後端 DELETE /api/group-buy-records/batch/{batchId} 端點也
 *   一併移除（見 GroupBuyRecordController）。
 * - 逐筆表格改為兩張彙總圖（各商品類型成團率、結果分布）：逐筆表格只回答
 *   「發生過什麼」，圖表回答「哪些商品類型歷史上比較容易成團」這種可以
 *   直接拿來比較、輔助選品判斷的問題。
 * - 匯入是這個頁面僅存、且無法透過畫面復原的寫入動作，送出前加一道確認。
 */
import { ListSort, SortHeader, SortRowsPipe } from '../../shared/ui/list-sort';
import {
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  afterRenderEffect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import Chart from 'chart.js/auto';
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
  imports: [SortHeader, SortRowsPipe, FormsModule],
  templateUrl: './group-buy.html',
  styleUrl: './group-buy.scss',
})
export class GroupBuy implements OnInit, OnDestroy {
  readonly errorSort = new ListSort();
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

  // ----- 彙總圖表（2026-09-23 分支整併，取代原本的逐筆表格） -----
  // 兩張圖都吃 filteredRecords()，跟上方統計卡口徑一致，篩選後即時重算。
  readonly resultDistribution = computed(() => {
    const counts: Record<GroupBuyResultCode, number> = { FULFILLED: 0, FAILED: 0, CANCELLED: 0 };
    for (const r of this.filteredRecords()) counts[r.result]++;
    return counts;
  });

  /** 各商品類型成團率（前 10 名）——分母跟上方統計卡一致，只計成團＋未成團，不含取消開團。 */
  readonly fulfillmentByProductType = computed(() => {
    const stats = new Map<string, { fulfilled: number; effective: number }>();
    for (const r of this.filteredRecords()) {
      if (r.result !== 'FULFILLED' && r.result !== 'FAILED') continue;
      const entry = stats.get(r.productTypeName) ?? { fulfilled: 0, effective: 0 };
      entry.effective++;
      if (r.result === 'FULFILLED') entry.fulfilled++;
      stats.set(r.productTypeName, entry);
    }
    return Array.from(stats.entries())
      .map(([name, { fulfilled, effective }]) => ({
        name,
        rate: Math.round((fulfilled / effective) * 1000) / 10,
        effective,
      }))
      .sort((a, b) => b.rate - a.rate || b.effective - a.effective)
      .slice(0, 10);
  });

  // ----- 毛利率彙總（僅管理層，2026-09 職責分層） -----
  // 後端只對 MANAGER 回傳 marginRate，PURCHASER 拿到的都是 null，這裡再用 isManager()
  // 擋一次只是避免畫面出現「全部都是 —」的空卡片，不是權限邊界。
  // 先用前端手上資料計算、不新增後端聚合端點（list() 沒有分頁，回傳的就是完整篩選結果）。
  // 模擬資料（isSimulated）不納入平均，另外列出筆數：管理層不該把模擬數字當真實績效判讀。
  readonly marginSummary = computed(() => {
    const real = this.filteredRecords().filter((r) => r.isSimulated !== true);
    return {
      overall: averageMarginRate(real),
      fulfilled: averageMarginRate(real.filter((r) => r.result === 'FULFILLED')),
      failed: averageMarginRate(real.filter((r) => r.result === 'FAILED')),
      simulatedCount: this.filteredRecords().length - real.length,
    };
  });

  @ViewChild('resultChartCanvas') private readonly resultChartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('typeRateChartCanvas') private readonly typeRateChartCanvas?: ElementRef<HTMLCanvasElement>;
  private resultChart: Chart | null = null;
  private typeRateChart: Chart | null = null;

  // 用 afterRenderEffect 的理由跟 dashboard.ts 的狀態分布圖相同：canvas 要等
  // 畫面真的渲染完成才存在，篩選條件改變也要能重新觸發。
  // ⚠️ 圖表區塊在「沒有符合條件的紀錄」時整個不渲染，再切回來時 canvas 是
  // 一個新的 DOM 元素——舊的 Chart 實例還綁在已經被移除的 canvas 上，直接
  // update() 畫面不會有任何反應，所以 canvas 換了就先 destroy 再重建
  // （比照 dashboard.ts 的同一個修正）。
  private readonly renderChartsEffect = afterRenderEffect(() => {
    const distribution = this.resultDistribution();
    const byType = this.fulfillmentByProductType();

    const resultCanvas = this.resultChartCanvas?.nativeElement ?? null;
    if (this.resultChart && this.resultChart.canvas !== resultCanvas) {
      this.resultChart.destroy();
      this.resultChart = null;
    }
    if (resultCanvas) {
      const data = {
        labels: [this.resultLabel.FULFILLED, this.resultLabel.FAILED, this.resultLabel.CANCELLED],
        datasets: [
          {
            data: [distribution.FULFILLED, distribution.FAILED, distribution.CANCELLED],
            backgroundColor: ['#379773', '#c76661', '#9aa4af'],
            borderWidth: 0,
          },
        ],
      };
      if (this.resultChart) {
        this.resultChart.data = data;
        this.resultChart.update();
      } else {
        this.resultChart = new Chart(resultCanvas, {
          type: 'doughnut',
          data,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
          },
        });
      }
    }

    const typeCanvas = this.typeRateChartCanvas?.nativeElement ?? null;
    if (this.typeRateChart && this.typeRateChart.canvas !== typeCanvas) {
      this.typeRateChart.destroy();
      this.typeRateChart = null;
    }
    if (typeCanvas) {
      const data = {
        labels: byType.map((t) => t.name),
        datasets: [
          {
            label: '成團率 (%)',
            data: byType.map((t) => t.rate),
            backgroundColor: '#1c5286',
            borderRadius: 4,
          },
        ],
      };
      if (this.typeRateChart) {
        this.typeRateChart.data = data;
        this.typeRateChart.update();
      } else {
        this.typeRateChart = new Chart(typeCanvas, {
          type: 'bar',
          data,
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { min: 0, max: 100, ticks: { callback: (value) => `${value}%` } } },
            plugins: {
              legend: { display: false },
              tooltip: {
                // 一併顯示樣本數：100% 是「1 次中 1 次」還是「20 次中 20 次」，可信度差很多。
                callbacks: {
                  label: (ctx) => `成團率 ${ctx.parsed.x}%（有效樣本 ${byType[ctx.dataIndex]?.effective ?? 0} 筆）`,
                },
              },
            },
          },
        });
      }
    }
  });

  ngOnDestroy(): void {
    this.resultChart?.destroy();
    this.typeRateChart?.destroy();
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
   * 送出匯入前的確認（2026-09-23 分支整併）。整批回退已移除（見檔案開頭
   * 說明），匯入的資料會直接成為「歷史成團率」計分因子的來源、且無法透過
   * 畫面復原，先讓使用者核對檔名，避免手滑選錯檔案就寫入正式資料；取消
   * 則不送出，可以重新選檔。
   */
  submitImport(): void {
    const file = this.selectedFile();
    if (!file || this.isImporting()) return;

    this.dialog
      .confirm(
        '確認匯入歷史開團紀錄',
        [
          `即將匯入檔案「${file.name}」。`,
          '匯入後會立即影響「歷史成團率」評分，且畫面上沒有整批回退功能，請先確認檔案內容無誤。',
        ],
        '確定匯入',
        '再檢查一次',
      )
      .subscribe((confirmed) => {
        if (confirmed) this.proceedImport(file);
      });
  }

  /**
   * ⚠️ HTTP 200 不代表成功，要看 body 的 success 欄位——這是後端刻意的
   * 設計（失敗結果本身就是使用者要看的資料，不該用 400 蓋掉），所以這裡
   * 不管 success 是 true 或 false 都停在 next callback 裡處理，只有真正
   * 的請求層錯誤（沒選檔案、檔案讀不到）才會進 error callback。
   */
  private proceedImport(file: File): void {
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

}

/** 毛利率彙總的單一口徑：只計入 marginRate 有值的紀錄，回傳每筆等權的平均與樣本數。 */
interface MarginRateAverage {
  /** 平均毛利率（%，小數一位）；沒有可計算的紀錄時為 null（顯示「—」，不是 0%）。 */
  average: number | null;
  sampleCount: number;
}

function averageMarginRate(records: readonly GroupBuyRecordVM[]): MarginRateAverage {
  const rates = records.map((r) => r.marginRate).filter((rate): rate is number => rate !== null);
  if (rates.length === 0) return { average: null, sampleCount: 0 };
  const sum = rates.reduce((total, rate) => total + rate, 0);
  return { average: Math.round((sum / rates.length) * 10) / 10, sampleCount: rates.length };
}
