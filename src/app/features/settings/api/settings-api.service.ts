import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope } from '../../../core/api/api-envelope';
import { unwrapData } from '../../../core/api/unwrap';
import {
  AudienceProfileResponsePayload,
  AudienceProfileUpdateRequestPayload,
  CustomFieldDefinitionCreateRequestPayload,
  CustomFieldDefinitionResponsePayload,
  CustomFieldDefinitionUpdateRequestPayload,
  EvaluationFactorUpdateRequestPayload,
  EvaluationModeResponsePayload,
  FactorDefinitionCreateRequestPayload,
  FactorDefinitionResponsePayload,
  FactorDefinitionUpdateRequestPayload,
  FestiveCampaignCreateRequestPayload,
  FestiveCampaignManualStatusRequestPayload,
  FestiveCampaignResponsePayload,
  FestiveCampaignUpdateRequestPayload,
  ProductTypeCreateRequestPayload,
  ProductTypeResponsePayload,
  ProductTypeScoreBandCreateRequestPayload,
  ProductTypeScoreBandResponsePayload,
  ProductTypeScoreBandUpdateRequestPayload,
  ProductTypeUpdatePayload,
  RegionWeightPayload,
  RegionWeightUpdateRequestPayload,
  RiskOptionCreateRequestPayload,
  RiskOptionResponsePayload,
  RiskOptionUpdatePayload,
  SETTINGS_API,
  SystemSettingResponsePayload,
  SystemSettingUpdateRequestPayload,
  SwitchEvaluationModeRequestPayload,
  WeightSnapshotPayload,
  WeatherSignalPreviewPayload,
  WeatherSignalTagMappingCreateRequestPayload,
  WeatherSignalTagMappingResponsePayload,
  WeatherSignalTagMappingUpdateRequestPayload,
  WeatherSignalTagOptionPayload,
  WeatherSyncResponsePayload,
} from './settings-api.contract';

/**
 * 設定模組 API 的唯一呼叫入口。
 *
 * ## 為什麼這個模組沒有 mapper 檔
 *
 * 後端的 ProductTypeResponse / RiskOptionResponse / EvaluationModeResponse /
 * FestiveCampaignResponse 形狀跟畫面要的完全一致（id、name、isActive 這種
 * 直接就能綁的欄位），mapper 會變成把欄位原封不動抄一遍的無用中間層。
 *
 * 品項與審核模組有 mapper，是因為那邊有實質轉換：逗號字串拆陣列、
 * 多欄位組合出按鈕條件、多支 API 合併、snapshot 攤平。
 * 「每個模組都要有三層」不是原則，「有實質轉換才需要 mapper」才是。
 *
 * 唯一的轉換需求是 keywords / alertKeywords 的字串↔陣列，
 * 那已經在 core/domain/labels.ts 的 splitKeywords() 提供，
 * 元件直接用即可，不必為此開一個檔案。
 */
@Injectable({ providedIn: 'root' })
export class SettingsApiService {
  private readonly http = inject(HttpClient);

  // ----- 評估模式 -----

  /** 1. GET /api/settings/evaluation-modes [僅管理]：3 套固定模式。 */
  getEvaluationModes(): Observable<EvaluationModeResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<EvaluationModeResponsePayload[]>>(SETTINGS_API.evaluationModes)
      .pipe(unwrapData());
  }

  /**
   * 2. GET /api/settings/evaluation-modes/{id}/factors [僅管理]：權重明細。
   * 回傳 WeightSnapshot，與 evaluation 端點的 weights 是同一個型別。
   */
  getEvaluationModeFactors(id: number): Observable<WeightSnapshotPayload> {
    return this.http
      .get<ApiEnvelope<WeightSnapshotPayload>>(SETTINGS_API.evaluationModeFactors(id))
      .pipe(unwrapData());
  }

  /**
   * 3. GET /api/settings/evaluation-mode/current [操作+管理]
   * ⚠️ 這支操作層也能呼叫，品項詳情頁需要顯示目前用哪套模式。
   */
  getCurrentEvaluationMode(): Observable<EvaluationModeResponsePayload> {
    return this.http
      .get<ApiEnvelope<EvaluationModeResponsePayload>>(SETTINGS_API.currentEvaluationMode)
      .pipe(unwrapData());
  }

  /**
   * 4. PUT /api/settings/evaluation-mode/current [僅管理]：切換生效模式。
   *
   * ⚠️ 切換模式會改變**所有未審核商品**的即時分數（LIVE 那一軌）。
   * 已審核通過的商品讀 SNAPSHOT，不受影響。
   * 這個影響範圍建議在 UI 上明講，不要讓使用者以為只是換個顯示。
   */
  switchEvaluationMode(evaluationModeId: number): Observable<EvaluationModeResponsePayload> {
    const body: SwitchEvaluationModeRequestPayload = { evaluationModeId };
    return this.http
      .put<ApiEnvelope<EvaluationModeResponsePayload>>(
        SETTINGS_API.currentEvaluationMode,
        body,
      )
      .pipe(unwrapData());
  }

  // ----- 人工風險選項 -----

  /**
   * 5. GET /api/settings/risk-options [僅管理]
   *
   * 管理清單需包含已停用項目及 isActive，才能在重載後再次啟用。
   * 若後端僅回啟用項目，前端只能保留本次操作中停用的列。
   */
  getRiskOptions(): Observable<RiskOptionResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<RiskOptionResponsePayload[]>>(SETTINGS_API.riskOptions)
      .pipe(unwrapData());
  }

  /** 6. POST /api/settings/risk-options [僅管理]：新增後立即出現在審核頁勾選清單。 */
  createRiskOption(
    body: RiskOptionCreateRequestPayload,
  ): Observable<RiskOptionResponsePayload> {
    return this.http
      .post<ApiEnvelope<RiskOptionResponsePayload>>(SETTINGS_API.riskOptions, body)
      .pipe(unwrapData());
  }

  // ----- 自訂計分因子（2026-09-20新增，方案B）-----

  /** GET /api/settings/factor-definitions [僅管理]：含已停用項目。 */
  getFactorDefinitions(): Observable<FactorDefinitionResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<FactorDefinitionResponsePayload[]>>(SETTINGS_API.factorDefinitions)
      .pipe(unwrapData());
  }

  /**
   * POST /api/settings/factor-definitions [僅管理]：新增自訂因子。
   * 新增後不影響任何評估模式的分數，要另外去權重編輯把它加進某個自訂模式，
   * 見 FactorDefinitionCreateRequestPayload 的類別註解。
   */
  createFactorDefinition(
    body: FactorDefinitionCreateRequestPayload,
  ): Observable<FactorDefinitionResponsePayload> {
    return this.http
      .post<ApiEnvelope<FactorDefinitionResponsePayload>>(SETTINGS_API.factorDefinitions, body)
      .pipe(unwrapData());
  }

  /**
   * PUT /api/settings/factor-definitions/{id} [僅管理]：編輯自訂因子（V14新增）。
   * 回應是新版本（新id）的資料，不是被取代的舊版本——呼叫端應以回應內容
   * 取代畫面上原本這一列，見 FactorDefinitionUpdateRequestPayload 類別註解。
   */
  updateFactorDefinition(
    id: number,
    body: FactorDefinitionUpdateRequestPayload,
  ): Observable<FactorDefinitionResponsePayload> {
    return this.http
      .put<ApiEnvelope<FactorDefinitionResponsePayload>>(SETTINGS_API.updateFactorDefinition(id), body)
      .pipe(unwrapData());
  }

  /** PUT /api/settings/factor-definitions/{id}/disable [僅管理] */
  disableFactorDefinition(id: number): Observable<FactorDefinitionResponsePayload> {
    return this.http
      .put<ApiEnvelope<FactorDefinitionResponsePayload>>(SETTINGS_API.disableFactorDefinition(id), {})
      .pipe(unwrapData());
  }

  /** PUT /api/settings/factor-definitions/{id}/enable [僅管理] */
  enableFactorDefinition(id: number): Observable<FactorDefinitionResponsePayload> {
    return this.http
      .put<ApiEnvelope<FactorDefinitionResponsePayload>>(SETTINGS_API.enableFactorDefinition(id), {})
      .pipe(unwrapData());
  }

  // ----- 自訂商品屬性（動態問卷，2026-09-20新增，Phase 1）-----

  /** GET /api/settings/custom-field-definitions [僅管理]：含已停用項目。 */
  getCustomFieldDefinitions(): Observable<CustomFieldDefinitionResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<CustomFieldDefinitionResponsePayload[]>>(SETTINGS_API.customFieldDefinitions)
      .pipe(unwrapData());
  }

  /** POST /api/settings/custom-field-definitions [僅管理]：新增自訂屬性題目。 */
  createCustomFieldDefinition(
    body: CustomFieldDefinitionCreateRequestPayload,
  ): Observable<CustomFieldDefinitionResponsePayload> {
    return this.http
      .post<ApiEnvelope<CustomFieldDefinitionResponsePayload>>(SETTINGS_API.customFieldDefinitions, body)
      .pipe(unwrapData());
  }

  /**
   * PUT /api/settings/custom-field-definitions/{id} [僅管理]：編輯自訂屬性
   * 題目（V14新增）。回應是新版本（新id）的資料，見
   * CustomFieldDefinitionUpdateRequestPayload 類別註解。
   */
  updateCustomFieldDefinition(
    id: number,
    body: CustomFieldDefinitionUpdateRequestPayload,
  ): Observable<CustomFieldDefinitionResponsePayload> {
    return this.http
      .put<ApiEnvelope<CustomFieldDefinitionResponsePayload>>(
        SETTINGS_API.updateCustomFieldDefinition(id),
        body,
      )
      .pipe(unwrapData());
  }

  /** PUT /api/settings/custom-field-definitions/{id}/disable [僅管理] */
  disableCustomFieldDefinition(id: number): Observable<CustomFieldDefinitionResponsePayload> {
    return this.http
      .put<ApiEnvelope<CustomFieldDefinitionResponsePayload>>(SETTINGS_API.disableCustomFieldDefinition(id), {})
      .pipe(unwrapData());
  }

  /** PUT /api/settings/custom-field-definitions/{id}/enable [僅管理] */
  enableCustomFieldDefinition(id: number): Observable<CustomFieldDefinitionResponsePayload> {
    return this.http
      .put<ApiEnvelope<CustomFieldDefinitionResponsePayload>>(SETTINGS_API.enableCustomFieldDefinition(id), {})
      .pipe(unwrapData());
  }

  // ----- 核心客群 -----

  /** 7. GET /api/settings/audience-profile [僅管理]：永遠只有一筆。 */
  getAudienceProfile(): Observable<AudienceProfileResponsePayload> {
    return this.http
      .get<ApiEnvelope<AudienceProfileResponsePayload>>(SETTINGS_API.audienceProfile)
      .pipe(unwrapData());
  }

  /** 8. PUT /api/settings/audience-profile [僅管理]：⚠️ 整份覆蓋，要送完整欄位。 */
  updateAudienceProfile(
    body: AudienceProfileUpdateRequestPayload,
  ): Observable<AudienceProfileResponsePayload> {
    return this.http
      .put<ApiEnvelope<AudienceProfileResponsePayload>>(SETTINGS_API.audienceProfile, body)
      .pipe(unwrapData());
  }

  // ----- 商品類型 -----

  /**
   * 9. GET /api/settings/product-types [操作+管理]
   * ⚠️ 操作層也能呼叫，新增商品的類型下拉需要這份資料。
   * 若只是要把 productTypeId 轉成名稱，請用 ProductTypeLookupService（有快取）。
   */
  getProductTypes(): Observable<ProductTypeResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<ProductTypeResponsePayload[]>>(SETTINGS_API.productTypes)
      .pipe(unwrapData());
  }

  /** 10. POST /api/settings/product-types [僅管理] */
  createProductType(
    body: ProductTypeCreateRequestPayload,
  ): Observable<ProductTypeResponsePayload> {
    return this.http
      .post<ApiEnvelope<ProductTypeResponsePayload>>(SETTINGS_API.productTypes, body)
      .pipe(unwrapData());
  }

  /** 11. PUT /api/settings/product-types/{id}/disable [僅管理]：停用而非刪除。 */
  disableProductType(id: number): Observable<ProductTypeResponsePayload> {
    return this.http
      .put<ApiEnvelope<ProductTypeResponsePayload>>(SETTINGS_API.disableProductType(id), {})
      .pipe(unwrapData());
  }

  /**
   * 11b. PUT /api/settings/product-types/{id}/enable [僅管理]：停用的反向操作。
   *
   * ⚠️ 後端端點的動詞是 `enable`，不是 `restore`。
   * SettingsController.enableProductType() 才是實際存在的那一支；
   * 先前這裡打的 `/restore` 後端從來沒有實作過，真實模式下必定 404。
   *
   * 命名保留 restoreProductType 是為了對齊畫面上的「復用」字樣與
   * settings.ts 既有呼叫端，避免為了改名而動到不相關的檔案。
   */
  restoreProductType(id: number): Observable<ProductTypeResponsePayload> {
    return this.http
      .put<ApiEnvelope<ProductTypeResponsePayload>>(SETTINGS_API.productTypeEnable(id), {})
      .pipe(unwrapData());
  }

  /**
   * 12. DELETE /api/settings/product-types/{id} [僅管理]
   *
   * ⚠️ 條件式刪除：被商品引用中的類型會收到 409（即使那些商品都已封存）。
   * 收到 409 時要提示「此類型已被商品使用，請改用停用」，
   * 不要顯示通用錯誤——使用者需要知道替代方案是什麼。
   */
  deleteProductType(id: number): Observable<void> {
    return this.http
      .delete<ApiEnvelope<null>>(SETTINGS_API.deleteProductType(id))
      .pipe(map(() => undefined));
  }

  // ----- 節慶檔期 -----

  /** 13. GET /api/settings/festive-campaigns [操作+管理] */
  getFestiveCampaigns(): Observable<FestiveCampaignResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<FestiveCampaignResponsePayload[]>>(SETTINGS_API.festiveCampaigns)
      .pipe(unwrapData());
  }

  /** 14. POST /api/settings/festive-campaigns [僅管理]：campaignCode 必須唯一。 */
  createFestiveCampaign(
    body: FestiveCampaignCreateRequestPayload,
  ): Observable<FestiveCampaignResponsePayload> {
    return this.http
      .post<ApiEnvelope<FestiveCampaignResponsePayload>>(SETTINGS_API.festiveCampaigns, body)
      .pipe(unwrapData());
  }

  /**
   * 15. PUT /api/settings/festive-campaigns/{id} [僅管理]
   *
   * ⚠️ 不能改 campaignCode（後端 UpdateRequest 沒有這個欄位）。
   * ⚠️ tags 整份覆蓋：送出前必須先載入現有標籤，否則會清光。
   */
  updateFestiveCampaign(
    id: number,
    body: FestiveCampaignUpdateRequestPayload,
  ): Observable<FestiveCampaignResponsePayload> {
    return this.http
      .put<ApiEnvelope<FestiveCampaignResponsePayload>>(
        SETTINGS_API.updateFestiveCampaign(id),
        body,
      )
      .pipe(unwrapData());
  }

  /**
   * 16. POST /api/settings/festive-campaigns/{id}/manual-status [僅管理]
   * ⚠️ 與「編輯」是兩個獨立入口，不要合併成同一個存檔按鈕。
   */
  switchFestiveCampaignStatus(
    id: number,
    body: FestiveCampaignManualStatusRequestPayload,
  ): Observable<FestiveCampaignResponsePayload> {
    return this.http
      .post<ApiEnvelope<FestiveCampaignResponsePayload>>(
        SETTINGS_API.festiveCampaignManualStatus(id),
        body,
      )
      .pipe(unwrapData());
  }

  // ----- 天氣檔期同步（WeatherController，2026-09-21新增）-----

  /**
   * POST /api/settings/weather/sync [僅管理]
   * 手動觸發一次完整天氣檔期同步，與每天05:00排程呼叫的是後端同一支方法，
   * 行為完全一致，只是觸發時機從cron換成這支HTTP請求。
   */
  syncWeatherCampaigns(): Observable<WeatherSyncResponsePayload> {
    return this.http
      .post<ApiEnvelope<WeatherSyncResponsePayload>>(SETTINGS_API.weatherSync, {})
      .pipe(unwrapData());
  }

  /**
   * GET /api/settings/weather/signals/preview [僅管理]
   * 只預覽這次會分類出的天氣訊號，**不寫入資料庫**。想看落地後的檔期，
   * 呼叫上面 syncWeatherCampaigns() 之後改查 getFestiveCampaigns()。
   */
  previewWeatherSignals(): Observable<WeatherSignalPreviewPayload[]> {
    return this.http
      .get<ApiEnvelope<WeatherSignalPreviewPayload[]>>(SETTINGS_API.weatherSignalsPreview)
      .pipe(unwrapData());
  }

  // ----- 天氣訊號標籤對照（SettingsController，2026-09-22新增）-----

  /** GET /api/settings/weather-signal-tags [僅管理]：含已停用與系統預設項目。 */
  getWeatherSignalTagMappings(): Observable<WeatherSignalTagMappingResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<WeatherSignalTagMappingResponsePayload[]>>(SETTINGS_API.weatherSignalTags)
      .pipe(unwrapData());
  }

  /** POST /api/settings/weather-signal-tags [僅管理]：新增後下一次同步立即採計。 */
  createWeatherSignalTagMapping(
    body: WeatherSignalTagMappingCreateRequestPayload,
  ): Observable<WeatherSignalTagMappingResponsePayload> {
    return this.http
      .post<ApiEnvelope<WeatherSignalTagMappingResponsePayload>>(SETTINGS_API.weatherSignalTags, body)
      .pipe(unwrapData());
  }

  /** PUT /api/settings/weather-signal-tags/{id} [僅管理]：只能改matchTier。 */
  updateWeatherSignalTagMapping(
    id: number,
    body: WeatherSignalTagMappingUpdateRequestPayload,
  ): Observable<WeatherSignalTagMappingResponsePayload> {
    return this.http
      .put<ApiEnvelope<WeatherSignalTagMappingResponsePayload>>(
        SETTINGS_API.updateWeatherSignalTagMapping(id),
        body,
      )
      .pipe(unwrapData());
  }

  /** PUT /api/settings/weather-signal-tags/{id}/disable [僅管理]：含系統預設項目，僅可停用不可刪除。 */
  disableWeatherSignalTagMapping(id: number): Observable<WeatherSignalTagMappingResponsePayload> {
    return this.http
      .put<ApiEnvelope<WeatherSignalTagMappingResponsePayload>>(
        SETTINGS_API.disableWeatherSignalTagMapping(id),
        {},
      )
      .pipe(unwrapData());
  }

  /** PUT /api/settings/weather-signal-tags/{id}/enable [僅管理] */
  enableWeatherSignalTagMapping(id: number): Observable<WeatherSignalTagMappingResponsePayload> {
    return this.http
      .put<ApiEnvelope<WeatherSignalTagMappingResponsePayload>>(
        SETTINGS_API.enableWeatherSignalTagMapping(id),
        {},
      )
      .pipe(unwrapData());
  }

  /**
   * GET /api/settings/weather-signal-tags/options [操作+管理]（2026-09-23新增）：
   * 商品表單「可選標籤」下拉用，只回傳isActive=true、精簡過的欄位。
   */
  getWeatherSignalTagOptions(): Observable<WeatherSignalTagOptionPayload[]> {
    return this.http
      .get<ApiEnvelope<WeatherSignalTagOptionPayload[]>>(SETTINGS_API.weatherSignalTagOptions)
      .pipe(unwrapData());
  }

  // ----- 地域占比設定（region_weights，2026-09-23新增，地域性影響評分方案B+D）-----

  /** GET /api/settings/region-weights [僅管理]：固定回傳四區。 */
  getRegionWeights(): Observable<RegionWeightPayload[]> {
    return this.http
      .get<ApiEnvelope<RegionWeightPayload[]>>(SETTINGS_API.regionWeights)
      .pipe(unwrapData());
  }

  /** PUT /api/settings/region-weights [僅管理]：整份覆蓋四區占比，加總須為100。 */
  updateRegionWeights(body: RegionWeightUpdateRequestPayload): Observable<RegionWeightPayload[]> {
    return this.http
      .put<ApiEnvelope<RegionWeightPayload[]>>(SETTINGS_API.regionWeights, body)
      .pipe(unwrapData());
  }

  // ==========================================
  // 🌟 以下為本次新增的 6 支 API
  // ==========================================

  /** 17. 帳號 復用 (PUT /api/users/{id}/enable) */
  enableUser(id: number): Observable<void> {
    return this.http
      .put<ApiEnvelope<void>>(SETTINGS_API.userEnable(id), {})
      .pipe(unwrapData());
  }

  /** 18. 商品類型 復用 (PUT /api/settings/product-types/{id}/enable) */
  enableProductType(id: number): Observable<ProductTypeResponsePayload> {
    return this.http
      .put<ApiEnvelope<ProductTypeResponsePayload>>(SETTINGS_API.productTypeEnable(id), {})
      .pipe(unwrapData());
  }

  /** 19. 商品類別 重新命名 (PUT /api/settings/product-types/{id}) */
  updateProductType(
    id: number,
    body: ProductTypeUpdatePayload,
  ): Observable<ProductTypeResponsePayload> {
    return this.http
      .put<ApiEnvelope<ProductTypeResponsePayload>>(SETTINGS_API.productTypeUpdate(id), body)
      .pipe(unwrapData());
  }

  /** 20. 人工風險選項 停用 (PUT /api/settings/risk-options/{id}/disable) */
  disableRiskOption(id: number): Observable<RiskOptionResponsePayload> {
    return this.http
      .put<ApiEnvelope<RiskOptionResponsePayload>>(SETTINGS_API.riskOptionDisable(id), {})
      .pipe(unwrapData());
  }

  /** 21. 人工風險選項 復用 (PUT /api/settings/risk-options/{id}/enable) */
  enableRiskOption(id: number): Observable<RiskOptionResponsePayload> {
    return this.http
      .put<ApiEnvelope<RiskOptionResponsePayload>>(SETTINGS_API.riskOptionEnable(id), {})
      .pipe(unwrapData());
  }

  /** 22. 人工風險選項 重新命名 & 關鍵字修改 (PUT /api/settings/risk-options/{id}) */
  updateRiskOption(
    id: number,
    body: RiskOptionUpdatePayload,
  ): Observable<RiskOptionResponsePayload> {
    return this.http
      .put<ApiEnvelope<RiskOptionResponsePayload>>(SETTINGS_API.riskOptionUpdate(id), body)
      .pipe(unwrapData());
  }

  // ----- 評估權重編輯（僅自訂模式）-----

  /**
   * 23. PUT /api/settings/evaluation-modes/{id}/factors [僅管理]
   *
   * ⚠️ **整份覆蓋**：body.factors 必須包含全部七個因子。只送想改的那幾個
   *    會讓後端拿資料庫現值補齊後才驗加總，與畫面上顯示的加總可能不一致。
   *
   * ⚠️ 呼叫前請自行確認加總為 100（FACTOR_WEIGHT_TOTAL），
   *    後端會擋，但先在前端擋下可以省一次往返、也能即時標示是哪一欄有問題。
   *
   * ⚠️ **只有 isEditable = true 的模式能改**。對固定模式呼叫會被後端拒絕。
   *
   * ⚠️ 權重調整**只影響之後新送審的商品**，已完成審核的紀錄不會變動
   *    （審核 snapshot 不可覆蓋）。這句話必須顯示給使用者看，否則主管會
   *    以為調權重可以修正已經審過的分數。
   */
  updateEvaluationModeFactors(
    id: number,
    body: EvaluationFactorUpdateRequestPayload,
  ): Observable<WeightSnapshotPayload> {
    return this.http
      .put<ApiEnvelope<WeightSnapshotPayload>>(SETTINGS_API.evaluationModeFactors(id), body)
      .pipe(unwrapData());
  }

  // ----- 目標區間 -----

  /**
   * 24. GET /api/settings/product-type-score-bands [操作+管理]
   *
   * ⚠️ 讀取權限與其他 settings 端點不同——這一支**採購也讀得到**，
   *    後端沒有掛 @PreAuthorize。修改（PUT）才是僅管理。
   *
   * ⚠️ 回傳裡 productTypeId 為 null 的是**全域預設區間**，
   *    套用到所有沒有專屬設定的品類。畫面要能區分，不要顯示成空白。
   */
  getProductTypeScoreBands(): Observable<ProductTypeScoreBandResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<ProductTypeScoreBandResponsePayload[]>>(SETTINGS_API.productTypeScoreBands)
      .pipe(unwrapData());
  }

  /**
   * 25. POST /api/settings/product-type-score-bands [僅管理]
   *
   * 新增品類專屬目標區間。⚠️ 只支援 MANUAL 模式建立，body 不接受
   * sourceMode 欄位——後端 DTO 就沒有這個欄位，新建列一律是 MANUAL。
   *
   * ⚠️ 同一品類×因子已存在生效中的列時，後端回 400（訊息會提示改用
   *    編輯），呼叫端把這個錯誤原樣顯示即可，不需要另外判斷成別的文案。
   */
  createProductTypeScoreBand(
    body: ProductTypeScoreBandCreateRequestPayload,
  ): Observable<ProductTypeScoreBandResponsePayload> {
    return this.http
      .post<ApiEnvelope<ProductTypeScoreBandResponsePayload>>(
        SETTINGS_API.createProductTypeScoreBand,
        body,
      )
      .pipe(unwrapData());
  }

  /**
   * 26. PUT /api/settings/product-type-score-bands/{id} [僅管理]
   *
   * ⚠️ sourceMode 決定 body 其餘欄位會不會被採用：
   *    - MANUAL：帶 lowerBound／upperBound；沒帶則沿用資料庫現值（不清空）
   *    - HISTORICAL：lowerBound／upperBound **一律被忽略**，
   *      後端從歷史開團紀錄重新計算並凍結
   *
   * 所以切到 HISTORICAL 時畫面應把上下界設為唯讀，
   * 不要讓使用者填了數字、存檔後才發現沒生效。
   */
  updateProductTypeScoreBand(
    id: number,
    body: ProductTypeScoreBandUpdateRequestPayload,
  ): Observable<ProductTypeScoreBandResponsePayload> {
    return this.http
      .put<ApiEnvelope<ProductTypeScoreBandResponsePayload>>(
        SETTINGS_API.updateProductTypeScoreBand(id),
        body,
      )
      .pipe(unwrapData());
  }

  // ----- 系統設定（演算法參數）-----

  /**
   * 26. GET /api/settings/system-settings [僅管理]
   *
   * 貝氏收縮 k 值、趨勢半衰期等演算法參數清單，每筆附帶型別與合法範圍，
   * 畫面依此渲染輸入元件並做送出前檢查。
   */
  getSystemSettings(): Observable<SystemSettingResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<SystemSettingResponsePayload[]>>(SETTINGS_API.systemSettings)
      .pipe(unwrapData());
  }

  /**
   * 27. PUT /api/settings/system-settings/{key} [僅管理]
   *
   * ⚠️ 後端依 key 對照登記表驗證型別與範圍，失敗時是 400，
   * message 會說明是違反哪個限制，直接顯示即可。
   */
  updateSystemSetting(
    key: string,
    body: SystemSettingUpdateRequestPayload,
  ): Observable<SystemSettingResponsePayload> {
    return this.http
      .put<ApiEnvelope<SystemSettingResponsePayload>>(SETTINGS_API.updateSystemSetting(key), body)
      .pipe(unwrapData());
  }
}
