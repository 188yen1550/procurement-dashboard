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
