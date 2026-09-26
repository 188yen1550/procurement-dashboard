/**
 * 檔案用途：驗證品項模組的資料轉換規則。
 *
 * 這裡完全不需要 TestBed、不需要 mock HttpClient——mapper 是純函式，
 * 直接 expect(fn(input)).toEqual(...) 即可。這正是把轉換邏輯從 service
 * 抽出來的理由：最容易寫錯、最值得測的那部分，測試成本最低。
 */
import { ProductResponsePayload } from './product-api.contract';
import {
  describeMatchedCampaignScope,
  toProductActionAvailability,
  toProductDetailModel,
  toProductFormModel,
  toProductListItem,
  toProductRequestPayload,
} from './product.mapper';

/** 測試用的基準資料：已通過審核、使用中、正式候選的再販售商品。 */
function makeProduct(overrides: Partial<ProductResponsePayload> = {}): ProductResponsePayload {
  return {
    id: 101,
    productTypeId: 3,
    pricingType: 'RESALE',
    name: '中秋炭烤海陸組合禮盒',
    description: '適合中秋家庭與企業團購。',
    imageUrl: '/images/products/101.jpg',
    supplierName: '潮港鮮物有限公司',
    createdByName: '陳小明',
    finalScore: 92.4,
    dataCompleteness: 96,
    costPrice: 820,
    salePrice: 1190,
    marketPrice: 1490,
    campaignTags: 'bbq,gift',
    moq: 50,
    supplyStability: 5,
    priceCompetitiveness: 4,
    targetCustomerDescription: '25–45 歲家庭與公司團購',
    estimatedPurchaseRate: 0.8,
    resaleReferenceProductId: null,
    temperatureZone: null,
    shelfLifeTier: null,
    supplierLeadTimeTier: null,
    packageSizeTier: null,
    packingType: null,
    handlingFlags: null,
    certificationFlags: null,
    supplierMaxCapacity: null,
    reviewStatus: 'APPROVED',
    candidateStatus: 'CANDIDATE',
    pricingStatus: 'PRICED',
    itemStatus: 'ACTIVE',
    submissionCount: 1,
    createdBy: 1,
    createdAt: '2026-08-20T09:00:00',
    updatedAt: '2026-08-31T09:25:00',
    updatedBy: 1,
    submittedAt: null,
    submittedBy: null,
    submittedByName: null,
    ...overrides,
  };
}

describe('toProductActionAvailability', () => {
  it('PENDING 且第 1 次送審（尚未被審核）：可刪除，但不可封存或復用', () => {
    // 2026-09-24：submissionCount 1 起算，建立商品即第 1 次送審。
    const actions = toProductActionAvailability({
      reviewStatus: 'PENDING',
      itemStatus: 'ACTIVE',
      candidateStatus: 'CANDIDATE',
      submissionCount: 1,
    });

    expect(actions.canDelete).toBe(true);
    // 最容易漏掉的條件：PENDING 商品必須先有審核結果才能封存。
    expect(actions.canArchive).toBe(false);
    expect(actions.canRestore).toBe(false);
    expect(actions.canResubmit).toBe(false);
    expect(actions.isCoreLocked).toBe(false);
  });

  it('PENDING 但曾被審核過（拒絕後重送，第 2 次送審）：不可刪除', () => {
    const actions = toProductActionAvailability({
      reviewStatus: 'PENDING',
      itemStatus: 'ACTIVE',
      candidateStatus: 'CANDIDATE',
      submissionCount: 2,
    });

    // 後端條件是 PENDING 且 submissionCount === 1，兩者缺一不可。
    expect(actions.canDelete).toBe(false);
  });

  it('第 1 次送審但已有審核結果：不可刪除', () => {
    const actions = toProductActionAvailability({
      reviewStatus: 'REJECTED',
      itemStatus: 'ACTIVE',
      candidateStatus: 'CANDIDATE',
      submissionCount: 1,
    });

    expect(actions.canDelete).toBe(false);
  });

  it('REJECTED 且 ACTIVE：可重審、可封存', () => {
    const actions = toProductActionAvailability({
      reviewStatus: 'REJECTED',
      itemStatus: 'ACTIVE',
      candidateStatus: 'CANDIDATE',
      submissionCount: 1,
    });

    expect(actions.canResubmit).toBe(true);
    expect(actions.canArchive).toBe(true);
  });

  it('REJECTED 但已封存：不可直接重審，要先復用', () => {
    const actions = toProductActionAvailability({
      reviewStatus: 'REJECTED',
      itemStatus: 'ARCHIVED',
      candidateStatus: 'CANDIDATE',
      submissionCount: 1,
    });

    // 這條規則在後端是 "商品目前已封存，請先復用後再重審"。
    expect(actions.canResubmit).toBe(false);
    expect(actions.canRestore).toBe(true);
  });

  it('REJECTED 且已封存：仍可復用（不是只有 APPROVED 才能復用）', () => {
    const actions = toProductActionAvailability({
      reviewStatus: 'REJECTED',
      itemStatus: 'ARCHIVED',
      candidateStatus: 'CANDIDATE',
      submissionCount: 2,
    });

    // 舊版前端寫成只有 APPROVED 可復用，會讓被拒絕又封存的商品永遠救不回來。
    expect(actions.canRestore).toBe(true);
  });

  it('REJECTED 且 ACTIVE，但 candidateStatus 還是 AI_SUGGESTED：不可重審', () => {
    // 2026-09-16修正：與後端 ProductService.resubmit() 的候選狀態檢查對稱——
    // AI 建議商品理論上不該出現在這個判斷式面對的清單裡（品項管理預設只查
    // CANDIDATE），但檢查邏輯本身要獨立成立，不能只靠「不會走到這裡」假設安全。
    const actions = toProductActionAvailability({
      reviewStatus: 'REJECTED',
      itemStatus: 'ACTIVE',
      candidateStatus: 'AI_SUGGESTED',
      submissionCount: 1,
    });

    expect(actions.canResubmit).toBe(false);
  });

  it('APPROVED：核心資料鎖定', () => {
    const actions = toProductActionAvailability({
      reviewStatus: 'APPROVED',
      itemStatus: 'ACTIVE',
      candidateStatus: 'CANDIDATE',
      submissionCount: 1,
    });

    expect(actions.isCoreLocked).toBe(true);
  });

  it('AI_SUGGESTED：可加入候選', () => {
    const actions = toProductActionAvailability({
      reviewStatus: 'PENDING',
      itemStatus: 'ACTIVE',
      candidateStatus: 'AI_SUGGESTED',
      submissionCount: 1,
    });

    expect(actions.canPromote).toBe(true);
  });
});

describe('toProductListItem', () => {
  it('把逗號分隔的 campaignTags 拆成陣列', () => {
    const item = toProductListItem(makeProduct({ campaignTags: 'bbq,gift, moon_cake ' }));

    // 後端 ScoringService.splitTags() 會 trim，前端也要一致。
    expect(item.campaignTags).toEqual(['bbq', 'gift', 'moon_cake']);
  });

  it('campaignTags 為 null 時回空陣列，讓樣板可直接迭代', () => {
    const item = toProductListItem(makeProduct({ campaignTags: null }));

    expect(item.campaignTags).toEqual([]);
  });

  it('清單端點的分數直接透傳，不再是恆為 null 的佔位值', () => {
    const item = toProductListItem(makeProduct());

    // 後端這次已在 GET /api/products 批次補上這兩個欄位（見 ProductService.
    // resolveEvaluations()），不是逐筆呼叫 /evaluation，mapper 直接透傳即可。
    expect(item.finalScore).toBe(92.4);
    expect(item.dataCompleteness).toBe(96);
    expect(item.hasScoreData).toBe(true);
  });

  it('該商品尚無評估紀錄時，分數為 null 但 hasScoreData 仍為 true', () => {
    const item = toProductListItem(makeProduct({ finalScore: null, dataCompleteness: null }));

    // ⚠️ 這裡的 null 代表「這筆商品真的還沒有分數」，不是「後端沒提供欄位」，
    // 兩者語意不同：hasScoreData 只反映後者，不應該因為某一筆商品剛好
    // 沒有評估紀錄就整體判定「後端沒提供分數」。
    expect(item.finalScore).toBeNull();
    expect(item.dataCompleteness).toBeNull();
    expect(item.hasScoreData).toBe(true);
  });

  it('supplierName 為 null 時填入 fallback，而非 undefined', () => {
    const item = toProductListItem(makeProduct({ supplierName: null }));

    expect(item.supplierName).toBe('—');
  });

  it('createdByName 直接透傳，找不到帳號時後端已給 fallback，不需前端再處理', () => {
    const item = toProductListItem(makeProduct({ createdByName: null }));

    // 後端 ProductService/ReviewService 批次查詢後才會回這個欄位，
    // 理論上不會是 null；但即使是 null，這裡也直接顯示 NOT_PROVIDED，
    // 不做額外猜測或另外呼叫其他 API 去補。
    expect(toProductListItem(makeProduct()).createdByName).toBe('陳小明');
    expect(item.createdByName).toBe('—');
  });

  it('帶入商品類型名稱時會反映在 productTypeName', () => {
    const item = toProductListItem(makeProduct(), '食品／生鮮');

    expect(item.productTypeName).toBe('食品／生鮮');
  });
});

describe('toProductRequestPayload', () => {
  it('RESALE 商品會送出 marketPrice', () => {
    const form = toProductFormModel(makeProduct({ pricingType: 'RESALE', marketPrice: 1490 }));
    const payload = toProductRequestPayload(form);

    expect(payload.marketPrice).toBe(1490);
  });

  it('NEW 商品的 marketPrice 一律送 null', () => {
    const form = toProductFormModel(
      makeProduct({ pricingType: 'NEW', marketPrice: 1490 }),
    );
    const payload = toProductRequestPayload(form);

    // 後端會以 400「市售價格僅適用於再販售(RESALE)商品」擋下，
    // 在這裡先過濾掉，使用者不會撞到那個錯誤。
    expect(payload.marketPrice).toBeNull();
  });

  it('campaignTags 一律以半形逗號組回，不使用全形頓號', () => {
    const form = toProductFormModel(makeProduct());
    form.core.campaignTags = ['bbq', 'gift'];
    const payload = toProductRequestPayload(form);

    // ScoringService.splitTags() 只吃 split(",")。
    // 若送出全形頓號，後端會把整串當成單一標籤，節慶比對失效且不報錯。
    expect(payload.campaignTags).toBe('bbq,gift');
    expect(payload.campaignTags).not.toContain('、');
  });

  it('空標籤陣列送 null 而非空字串', () => {
    const form = toProductFormModel(makeProduct());
    form.core.campaignTags = [];
    const payload = toProductRequestPayload(form);

    expect(payload.campaignTags).toBeNull();
  });

  it('必填欄位缺漏時拋錯，避免送出一定會被 400 的請求', () => {
    const form = toProductFormModel(makeProduct());
    form.core.productTypeId = null;

    expect(() => toProductRequestPayload(form)).toThrow();
  });
});

describe('toProductDetailModel', () => {
  const evaluation = {
    dataSource: 'SNAPSHOT' as const,
    evaluationModeId: 1,
    evaluationModeName: '均衡模式',
    evaluationModeVersion: 1,
    weights: null,
    businessScore: 88,
    audienceScore: 91,
    historicalScore: 84,
    purchaseScore: 86,
    trendScore: 90,
    forecastScore: 87,
    totalScore: 88.2,
    dataCompleteness: 96,
    festivalBoost: 4.2,
    finalScore: 92.4,
  };

  it('分數以 evaluation 為單一真實來源', () => {
    const model = toProductDetailModel(makeProduct(), evaluation, {
      dataSource: 'SNAPSHOT',
      matchedCampaign: null,
      // 刻意讓 festival 端點的值與 evaluation 不同，驗證不會被它蓋掉。
      festivalBoost: 99,
      finalScore: 999,
    });

    expect(model.festivalBoost).toBe(4.2);
    expect(model.finalScore).toBe(92.4);
  });

  it('evaluation 載入失敗時降級，不謊稱資料已凍結', () => {
    const model = toProductDetailModel(makeProduct({ reviewStatus: 'APPROVED' }), null, null);

    expect(model.hasEvaluation).toBe(false);
    // 即使 reviewStatus 是 APPROVED，也不能反推成 SNAPSHOT——
    // 那會對使用者謊稱「這是審核當下凍結的數字」，但其實根本沒拿到分數。
    expect(model.dataSource).toBe('LIVE');
    expect(model.finalScore).toBeNull();
  });

  it('未命中檔期時 matchedCampaign 為 null，整個區塊不顯示', () => {
    const model = toProductDetailModel(makeProduct(), evaluation, {
      dataSource: 'LIVE',
      matchedCampaign: null,
      festivalBoost: 0,
      finalScore: 88.2,
    });

    expect(model.matchedCampaign).toBeNull();
  });

  it('RESALE 且有市價時才顯示比價區塊', () => {
    const withMarketPrice = toProductDetailModel(makeProduct(), null, null);
    const newProduct = toProductDetailModel(
      makeProduct({ pricingType: 'NEW', marketPrice: null }),
      null,
      null,
    );

    expect(withMarketPrice.showPriceComparison).toBe(true);
    expect(newProduct.showPriceComparison).toBe(false);
  });

  it('折扣率與毛利率四捨五入到小數一位', () => {
    const model = toProductDetailModel(makeProduct(), null, null);

    // 市價 1490、售價 1190 → 折 20.1%
    expect(model.discountRate).toBe(20.1);
    // 售價 1190、成本 820 → 毛利 31.1%
    expect(model.marginRate).toBe(31.1);
  });

  it('新品沒有價格時不計算比率，回 null 而非 NaN', () => {
    const model = toProductDetailModel(
      makeProduct({ pricingType: 'NEW', costPrice: null, salePrice: null, marketPrice: null }),
      null,
      null,
    );

    expect(model.discountRate).toBeNull();
    expect(model.marginRate).toBeNull();
  });
});

/** 2026-09-24（V21 檔期規則改版）：命中期間與地域的顯示文字。 */
describe('describeMatchedCampaignScope', () => {
  const base = { campaignId: 1, campaignName: '端午節', matchedTags: ['粽子'], matchWeight: 1, urgencyFactor: 0.5 };

  it('returns null for snapshots created before V21', () => {
    expect(describeMatchedCampaignScope(base)).toBeNull();
    expect(describeMatchedCampaignScope(null)).toBeNull();
  });

  it('shows the occurrence period, regions and override marker', () => {
    expect(
      describeMatchedCampaignScope({
        ...base,
        occurrenceStartDate: '2026-06-19',
        occurrenceEndDate: '2026-06-21',
        regions: ['SOUTH', 'EAST'],
      }),
    ).toBe('2026-06-19 – 2026-06-21 · 南部、東部');
    expect(
      describeMatchedCampaignScope({
        ...base,
        occurrenceStartDate: '2026-02-17',
        occurrenceEndDate: '2026-02-17',
        regions: [],
        occurrenceOverridden: true,
      }),
    ).toBe('2026-02-17 · 全國（已覆寫）');
  });
});
