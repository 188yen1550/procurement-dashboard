import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiEnvelope } from '../../../core/api/api-envelope';
import { unwrapData } from '../../../core/api/unwrap';
import {
  USER_API,
  UserAccountResponsePayload,
  UserCreateRequestPayload,
} from './user-api.contract';

/**
 * 帳號管理 API 的唯一呼叫入口。三支都是 [僅管理]。
 *
 * 這個模組沒有 mapper：UserAccountResponse 的六個欄位形狀就是清單畫面要的，
 * role 的中文顯示用 core/domain/labels.ts 的 USER_ROLE_LABEL。
 */
@Injectable({ providedIn: 'root' })
export class UserApiService {
  private readonly http = inject(HttpClient);

  /** 1. GET /api/users [僅管理]：⚠️ 含已停用帳號，畫面要區隔顯示。 */
  list(): Observable<UserAccountResponsePayload[]> {
    return this.http
      .get<ApiEnvelope<UserAccountResponsePayload[]>>(USER_API.list)
      .pipe(unwrapData());
  }

  /**
   * 2. POST /api/users [僅管理]：新增帳號。
   * ⚠️ username 重複時後端回 400，訊息要顯示給使用者看，
   * 不要吞成通用錯誤——使用者需要知道要換一個帳號名。
   */
  create(body: UserCreateRequestPayload): Observable<UserAccountResponsePayload> {
    return this.http
      .post<ApiEnvelope<UserAccountResponsePayload>>(USER_API.create, body)
      .pipe(unwrapData());
  }

  /**
   * 3. PUT /api/users/{id}/disable [僅管理]：停用帳號。
   *
   * ⚠️ **不能停用自己**：後端回 409「不可停用自己的帳號」。
   * 建議在畫面上直接把自己那一列的停用按鈕 disable
   * （比對 row.id 與 Auth.currentUser()?.id），
   * 讓使用者根本不會撞到這個錯誤，而不是撞到後才解釋。
   *
   * ⚠️ **停用是即時生效的**：對方就算已經登入，下一個請求就會被擋。
   * 這點值得在確認對話框寫明，避免管理者在對方操作中途停用造成資料遺失。
   */
  disable(id: number): Observable<UserAccountResponsePayload> {
    return this.http
      .put<ApiEnvelope<UserAccountResponsePayload>>(USER_API.disable(id), {})
      .pipe(unwrapData());
  }

  /**
   * 4. PUT /api/users/{id}/enable [僅管理]：停用的反向操作。
   *
   * ⚠️ 後端端點的動詞是 `enable`，不是 `restore`。
   * UserController.enableUser() 才是實際存在的那一支；
   * 先前這裡打的 `/restore` 後端從來沒有實作過，真實模式下必定 404。
   *
   * 命名保留 restore 以對齊畫面上的「復用」字樣與既有呼叫端。
   */
  restore(id: number): Observable<UserAccountResponsePayload> {
    return this.http
      .put<ApiEnvelope<UserAccountResponsePayload>>(USER_API.enable(id), {})
      .pipe(unwrapData());
  }
}
