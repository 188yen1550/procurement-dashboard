/** 檔案用途：驗證詳情頁 SNAPSHOT、60% 門檻、圖片替代、趨勢與封存／復用 Mock 規則。 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProductDetail } from './product-detail';

describe('ProductDetail', () => {
  let fixture: ComponentFixture<ProductDetail>;
  let component: ProductDetail;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(ProductDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  it('renders a complete product evaluation', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Final Score');
    expect(fixture.nativeElement.textContent).toContain('92.4');
    expect(fixture.nativeElement.textContent).toContain('節慶加成明細');
  });
  it('shows margin, evaluation references and snapshot source', () => {
    expect(fixture.nativeElement.textContent).toContain('毛利率');
    expect(fixture.nativeElement.textContent).toContain('31.1%');
    expect(fixture.nativeElement.textContent).toContain('參考項目');
    expect(fixture.nativeElement.textContent).toContain('SNAPSHOT');
  });
  it('explains approved scope and locked core data', () => {
    expect(component.isLocked()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('不代表已上架');
    expect(fixture.nativeElement.textContent).toContain('一般基本資料仍可編輯');
    expect(fixture.nativeElement.textContent).toContain('核心選品資料已鎖定');
  });
  it('allows approved products to enter edit mode for basic fields', () => {
    const link = fixture.nativeElement.querySelector('.header-actions a');
    expect(link).toBeTruthy();
    expect(link.textContent).toContain('編輯品項');
  });
  it('renders incomplete data without AI fabrication', () => {
    component.showIncomplete();
    fixture.detectChanges();
    expect(component.incomplete()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('不進入評估計分與 AI 推薦');
    expect(fixture.nativeElement.textContent).toContain('不會虛構推薦內容');
  });
  it('simulates trend sync success and failure', () => {
    component.syncTrend();
    expect(component.syncState()).toBe('syncing');
    component.completeSync(false);
    fixture.detectChanges();
    expect(component.syncState()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('同步失敗');
  });
  it('simulates archive and restore locally', () => {
    component.toggleArchive();
    expect(component.product()?.itemStatus).toBe('ARCHIVED');
    component.toggleArchive();
    expect(component.product()?.itemStatus).toBe('ACTIVE');
  });
  it('renders loading empty and error recovery states', () => {
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入品項詳情');
    component.setState('empty');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('找不到品項資料');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('無法載入品項詳情');
  });
  it('renders the product image with useful alt text', () => {
    const image = fixture.nativeElement.querySelector('.product-media img');
    expect(image).toBeTruthy(); expect(image.alt).toContain(component.product()!.name);
  });
  it('shows fallback content when the product image fails', () => {
    component.handleImageError(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('商品圖片載入失敗'); expect(fixture.nativeElement.querySelector('.image-fallback').getAttribute('role')).toBe('alert'); expect(fixture.nativeElement.textContent).toContain('Final Score');
  });
  it('shows an empty image state when imageUrl is absent', () => {
    component.showIncomplete(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('尚無商品圖片');
  });
});
