/**
 * 檔案用途：集中宣告 Router、HttpClient 與攔截器等應用程式層級 provider。
 * HttpClient 是保留的未來整合入口；目前 feature 的本地 Mock 初始化不因此等同 API 已串接。
 */
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { jwtInterceptor } from './core/auth/jwt-interceptor';

/** 啟動時一次套用的全域 Angular 組態。 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([jwtInterceptor])),
  ],
};
