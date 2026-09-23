/*
 * 檔案用途：歷史開團紀錄 API 的唯一呼叫入口。
 *
 * 三支端點對應後端 GroupBuyRecordController，沒有單筆 CRUD——
 * 理由見 group-buy-api.contract.ts 的檔頭說明（系統邊界，非疏漏）。
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope } from '../../../core/api/api-envelope';
import { buildParams } from '../../../core/api/http-params';
import { unwrapData } from '../../../core/api/unwrap';
import {
  ClaimGroupBuyRecordsPayload,
  GROUP_BUY_API,
  GroupBuyClaimCandidatePayload,
  GroupBuyImportResultPayload,
  GroupBuyRecordListQuery,
  GroupBuyRecordResponsePayload,
  UnlinkedGroupBuyCandidateQuery,
} from './group-buy-api.contract';

@Injectable({ providedIn: 'root' })
export class GroupBuyApiService {
  private readonly http = inject(HttpClient);

  /**
   * 1. GET /api/group-buy-records [操作+管理]
   *
   * ⚠️ 後端判斷順序是 **productId 優先**：兩個參數都給時 productTypeId
   *    會被忽略。呼叫端應該只給其中一個。
   *
   * 採購也讀得到是刻意的——後端註解：「採購需要看到歷史成團狀況
   * 才能判斷自己的預估合不合理」。
   */
  list(query: GroupBuyRecordListQuery = {}): Observable<GroupBuyRecordResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<GroupBuyRecordResponsePayload[]>>(GROUP_BUY_API.list, {
        params: buildParams({
          productTypeId: query.productTypeId,
          productId: query.productId,
        }),
      })
      .pipe(unwrapData());
  }

  /**
   * 2. POST /api/group-buy-records/import [僅管理]
   *
   * ⚠️ multipart/form-data，欄位名固定是 **file**。
   * ⚠️ **不要自己設 Content-Type header**——瀏覽器需要自行產生含 boundary 的
   *    multipart/form-data; boundary=----xxx，手動設定後端會解不出檔案。
   *    （與 ProductApiService.uploadImage() 同一個注意事項。）
   *
   * ⚠️ **匯入失敗時 HTTP 仍是 200**。判斷成敗要看回傳的 success 欄位，
   *    不是看有沒有進 error callback。會進 error 的只有真正的請求層錯誤
   *    （沒帶檔案、檔案讀不到）。
   *
   * ⚠️ 全有或全無：有任何一列錯誤，整份檔案都不會寫入。
   */
  importCsv(file: File): Observable<GroupBuyImportResultPayload> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<ApiEnvelope<GroupBuyImportResultPayload>>(GROUP_BUY_API.import, formData)
      .pipe(unwrapData());
  }

  // 3. DELETE /api/group-buy-records/batch/{batchId}（整批回退）已於 2026-09-23
  //    分支整併時移除（前後端一併移除），理由見 group-buy.ts 檔案開頭說明。

  /**
   * 4. GET /api/group-buy-records/unlinked-candidates [操作+管理]
   *
   * 唯讀查詢，不修改任何資料。回傳 product_id 為 null 的歷史紀錄候選，
   * 供新增／編輯商品時「認領歷史紀錄」使用——系統只排序建議，**不做自動
   * 連結判定**，選定的 id 要交給使用者人工核對後，再呼叫 claim() 送出。
   */
  searchUnlinkedCandidates(query: UnlinkedGroupBuyCandidateQuery): Observable<GroupBuyClaimCandidatePayload[]> {
    return this.http
      .get<ApiEnvelope<GroupBuyClaimCandidatePayload[]>>(GROUP_BUY_API.unlinkedCandidates, {
        params: buildParams({
          productTypeId: query.productTypeId,
          name: query.name,
          supplierName: query.supplierName,
        }),
      })
      .pipe(unwrapData());
  }

  /**
   * 5. POST /api/group-buy-records/claim [操作+管理]
   *
   * ⚠️ 全有全無：只要有一筆驗證失敗（例如已經被別人認領過），整批都不會
   * 連結，不會出現「連了一半」的狀態。後端回 data: null，這裡不回傳內容。
   */
  claim(payload: ClaimGroupBuyRecordsPayload): Observable<void> {
    return this.http
      .post<ApiEnvelope<null>>(GROUP_BUY_API.claim, payload)
      .pipe(map(() => undefined));
  }
}
