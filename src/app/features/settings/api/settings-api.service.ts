import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope } from '../../../core/api/api-envelope';
import { unwrapData } from '../../../core/api/unwrap';
import {
  AudienceProfileResponsePayload,
  AudienceProfileUpdateRequestPayload,
  EvaluationModeResponsePayload,
  FestiveCampaignCreateRequestPayload,
  FestiveCampaignManualStatusRequestPayload,
  FestiveCampaignResponsePayload,
  FestiveCampaignUpdateRequestPayload,
  ProductTypeCreateRequestPayload,
  ProductTypeResponsePayload,
  RiskOptionCreateRequestPayload,
  RiskOptionResponsePayload,
  SETTINGS_API,
  SwitchEvaluationModeRequestPayload,
  WeightSnapshotPayload,
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
   * ⚠️ 這支回**全部**選項（含已停用），用途是設定頁的管理清單，
   * 以及決策紀錄把 riskOptionIds 對照成名稱。
   * 審核頁的勾選清單**不要用這支**——那份資料在
   * GET /api/reviews/{productId} 的 availableRiskOptions，只含啟用中的。
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
}
