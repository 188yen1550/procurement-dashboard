import { TestBed } from '@angular/core/testing';
import { ProductImage } from './product-image';
describe('商品圖片', () => {
  it('缺圖或圖片失敗都顯示一致的替代圖，保留替代文字', () => {
    const f=TestBed.createComponent(ProductImage);f.componentRef.setInput('name','測試商品');f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[role=img]')?.getAttribute('aria-label')).toContain('測試商品');
    f.componentRef.setInput('src','/missing.png');f.detectChanges();
    const img=(f.nativeElement as HTMLElement).querySelector('img')!;expect(img.alt).toContain('測試商品');img.dispatchEvent(new Event('error'));f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('尚無圖片');
    f.componentRef.setInput('src','/replacement.png');f.detectChanges();expect((f.nativeElement as HTMLElement).querySelector('img')).toBeTruthy();
  });
});
