/**
 * 檔案用途：AI 商品雷達清單（操作層，2026-09-29 第一階段）。
 *
 * 系統每天 01:30 掃 PTT 7 個看板近 7 天的文章標題，由 AI（2026-09-29 起改用 Groq）抽出具體商品、Java 驗證名稱
 * 確實出現在引用的標題裡，再排除系統已有的商品。這頁讓操作人員逐筆決定：
 * - 建立商品：帶著名稱與品類前往新增品項表單，送出時一併帶 discoveredItemId，
 *   後端在同一個交易裡把這筆標成「已建立商品」（見 DiscoveryApiService 檔頭說明）。
 * - 略過：之後再被 PTT 提及也不會重新冒出來；略過錯了可以在「已略過」分頁移回。
 *
 * 探索結果只是「值得看一眼的線索」，不是商品，也不會自動進入評分或審核（Human-in-the-loop）。
 *
 * 第二階段：
 * - 每張卡片並列 AI 適配分（附理由與疑慮）、溫層判定（規則）、PTT 熱度、Google 趨勢，
 *   刻意不合成一個總分；清單預設依適配度排序，可切換成熱度或最近出現。
 * - 略過改成在卡片內選原因（不再跳確認視窗），原因會回饋到下一次探索。
 */
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { toApiError } from '../../../core/api/api-error';
import { APP_CONFIG } from '../../../core/config/app-config';
import { DialogService } from '../../../core/dialog/dialog.service';
import { GATE_STATUS_LABEL, TEMPERATURE_ZONE_LABEL } from '../../../core/domain/labels';
import { reloadOnRevisit } from '../../../core/router/reload-on-revisit';
import { Icon } from '../../../shared/components/icon/icon';
import {
  DISCOVERY_DISMISS_REASONS,
  DISCOVERY_DISMISS_REASON_LABEL,
  DiscoveredItem,
  DiscoveredItemStatus,
  DiscoveryApiService,
  DiscoveryDismissReason,
  DiscoverySort,
  DiscoveryTrendDirection,
} from '../../discovery/api/discovery-api.service';

type PageState = 'loading' | 'ready' | 'error';

export const DISCOVERY_PAGE_SIZE = 20;

export const DISCOVERY_STATUS_TABS: readonly { status: DiscoveredItemStatus; label: string }[] = [
  { status: 'NEW', label: '待處理' },
  { status: 'DISMISSED', label: '已略過' },
  { status: 'CONVERTED', label: '已建立商品' },
];

export const DISCOVERY_SORT_OPTIONS: readonly { value: DiscoverySort; label: string }[] = [
  { value: 'FIT', label: '適配度' },
  { value: 'BUZZ', label: 'PTT 熱度' },
  { value: 'RECENT', label: '最近出現' },
];

/** 補充說明上限，對應後端 DiscoveredItemDismissRequest.reason 的 @Size(max = 255)。 */
export const DISMISS_NOTE_MAX_LENGTH = 255;

const DIRECTION_LABEL: Record<DiscoveryTrendDirection, string> = { UP: '上升', DOWN: '下滑', STABLE: '持平' };

/** 溫層徽章：確定不能出貨（FAILED）與無法判斷（INSUFFICIENT_DATA）用不同顏色，不混為一談。 */
export interface TemperatureBadge {
  text: string;
  tone: 'ok' | 'error' | 'warn';
  title: string;
}

@Component({
  selector: 'app-discoveries',
  imports: [DatePipe, RouterLink, Icon],
  templateUrl: './discoveries.html',
  styleUrl: './discoveries.scss',
})
export class Discoveries implements OnInit {
  private readonly api = inject(DiscoveryApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;
  readonly tabs = DISCOVERY_STATUS_TABS;
  readonly status = signal<DiscoveredItemStatus>('NEW');
  readonly pageState = signal<PageState>('loading');
  readonly loadError = signal('');
  readonly items = signal<DiscoveredItem[]>([]);
  readonly pageNumber = signal(0);
  readonly totalPages = signal(0);
  readonly totalElements = signal(0);
  readonly sortOptions = DISCOVERY_SORT_OPTIONS;
  readonly sort = signal<DiscoverySort>('FIT');
  /** 正在略過／復原的項目 id，避免連點。 */
  readonly busyId = signal<number | null>(null);

  /** 略過表單：同一時間只展開一張卡片。 */
  readonly dismissReasons = DISCOVERY_DISMISS_REASONS;
  readonly dismissNoteMaxLength = DISMISS_NOTE_MAX_LENGTH;
  readonly dismissingId = signal<number | null>(null);
  readonly dismissCode = signal<DiscoveryDismissReason | null>(null);
  readonly dismissNote = signal('');
  readonly dismissHint = computed(
    () => this.dismissReasons.find((reason) => reason.code === this.dismissCode())?.hint ?? '',
  );
  /** 「其他」沒有補充說明就無法回饋任何資訊，所以必填；其餘原因的說明選填。 */
  readonly dismissNoteRequired = computed(() => this.dismissCode() === 'OTHER');
  readonly canSubmitDismiss = computed(
    () =>
      this.dismissCode() !== null &&
      this.busyId() === null &&
      this.dismissNote().length <= DISMISS_NOTE_MAX_LENGTH &&
      (!this.dismissNoteRequired() || this.dismissNote().trim().length > 0),
  );

  readonly hasPrevious = computed(() => this.pageNumber() > 0);
  readonly hasNext = computed(() => this.pageNumber() + 1 < this.totalPages());

  constructor() {
    // 原地重點側欄「AI 商品雷達」時重新載入（ngOnInit 不會再觸發）。
    if (!this.useMockData) reloadOnRevisit(() => this.load());
  }

  ngOnInit(): void {
    if (this.useMockData) {
      // 真實資料來自每日排程；Mock 模式沒有後端可讀，只呈現空狀態與說明。
      this.pageState.set('ready');
      return;
    }
    this.load();
  }

  selectTab(status: DiscoveredItemStatus): void {
    if (status === this.status()) return;
    this.status.set(status);
    this.pageNumber.set(0);
    this.cancelDismiss();
    this.load();
  }

  selectSort(value: string): void {
    const sort = DISCOVERY_SORT_OPTIONS.find((option) => option.value === value)?.value;
    if (!sort || sort === this.sort()) return;
    this.sort.set(sort);
    this.pageNumber.set(0);
    this.cancelDismiss();
    this.load();
  }

  goToPage(page: number): void {
    if (page < 0 || (this.totalPages() > 0 && page >= this.totalPages())) return;
    this.pageNumber.set(page);
    this.load();
  }

  load(): void {
    if (this.useMockData) return;
    this.pageState.set('loading');
    this.api
      .list({ status: this.status(), sort: this.sort(), page: this.pageNumber(), size: DISCOVERY_PAGE_SIZE })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.items.set(result.items);
          this.totalPages.set(result.totalPages);
          this.totalElements.set(result.totalElements);
          this.loadError.set('');
          this.pageState.set('ready');
          // 最後一頁的項目都處理掉之後，退回上一頁，不要停在空白頁。
          if (result.items.length === 0 && this.pageNumber() > 0) this.goToPage(this.pageNumber() - 1);
        },
        error: (err: unknown) => {
          this.loadError.set(toApiError(err).message);
          this.pageState.set('error');
        },
      });
  }

  /** 新增品項表單的 query 參數：名稱帶標題裡最常見的寫法，品類對得上才帶。 */
  createQueryParams(item: DiscoveredItem): Record<string, string | number> {
    const params: Record<string, string | number> = { discoveryId: item.id, name: item.displayName };
    if (item.productTypeId !== null) params['productTypeId'] = item.productTypeId;
    return params;
  }

  /** 在卡片內展開略過表單（原因必選）；不跳確認視窗，因為選原因本身就是確認。 */
  startDismiss(item: DiscoveredItem): void {
    if (this.busyId() !== null) return;
    this.dismissingId.set(item.id);
    this.dismissCode.set(null);
    this.dismissNote.set('');
  }

  cancelDismiss(): void {
    this.dismissingId.set(null);
    this.dismissCode.set(null);
    this.dismissNote.set('');
  }

  selectDismissCode(value: string): void {
    this.dismissCode.set(DISCOVERY_DISMISS_REASONS.find((reason) => reason.code === value)?.code ?? null);
  }

  updateDismissNote(value: string): void {
    this.dismissNote.set(value);
  }

  submitDismiss(item: DiscoveredItem): void {
    const code = this.dismissCode();
    if (code === null || !this.canSubmitDismiss() || this.dismissingId() !== item.id) return;
    this.mutate(item, this.api.dismiss(item.id, code, this.dismissNote()), '略過失敗');
  }

  restore(item: DiscoveredItem): void {
    if (this.busyId() !== null) return;
    this.mutate(item, this.api.restore(item.id), '移回失敗');
  }

  private mutate(item: DiscoveredItem, request$: ReturnType<DiscoveryApiService['restore']>, errorTitle: string): void {
    this.busyId.set(item.id);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        if (this.dismissingId() === item.id) this.cancelDismiss();
        // 狀態改變後這筆就不屬於目前分頁，直接從畫面移除並更新總數，不必整頁重抓。
        this.items.update((list) => list.filter((row) => row.id !== item.id));
        this.totalElements.update((count) => Math.max(count - 1, 0));
      },
      error: (err: unknown) => {
        this.busyId.set(null);
        this.dialog.notify('error', errorTitle, [toApiError(err).message]).subscribe();
        // 409 通常是別人已經處理過這筆，重抓讓畫面跟上
        this.load();
      },
    });
  }

  directionLabel(direction: DiscoveryTrendDirection | null): string {
    return direction ? DIRECTION_LABEL[direction] : '';
  }

  /** 品類未判定（沒有溫層）時 gate 也是 INSUFFICIENT_DATA；gate 為 null 代表是第二階段之前的資料，還沒判定過。 */
  temperatureBadge(item: DiscoveredItem): TemperatureBadge | null {
    const gate = item.temperatureGate;
    if (gate === null) return null;
    const zone = item.temperatureZone ? TEMPERATURE_ZONE_LABEL[item.temperatureZone] : null;
    switch (gate) {
      case 'PASSED':
        return { text: zone ?? '溫層可配送', tone: 'ok', title: '通路支援此溫層' };
      case 'FAILED':
        return { text: `${zone ?? '溫層'}・通路不支援`, tone: 'error', title: '通路目前不支援這個溫層，無法出貨' };
      default:
        return { text: '溫層未判定', tone: 'warn', title: `品類未判定，${GATE_STATUS_LABEL[gate]}` };
    }
  }

  /** Google 趨勢：null＝這次沒排到查詢（只查適配分最高的前幾項），與「查了但沒有資料」分開顯示。 */
  googleText(item: DiscoveredItem): string {
    if (item.googleStatus === null) return '未查';
    if (item.googleStatus === 'NO_DATA') return '查無資料';
    const direction = this.directionLabel(item.googleDirection);
    if (item.googleGrowthRate === null) return direction || '有資料';
    const rate = Math.round(item.googleGrowthRate);
    return `${direction} ${rate > 0 ? '+' : ''}${rate}%`.trim();
  }

  dismissedReasonText(item: DiscoveredItem): string {
    const label = item.dismissReasonCode ? DISCOVERY_DISMISS_REASON_LABEL[item.dismissReasonCode] : null;
    if (label && item.dismissReason) return `${label}（${item.dismissReason}）`;
    return label ?? item.dismissReason ?? '';
  }

  emptyText(): string {
    switch (this.status()) {
      case 'NEW':
        return '目前沒有待處理的新品。系統每天 01:30 掃描 PTT，最近 14 天內仍被提及的項目會列在這裡。';
      case 'DISMISSED':
        return '沒有已略過的項目。';
      default:
        return '還沒有從探索結果建立的商品。';
    }
  }
}
