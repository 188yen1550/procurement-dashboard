import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ProductEdit } from './product-edit';

describe('ProductEdit', () => {
  let component: ProductEdit;
  let fixture: ComponentFixture<ProductEdit>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductEdit],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductEdit);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
