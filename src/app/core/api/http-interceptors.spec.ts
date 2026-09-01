/**
 * 檔案用途：把「攔截器不得破壞 multipart 上傳」這條規則釘成自動化測試。
 *
 * ## 為什麼值得為這件事寫測試
 *
 * 手動檢查一次會過，但下個月同事加一個統一設 Content-Type 的攔截器，
 * 上傳功能就壞了——而且只有上傳會壞，其他 API 全部正常，
 * 錯誤訊息也不會提到 boundary，通常要等 QA 回報「圖片傳不上去」才發現。
 *
 * 這幾條測試很短，但會在攔截器被改壞的當下就紅燈。
 * 如果它紅了，請改攔截器，不要改測試。
 */
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { withCredentialsInterceptor } from '../auth/with-credentials-interceptor';
import { jsonContentTypeInterceptor } from './json-content-type.interceptor';

describe('HTTP 攔截器', () => {
  describe('實際註冊的組態（app.config.ts）', () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          // 這裡必須與 app.config.ts 的 withInterceptors([...]) 保持一致。
          // 若 app.config.ts 加了新攔截器，這裡也要加，否則測試會失去意義。
          provideHttpClient(withInterceptors([withCredentialsInterceptor])),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpClient);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('上傳 FormData 時不得設定 Content-Type，交由瀏覽器產生 boundary', () => {
      const formData = new FormData();
      formData.append('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }));

      http.post('/api/products/1/image', formData).subscribe();

      const req = httpMock.expectOne('/api/products/1/image');
      // 這是本檔最重要的一條斷言。
      // has() 為 true 代表某個攔截器蓋掉了 Content-Type，
      // 瀏覽器就不會補 boundary，後端 @RequestParam("file") 會拿到空值。
      expect(req.request.headers.has('Content-Type')).toBe(false);
      expect(req.request.body instanceof FormData).toBe(true);

      req.flush({ success: true, message: '圖片上傳成功', data: {} });
    });

    it('所有請求都必須帶 withCredentials，否則 Cookie 不會送出', () => {
      http.get('/api/auth/me').subscribe();

      const req = httpMock.expectOne('/api/auth/me');
      // 少了這個，登入本身會成功（Set-Cookie 收得到），
      // 但之後每一支 API 都是 401，症狀很容易被誤判成 token 過期。
      expect(req.request.withCredentials).toBe(true);

      req.flush({ success: true, message: '查詢成功', data: null });
    });

    it('JSON 請求交給 HttpClient 自行判斷，攔截器不介入', () => {
      http.post('/api/products', { name: '測試商品' }).subscribe();

      const req = httpMock.expectOne('/api/products');
      // HttpClient 會在實際送出時依 body 型別自動補 application/json，
      // 攔截器層不需要、也不應該先寫死。
      expect(req.request.headers.has('Content-Type')).toBe(false);

      req.flush({ success: true, message: '新增成功', data: {} });
    });
  });

  describe('jsonContentTypeInterceptor（目前未註冊，僅備用）', () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(
            withInterceptors([withCredentialsInterceptor, jsonContentTypeInterceptor]),
          ),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpClient);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('即使註冊了此攔截器，FormData 仍不得被加上 Content-Type', () => {
      const formData = new FormData();
      formData.append('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }));

      http.post('/api/products/1/image', formData).subscribe();

      const req = httpMock.expectOne('/api/products/1/image');
      expect(req.request.headers.has('Content-Type')).toBe(false);

      req.flush({ success: true, message: '圖片上傳成功', data: {} });
    });

    it('一般 JSON body 才會被加上 application/json', () => {
      http.post('/api/products', { name: '測試商品' }).subscribe();

      const req = httpMock.expectOne('/api/products');
      expect(req.request.headers.get('Content-Type')).toBe('application/json');

      req.flush({ success: true, message: '新增成功', data: {} });
    });

    it('無 body 的請求不加 Content-Type', () => {
      http.get('/api/products').subscribe();

      const req = httpMock.expectOne('/api/products');
      expect(req.request.headers.has('Content-Type')).toBe(false);

      req.flush({ success: true, message: '查詢成功', data: { content: [] } });
    });
  });
});
