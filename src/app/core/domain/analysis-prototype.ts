import { Injectable } from '@angular/core';
export interface AnalysisSnapshot {
  reasons: string[]; risks: string[]; generatedAt: string; dataVersion: number; ruleVersion: number;
}
/** 讀取與重新產生分離，未來由 API adapter 實作；目前僅保存在本次瀏覽器記憶體。 */
export interface AnalysisRepository {
  read(productId: number): AnalysisSnapshot | null;
  generate(productId: number, dataVersion: number, ruleVersion: number): AnalysisSnapshot;
}
@Injectable({providedIn: 'root'})
export class MockAnalysisRepository implements AnalysisRepository {
  private readonly snapshots = new Map<number, AnalysisSnapshot>();
  read(productId: number): AnalysisSnapshot | null { return this.snapshots.get(productId) ?? null; }
  seed(productId: number, reasons: string[], risks: string[]): void {
    if (!this.snapshots.has(productId) && (reasons.length || risks.length)) this.snapshots.set(productId, {reasons: [...reasons], risks: [...risks], generatedAt: '2026-09-01T10:00:00+08:00', dataVersion: 1, ruleVersion: 1});
  }
  generate(productId: number, dataVersion: number, ruleVersion: number): AnalysisSnapshot {
    const snapshot = {reasons: ['商品資料已補齊，可供人工評估。', '本地趨勢範例顯示近期需求增加。'], risks: ['實際供貨與交期仍需向供應商確認。'], generatedAt: new Date().toISOString(), dataVersion, ruleVersion};
    this.snapshots.set(productId, snapshot);
    return snapshot;
  }
}
/** 手工編寫的展示序列，並非權重、價格或正式評分公式的計算結果。 */
export const TREND_FIXTURES: Record<string, readonly number[]> = {
  BALANCED: [54, 58, 61, 67, 70, 75, 78], VOLUME: [52, 64, 62, 76, 80, 83, 91],
  PROFIT: [65, 63, 70, 69, 73, 71, 76], CUSTOM: [50, 57, 65, 61, 74, 77, 82],
};
