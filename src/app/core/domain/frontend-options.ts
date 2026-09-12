/** 前端原型選項；編號不是正式資料庫映射，正式分類與再販售來源待後端確認。 */
export interface ProductTypeOption { id: number; name: string }
export const PRODUCT_TYPES: readonly ProductTypeOption[] = [
  { id: 1, name: '生鮮' }, { id: 2, name: '日用品' }, { id: 3, name: '電子配件' },
  { id: 4, name: '生活雜貨' }, { id: 5, name: '美妝保養' }, { id: 6, name: '服飾配件' },
  { id: 7, name: '寢具家用' }, { id: 8, name: '精品禮盒' }, { id: 9, name: '其他' },
  { id: 10, name: '零食' }, { id: 11, name: '冷凍食品' }, { id: 12, name: '常溫食品' }, { id: 13, name: '飲料' },
];
export const CAMPAIGN_TAGS = [
  { code: 'bbq', name: '中秋烤肉' }, { code: 'gift', name: '節慶送禮' },
  { code: 'family', name: '家庭聚會' }, { code: 'daily', name: '日常補貨' },
  { code: 'summer', name: '夏季消暑' }, { code: 'winter', name: '冬季保暖' },
  { code: 'seasonal', name: '換季用品' },
] as const;
export function tagLabel(code: string): string {
  return CAMPAIGN_TAGS.find(t => t.code === code)?.name ?? (/^[\u3400-\u9fff\s]+$/u.test(code) ? code : '其他節慶標籤');
}
export const RESALE_PRODUCTS = [
  { id: 101, name: '中秋炭烤海陸組合禮盒' }, { id: 103, name: '無香低敏濃縮洗衣紙補充組' },
] as const;
/** 與本地 Java ProductService 白名單及 multipart 設定對照；WebP 解碼能力仍待整合驗證。 */
export const IMAGE_POLICY = {
  maxBytes: 5 * 1024 * 1024,
  types: ['image/jpeg', 'image/png', 'image/webp'], extensions: ['jpg', 'jpeg', 'png', 'webp'],
} as const;
export function imageTypeLabel(type: string): string {
  return ({ 'image/jpeg': 'JPG 圖片', 'image/png': 'PNG 圖片', 'image/webp': 'WebP 圖片' } as Record<string, string>)[type] ?? '圖片';
}
export function supplyLabel(value: number): string {
  return value === 0 ? '暫時缺貨' : value >= 4 ? '供貨充足' : '供貨不穩定';
}
export const UI_STATE_LABEL: Record<string, string> = {
  default: '正常', disabled: '唯讀', locked: '鎖定', loading: '載入中', pending: '處理中', empty: '無資料', error: '錯誤',
};
