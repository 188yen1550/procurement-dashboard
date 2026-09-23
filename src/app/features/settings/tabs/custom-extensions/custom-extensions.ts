/**
 * 檔案用途：系統設定 › 「自訂屬性與因子」分頁。
 *
 * 2026-09-24 拆分（決策 D5）。原本這兩塊分散在兩個分頁：
 *   - 自訂商品屬性：放在「商品類型」分頁底部
 *   - 自訂計分因子：放在「評估模式」分頁、三張模式卡片下方
 * 但兩者是同一條相依鏈：自訂屬性 →（資料源選 CUSTOM_FIELD）自訂因子 →
 * 評估模式權重 →（TARGET_BAND_NORMALIZE 時）目標區間。分開放造成的實際
 * 問題：因子表單在找不到可用屬性時提示「請先到下方新增一個」，下方根本
 * 沒有——屬性在另一個分頁。合併後依相依順序排列：屬性在上、因子在下，
 * 建立因子後提供「下一步」連結跳到評估模式／目標區間（透過 navigateTab
 * 輸出交給父元件切換分頁）。
 *
 * 程式邏輯原樣搬自 settings.ts（2026-09-20 方案B、V14 編輯/分數說明），
 * 只做三件事：
 *   1. 清單改讀 CustomDefinitionsStore（父元件其他分頁也要讀，見該檔說明）
 *   2. 成功訊息改用 status 輸出交給父元件的 toast 顯示，錯誤仍直接開 dialog
 *   3. 修正兩段過時／指錯位置的文案（見 submitFactorDefinition、submitCustomFieldDefinition）
 */
import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { toApiError } from '../../../../core/api/api-error';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { DialogService } from '../../../../core/dialog/dialog.service';
import {
  CustomFieldType,
  FactorDataSource,
  FactorStrategyCode,
} from '../../api/settings-api.contract';
import { SettingsApiService } from '../../api/settings-api.service';
import {
  CustomDefinitionsStore,
  CustomFieldDefinitionVM,
  FactorDefinitionVM,
  SCALE_LABEL_KEYS,
  toCustomFieldDefinitionVM,
  toFactorDefinitionVM,
} from '../../state/custom-definitions.store';

/** 父元件傳進來的品類清單最小形狀：只需要 id／名稱／層級。 */
export interface CustomExtensionsProductType {
  id: number | null;
  name: string;
  level: number | null;
}

/** 這個分頁可以要求父元件切換到的下一步分頁。 */
export type CustomExtensionsNextTab = 'modes' | 'scoreBands';

@Component({
  selector: 'app-custom-extensions',
  imports: [FormsModule],
  templateUrl: './custom-extensions.html',
  styleUrl: './custom-extensions.scss',
})
export class CustomExtensions {
  private readonly store = inject(CustomDefinitionsStore);
  private readonly api = inject(SettingsApiService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly useMockData = APP_CONFIG.useMockData;

  /** 全部品類（含小類），用來把 applicableRootProductTypeIds 轉成名稱。 */
  readonly productTypes = input<readonly CustomExtensionsProductType[]>([]);
  /** 父元件的「停用」示範狀態（pageState === 'disabled'）。 */
  readonly disabled = input(false);

  /** 成功類操作回饋，交給父元件既有的 toast 顯示（跟其他分頁同一個位置）。 */
  readonly status = output<string>();
  /** 「下一步」連結：請父元件切換分頁。 */
  readonly navigateTab = output<CustomExtensionsNextTab>();

  /** 只有大類可以選為適用範圍（後端以根品類判斷適用，見 V11 說明）。 */
  readonly availableMajorTypes = computed(() => this.productTypes().filter((t) => t.level === 1));

  /**
   * 剛建立、且運算邏輯是「依品類目標區間正規化」的因子代碼。有值時在因子表格
   * 上方顯示「下一步：設定目標區間」提示；建立其他類型的因子只提示去評估模式。
   */
  readonly lastCreatedTargetBandFactor = signal<string | null>(null);

  private showAlert(message: string, title = '操作失敗'): void {
    this.dialog.notify('error', title, [message]).subscribe();
  }

  // ----- 自訂計分因子（2026-09-20新增，方案B）-----
  //
  // 沒有沿用既有的共用 modal() 系統：既有 modal 是靠共用的 draftXxx 訊號組出
  // 好幾種完全不同的表單（風險/品類/檔期/帳號），saveModal()／saveModalMock()
  // 已經是一長串 if-else，硬塞一種欄位形狀差很多的新表單（選運算邏輯＋選資料源＋
  // 選填參數）進去，只會讓那兩個已經很長的方法更難讀、也更容易在改動時不小心
  // 影響到其他既有表單。獨立一組訊號與方法，风险更低、也更容易單獨測試。

  readonly factorDefinitions = this.store.factorDefinitions;

  readonly isCreatingFactorDefinition = signal(false);
  readonly isSavingFactorDefinition = signal(false);
  /**
   * V14新增：null＝目前是「新增」表單；非null＝正在編輯這個id的因子，
   * 表單與新增共用同一組 newFactorXxx 訊號（見 openEditFactorDefinition()），
   * 只是送出時走 updateFactorDefinition() 而不是 createFactorDefinition()，
   * 且因子代碼欄位改為唯讀——編輯不開放修改代碼，見後端
   * FactorDefinitionUpdateRequest 類別註解。
   */
  readonly editingFactorDefinitionId = signal<number | null>(null);
  readonly newFactorCode = signal('');
  readonly newFactorName = signal('');
  /**
   * 資料源類型：既有 Product 固定欄位，或自訂商品屬性（動態問卷）題目。
   * 2026-09-20新增。運算邏輯不再由使用者直接選——見 newFactorStrategy()
   * 下方的說明，改成依這裡選的資料源自動決定，避免選出互不相容的組合。
   */
  readonly newFactorSourceKind = signal<'FIXED' | 'CUSTOM_FIELD'>('FIXED');
  readonly newFactorDataSource = signal<FactorDataSource>('PRICE_COMPETITIVENESS');
  readonly newFactorCustomFieldId = signal<number | null>(null);
  /** 空字串代表沿用該策略的預設倍率（MANUAL_SCALE=20／MANUAL_PERCENT=100），不送 strategyParams。 */
  readonly newFactorScale = signal('');

  /** 中文顯示名稱，對應後端 FactorStrategyCode 的三個已實作值，純顯示用（見 newFactorStrategy()）。 */
  readonly factorStrategyLabel: Record<string, string> = {
    MANUAL_SCALE: '人工評分 × 倍率',
    MANUAL_PERCENT: '人工估值 × 倍率',
    TARGET_BAND_NORMALIZE: '依品類目標區間正規化',
  };

  /** 中文顯示名稱，對應後端 FactorDataSource。 */
  readonly factorDataSourceLabel: Record<string, string> = {
    PRICE_COMPETITIVENESS: '價格競爭力（1~5人工評分）',
    MOQ: '最低訂購量（原始數字，需設定目標區間）',
    SUPPLIER_MAX_CAPACITY: '供應商最大產能（原始數字，需設定目標區間）',
  };

  /**
   * 每個資料源相容哪一種運算邏輯，對應後端 FactorDataSource.getCompatibleStrategy()。
   * 新增資料源時要同步更新這裡。
   */
  readonly factorDataSourceOptions: readonly {
    code: FactorDataSource;
    compatibleStrategy: FactorStrategyCode;
  }[] = [
    { code: 'PRICE_COMPETITIVENESS', compatibleStrategy: 'MANUAL_SCALE' },
    { code: 'MOQ', compatibleStrategy: 'TARGET_BAND_NORMALIZE' },
    { code: 'SUPPLIER_MAX_CAPACITY', compatibleStrategy: 'TARGET_BAND_NORMALIZE' },
  ];

  /**
   * 依 CustomFieldType 對應的運算邏輯，鏡射後端 CustomFieldType.
   * getCompatibleStrategy()。TEXT 型態不會出現在這裡（見
   * availableCustomFieldsForFactor() 已經把它篩掉）。
   */
  readonly customFieldTypeStrategy: Record<string, FactorStrategyCode> = {
    SCALE_1_5: 'MANUAL_SCALE',
    PERCENT_0_1: 'MANUAL_PERCENT',
    RAW_NUMBER: 'TARGET_BAND_NORMALIZE',
  };

  /**
   * 可選為計分資料源的自訂商品屬性——只有數值類（排除 TEXT）且生效中的。
   * 2026-09-20新增，「開新計分因子資料源」最後一階段：讓自訂因子除了能綁
   * 既有 Product 固定欄位，也能綁管理層自己在「商品類型」分頁新增的自訂
   * 商品屬性題目。
   */
  readonly availableCustomFieldsForFactor = computed(() =>
    this.customFieldDefinitions().filter((f) => f.isActive && f.fieldType !== 'TEXT'),
  );

  /**
   * 運算邏輯不再由使用者直接選——依目前選的資料源（既有欄位或自訂屬性）
   * 自動決定。原本是「先選運算邏輯，再篩出相容的資料源」，兩種資料源
   * 並存後反過來更簡單：使用者只需要決定「要用哪個數字來打分數」，
   * 邏輯怎麼算是那個數字的形狀決定的，不需要使用者自己知道兩者要對得上。
   */
  readonly newFactorStrategy = computed<FactorStrategyCode | null>(() => {
    if (this.newFactorSourceKind() === 'FIXED') {
      return (
        this.factorDataSourceOptions.find((o) => o.code === this.newFactorDataSource())?.compatibleStrategy ?? null
      );
    }
    const field = this.availableCustomFieldsForFactor().find((f) => f.id === this.newFactorCustomFieldId());
    return field ? (this.customFieldTypeStrategy[field.fieldType] ?? null) : null;
  });

  openCreateFactorDefinition(): void {
    this.editingFactorDefinitionId.set(null);
    this.newFactorCode.set('');
    this.newFactorName.set('');
    this.newFactorSourceKind.set('FIXED');
    this.newFactorDataSource.set('PRICE_COMPETITIVENESS');
    this.newFactorCustomFieldId.set(null);
    this.newFactorScale.set('');
    this.isCreatingFactorDefinition.set(true);
  }

  /**
   * V14新增：開啟編輯表單，用選定因子目前的內容預填同一組表單訊號。
   * 因子代碼維持顯示但欄位在畫面上是唯讀（見 settings.html），送出時
   * 也不會被送出——updateFactorDefinition() 沿用舊代碼，不理會這裡的值。
   */
  openEditFactorDefinition(item: FactorDefinitionVM): void {
    this.editingFactorDefinitionId.set(item.id);
    this.newFactorCode.set(item.factorCode);
    this.newFactorName.set(item.factorName);
    if (item.dataSourceCode) {
      this.newFactorSourceKind.set('FIXED');
      this.newFactorDataSource.set(item.dataSourceCode);
      this.newFactorCustomFieldId.set(null);
    } else {
      this.newFactorSourceKind.set('CUSTOM_FIELD');
      this.newFactorCustomFieldId.set(item.customFieldDefinitionId);
    }
    const scale = item.strategyParams?.['scale'];
    this.newFactorScale.set(scale != null ? String(scale) : '');
    this.isCreatingFactorDefinition.set(true);
  }

  /**
   * 切換資料源類型（既有欄位／自訂商品屬性）時，把另一邊的選擇重置成預設值，
   * 避免使用者先選了自訂屬性、又切回既有欄位，殘留的 newFactorCustomFieldId
   * 被誤送出（雖然 createFactorDefinition() 只依 newFactorSourceKind() 決定
   * 送哪一個欄位，殘留值不會真的被送出，但重置更乾淨，也讓畫面狀態更好預期）。
   */
  updateNewFactorSourceKind(kind: 'FIXED' | 'CUSTOM_FIELD'): void {
    this.newFactorSourceKind.set(kind);
    if (kind === 'FIXED') {
      this.newFactorCustomFieldId.set(null);
    } else {
      this.newFactorDataSource.set('PRICE_COMPETITIVENESS');
      const firstAvailable = this.availableCustomFieldsForFactor()[0];
      this.newFactorCustomFieldId.set(firstAvailable ? firstAvailable.id : null);
    }
  }

  cancelCreateFactorDefinition(): void {
    this.isCreatingFactorDefinition.set(false);
    this.editingFactorDefinitionId.set(null);
  }

  /**
   * 表單送出的統一入口，依 editingFactorDefinitionId() 分派到新增或編輯。
   * 兩者共用同一組欄位驗證（必填、策略是否可解析、倍率格式），只有送出的
   * API 呼叫不同——編輯不送 factorCode（後端 FactorDefinitionUpdateRequest
   * 本來就沒有這個欄位，見其類別註解，代碼不可修改）。
   */
  submitFactorDefinition(): void {
    if (this.isSavingFactorDefinition()) return;

    const factorCode = this.newFactorCode().trim().toUpperCase();
    const factorName = this.newFactorName().trim();
    if (!factorCode || !factorName) {
      this.showAlert('請填寫因子代碼與名稱。', '自訂因子');
      return;
    }

    const strategyCode = this.newFactorStrategy();
    if (!strategyCode) {
      this.showAlert(
        this.newFactorSourceKind() === 'FIXED'
          ? '請選擇資料源。'
          : '請選擇自訂商品屬性——目前沒有可用的數值類題目，請先在同一頁上方的「自訂商品屬性」新增一個。',
        '自訂因子',
      );
      return;
    }

    const scaleInput = this.newFactorScale().trim();
    const strategyParams: Record<string, number> | undefined = scaleInput
      ? { scale: Number(scaleInput) }
      : undefined;
    if (scaleInput && Number.isNaN(strategyParams?.['scale'])) {
      this.showAlert('倍率必須是數字。', '自訂因子');
      return;
    }

    const isFixedSource = this.newFactorSourceKind() === 'FIXED';
    const editingId = this.editingFactorDefinitionId();

    if (this.useMockData) {
      if (editingId != null) {
        this.factorDefinitions.update((items) =>
          items.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  factorName,
                  strategyCode,
                  dataSourceCode: isFixedSource ? this.newFactorDataSource() : null,
                  customFieldDefinitionId: isFixedSource ? null : this.newFactorCustomFieldId(),
                }
              : item,
          ),
        );
        this.cancelCreateFactorDefinition();
        this.status.emit('已在本地編輯 Mock 自訂因子。');
        return;
      }
      this.factorDefinitions.update((items) => [
        ...items,
        {
          id: -(items.length + 1),
          factorCode,
          factorName,
          category: null,
          strategyCode,
          dataSourceCode: isFixedSource ? this.newFactorDataSource() : null,
          customFieldDefinitionId: isFixedSource ? null : this.newFactorCustomFieldId(),
          strategyParams: strategyParams ?? null,
          isActive: true,
          isSuperseded: false,
        },
      ]);
      this.cancelCreateFactorDefinition();
      this.status.emit('已在本地新增 Mock 自訂因子。');
      return;
    }

    this.isSavingFactorDefinition.set(true);

    // 二選一：既有欄位或自訂商品屬性，另一個固定送 null，見後端
    // FactorDefinitionCreateRequest／FactorDefinitionUpdateRequest 類別註解
    // 的「資料源二選一」說明。category 固定不送，理由見下方 create 分支註解。
    const dataSourceCode = isFixedSource ? this.newFactorDataSource() : null;
    const customFieldDefinitionId = isFixedSource ? null : this.newFactorCustomFieldId();

    if (editingId != null) {
      this.api
        .updateFactorDefinition(editingId, {
          factorName,
          strategyCode,
          dataSourceCode,
          customFieldDefinitionId,
          strategyParams: strategyParams ?? null,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.isSavingFactorDefinition.set(false);
            this.cancelCreateFactorDefinition();
            // 編輯會產生新版本（新id）並把舊版本標記為已取代，兩者狀態都要
            // 反映在清單上，直接重新整份載入比在本地嘗試拼湊兩列的狀態更保險。
            this.store.loadFactorDefinitions();
            this.status.emit('自訂因子已更新。');
          },
          error: (err) => {
            this.isSavingFactorDefinition.set(false);
            this.showAlert(toApiError(err).message);
          },
        });
      return;
    }

    this.api
      .createFactorDefinition({
        factorCode,
        factorName,
        // 2026-09-20拿掉分組欄位：category 的唯一用途是卡片上的四象限彙總
        // 顯示，那個顯示已經在同一輪改成展開因子明細（見 mode-grid 樣板），
        // 分組已經沒有任何畫面在讀，繼續讓使用者填一個沒有效果的欄位只會
        // 造成困惑。後端 FactorDefinitionCreateRequest.category 保留可為 null，
        // 這裡固定不送即可，不需要為此再動後端。
        strategyCode,
        dataSourceCode,
        customFieldDefinitionId,
        strategyParams: strategyParams ?? null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.factorDefinitions.update((items) => [...items, toFactorDefinitionVM(created)]);
          this.lastCreatedTargetBandFactor.set(
            created.strategyCode === 'TARGET_BAND_NORMALIZE' ? created.factorName : null,
          );
          this.isSavingFactorDefinition.set(false);
          this.cancelCreateFactorDefinition();
          this.status.emit(
            '自訂因子已新增。要讓某個自訂模式開始採計，請到「評估模式」分頁的「編輯權重」加入並分配權重。',
          );
        },
        error: (err) => {
          this.isSavingFactorDefinition.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  disableFactorDefinition(id: number): void {
    if (this.useMockData) {
      this.factorDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: false } : item)),
      );
      this.status.emit('已在本地停用 Mock 自訂因子。');
      return;
    }
    this.api
      .disableFactorDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.factorDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toFactorDefinitionVM(updated) : item)),
          ),
        error: (err) => this.showAlert(toApiError(err).message),
      });
  }

  enableFactorDefinition(id: number): void {
    if (this.useMockData) {
      this.factorDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: true } : item)),
      );
      this.status.emit('已在本地啟用 Mock 自訂因子。');
      return;
    }
    this.api
      .enableFactorDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.factorDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toFactorDefinitionVM(updated) : item)),
          ),
        error: (err) => this.showAlert(toApiError(err).message),
      });
  }

  // ----- 自訂商品屬性（動態問卷，2026-09-20新增，Phase 1：僅題目管理）-----
  //
  // 品類勾選比照 toggleTagPickerSelection() 的既有寫法（[checked]+click+
  // preventDefault()），是這一輪之前才確認真正可行的核取方塊寫法，直接
  // 沿用，不再重蹈 [ngModel]/(ngModelChange) 那次的覆轍。

  readonly customFieldDefinitions = this.store.customFieldDefinitions;
  readonly isCreatingCustomField = signal(false);
  readonly isSavingCustomField = signal(false);
  /** V14新增：null＝新增表單；非null＝正在編輯這個id的題目，理由同editingFactorDefinitionId。 */
  readonly editingCustomFieldId = signal<number | null>(null);
  readonly newFieldCode = signal('');
  readonly newFieldName = signal('');
  readonly newFieldType = signal<CustomFieldType>('SCALE_1_5');
  readonly newFieldHelpText = signal('');
  readonly newFieldRequired = signal(false);
  readonly newFieldApplicableTypeIds = signal<Set<number>>(new Set());
  /**
   * V14新增：1~5分數說明，key固定為'1'~'5'（見SCALE_LABEL_KEYS），value為
   * 使用者填的文字，留空的分數不會被送出（見submitCustomFieldDefinition()）。
   * 只有 newFieldType()==='SCALE_1_5' 時，畫面才會顯示這組輸入。
   */
  readonly newFieldScaleLabels = signal<Record<string, string>>({});
  readonly scaleLabelKeys = SCALE_LABEL_KEYS;

  readonly customFieldTypeLabel: Record<string, string> = {
    SCALE_1_5: '1~5人工評分',
    PERCENT_0_1: '0~1小數估值',
    RAW_NUMBER: '原始數字',
    TEXT: '純文字（不參與計分）',
  };

  /** 下拉選單用的陣列版本，直接沿用上面的 label 對照表，避免兩處各維護一份文字。 */
  readonly customFieldTypeOptions: readonly { code: CustomFieldType; label: string }[] = (
    ['SCALE_1_5', 'PERCENT_0_1', 'RAW_NUMBER', 'TEXT'] as const
  ).map((code) => ({ code, label: this.customFieldTypeLabel[code] }));

  /**
   * 把品類 id 陣列轉成畫面可讀的大類名稱，空陣列顯示「全部品類」。
   *
   * 2026-09-20修正一個防呆缺口：原本「有 id 但一個都對不到名稱」時會
   * 誤顯示成「全部品類」——這是錯的，「有限制但查無名稱」（品類被刪除、
   * 或品類清單還沒載入完成）跟「本來就沒有限制」是兩種完全不同的狀態，
   * 混在一起顯示會讓管理層誤以為一個原本有品類限制的題目其實適用全部
   * 品類，進而做出錯誤的判斷。現在只有 ids 真的是空陣列時才顯示「全部
   * 品類」；有 id 卻對不到名稱的，改顯示「未知品類」並標明筆數，不悄悄
   * 吞掉、也不謊報成「沒有限制」。
   */
  describeApplicableTypes(ids: number[]): string {
    if (!ids || ids.length === 0) {
      return '全部品類';
    }
    const names = ids.map((id) => this.productTypes().find((t) => t.id === id)?.name).filter((name): name is string => !!name);
    const unresolvedCount = ids.length - names.length;
    if (names.length === 0) {
      return `未知品類（${unresolvedCount}項，可能已被刪除）`;
    }
    if (unresolvedCount > 0) {
      return `${names.join('、')}（另有${unresolvedCount}項未知品類）`;
    }
    return names.join('、');
  }

  /** 因子清單表格用：把資料源顯示成人類看得懂的文字，涵蓋既有欄位與自訂商品屬性兩種來源。 */
  describeFactorDataSource(factor: FactorDefinitionVM): string {
    if (factor.dataSourceCode) {
      return this.factorDataSourceLabel[factor.dataSourceCode] ?? factor.dataSourceCode;
    }
    if (factor.customFieldDefinitionId != null) {
      const field = this.customFieldDefinitions().find((f) => f.id === factor.customFieldDefinitionId);
      return field ? `${field.fieldName}（自訂屬性）` : '未知的自訂屬性（可能已被刪除）';
    }
    return '—';
  }

  openCreateCustomField(): void {
    this.editingCustomFieldId.set(null);
    this.newFieldCode.set('');
    this.newFieldName.set('');
    this.newFieldType.set('SCALE_1_5');
    this.newFieldHelpText.set('');
    this.newFieldRequired.set(false);
    this.newFieldApplicableTypeIds.set(new Set());
    this.newFieldScaleLabels.set({});
    this.isCreatingCustomField.set(true);
  }

  /**
   * V14新增：開啟編輯表單，用選定題目目前的內容預填同一組表單訊號。
   * 欄位代碼維持顯示但欄位在畫面上是唯讀——編輯不開放修改代碼，見後端
   * CustomFieldDefinitionUpdateRequest 類別註解。
   */
  openEditCustomField(item: CustomFieldDefinitionVM): void {
    this.editingCustomFieldId.set(item.id);
    this.newFieldCode.set(item.fieldCode);
    this.newFieldName.set(item.fieldName);
    this.newFieldType.set(item.fieldType);
    this.newFieldHelpText.set(item.helpText ?? '');
    this.newFieldRequired.set(item.isRequired);
    this.newFieldApplicableTypeIds.set(new Set(item.applicableRootProductTypeIds));
    this.newFieldScaleLabels.set({ ...(item.scaleLabels ?? {}) });
    this.isCreatingCustomField.set(true);
  }

  cancelCreateCustomField(): void {
    this.isCreatingCustomField.set(false);
    this.editingCustomFieldId.set(null);
  }

  /** V14新增：更新單一分數（'1'~'5'）的說明文字，留空代表這個分數不需要說明。 */
  updateNewFieldScaleLabel(key: string, value: string): void {
    this.newFieldScaleLabels.update((labels) => {
      const next = { ...labels };
      const trimmed = value.trim();
      if (trimmed) {
        next[key] = trimmed;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  toggleNewFieldApplicableType(typeId: number): void {
    this.newFieldApplicableTypeIds.update((set) => {
      const next = new Set(set);
      if (next.has(typeId)) {
        next.delete(typeId);
      } else {
        next.add(typeId);
      }
      return next;
    });
  }

  /**
   * 表單送出的統一入口，依 editingCustomFieldId() 分派到新增或編輯，
   * 寫法對稱 submitFactorDefinition()。編輯時代碼不可變、也不重複查重
   * （反正沒有送出，後端 CustomFieldDefinitionUpdateRequest 本來就沒有
   * fieldCode 欄位）。
   */
  submitCustomFieldDefinition(): void {
    if (this.isSavingCustomField()) return;

    const editingId = this.editingCustomFieldId();
    const fieldCode = this.newFieldCode().trim().toUpperCase();
    const fieldName = this.newFieldName().trim();
    if (!fieldCode || !fieldName) {
      this.showAlert('請填寫欄位代碼與名稱。', '自訂屬性');
      return;
    }

    if (editingId == null) {
      // 2026-09-20新增防呆：格式跟重複兩項檢查都能在前端先擋，不用等後端
      // 回應才知道錯在哪。格式比照既有計分因子代碼的既定慣例（英數字加底線，
      // 不能以數字開頭）——欄位代碼是給程式跟未來的計分資料源對照用的鍵值，
      // 不是給人看的顯示文字（那是 fieldName 的職責），混進空白或符號會讓
      // 之後串接計分系統時難以預期地出錯。編輯時代碼不可修改、也不會被送出，
      // 不需要重跑這兩項檢查。
      if (!/^[A-Z][A-Z0-9_]*$/.test(fieldCode)) {
        this.showAlert('欄位代碼只能是英文字母、數字、底線，且不能以數字開頭。', '自訂屬性');
        return;
      }
      if (this.customFieldDefinitions().some((item) => item.fieldCode === fieldCode && item.isActive)) {
        this.showAlert(`欄位代碼「${fieldCode}」已存在，請改用其他代碼。`, '自訂屬性');
        return;
      }
    }

    const fieldType = this.newFieldType();
    // V14新增：1~5分數說明只有SCALE_1_5型態才有意義，其餘型態即使使用者
    // 之前填過（例如先選SCALE_1_5填了說明，又切回其他型態），送出時一律
    // 清空，不送給後端——後端也會擋（見ValidationMessage.
    // CUSTOM_FIELD_SCALE_LABEL_NOT_APPLICABLE），這裡先擋一次，錯誤訊息
    // 更早出現。
    const scaleLabels = fieldType === 'SCALE_1_5' ? this.newFieldScaleLabels() : null;
    const scaleLabelsPayload = scaleLabels && Object.keys(scaleLabels).length > 0 ? scaleLabels : null;

    const applicableIds = Array.from(this.newFieldApplicableTypeIds());

    if (this.useMockData) {
      if (editingId != null) {
        this.customFieldDefinitions.update((items) =>
          items.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  fieldName,
                  helpText: this.newFieldHelpText().trim() || null,
                  fieldType,
                  isRequired: this.newFieldRequired(),
                  applicableRootProductTypeIds: applicableIds,
                  scaleLabels: scaleLabelsPayload,
                }
              : item,
          ),
        );
        this.cancelCreateCustomField();
        this.status.emit('已在本地編輯 Mock 自訂屬性。');
        return;
      }
      this.customFieldDefinitions.update((items) => [
        ...items,
        {
          id: -(items.length + 1),
          fieldCode,
          fieldName,
          helpText: this.newFieldHelpText().trim() || null,
          fieldType,
          isRequired: this.newFieldRequired(),
          isActive: true,
          applicableRootProductTypeIds: applicableIds,
          scaleLabels: scaleLabelsPayload,
          isSuperseded: false,
        },
      ]);
      this.cancelCreateCustomField();
      this.status.emit('已在本地新增 Mock 自訂屬性。');
      return;
    }

    this.isSavingCustomField.set(true);

    if (editingId != null) {
      this.api
        .updateCustomFieldDefinition(editingId, {
          fieldName,
          helpText: this.newFieldHelpText().trim() || null,
          fieldType,
          isRequired: this.newFieldRequired(),
          applicableRootProductTypeIds: applicableIds,
          scaleLabels: scaleLabelsPayload,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.isSavingCustomField.set(false);
            this.cancelCreateCustomField();
            // 編輯可能連動改綁生效中的因子、也會產生新舊兩個版本，直接
            // 重新整份載入因子清單與屬性清單，避免本地拼湊狀態失真，
            // 理由同 submitFactorDefinition()。
            this.store.loadCustomFieldDefinitions();
            this.store.loadFactorDefinitions();
            this.status.emit('自訂屬性已更新。');
          },
          error: (err) => {
            this.isSavingCustomField.set(false);
            this.showAlert(toApiError(err).message);
          },
        });
      return;
    }

    this.api
      .createCustomFieldDefinition({
        fieldCode,
        fieldName,
        helpText: this.newFieldHelpText().trim() || null,
        fieldType,
        isRequired: this.newFieldRequired(),
        applicableRootProductTypeIds: applicableIds,
        scaleLabels: scaleLabelsPayload,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.customFieldDefinitions.update((items) => [...items, toCustomFieldDefinitionVM(created)]);
          this.isSavingCustomField.set(false);
          this.cancelCreateCustomField();
          // 2026-09-24：原文案「目前還不會出現在商品表單上，那是下一階段的工作」
          // 已過時——商品表單早已依品類載入 custom-field-schema 並渲染這些題目。
          this.status.emit('自訂屬性已新增，商品新增／編輯表單會依適用品類顯示這一題。');
        },
        error: (err) => {
          this.isSavingCustomField.set(false);
          this.showAlert(toApiError(err).message);
        },
      });
  }

  disableCustomField(id: number): void {
    if (this.useMockData) {
      this.customFieldDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: false } : item)),
      );
      this.status.emit('已在本地停用 Mock 自訂屬性。');
      return;
    }
    this.api
      .disableCustomFieldDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.customFieldDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toCustomFieldDefinitionVM(updated) : item)),
          ),
        error: (err) => this.showAlert(toApiError(err).message),
      });
  }

  enableCustomField(id: number): void {
    if (this.useMockData) {
      this.customFieldDefinitions.update((items) =>
        items.map((item) => (item.id === id ? { ...item, isActive: true } : item)),
      );
      this.status.emit('已在本地啟用 Mock 自訂屬性。');
      return;
    }
    this.api
      .enableCustomFieldDefinition(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) =>
          this.customFieldDefinitions.update((items) =>
            items.map((item) => (item.id === id ? toCustomFieldDefinitionVM(updated) : item)),
          ),
        error: (err) => this.showAlert(toApiError(err).message),
      });
  }
}
