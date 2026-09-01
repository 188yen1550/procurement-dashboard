import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { SettingsApiService } from './settings-api.service';

/**
 * 人工風險選項的 id → 名稱對照。
 *
 * ## 用途只有一個：決策紀錄頁
 *
 * ReviewRecordResponse.riskOptionIds 是 Long[]，只有編號沒有名稱
 * （前端 API 手冊列為陷阱之一）。要在決策紀錄顯示「本次勾選了哪些風險」，
 * 必須自己對照 GET /api/settings/risk-options。
 *
 * ## ⚠️ 審核頁不要用這個服務
 *
 * 審核頁的風險勾選清單資料來源是 GET /api/reviews/{productId} 回應裡的
 * availableRiskOptions，那份**只含目前啟用中**的選項；
 * 而 GET /api/settings/risk-options 回的是**全部（含已停用）**。
 * 用錯來源會讓使用者勾到已停用的選項。
 *
 * ## ⚠️ 這支端點是 [僅管理]
 *
 * SettingsController.getRiskOptions() 有 @PreAuthorize("hasRole('MANAGER')")。
 * 操作層呼叫會拿到 403。決策紀錄頁本來就是僅管理，所以沒問題，
 * 但若日後想在操作層看得到的地方顯示風險名稱，會需要後端補一支公開端點——
 * 不要在前端寫死一份風險名稱對照表繞過去，那份資料會跟設定頁不同步。
 */
@Injectable({ providedIn: 'root' })
export class RiskOptionLookupService {
  private readonly api = inject(SettingsApiService);

  private cache$: Observable<Map<number, string>> | null = null;

  getNameMap(): Observable<Map<number, string>> {
    if (!this.cache$) {
      this.cache$ = this.api.getRiskOptions().pipe(
        map((options) => new Map(options.map((option) => [option.id, option.name]))),
        // 403（操作層呼叫）或其他失敗時降級成空 Map，
        // 決策紀錄的其餘欄位仍應正常顯示。
        catchError(() => of(new Map<number, string>())),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.cache$;
  }

  /** 把 riskOptionIds 轉成名稱陣列；查不到的 id 會被略過，不顯示成 undefined。 */
  getNames(riskOptionIds: readonly number[] | null): Observable<string[]> {
    if (!riskOptionIds || riskOptionIds.length === 0) return of([]);
    return this.getNameMap().pipe(
      map((nameById) =>
        riskOptionIds
          .map((id) => nameById.get(id))
          .filter((name): name is string => name !== undefined),
      ),
    );
  }

  /** 設定頁新增風險選項後呼叫。 */
  invalidate(): void {
    this.cache$ = null;
  }
}
