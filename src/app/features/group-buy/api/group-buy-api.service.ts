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
  GROUP_BUY_API,
  GroupBuyImportResultPayload,
  GroupBuyRecordListQuery,
  GroupBuyRecordResponsePayload,
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

  /**
   * 3. DELETE /api/group-buy-records/batch/{batchId} [僅管理]
   *
   * 整批退回。匯入錯誤時使用，不需要逐筆刪除。
   *
   * ⚠️ 這是**不可復原**的破壞性操作，且影響範圍是整批（可能上百筆）。
   *    畫面上必須二次確認，並且在確認訊息裡寫清楚這個批次有幾筆資料，
   *    不要只寫一個 batchId 讓使用者自己猜。
   *
   * 後端回 data: null，這裡不回傳內容。
   */
  deleteBatch(batchId: string): Observable<void> {
    return this.http
      .delete<ApiEnvelope<null>>(GROUP_BUY_API.deleteBatch(batchId))
      .pipe(map(() => undefined));
  }
}
