/**
 * 後端 enum 的前端對應型別。
 *
 * 全部逐一對照 enums/ 底下的 Java 檔確認過，值與順序都以後端為準。
 * 這裡刻意用字面量聯集（union of string literals）而不是 TS enum：
 * 後端傳來的就是字串，用 TS enum 會多一層 EnumType.XXX 的轉換，
 * 而且 TS enum 在型別檢查上反而比字面量寬鬆。
 *
 * ⚠️ 這個檔案是「後端 enum 的鏡像」。後端加值時這裡要同步，
 * 顯示文案請寫在 labels.ts，不要混在這裡。
 */

/** enums/UserRole.java。⚠️ 不是 PURCHASER/ADMIN，也不是 OPERATOR。 */
export type UserRole = 'PURCHASER' | 'MANAGER';

/** enums/ProductReviewStatus.java。⚠️ 沒有 DRAFT 狀態，不要自行擴充。 */
export type ReviewStatus = 'PENDING' | 'REJECTED' | 'APPROVED';

/** enums/ProductItemStatus.java。 */
export type ItemStatus = 'ACTIVE' | 'ARCHIVED';

/** enums/ProductCandidateStatus.java。 */
export type CandidateStatus = 'AI_SUGGESTED' | 'CANDIDATE';

/** enums/ProductPricingType.java。⚠️ 與 productTypeId（商品實際分類）語意完全不同。 */
export type PricingType = 'NEW' | 'RESALE';

/** enums/ProductPricingStatus.java。新品建立後為 PENDING_PRICING。 */
export type PricingStatus = 'PENDING_PRICING' | 'PRICED';

/** enums/ReviewRecordReviewStatus.java。⚠️ 只有兩個值，沒有 PENDING——審核紀錄必然有結果。 */
export type ReviewDecision = 'APPROVED' | 'REJECTED';

/** enums/FestiveCategory.java。 */
export type FestiveCategory = 'FESTIVAL' | 'SEASON';

/** enums/FestiveCampaignStatus.java。 */
export type FestiveCampaignStatus = 'UPCOMING' | 'PREPARING' | 'ACTIVE' | 'EXPIRED';

/** enums/FestiveCampaignTagMatchTier.java。括號內為後端定義的權重值。 */
export type TagMatchTier = 'CORE' | 'GENERAL' | 'WEAK';

/**
 * enums/PriceSensitivityStatus.java。
 *
 * ⚠️ 這是後端這次的異動：priceSensitivity 從 String 改回 enum
 * （@Enumerated(EnumType.STRING)）。這與先前記錄的「已改為 free-text」
 * 方向相反——後端這次真的把型別換回去了，不是文件過期。
 * Jackson 序列化後就是 "LOW" / "MEDIUM" / "HIGH" 字串，前端直接沿用即可。
 */
export type PriceSensitivity = 'LOW' | 'MEDIUM' | 'HIGH';

/** enums/TrendSignalTrendDirection.java。 */
export type TrendDirection = 'UP' | 'DOWN' | 'STABLE';

/**
 * EvaluationResponse.dataSource / FestivalBoostResponse.dataSource。
 *
 * ⚠️ 後端是 String 不是 enum，但實際只會回這兩個值：
 * - SNAPSHOT：reviewStatus === 'APPROVED'，分數讀 review_records 凍結值
 * - LIVE：其餘狀態，讀 product_evaluations 即時值
 *
 * 前端不需要自己判斷該讀哪一軌（後端已處理），但建議顯示這個狀態，
 * 避免使用者疑惑「為什麼改了資料分數卻沒變」。
 */
export type DataSource = 'SNAPSHOT' | 'LIVE';

/** enums/TemperatureZone.java。Gate 屬性欄位之一，供 GATE_TEMPERATURE_ZONE 判定使用。 */
export type TemperatureZone = 'NORMAL' | 'CHILLED' | 'FROZEN';

/**
 * enums/ShelfLifeTier.java。Gate 屬性欄位之一，供 GATE_SHELF_LIFE 判定使用。
 * NA 代表「這件商品沒有效期概念」，不是「效期未知」——兩者語意不同，
 * 畫面上不要把 NA 跟「尚未填寫」用同一種視覺表示。
 */
export type ShelfLifeTier = 'D7' | 'D8_30' | 'D31_90' | 'D90_PLUS' | 'NA';

/** enums/SupplierLeadTimeTier.java。Gate 屬性欄位之一，供 GATE_LEAD_TIME 判定使用。 */
export type SupplierLeadTimeTier = 'D3' | 'D4_7' | 'D8_14' | 'D15_PLUS';

/**
 * enums/PackageSizeTier.java。供運費估算查表使用（進而影響毛利率因子），
 * 不是 Gate 判定的輸入。
 */
export type PackageSizeTier = 'XS' | 'S' | 'M' | 'L';

/** enums/PackingType.java。純 Signal 顯示用，不參與任何判定或計分。 */
export type PackingType = 'WHOLE_CARTON' | 'REPACK';

/**
 * enums/GateStatus.java。
 *
 * ⚠️ 只有 FAILED 算「明確擋下」，其餘三態都不阻擋送審——畫面上不要把
 * INSUFFICIENT_DATA／NOT_APPLICABLE 跟 FAILED 用同一種警示顏色，
 * 那會讓使用者分不清「這件真的有問題」跟「這件只是資料還沒填」或
 * 「這項檢查對這件商品不適用」，三者處理方式完全不同。
 */
export type GateStatus = 'PASSED' | 'FAILED' | 'INSUFFICIENT_DATA' | 'NOT_APPLICABLE';

/**
 * Gate 判定代碼。對應後端 GateEvaluationService 目前實作的五個 Gate。
 * riskCategory 目前恆為 null（後端尚未把 Gate 結果對應到風險分類），
 * 前端不要假設這個欄位一定有值。
 */
export type GateCode =
  | 'GATE_MOQ_FEASIBILITY'
  | 'GATE_LEAD_TIME'
  | 'GATE_SHELF_LIFE'
  | 'GATE_TEMPERATURE_ZONE'
  | 'GATE_DATA_COMPLETENESS';
