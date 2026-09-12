import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProductTypes } from './product-types';

describe('ProductTypes', () => {
  let component: ProductTypes;
  let fixture: ComponentFixture<ProductTypes>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductTypes],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductTypes);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
