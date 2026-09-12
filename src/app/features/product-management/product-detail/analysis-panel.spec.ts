import { TestBed } from '@angular/core/testing';
import { AnalysisPanel } from './analysis-panel';
import { MockAnalysisRepository } from '../../../core/domain/analysis-prototype';
describe('本地分析與趨勢', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function create() {
    const fixture = TestBed.createComponent(AnalysisPanel);
    fixture.componentRef.setInput('productId', 101);
    fixture.componentRef.setInput('reasons', ['團購價格具有吸引力。']);
    fixture.componentRef.setInput('risks', ['需確認供貨。']);
    fixture.detectChanges();
    return fixture;
  }
  it('讀取既有摘要並分成中文推薦原因、風險與時間版本', () => {
    const f = create();
    const text = (f.nativeElement as HTMLElement).textContent;
    expect(text).toContain('推薦原因'); expect(text).toContain('風險提示');
    expect(text).toContain('2026/09/01'); expect(text).toContain('資料版本');
    expect(f.componentInstance.analyzing()).toBe(false);
  });
  it('失敗保留原有摘要，分析中防止重複操作', () => {
    const f = create(), c = f.componentInstance, previous = c.snapshot();
    c.failAnalysis.set(true); c.generate(); c.generate();
    expect(c.analyzing()).toBe(true);
    vi.advanceTimersByTime(700);
    expect(c.snapshot()).toEqual(previous); expect(c.analysisError()).toContain('已保留');
    c.failAnalysis.set(false);
    const generate = vi.spyOn(TestBed.inject(MockAnalysisRepository), 'generate');
    c.generate(); c.generate(); vi.advanceTimersByTime(700);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('支持首次空白、資料不足與規則或資料過期', () => {
    const f=create(), c=f.componentInstance;
    c.dataVersion.set(2); expect(c.stale()).toContain('資料已更新');
    c.ruleVersion.set(2); expect(c.stale()).toContain('規則已變更');
    c.clearAnalysis(); expect(c.snapshot()).toBeNull();
    f.componentRef.setInput('incomplete',true); f.detectChanges(); c.generate();
    expect(c.analyzing()).toBe(false);
    expect((f.nativeElement as HTMLElement).textContent).toContain('資料不足，暫時無法產生完整分析');
  });
  it('不同模式更新展示序列，保持載入、空白與錯誤狀態', () => {
    const f=create(), c=f.componentInstance, initial=c.trend();
    c.selectMode('VOLUME'); expect(c.trendState()).toBe('loading');
    vi.advanceTimersByTime(400); expect(c.trend()).not.toEqual(initial);
    expect(c.modeName()).toBe('衝量模式');
    c.setTrendState('empty'); f.detectChanges(); expect((f.nativeElement as HTMLElement).textContent).toContain('尚無趨勢資料');
    c.setTrendState('error'); f.detectChanges(); expect((f.nativeElement as HTMLElement).textContent).toContain('模擬趨勢載入失敗');
  });
  it('锁定後不能分析或切換模式，天氣不進基本權重', () => {
    const f=create(), c=f.componentInstance;
    f.componentRef.setInput('locked',true); f.detectChanges(); c.generate(); c.selectMode('PROFIT');
    expect(c.analyzing()).toBe(false); expect(c.selectedMode()).toBe('BALANCED');
    expect((f.nativeElement as HTMLElement).textContent).toContain('未納入四項基本權重');
  });
});
