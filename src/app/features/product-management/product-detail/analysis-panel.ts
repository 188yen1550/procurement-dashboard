import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalysisSnapshot, MockAnalysisRepository, TREND_FIXTURES } from '../../../core/domain/analysis-prototype';
import { EvaluationPrototype } from '../../../core/domain/evaluation-prototype';

@Component({
  selector: 'app-analysis-panel', imports: [FormsModule, DatePipe],
  templateUrl: './analysis-panel.html', styleUrl: './analysis-panel.scss',
})
export class AnalysisPanel {
  readonly productId = input.required<number>();
  readonly incomplete = input(false);
  readonly locked = input(false);
  readonly reasons = input<string[]>([]);
  readonly risks = input<string[]>([]);
  readonly category = input('');
  readonly modes = inject(EvaluationPrototype);
  private readonly repository = inject(MockAnalysisRepository);
  private readonly destroyRef = inject(DestroyRef);
  readonly snapshot = signal<AnalysisSnapshot | null>(null);
  readonly dataVersion = signal(1);
  readonly ruleVersion = signal(1);
  readonly analyzing = signal(false);
  readonly analysisError = signal('');
  readonly failAnalysis = signal(false);
  readonly selectedMode = signal(this.modes.activeMode());
  readonly trendState = signal<'ready' | 'loading' | 'empty' | 'error'>('ready');
  readonly trend = signal<readonly number[]>(TREND_FIXTURES['BALANCED']);
  readonly showWeather = signal(true);
  readonly weatherApplies = computed(() => ['飲料', '冷凍食品', '生鮮'].includes(this.category()));
  readonly stale = computed(() => {
    const s = this.snapshot();
    if (!s) return '';
    if (s.ruleVersion !== this.ruleVersion()) return '規則已變更，建議重新分析。';
    return s.dataVersion !== this.dataVersion() ? '資料已更新，建議重新分析。' : '';
  });
  readonly modeName = computed(() => this.modes.options().find(m => m.id === this.selectedMode())?.name ?? '未選擇');
  private analysisTimer?: number;
  private trendTimer?: number;
  constructor() {
    effect(() => {
      const id = this.productId();
      window.clearTimeout(this.analysisTimer); this.analyzing.set(false); this.analysisError.set('');
      this.repository.seed(id, this.reasons(), this.risks());
      this.snapshot.set(this.repository.read(id));
      this.dataVersion.set(1);
    });
    effect(() => { this.ruleVersion.set(this.modes.revision()); });
    this.destroyRef.onDestroy(() => {window.clearTimeout(this.analysisTimer); window.clearTimeout(this.trendTimer);});
    this.trend.set(TREND_FIXTURES[this.selectedMode()] ?? TREND_FIXTURES['CUSTOM']);
  }
  generate(): void {
    if (this.analyzing() || this.incomplete() || this.locked()) return;
    this.analyzing.set(true); this.analysisError.set('');
    const id = this.productId(), dataVersion = this.dataVersion(), ruleVersion = this.ruleVersion();
    this.analysisTimer = window.setTimeout(() => {
      this.analyzing.set(false);
      if (this.failAnalysis()) { this.analysisError.set('模擬分析失敗，已保留原有摘要，請重試。'); return; }
      this.snapshot.set(this.repository.generate(id, dataVersion, ruleVersion));
    }, 700);
  }
  clearAnalysis(): void {
    if (this.analyzing()) return;
    this.snapshot.set(null); this.analysisError.set('');
  }
  selectMode(id: string): void {
    if (this.locked() || this.trendState() === 'loading') return;
    this.selectedMode.set(id); this.trendState.set('loading');
    this.trendTimer = window.setTimeout(() => {
      this.trend.set(TREND_FIXTURES[id] ?? TREND_FIXTURES['CUSTOM']); this.trendState.set('ready');
    }, 400);
  }
  setTrendState(state: 'ready' | 'empty' | 'error'): void {window.clearTimeout(this.trendTimer); this.trendState.set(state);}
}
