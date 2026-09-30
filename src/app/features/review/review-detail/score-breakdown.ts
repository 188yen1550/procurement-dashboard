/**
 * 檔案用途：審核詳情「因子明細（權重與分數）」表格的資料組裝。純函式，可直接單元測試。
 *
 * 2026-09-30（方案 A，只改前端）：原本 11 格同款卡片把「公式組成」「門檻」「分組參考分」
 * 混排在同一個固定 6 欄的 grid 裡，且畫面上完全看不到權重，評審無法從畫面理解
 * 「基本分數怎麼來的」。改為：公式列（元件模板）＋本檔組出的分組因子表。
 *
 * 資料限制（方案 A 的邊界，誠實呈現而非推測）：
 * - API 目前只回傳分組分數（businessScore…forecastScore），沒有逐因子分數。
 *   商業效益組內的毛利率／折扣深度／供應穩定性只能顯示權重與來源，分數以「組分」呈現；
 *   組內哪個因子缺資料，前端無從得知，因此不計算「實際參與權重」，避免顯示錯誤數字。
 * - 客群、歷史、購買、趨勢四個因子的分組分數就等於該因子分數，可逐列顯示。
 * - 自訂因子（factor_definitions）的分數不在此 API 內，只顯示權重並註明。
 * 需要完整逐因子驗算時，屬方案 B（API 與審核快照補 factorScores）。
 */
import { WeightSnapshotPayload } from '../../product-management/api/product-api.contract';
import { ReviewScoreBreakdown } from '../api/review.mapper';

/** 資料來源：讓評審看出「人工判斷／系統計算／外部數據」的分工。 */
export type FactorSource = '人工' | '系統計算' | '系統統計' | '外部數據' | '自訂';

export interface ScoreFactorRow {
  code: string;
  name: string;
  source: FactorSource;
  /** 權重（百分比，0~100）；沒有權重快照時為 null。 */
  weight: number | null;
  /** 因子本身分數；undefined＝此 API 不提供逐因子分數（以組分呈現）。 */
  score: number | null | undefined;
  /** ? 提示泡泡的說明文字：這個因子怎麼算、什麼情況下不計入。 */
  hint: string;
}

export interface ScoreGroup {
  key: 'BUSINESS' | 'AUDIENCE' | 'HISTORY' | 'FORECAST' | 'CUSTOM';
  label: string;
  /** 分組參考分（不參與總分計算）；CUSTOM 組恆為 undefined。 */
  score: number | null | undefined;
  /** 組內權重合計；沒有權重快照時為 null。 */
  weight: number | null;
  /** false＝該組沒有任何可計分資料，整組不計入基本分數。 */
  counted: boolean;
  /** ? 提示泡泡的說明文字：這一組評估什麼、包含哪些因子、組分怎麼彙總。 */
  hint: string;
  rows: ScoreFactorRow[];
}

interface FixedFactor {
  code: string;
  name: string;
  group: Exclude<ScoreGroup['key'], 'CUSTOM'>;
  source: FactorSource;
  hint: string;
  /** 此因子分數對應的欄位；undefined＝API 沒有逐因子分數。 */
  scoreOf?: (s: ReviewScoreBreakdown) => number | null;
}

/** 既有七個固定因子（與後端 FactorCode 對齊）。名稱以權重快照的 factorName 為準，這裡是備援。 */
/**
 * 既有七個固定因子（與後端 FactorCode 對齊）。名稱以權重快照的 factorName 為準，這裡是備援。
 * hint 依後端 ProductFactorScorer／HistoricalScoreCalculator 的實際算法撰寫，演算法改動時需同步更新。
 */
const FIXED_FACTORS: readonly FixedFactor[] = [
  {
    code: 'MARGIN_RATE', name: '毛利率（已扣運費）', group: 'BUSINESS', source: '系統計算',
    hint: '毛利率＝（售價－成本價－運費估算）÷ 售價，運費依商品材積級距估算。再依該品類的目標區間換算成 0～100 分，避免高毛利品類天生佔優勢。新品尚未訂價時不計入。',
  },
  {
    code: 'DISCOUNT_DEPTH', name: '折扣深度', group: 'BUSINESS', source: '系統計算',
    hint: '團購價相對市場行情價的折讓幅度，依該品類的目標區間換算成 0～100 分。只有再販售商品會填市場行情價，新品一律不計入。',
  },
  {
    code: 'SUPPLY_STABILITY', name: '供應穩定性', group: 'BUSINESS', source: '人工',
    hint: '採購人工評估 1～5 級（暫時缺貨、供應量短少、普通、穩定、充足），× 20 換算為 20～100 分。刻意保留人工判斷，承載系統拿不到的供應面資訊（例如供應商近期出貨延遲）。',
  },
  {
    code: 'AUDIENCE_MATCH', name: '核心客群匹配度', group: 'AUDIENCE', source: '系統計算', scoreOf: (s) => s.audienceScore,
    hint: '以客群設定的關鍵字逐一比對「目標客群描述＋商品名稱」，命中比例 × 100。分數偏低通常代表目標客群描述沒有寫到客群關鍵字。沒有啟用中的客群設定時不計入。',
  },
  {
    code: 'HISTORY_FULFILLMENT', name: '歷史成團率', group: 'HISTORY', source: '系統統計', scoreOf: (s) => s.historicalScore,
    hint: '以「全站 → 品類 → 商品」三層逐步修正（巢狀貝氏收縮）估算成團率：樣本少時分數往品類平均靠攏，避免只開過幾次、剛好全部成團就拿滿分。再販售商品若指定了參考商品，會優先參考它的歷史。',
  },
  {
    code: 'PURCHASE_RATE', name: '預估購買率', group: 'FORECAST', source: '人工', scoreOf: (s) => s.purchaseScore,
    hint: '採購人工填寫的預估購買率（0～1），× 100 換算成分數。未填寫時不計入。',
  },
  {
    code: 'TREND_HEAT', name: '市場趨勢熱度', group: 'FORECAST', source: '外部數據', scoreOf: (s) => s.trendScore,
    hint: '最新一筆真實的外部熱度資料（例如 PTT 討論量）。資料越舊越不可信，會依距今天數逐步收斂到中性分。屬於相對熱度，不是銷售量。從未取得真實資料時不計入。',
  },
];

const GROUP_META: Record<Exclude<ScoreGroup['key'], 'CUSTOM'>, { label: string; hint: string; scoreOf: (s: ReviewScoreBreakdown) => number | null }> = {
  BUSINESS: {
    label: '商業效益',
    hint: '評估這件商品「划不划算、供不供得穩」。包含毛利率（已扣運費）、折扣深度、供應穩定性三個因子；組分是三者依權重的加權平均，缺資料的因子不計入。組分只供參考，基本分數是直接由各因子加權計算。',
    scoreOf: (s) => s.businessScore,
  },
  AUDIENCE: {
    label: '客群契合',
    hint: '評估商品是否符合本店的核心客群。包含一個因子：核心客群匹配度（客群關鍵字命中率）。',
    scoreOf: (s) => s.audienceScore,
  },
  HISTORY: {
    label: '歷史表現',
    hint: '評估同品類、同商品過去開團的成團情況。包含一個因子：歷史成團率。沒有開團紀錄時會退回品類或全站的平均水準，不會是 0 分。',
    scoreOf: (s) => s.historicalScore,
  },
  FORECAST: {
    label: '需求預測',
    hint: '評估預期買氣。包含預估購買率（採購人工預估）與市場趨勢熱度（外部數據）兩個因子；組分是兩者依權重的加權平均，缺資料的因子不計入。',
    scoreOf: (s) => s.forecastScore,
  },
};

const CUSTOM_GROUP_HINT = '由設定頁「自訂擴充」建立的評分因子，依各自設定的資料來源與運算方式計分，和固定因子一樣依權重計入基本分數。此頁的 API 沒有提供自訂因子的分數，請到品項詳情查看。';
const CUSTOM_FACTOR_HINT = '自訂因子：計算方式依設定頁「自訂擴充」中的設定。分數請見品項詳情。';

const GROUP_ORDER = ['BUSINESS', 'AUDIENCE', 'HISTORY', 'FORECAST'] as const;

function sumWeights(rows: ScoreFactorRow[]): number | null {
  if (rows.length === 0 || rows.some((r) => r.weight === null)) return null;
  return Math.round(rows.reduce((total, r) => total + (r.weight ?? 0), 0) * 100) / 100;
}

export function buildScoreGroups(
  scores: ReviewScoreBreakdown,
  weights: WeightSnapshotPayload | null | undefined,
): ScoreGroup[] {
  const weightFactors = weights?.factors ?? [];
  const weightByCode = new Map(weightFactors.map((f) => [f.factorCode, f]));
  const hasSnapshot = weightFactors.length > 0;

  const groups: ScoreGroup[] = GROUP_ORDER.map((key) => {
    const rows: ScoreFactorRow[] = FIXED_FACTORS.filter((f) => f.group === key)
      // 有權重快照時只列出該模式真的有的因子（權重 0 視為未啟用，與後端 weightedAverage 一致）
      .filter((f) => !hasSnapshot || Number(weightByCode.get(f.code)?.weight ?? 0) > 0)
      .map((f) => {
        const snapshot = weightByCode.get(f.code);
        return {
          code: f.code,
          name: snapshot?.factorName || f.name,
          source: f.source,
          weight: snapshot ? Number(snapshot.weight) : null,
          score: f.scoreOf ? f.scoreOf(scores) : undefined,
          hint: f.hint,
        };
      });
    const groupScore = GROUP_META[key].scoreOf(scores);
    return {
      key,
      label: GROUP_META[key].label,
      hint: GROUP_META[key].hint,
      score: groupScore,
      weight: sumWeights(rows),
      counted: groupScore !== null,
      rows,
    };
  }).filter((g) => g.rows.length > 0);

  const fixedCodes = new Set(FIXED_FACTORS.map((f) => f.code));
  const customRows: ScoreFactorRow[] = weightFactors
    .filter((f) => !fixedCodes.has(f.factorCode) && Number(f.weight ?? 0) > 0)
    .map((f) => ({
      code: f.factorCode,
      name: f.factorName,
      source: '自訂' as const,
      weight: Number(f.weight),
      score: undefined,
      hint: CUSTOM_FACTOR_HINT,
    }));
  if (customRows.length > 0) {
    groups.push({
      key: 'CUSTOM',
      label: '自訂因子',
      hint: CUSTOM_GROUP_HINT,
      score: undefined,
      weight: sumWeights(customRows),
      counted: true,
      rows: customRows,
    });
  }
  return groups;
}
