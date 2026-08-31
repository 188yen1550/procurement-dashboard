import { CanDeactivateFn } from '@angular/router';
import type { ProductForm } from './product-form';

export const productFormCanDeactivate: CanDeactivateFn<ProductForm> = (component) =>
  component.canLeave();
