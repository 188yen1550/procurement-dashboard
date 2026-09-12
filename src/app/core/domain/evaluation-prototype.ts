import { Injectable, computed, signal } from '@angular/core';

export interface EvaluationFactor { code: string; name: string; weight: number | null }
export interface CustomEvaluationMode {
  id: string; name: string; description: string; creator: string; factors: EvaluationFactor[]; version: number;
}
export const BASE_FACTORS: readonly EvaluationFactor[] = [
  { code: 'business', name: '商品商業條件', weight: 25 },
  { code: 'audience', name: '核心客群匹配度', weight: 25 },
  { code: 'history', name: '歷史銷售資料', weight: 25 },
  { code: 'forecast', name: '預測人氣', weight: 25 },
];
export const FIXED_MODE_OPTIONS = [
  { id: 'BALANCED', name: '均衡模式' }, { id: 'VOLUME', name: '衝量模式' }, { id: 'PROFIT', name: '高利潤模式' },
] as const;
export function validWeights(factors: readonly EvaluationFactor[]): boolean {
  return factors.length > 0 && factors.every(f => typeof f.weight === 'number' && Number.isFinite(f.weight) && f.weight >= 0 && f.weight <= 100)
    && Math.abs(factors.reduce((sum, f) => sum + (f.weight ?? 0), 0) - 100) < 0.000001;
}
/** 僅記憶體狀態。建立者身分、權重保存與套用 API、審核快照均待 PM／後端定案。 */
@Injectable({ providedIn: 'root' })
export class EvaluationPrototype {
  readonly customModes = signal<CustomEvaluationMode[]>([]);
  readonly activeMode = signal('BALANCED');
  readonly revision = signal(1);
  readonly options = computed(() => [...FIXED_MODE_OPTIONS, ...this.customModes().map(m => ({ id: m.id, name: m.name }))]);
  save(draft: CustomEvaluationMode): void {
    if (!validWeights(draft.factors) || !draft.name.trim()) throw new Error('請確認名稱與權重');
    const exists = this.customModes().some(m => m.id === draft.id);
    const copy = { ...draft, name: draft.name.trim(), factors: draft.factors.map(f => ({ ...f })) };
    this.customModes.update(modes => exists ? modes.map(m => m.id === draft.id ? copy : m) : [...modes, copy]);
    this.revision.update(v => v + 1);
  }
  apply(id: string): void {
    if (!this.options().some(m => m.id === id)) return;
    this.activeMode.set(id);
    this.revision.update(v => v + 1);
  }
}
