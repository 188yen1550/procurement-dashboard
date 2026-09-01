/**
 * 檔案用途：集中宣告 Router、HttpClient 與攔截器等應用程式層級 provider。
 *
 * ## ⚠️ 新增攔截器前請先看這段
 *
 * withInterceptors() 的陣列是全站唯一的攔截器註冊點。
 * 任何在這裡加入、且會動到 request header 的攔截器，都必須先確認
 * 它對 FormData 請求的行為——POST /api/products/{id}/image 送的是
 * multipart/form-data，Content-Type 一旦被寫死就會失去 boundary，
 * 後端解不出檔案（詳見 core/auth/with-credentials-interceptor.ts 的說明）。
 *
 * 這件事有測試把關：core/api/http-interceptors.spec.ts。
 * 加了新攔截器後那支測試如果紅燈，代表你蓋掉了 FormData 的 Content-Type，
 * 不要改測試，改攔截器。
 */
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { withCredentialsInterceptor } from './core/auth/with-credentials-interceptor';

/** 啟動時一次套用的全域 Angular 組態。 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // 目前只有一個攔截器，且它只設 withCredentials、不碰任何 header。
    // jsonContentTypeInterceptor 刻意不註冊——HttpClient 已會依 body 型別
    // 自動決定 Content-Type，多一層只是多一個會壞的地方。
    provideHttpClient(withInterceptors([withCredentialsInterceptor])),
  ],
};
