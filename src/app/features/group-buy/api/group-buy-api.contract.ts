/*
 * 檔案用途：歷史開團紀錄的 API 契約。對應後端 GroupBuyRecordController
 * （@RequestMapping("/api/group-buy-records")）。
 *
 * ## 為什麼這個模組只有三支端點、沒有單筆 CRUD
 * 後端 Controller 註解寫得很明白，這是刻意的系統邊界：選品系統的職責
 * 到「審核」為止，不負責審核之後的開團執行。開團結果由外部系統產生後
 * 批次匯入，在本系統內是**唯讀的參考資料**。
 *
 * 只有兩種寫入路徑：整批匯入、整批回退。兩者都是批次級別，
 * 這樣每一筆資料的來源永遠可以追溯到某一次匯入。
 *
 * ⚠️ 請勿為了「補齊 CRUD」而在前端做出單筆新增／編輯／刪除的 UI，
 *    後端沒有對應端點，做了也只會是 404。
 *
 * ## 這份資料為什麼重要
 * historical_fulfillment（歷史成團率）在各評估模式裡佔 15~35% 的權重，
 * 資料來源就是這張表。沒有匯入資料時該項分數會失真。
 */
import { Decimal, IsoDate, IsoDateTime } from '../../../core/api/api-envelope';

export const GROUP_BUY_API = {
  /** GET [操作+管理]：唯讀查詢，可用 productTypeId／productId 篩選。 */
  list: '/api/group-buy-records',
  /** POST [僅管理]：CSV 匯入，multipart/form-data，欄位名固定 file。 */
  import: '/api/group-buy-records/import',
  /** DELETE [僅管理]：整批回退。 */
  deleteBatch: (batchId: string) => `/api/group-buy-records/batch/${encodeURIComponent(batchId)}`,
  /** GET [操作+管理]：認領歷史紀錄的候選查詢，唯讀。 */
  unlinkedCandidates: '/api/group-buy-records/unlinked-candidates',
  /** POST [操作+管理]：把選定的歷史紀錄連結到指定商品。 */
  claim: '/api/group-buy-records/claim',
} as const;

/**
 * 開團結果。對應後端 GroupBuyResult enum。
 *
 * ⚠️ 成團率的分母**只計 FULFILLED + FAILED，CANCELLED 不計入**。
 * 後端 enum 註解說明理由：取消開團多半是營運面決定（供應商臨時出不了貨、
 * 檔期調整），不代表客群不買單，算進分母會低估該品類的真實成團能力。
 * 前端自行計算成團率時必須沿用同一個分母，否則畫面數字會跟評分用的不一致。
 */
export type GroupBuyResultCode = 'FULFILLED' | 'FAILED' | 'CANCELLED';

/** 後端 GroupBuyResult enum 建構子裡的中文名稱，後端不外露，前端自行對應。 */
export const GROUP_BUY_RESULT_LABEL: Record<GroupBuyResultCode, string> = {
  FULFILLED: '成團',
  FAILED: '未成團',
  CANCELLED: '取消開團',
};

/**
 * GET /api/group-buy-records 的 query 參數。
 *
 * ⚠️ 後端的判斷順序是 **productId 優先**：兩個都給時只會用 productId，
 * productTypeId 會被忽略。畫面上不要讓使用者同時選兩個，
 * 否則會看到「品類篩選沒有作用」而不知道為什麼。
 */
export interface GroupBuyRecordListQuery {
  productTypeId?: number;
  productId?: number;
}

/**
 * 對應後端 GroupBuyRecordResponse.java，逐欄核對過。
 *
 * ⚠️ productId 可為 null——歷史紀錄不一定對得上系統內現存的商品
 * （外部系統開過的團，本系統可能根本沒有那個品項）。
 * 這種情況要靠 externalProductName 顯示名稱，不要顯示成「商品 #null」。
 *
 * ⚠️ isSimulated 代表這是模擬資料而非真實開團。畫面上必須標示出來，
 * 否則使用者會把模擬數字當成真實績效做決策。
 *
 * ⚠️ 大量數值欄位可為 null（匯入時 CSV 沒帶那一欄）。
 * 顯示時要用「—」之類的佔位符，不要把 null 算成 0 再拿去做統計。
 */
export interface GroupBuyRecordResponsePayload {
  id: number;
  /** 對應本系統商品；外部商品時為 null。 */
  productId: number | null;
  productTypeId: number | null;
  externalProductName: string;
  supplierName: string | null;
  campaignStartDate: IsoDate | null;
  campaignEndDate: IsoDate | null;
  moqAtTime: number | null;
  salePriceAtTime: Decimal | null;
  costPriceAtTime: Decimal | null;
  marketPriceAtTime: Decimal | null;
  targetQuantity: number | null;
  actualQuantity: number | null;
  participantCount: number | null;
  result: GroupBuyResultCode;
  complaintCount: number | null;
  returnCount: number | null;
  /** true = 模擬資料，非真實開團績效。畫面必須標示。 */
  isSimulated: boolean | null;
  /** 所屬匯入批次，整批回退時要用這個值。 */
  importBatchId: string | null;
  importedAt: IsoDateTime | null;
}

/**
 * 對應後端 GroupBuyImportResult.java（POST /import 的回應）。
 *
 * ⚠️ **採全有或全無**：任何一列有錯就整批拒絕，不做部分成功。
 * 後端註解說明理由：部分成功會讓使用者難以判斷資料庫現在是什麼狀態，
 * 而修正後重匯又會造成重複。
 *
 * ⚠️ **匯入失敗時 HTTP 仍是 200**，不是 400。失敗結果（哪幾列有錯）
 * 本身就是使用者要看的資料。所以**不能靠 HTTP 狀態碼判斷成敗**，
 * 必須看 body 裡的 success 欄位。只有真正的請求錯誤
 * （沒選檔案、檔案讀不到）才會是 400。
 */
export interface GroupBuyImportResultPayload {
  /** ⚠️ 判斷成敗看這裡，不是看 HTTP 狀態碼。 */
  success: boolean;
  /** 成功時才有值；失敗時為 null。整批回退要用它。 */
  importBatchId: string | null;
  totalRows: number;
  /** 失敗時為 0（全有或全無）。 */
  importedRows: number;
  errors: GroupBuyImportRowErrorPayload[];
}

/**
 * 對應後端 GroupBuyImportResult.RowError。
 *
 * rowNumber 是 **CSV 的實際列號（含標頭列，從 1 起算）**，後端註解說明
 * 這是為了讓使用者直接在 Excel 裡跳到那一列，不用自己換算。
 * 顯示時請照原值顯示，不要 +1 或 −1「修正」。
 */
export interface GroupBuyImportRowErrorPayload {
  /** CSV 實際列號，含標頭列，從 1 起算。 */
  rowNumber: number;
  field: string;
  message: string;
}

/**
 * CSV 必要欄位。對應後端 GroupBuyRecordService.REQUIRED_HEADERS。
 * 缺任何一欄整份檔案會被拒絕，所以上傳前先在前端檢查一次，
 * 比送出去等後端回錯誤快得多。
 */
export const GROUP_BUY_CSV_REQUIRED_HEADERS: readonly string[] = [
  'product_type_name',
  'external_product_name',
  'campaign_start_date',
  'campaign_end_date',
  'actual_quantity',
  'result',
];

/**
 * CSV 可接受的全部欄位。對應後端 GroupBuyRecordService.KNOWN_HEADERS。
 * 順序即建議的欄位順序，供畫面產生範本檔使用。
 */
export const GROUP_BUY_CSV_KNOWN_HEADERS: readonly string[] = [
  'product_id',
  'product_type_name',
  'external_product_name',
  'supplier_name',
  'campaign_start_date',
  'campaign_end_date',
  'moq_at_time',
  'sale_price_at_time',
  'cost_price_at_time',
  'market_price_at_time',
  'target_quantity',
  'actual_quantity',
  'participant_count',
  'result',
  'complaint_count',
  'return_count',
  'is_simulated',
];

/**
 * GET /api/group-buy-records/unlinked-candidates 的 query 參數。
 * 對應 GroupBuyRecordController.searchUnlinkedCandidates() 的三個 @RequestParam。
 */
export interface UnlinkedGroupBuyCandidateQuery {
  productTypeId: number;
  name: string;
  supplierName?: string;
}

/**
 * 對應後端 GroupBuyRecordClaimCandidateResponse.java。
 *
 * 比對邏輯與欄位形狀比照 product-management 模組的
 * SimilarProductCandidatePayload：分項相似度而非只給綜合分數，
 * nameSimilarity／supplierSimilarity 都是 0~1，畫面顯示需要 ×100。
 * supplierSimilarity 任一邊供應商名稱為空時是 null，不是 0。
 */
export interface GroupBuyClaimCandidatePayload {
  id: number;
  externalProductName: string;
  supplierName: string | null;
  campaignStartDate: IsoDate;
  campaignEndDate: IsoDate;
  actualQuantity: number | null;
  result: GroupBuyResultCode;
  nameSimilarity: Decimal;
  supplierSimilarity: Decimal | null;
  combinedScore: Decimal;
}

/**
 * POST /api/group-buy-records/claim 的 Request Body。
 * 對應後端 ClaimGroupBuyRecordsRequest.java。
 */
export interface ClaimGroupBuyRecordsPayload {
  productId: number;
  groupBuyRecordIds: number[];
}
