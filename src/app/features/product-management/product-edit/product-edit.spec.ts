import { DialogService } from '../../../core/dialog/dialog.service';
import { ProductApiService } from '../api/product-api.service';
import { Subject } from 'rxjs';
import { APP_RUNTIME_CONFIG } from '../../../core/config/app-config';
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
      providers: [
        { provide: APP_RUNTIME_CONFIG, useValue: { useMockData: false } },provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductEdit);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('confirms the named product and blocks repeated requests', () => {
    component.actions.canDelete = true;
    component.isLoading = false;
    component.productId = 'test-product';
    component.editForm.controls.name.setValue('刪除測試品項');
    const response = new Subject<void>();
    const remove = vi.spyOn(TestBed.inject(ProductApiService), 'remove').mockReturnValue(response);
    const dialog = TestBed.inject(DialogService);
    component.onDelete(); component.onDelete();
    expect(dialog.state()?.messages.join('')).toContain('刪除測試品項');
    expect(remove).not.toHaveBeenCalled();
    dialog.handleCancel();
    component.onDelete(); dialog.handleConfirm(); component.onDelete();
    expect(remove).toHaveBeenCalledTimes(1);
    response.error(new Error('測試錯誤'));
    expect(component.isDeleting).toBe(false);
    expect(dialog.state()?.title).toBe('刪除失敗');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
