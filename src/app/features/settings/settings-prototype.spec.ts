import '../../core/dialog/modal-test-setup';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Settings } from './settings';
import { DialogService } from '../../core/dialog/dialog.service';
import { validWeights } from '../../core/domain/evaluation-prototype';
describe('自訂評估模式原型', () => {
  beforeEach(() => {vi.useFakeTimers(); TestBed.configureTestingModule({providers:[provideHttpClient(), provideRouter([])]});});
  afterEach(() => vi.useRealTimers());
  function create(){ const f=TestBed.createComponent(Settings); f.detectChanges(); return f; }
  it('保留三個系統模式唯讀權重，另可進入自訂編輯', () => {
    const f=create();
    expect(f.componentInstance.modes().length).toBe(3);
    expect((f.nativeElement as HTMLElement).querySelector('.mode-grid input[type=number]')).toBeNull();
    f.componentInstance.openCustom(); f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelectorAll('.weight-row input[type=number]').length).toBe(4);
  }, 15000);
  it('固定卡片共用原生 radio，點擊及 Enter 可選取，停用後不可切換', () => {
    const f=create(), c=f.componentInstance;
    const radios = [...(f.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('.mode-radio')];
    expect(radios.length).toBe(3);
    const weights = c.modes().map(m => ({...m.weights}));
    radios[1].click(); f.detectChanges();
    expect(c.activeMode()).toBe('VOLUME');
    radios[2].dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true})); f.detectChanges();
    expect(c.activeMode()).toBe('PROFIT');
    expect(radios[2].checked).toBe(true);
    expect(radios[2].closest('article')?.classList.contains('active')).toBe(true);
    c.setState('disabled'); f.detectChanges();
    radios[0].click();
    radios[0].dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
    expect(radios.every(r => r.disabled)).toBe(true);
    expect(c.activeMode()).toBe('PROFIT');
    expect(c.modes().map(m => m.weights)).toEqual(weights);
  });
  it('拒絕不足、超出、負值、非數值與空權重', () => {
    const f=create(), c=f.componentInstance; c.openCustom(); c.changeCustom('name','自訂');
    for(const value of [20,30,-1,101,NaN,null]) {c.changeWeight(0,value); expect(c.customValid()).toBe(false); c.saveCustom(); expect(c.prototype.customModes().length).toBe(0);}
    expect(validWeights([])).toBe(false);
    c.changeWeight(0,25); expect(c.customValid()).toBe(true);
    c.changeCustom('name','  '); expect(c.customValid()).toBe(false);
  });
  it('同步數字與滑桿，顯示總和差額', () => {
    const f=create(), c=f.componentInstance; c.openCustom(); c.changeWeight(0,30); f.detectChanges();
    expect(c.weightTotal()).toBe(105);
    expect((f.nativeElement as HTMLElement).textContent).toContain('超過 5.0%');
    expect((f.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type=range]')?.value).toBe('30');
  });
  it('防止重複儲存、失敗保留輸入，成功可編輯與套用', () => {
    const f=create(), c=f.componentInstance; c.openCustom(); c.changeCustom('name','飲料評估'); c.customFailure.set(true);
    c.saveCustom(); c.saveCustom(); expect(c.customSaving()).toBe(true); vi.advanceTimersByTime(500);
    expect(c.customDraft()?.name).toBe('飲料評估'); expect(c.customMessage()).toContain('失敗');
    c.customFailure.set(false); c.saveCustom(); c.saveCustom(); vi.advanceTimersByTime(500);
    expect(c.prototype.customModes().length).toBe(1);
    const mode=c.prototype.customModes()[0]; c.applyCustom(mode.id); expect(c.prototype.activeMode()).toBe(mode.id);
    c.openCustom(mode); c.changeCustom('description','更新說明'); c.saveCustom(); vi.advanceTimersByTime(500);
    expect(c.prototype.customModes()[0].description).toBe('更新說明');
  });
  it('離頁和切換分頁要求確認未儲存資料', () => {
    const f=create(),c=f.componentInstance;c.openCustom();c.changeCustom('name','未完成');
    c.setTab('productTypes'); expect(c.activeTab()).toBe('modes');
    const dialog=TestBed.inject(DialogService); expect(dialog.state()?.variant).toBe('confirm');
    dialog.handleCancel(); expect(c.customDraft()?.name).toBe('未完成');
    let result=true;c.canLeave().subscribe(ok=>result=ok);dialog.handleCancel();expect(result).toBe(false);
  });
  it('唯讀狀態不能新增、修改或儲存模式', () => {
    const c=create().componentInstance; c.setState('disabled'); c.openCustom(); expect(c.customDraft()).toBeNull();
    c.setState('default');c.openCustom();c.changeCustom('name','原型');c.setState('disabled');c.saveCustom();expect(c.customSaving()).toBe(false);
  });
});
