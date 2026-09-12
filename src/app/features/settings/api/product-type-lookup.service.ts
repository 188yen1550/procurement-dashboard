import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { SettingsApiService } from './settings-api.service';
import { ProductTypeResponsePayload } from './settings-api.contract';

/**
 * 商品類型的 id → 名稱對照。
 *
 * ## 為什麼需要這個服務
 *
 * ProductResponse 只有 productTypeId（Long），沒有名稱，
 * 而清單、詳情、審核三個地方都要顯示中文類型。前端 API 手冊把它列為第一條陷阱。
 *
 * 天真做法有兩種都不行：
 * 1. 每筆商品打一次 settings API → 20 筆清單 = 20 個請求（N+1）
 * 2. 每個元件自己 subscribe 一次 getProductTypes() → 進三個頁面打三次
 *
 * 這裡用 shareReplay(1) 把結果快取在服務裡：第一次呼叫時發請求，
 * 之後所有訂閱者共用同一份結果，跨元件、跨頁面都不會重打。
 *
 * ## 快取失效
 *
 * 商品類型是低頻異動的設定資料，一個 session 內幾乎不會變，
 * 所以預設永久快取。設定頁新增／停用類型後要呼叫 invalidate()，
 * 否則下拉選單不會出現剛新增的項目。
 */
@Injectable({ providedIn: 'root' })
export class ProductTypeLookupService {
  private readonly api = inject(SettingsApiService);

  /** null 代表尚未載入過；載入後持有 shareReplay 過的 Observable。 */
  private cache$: Observable<Map<number, string>> | null = null;
  private raw$: Observable<ProductTypeResponsePayload[]> | null = null;

  /**
   * 取得依大類分組的階層結構，供畫面用 <optgroup> 或縮排呈現「大類底下
   * 有哪些小類」，不要再把 30 個小類攤平成一條長長的清單——使用者要從
   * 扁平清單裡找到「海鮮水產」屬於哪個大類，得先記住或用猜的。
   *
   * 只回傳未停用（isActive !== false）的項目——停用的品類不該出現在
   * 新增／篩選這種「往前看」的操作情境，那是設定頁管理列表才需要看到的。
   */
  getGroupedOptions(): Observable<{ major: ProductTypeResponsePayload; minors: ProductTypeResponsePayload[] }[]> {
    return this.getRaw().pipe(
      map((types) => {
        const actives = types.filter((t) => t.isActive !== false);
        const majors = actives.filter((t) => t.level === 1).sort((a, b) => a.id - b.id);
        const minorsByParent = new Map<number, ProductTypeResponsePayload[]>();
        for (const t of actives) {
          if (t.level !== 2 || t.parentId === null) continue;
          const arr = minorsByParent.get(t.parentId) ?? [];
          arr.push(t);
          minorsByParent.set(t.parentId, arr);
        }
        return majors.map((major) => ({
          major,
          minors: (minorsByParent.get(major.id) ?? []).sort((a, b) => a.id - b.id),
        }));
      }),
    );
  }

  private getRaw(): Observable<ProductTypeResponsePayload[]> {
    if (!this.raw$) {
      this.raw$ = this.api.getProductTypes().pipe(
        catchError(() => of([] as ProductTypeResponsePayload[])),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.raw$;
  }

  /**
   * 取得 id → 說明文字的 Map，供品類名稱懸停顯示用。說明是選填欄位，
   * 沒填的品類不會出現在這個 Map 裡（呼叫端用 Map.get() 拿到 undefined，
   * 據此判斷不要顯示提示框，而不是顯示一個空白的提示框）。
   */
  getDescriptionMap(): Observable<Map<number, string>> {
    return this.getRaw().pipe(
      map((types) => {
        const entries: [number, string][] = [];
        for (const t of types) {
          if (t.description && t.description.trim()) entries.push([t.id, t.description.trim()]);
        }
        return new Map(entries);
      }),
    );
  }

  /**
   * 取得 id → 名稱的 Map。
   *
   * ⚠️ 失敗時降級成空 Map 而不是拋錯：類型名稱只是顯示用的輔助資訊，
   * 拿不到時商品清單仍應該正常渲染（名稱位置顯示 fallback 字串即可），
   * 不該因為次要資料失敗就讓主要清單整個掛掉。
   *
   * ⚠️ 這也代表操作層呼叫時不會因為 403 而壞掉——雖然這支端點
   * 操作層本來就有權限，但降級處理讓它對權限變更有韌性。
   */
  getNameMap(): Observable<Map<number, string>> {
    if (!this.cache$) {
      this.cache$ = this.api.getProductTypes().pipe(
        map((types) => new Map(types.map((type) => [type.id, type.name]))),
        catchError(() => of(new Map<number, string>())),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.cache$;
  }

  /** 單一 id 的名稱查詢；查不到或 id 為 null 時回傳 fallback。 */
  getName(productTypeId: number | null, fallback = '—'): Observable<string> {
    if (productTypeId === null) return of(fallback);
    return this.getNameMap().pipe(map((nameById) => nameById.get(productTypeId) ?? fallback));
  }

  /**
   * 清除快取。設定頁新增／停用／刪除商品類型之後必須呼叫，
   * 否則其他頁面的下拉與名稱對照會停留在舊資料。
   */
  invalidate(): void {
    this.cache$ = null;
    this.raw$ = null;
  }
}
