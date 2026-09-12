import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SettingsApiService } from '../../settings/api/settings-api.service';
import { ProductTypeResponsePayload } from '../../settings/settings-api.contract';

@Component({
  selector: 'app-product-types',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product-types.html',
  styleUrl: './product-types.scss'
})
export class ProductTypes implements OnInit {
  private settingsApi = inject(SettingsApiService);

  productTypes: ProductTypeResponsePayload[] = [];
  isLoading = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadProductTypes();
  }

  loadProductTypes(): void {
    this.isLoading = true;
    this.settingsApi.getProductTypes().subscribe({
      next: (res) => {
        this.productTypes = res;
        this.isLoading = false;
      },
      error: (err: any) => {
        this.errorMessage = '載入商品類型失敗';
        this.isLoading = false;
        console.error(err);
      }
    });
  }

  onEnable(id: number): void {
    this.settingsApi.enableProductType(id).subscribe({
      next: () => this.loadProductTypes(),
      error: (err: any) => {
        console.error('啟用失敗', err);
        this.errorMessage = '啟用失敗，請稍後再試';
      }
    });
  }

  onRename(id: number, newName: string): void {
    this.settingsApi.updateProductType(id, { name: newName }).subscribe({
      next: () => this.loadProductTypes(),
      error: (err: any) => {
        console.error('更名失敗', err);
        this.errorMessage = '更名失敗，請稍後再試';
      }
    });
  }
}
