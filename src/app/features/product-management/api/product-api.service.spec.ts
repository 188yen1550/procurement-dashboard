/**
 * 檔案用途：驗證 ProductApiService 正確拆掉 ApiResponse／Page 兩層殼，
 * 且圖片上傳走 multipart 而非 JSON。
 *
 * 拆殼特別需要測試的理由：http.get<T>() 的泛型不做執行期驗證，
 * 漏拆時 TypeScript 完全不會報錯，只有跑起來才會發現每個欄位都是 undefined。
 * 這種錯誤編譯器抓不到，只能靠測試。
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { ProductApiService } from './product-api.service';

/** 後端統一回應殼。測試資料一律照真實形狀寫，不要為了方便省略外層。 */
function envelope<T>(data: T, message = '查詢成功') {
  return { success: true, message, data };
}

/** Spring Data Page 序列化後的形狀。 */
function page<T>(content: T[], totalElements = content.length) {
  return { content, totalElements, totalPages: 1, number: 0, size: 20 };
}

const PRODUCT = {
  id: 101,
  productTypeId: 3,
  pricingType: 'RESALE',
  name: '中秋炭烤海陸組合禮盒',
  description: null,
  imageUrl: null,
  supplierName: '潮港鮮物有限公司',
  costPrice: 820,
  salePrice: 1190,
  marketPrice: 1490,
  campaignTags: 'bbq,gift',
  moq: 50,
  supplyStability: 4.5,
  priceCompetitiveness: 4.2,
  targetCustomerDescription: null,
  estimatedPurchaseRate: 0.8,
  reviewStatus: 'APPROVED',
  candidateStatus: 'CANDIDATE',
  pricingStatus: 'PRICED',
  itemStatus: 'ACTIVE',
  submissionCount: 1,
  createdBy: 1,
  createdAt: '2026-08-20T09:00:00',
  updatedAt: '2026-08-31T09:25:00',
  updatedBy: 1,
};

const PRODUCT_TYPES = [
  { id: 3, name: '食品／生鮮', description: null, isSystemDefault: true, isActive: true },
];

describe('ProductApiService', () => {
  let service: ProductApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProductApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('list', () => {
    it('拆掉 ApiResponse 與 Page 兩層殼', async () => {
      const promise = firstValueFrom(service.list());

      // 商品類型對照表是 list() 內部一併發出的請求。
      httpMock
        .expectOne((req) => req.url === '/api/settings/product-types')
        .flush(envelope(PRODUCT_TYPES));
      httpMock
        .expectOne((req) => req.url === '/api/products')
        .flush(envelope(page([PRODUCT], 47)));

      const result = await promise;

      // 若漏拆殼，這裡會是 undefined 而不是陣列。
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('中秋炭烤海陸組合禮盒');
      // 分頁資訊要保留，否則畫面算不出「共 47 筆」。
      expect(result.totalElements).toBe(47);
      expect(result.pageNumber).toBe(0);
    });

    it('把 productTypeId 對照成中文名稱', async () => {
      const promise = firstValueFrom(service.list());

      httpMock
        .expectOne((req) => req.url === '/api/settings/product-types')
        .flush(envelope(PRODUCT_TYPES));
      httpMock
        .expectOne((req) => req.url === '/api/products')
        .flush(envelope(page([PRODUCT])));

      const result = await promise;

      expect(result.items[0].productTypeName).toBe('食品／生鮮');
    });

    it('略過沒有值的查詢參數，避免後端收到空字串', async () => {
      const promise = firstValueFrom(
        service.list({ keyword: '', reviewStatus: 'PENDING', page: 0 }),
      );

      httpMock
        .expectOne((req) => req.url === '/api/settings/product-types')
        .flush(envelope(PRODUCT_TYPES));

      const req = httpMock.expectOne((r) => r.url === '/api/products');
      // 空字串會讓 Spring 嘗試把 "" 轉成 enum 而拋 400。
      expect(req.request.params.has('keyword')).toBe(false);
      expect(req.request.params.get('reviewStatus')).toBe('PENDING');
      // 0 是合法值，不能被 truthy 判斷過濾掉，否則第一頁參數會消失。
      expect(req.request.params.get('page')).toBe('0');

      req.flush(envelope(page([])));
      await promise;
    });
  });

  describe('getProduct', () => {
    it('回傳 data 內容而非整個 envelope', async () => {
      const promise = firstValueFrom(service.getProduct(101));

      httpMock.expectOne('/api/products/101').flush(envelope(PRODUCT));

      const product = await promise;

      expect(product.id).toBe(101);
      // 確認殼沒有殘留：若漏拆，product 上會有 success 這個欄位。
      expect((product as unknown as { success?: boolean }).success).toBeUndefined();
    });
  });

  describe('uploadImage', () => {
    it('以 multipart 送出，欄位名為 file 且不設 Content-Type', async () => {
      const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
      const promise = firstValueFrom(service.uploadImage(101, file));

      const req = httpMock.expectOne('/api/products/101/image');

      expect(req.request.body instanceof FormData).toBe(true);
      // 後端是 @RequestParam("file")，欄位名寫錯會拿不到檔案。
      expect((req.request.body as FormData).get('file')).toBe(file);
      // 最關鍵的一條：設了 Content-Type 就沒有 boundary，後端解不出檔案。
      expect(req.request.headers.has('Content-Type')).toBe(false);

      req.flush(envelope({ ...PRODUCT, imageUrl: '/images/products/101.jpg' }, '圖片上傳成功'));

      const result = await promise;
      expect(result.imageUrl).toBe('/images/products/101.jpg');
    });
  });

  describe('狀態轉換', () => {
    it('archive 走 POST /archive，不是 PATCH /item-status', async () => {
      const promise = firstValueFrom(service.archive(101));

      const req = httpMock.expectOne('/api/products/101/archive');
      // 後端沒有 item-status 這支端點，舊寫法必定 404。
      expect(req.request.method).toBe('POST');
      req.flush(envelope({ ...PRODUCT, itemStatus: 'ARCHIVED' }, '已封存'));

      const result = await promise;
      expect(result.itemStatus).toBe('ARCHIVED');
    });

    it('重複操作時把 409 原樣拋給呼叫端，不吞掉狀態碼', async () => {
      const promise = firstValueFrom(service.archive(101)).catch(
        (err: { status: number }) => err,
      );

      httpMock
        .expectOne('/api/products/101/archive')
        .flush(
          { success: false, message: '商品目前並非使用中，無法封存', data: null },
          { status: 409, statusText: 'Conflict' },
        );

      const error = (await promise) as { status: number };
      // 呼叫端需要靠 409 區分「狀態被別人改了」與一般錯誤，
      // service 層若統一 catchError 會讓上層只剩「失敗了」可用。
      expect(error.status).toBe(409);
    });
  });

  describe('getDetail', () => {
    it('evaluation 失敗時降級，仍回傳商品基本資料', async () => {
      const promise = firstValueFrom(service.getDetail(101));

      httpMock.expectOne('/api/products/101').flush(envelope(PRODUCT));
      httpMock
        .expectOne('/api/products/101/evaluation')
        .flush({ success: false, message: '伺服器發生錯誤', data: null }, { status: 500, statusText: 'Error' });
      httpMock.expectOne('/api/products/101/festival-boost').flush(
        envelope({ dataSource: 'LIVE', matchedCampaign: null, festivalBoost: 0, finalScore: null }),
      );
      httpMock
        .expectOne((req) => req.url === '/api/settings/product-types')
        .flush(envelope(PRODUCT_TYPES));

      const detail = await promise;

      // 商品資料還在，沒有理由讓整頁空白。
      expect(detail.name).toBe('中秋炭烤海陸組合禮盒');
      expect(detail.hasEvaluation).toBe(false);
      expect(detail.finalScore).toBeNull();
    });
  });

  describe('getAiAnalysis', () => {
    it('後端回全 null 物件時視為「尚未生成」，不是錯誤', async () => {
      const promise = firstValueFrom(service.getAiAnalysis(101));

      httpMock.expectOne('/api/products/101/ai-analysis').flush(
        envelope({
          summary: null,
          recommendation: null,
          reasons: null,
          modelName: null,
          generatedAt: null,
        }),
      );

      const result = await promise;

      // 後端刻意回 200 + 空物件而非 404，前端要顯示 Empty 狀態。
      expect(result.hasAnalysis).toBe(false);
    });

    it('modelName 為 MOCK-LLM-v1 時標記為模擬資料', async () => {
      const promise = firstValueFrom(service.getAiAnalysis(101));

      httpMock.expectOne('/api/products/101/ai-analysis').flush(
        envelope({
          summary: '【模擬資料】節慶標籤與檔期吻合。',
          recommendation: '建議通過',
          reasons: '需求上升',
          modelName: 'MOCK-LLM-v1',
          generatedAt: '2026-08-31T09:20:00',
        }),
      );

      const result = await promise;

      expect(result.hasAnalysis).toBe(true);
      expect(result.isMockData).toBe(true);
    });
  });
});
