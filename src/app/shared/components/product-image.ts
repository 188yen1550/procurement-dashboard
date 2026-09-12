import { Component, input, signal } from '@angular/core';
@Component({
  selector: 'app-product-image',
  template: `@if (src() && failedUrl() !== src()) {
    <img [src]="src()" [alt]="name() + ' 商品圖片'" (error)="failedUrl.set(src())" />
  } @else { <div class="placeholder" role="img" [attr.aria-label]="name() + '：尚無可用圖片'"><span aria-hidden="true">▧</span><small>尚無圖片</small></div> }`,
  styles: [`:host{display:block;width:100%;min-width:0}img,.placeholder{width:100%;aspect-ratio:4/3;border-radius:12px;object-fit:contain;background:#edf3f0}.placeholder{display:flex;align-items:center;justify-content:center;flex-direction:column;color:#526b60}.placeholder span{font-size:24px}.placeholder small{font-size:11px}`],
})
export class ProductImage {
  readonly src = input<string | null | undefined>(null);
  readonly name = input('商品');
  readonly failedUrl = signal<string | null | undefined>(undefined);
}
