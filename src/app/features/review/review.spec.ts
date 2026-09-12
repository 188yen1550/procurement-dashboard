import { APP_RUNTIME_CONFIG } from '../../core/config/app-config';
/** 檔案用途：驗證待審預設範圍、決策紀錄與 Loading／Empty／Error 本地狀態。 */
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Review } from './review';
describe('Review', () => {
  let fixture: ComponentFixture<Review>;
  let component: Review;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Review],
      providers: [
        { provide: APP_RUNTIME_CONFIG, useValue: { useMockData: false } },provideHttpClient(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Review);
    component = fixture.componentInstance;
    // 本檔驗證的是元件內建的完整 Demo 資料與各種 Mock UI 狀態。
    // 全域設定目前使用真實 API，因此必須在第一次 change detection（ngOnInit）前
    // 明確切回 Mock 模式，避免測試誤送 HTTP 並只得到空清單。
    Object.defineProperty(component, 'useMockData', { value: true });
    fixture.detectChanges();
  });
  it('uses the shared image fallback without removing page actions', () => {
    const item=component.filtered()[0]; component.items.set([{...item,imageUrl:'/broken.png'}]);
    fixture.detectChanges();
    const host=fixture.nativeElement.querySelector('app-product-image');
    const img=host.querySelector('img');
    expect(img.alt).toContain(item.name);
    img.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(host.querySelector('[role=img]').getAttribute('aria-label')).toContain(item.name);
    expect(fixture.nativeElement.querySelector('a,button')).toBeTruthy();
  });
  it('creates with default pending and active filters', () => {
    expect(component).toBeTruthy();
    expect(component.items().length).toBe(4);
    expect(component.filtered().length).toBe(3);
    expect(component.reviewFilter()).toBe('PENDING');
    expect(component.itemFilter()).toBe('ACTIVE');
    expect(fixture.nativeElement.textContent).toContain('選品審核');
  });
  it.each([[null, '尚未計算'], [0, '0%'], [78, '78%']])('renders completeness %s with the expected label', (value, label) => {
    const item = component.filtered()[0];
    component.items.set([{...item, completeness: value as number | null}]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.meta').textContent).toContain(label);
    expect(fixture.nativeElement.textContent).not.toContain('Human Review');
    expect(fixture.nativeElement.textContent).not.toContain('—%');
  });

  it('filters by review and item status', () => {
    component.reviewFilter.set('REJECTED');
    component.itemFilter.set('ARCHIVED');
    expect(component.filtered().map((item) => item.id)).toEqual([109]);
  });
  it('shows resubmission context', () => {
    expect(fixture.nativeElement.textContent).toContain('第 2 次送審');
  });
  it('shows decision records', () => {
    component.view.set('records');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('保留每次送審快照');
    expect(fixture.nativeElement.textContent).toContain('節慶需求明確');
  });
  it('renders disabled loading empty and error states', () => {
    component.setState('disabled');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('審核停用');
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入待審核');
    component.setState('empty');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('目前沒有審核品項');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
});
