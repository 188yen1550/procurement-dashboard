/**
 * 檔案用途：系統設定頁「自訂計分因子」與「自訂商品屬性」的共用狀態。
 *
 * 2026-09-24 拆分（決策 D5）：這兩份清單的管理畫面搬到獨立分頁
 * 「自訂屬性與因子」（tabs/custom-extensions），但清單本身還有其他分頁要讀：
 *   - 評估模式：權重編輯器要列出「還沒加入這個模式」的自訂因子（weightEditorRows）
 *   - 目標區間：把 factorCode 轉成自訂因子名稱（customFactorNameByCode）
 * 所以清單不能只存在子元件裡。這裡用一個掛在 Settings 元件層級的
 * signal store（providers: [CustomDefinitionsStore]），父元件與子元件注入
 * 同一個實例，誰更新清單、另一邊都會即時看到，不需要 @Input/@Output 來回同步。
 *
 * 只放「清單＋載入」，CRUD 表單狀態留在子元件——那些只有管理畫面用得到。
 */
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CustomFieldDefinitionResponsePayload,
  CustomFieldType,
  FactorDataSource,
  FactorDefinitionResponsePayload,
  FactorStrategyCode,
} from '../api/settings-api.contract';
import { SettingsApiService } from '../api/settings-api.service';

/** 自訂計分因子的畫面顯示模型（2026-09-20新增，方案B；V14新增編輯所需欄位）。 */
export interface FactorDefinitionVM {
  id: number;
  factorCode: string;
  factorName: string;
  category: string | null;
  strategyCode: FactorStrategyCode;
  dataSourceCode: FactorDataSource | null;
  customFieldDefinitionId: number | null;
  strategyParams: Record<string, number> | null;
  isActive: boolean;
  /** V14新增：已被新版本取代——true時隱藏「啟用」按鈕，只能看不能動。 */
  isSuperseded: boolean;
}

export function toFactorDefinitionVM(payload: FactorDefinitionResponsePayload): FactorDefinitionVM {
  return {
    id: payload.id,
    factorCode: payload.factorCode,
    factorName: payload.factorName,
    category: payload.category,
    strategyCode: payload.strategyCode,
    dataSourceCode: payload.dataSourceCode,
    customFieldDefinitionId: payload.customFieldDefinitionId,
    strategyParams: payload.strategyParams,
    isActive: payload.isActive,
    isSuperseded: payload.isSuperseded,
  };
}

/** 自訂商品屬性（動態問卷）的畫面顯示模型（2026-09-20新增，Phase 1；V14新增編輯/分數說明欄位）。 */
export interface CustomFieldDefinitionVM {
  id: number;
  fieldCode: string;
  fieldName: string;
  helpText: string | null;
  fieldType: CustomFieldType;
  isRequired: boolean;
  isActive: boolean;
  applicableRootProductTypeIds: number[];
  /** V14新增：僅fieldType='SCALE_1_5'時可能有值，key為'1'~'5'、value為說明文字。 */
  scaleLabels: Record<string, string> | null;
  /** V14新增：已被新版本取代——true時隱藏「啟用」按鈕，只能看不能動。 */
  isSuperseded: boolean;
}

export function toCustomFieldDefinitionVM(payload: CustomFieldDefinitionResponsePayload): CustomFieldDefinitionVM {
  return {
    id: payload.id,
    fieldCode: payload.fieldCode,
    fieldName: payload.fieldName,
    helpText: payload.helpText,
    fieldType: payload.fieldType,
    isRequired: payload.isRequired,
    isActive: payload.isActive,
    applicableRootProductTypeIds: payload.applicableRootProductTypeIds,
    scaleLabels: payload.scaleLabels,
    isSuperseded: payload.isSuperseded,
  };
}

/** 1~5分數說明編輯表單用的固定五列結構，避免畫面直接操作稀疏的Record。 */
export const SCALE_LABEL_KEYS: readonly string[] = ['1', '2', '3', '4', '5'];

@Injectable()
export class CustomDefinitionsStore {
  private readonly api = inject(SettingsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly factorDefinitions = signal<FactorDefinitionVM[]>([]);
  readonly customFieldDefinitions = signal<CustomFieldDefinitionVM[]>([]);

  /**
   * 停用的舊版本（isSuperseded=true，因編輯而被取代）不需要在前端顯示——
   * 它們永遠不能再被啟用（見後端 enableFactorDefinition() 的防呆），留著
   * 只會讓清單越積越多歷史雜訊。純粹手動停用（isSuperseded=false）的
   * 因子仍然照常顯示，管理層才能看到並重新啟用。
   *
   * 載入失敗不影響其他區塊的顯示，維持空清單即可（沿用拆分前的行為）。
   */
  loadFactorDefinitions(): void {
    this.api
      .getFactorDefinitions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) =>
          this.factorDefinitions.set(list.map(toFactorDefinitionVM).filter((item) => !item.isSuperseded)),
        error: () => undefined,
      });
  }

  /** 理由同 loadFactorDefinitions()：被編輯取代的舊版本不需要在前端顯示。 */
  loadCustomFieldDefinitions(): void {
    this.api
      .getCustomFieldDefinitions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) =>
          this.customFieldDefinitions.set(
            list.map(toCustomFieldDefinitionVM).filter((item) => !item.isSuperseded),
          ),
        error: () => undefined,
      });
  }
}
