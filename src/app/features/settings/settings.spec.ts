/** 檔案用途：驗證固定模式、9 類商品、條件式刪除、檔期入口與帳號停用等設定 Mock 規則。 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Settings } from './settings';
describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let component: Settings;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Settings] }).compileComponents();
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  it('creates the complete management settings page', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('評估模式');
    expect(fixture.nativeElement.textContent).toContain('帳號管理');
    expect(fixture.nativeElement.textContent).not.toContain('核心客群設定');
    expect(Array.from(fixture.nativeElement.querySelectorAll('.tabs button')).some((button: unknown) => (button as HTMLButtonElement).textContent?.includes('核心客群'))).toBe(false);
  });
  it('validates audience age range', () => {
    component.form.patchValue({ ageMin: 50, ageMax: 30 });
    component.saveAudience();
    expect(component.saved()).toBe(false);
    expect(component.ageRangeInvalid()).toBe(true);
    expect(component.statusMessage()).toContain('請修正客群設定欄位');
  });
  it('saves valid audience settings locally', () => {
    component.saveAudience();
    expect(component.saved()).toBe(true);
    expect(component.statusMessage()).toContain('核心客群已儲存');
  });
  it('disables controls with an explanation', () => {
    component.setState('disabled');
    expect(component.form.disabled).toBe(true);
    expect(component.statusMessage()).toContain('disabled');
  });
  it('prevents normal navigation from entering the hidden audience tab', () => {
    component.setTab('audience');
    expect(component.activeTab()).toBe('modes');
    expect(component.statusMessage()).toContain('暫不開放');
  });
  it('shows risk, product type, campaign and account settings', () => {
    for (const tab of ['risks', 'productTypes', 'campaigns', 'accounts'] as const) {
      component.setTab(tab);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.data-table')).toBeTruthy();
    }
  });
  it('contains all nine default product types', () => {
    expect(component.productTypes().filter((item) => item.system).length).toBe(9);
  });
  it('creates a risk option through modal state', () => {
    component.openModal('risk');
    component.draftName.set('測試風險');
    component.draftKeywords.set('測試關鍵字');
    component.saveModal();
    expect(component.riskOptions().some((item) => item.name === '測試風險')).toBe(true);
  });
  it('prevents deleting an in-use product type', () => {
    component.removeProductType('食品／生鮮');
    expect(component.productTypes().some((item) => item.name === '食品／生鮮')).toBe(true);
    expect(component.statusMessage()).toContain('不可刪除');
  });
  it('disables accounts and retains their records', () => {
    component.disableAccount('buyer01');
    expect(component.accounts().find((item) => item.username === 'buyer01')?.active).toBe(false);
    expect(component.accounts().length).toBe(3);
  });
  it('shows fixed read-only weights and switches modes', () => {
    component.setTab('modes');
    component.selectMode('PROFIT');
    fixture.detectChanges();
    expect(component.activeMode()).toBe('PROFIT');
    expect(fixture.nativeElement.textContent).toContain('高利潤模式');
    expect(fixture.nativeElement.textContent).toContain('權重唯讀');
  });
  it('renders loading and error recovery states', () => {
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入設定');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('無法載入設定');
    component.retry();
    expect(component.pageState()).toBe('default');
  });
});
