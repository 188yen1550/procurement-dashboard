/**
 * 檔案用途：提供 Dashboard 的固定本地 Mock 資料與特殊情境。
 * 內容包含低完整度、重審、高風險與 Top 10 範例，不呼叫 API 且不得視為即時營運數據。
 */
import { DashboardMockData, DashboardRecommendation } from './dashboard.models';

export const DASHBOARD_MOCK_DATA: DashboardMockData = {
  generatedAt: '2026-08-27 14:30',
  statistics: {
    totalProducts: 128,
    pendingReviews: 18,
    approvedProducts: 72,
    rejectedProducts: 14,
    // Mock 情境：18 筆已轉正候選、待人工審核；另外 5 筆是 AI 建議、
    // 尚未轉正候選，兩者互斥，用來展示「AI 建議待確認」卡片。
    aiSuggestedPending: 5,
    conversionRate: 63.7,
  },
  recommendations: [
    recommendation(
      1,
      '中秋炭烤海鮮組',
      '食品／生鮮',
      94.6,
      'PENDING',
      100,
      '節慶標籤與近期搜尋熱度高度吻合。',
    ),
    recommendation(
      2,
      '智能溫控氣炸鍋',
      '3C／家電',
      91.8,
      'PENDING',
      92,
      '高客單但毛利與核心客群契合度良好。',
    ),
    recommendation(
      3,
      '低糖精品月餅禮盒',
      '精品禮盒',
      90.4,
      'REJECTED',
      96,
      '節慶需求強，調整包裝成本後值得重新評估。',
      2,
      '上次因包材成本偏高未通過。',
    ),
    recommendation(
      4,
      '膠原蛋白飲 30 入',
      '美妝保養',
      88.9,
      'PENDING',
      88,
      '回購特性明確，女性核心客群匹配度高。',
    ),
    recommendation(
      5,
      '抗菌涼感床包組',
      '寢具家用',
      86.7,
      'APPROVED',
      100,
      '季節需求穩定，供應商交期與毛利表現良好。',
    ),
    recommendation(
      6,
      '折疊露營推車',
      '生活雜貨',
      85.3,
      'PENDING',
      84,
      '戶外趨勢持續上升，社群討論度高。',
    ),
    recommendation(
      7,
      '天然酵素洗衣膠囊',
      '日用品',
      83.8,
      'PENDING',
      80,
      '消耗型商品，價格競爭力與復購潛力佳。',
    ),
    recommendation(
      8,
      '磁吸快充行動電源',
      '3C／家電',
      82.1,
      'PENDING',
      76,
      '市場需求高，但需留意認證與客訴風險。',
    ),
    recommendation(
      9,
      '機能防曬外套',
      '服飾配件',
      80.9,
      'REJECTED',
      72,
      '季節性強，補齊尺寸退換貨方案後可重審。',
      3,
      '上次因尺寸退換貨風險未通過。',
    ),
    recommendation(
      10,
      '常溫滴雞精禮盒',
      '食品／生鮮',
      79.6,
      'PENDING',
      68,
      '送禮需求穩定，客群契合度良好。',
    ),
  ],
  riskAlerts: [
    {
      id: 1,
      productName: '磁吸快充行動電源',
      message: 'AI 摘要提及認證文件與電池安全資訊尚未確認。',
      detectedKeyword: '認證／安全',
    },
    {
      id: 2,
      productName: '機能防曬外套',
      message: '尺寸退換貨政策不完整，可能提高客服與庫存壓力。',
      detectedKeyword: '退換貨',
    },
    {
      id: 3,
      productName: '低糖精品月餅禮盒',
      message: '節慶檔期接近，包裝交期可能影響預定時程。',
      detectedKeyword: '交期',
    },
  ],
};

export const INCOMPLETE_RECOMMENDATION: DashboardRecommendation = recommendation(
  0,
  '產地直送水果箱',
  '食品／生鮮',
  0,
  'PENDING',
  48,
  '資料完整度未達 60%，暫不進入評分與 Top 10。',
);

function recommendation(
  rank: number,
  name: string,
  category: string,
  finalScore: number,
  reviewStatus: DashboardRecommendation['reviewStatus'],
  completeness: number,
  aiReason: string,
  submissionCount = 1,
  previousRejectionSummary?: string,
): DashboardRecommendation {
  return {
    id: 1000 + rank,
    rank,
    name,
    category,
    finalScore,
    reviewStatus,
    completeness,
    aiReason,
    submissionCount,
    previousRejectionSummary,
  };
}
