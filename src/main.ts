/**
 * 檔案用途：Angular 應用程式的瀏覽器啟動入口。
 * `bootstrapApplication` 以 standalone 模式建立根元件並套用集中組態；
 * 此處不保存產品或 Mock 狀態，避免入口層與功能頁耦合。
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
