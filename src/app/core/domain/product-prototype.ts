import { Injectable, signal } from '@angular/core';
import { ProductListItem, toProductActionAvailability } from '../../features/product-management/api/product.mapper';
import { PRODUCT_TYPES } from './frontend-options';
export interface ProductDraft {
  name: string; supplierName: string; productTypeId: number | null; pricingType: string;
  resaleProductId: number | null; description: string; campaignTags: string[];
  costPrice: number; salePrice: number; marketPrice: number; moq: number;
  supplyStability: number; priceCompetitiveness: number; targetCustomer: string; estimatedPurchaseRate: number;
}
export interface SavedMockProduct {
  id: number; draft: ProductDraft; imageUrl: string | null; reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED'; submissionCount: number;
}
/** 本地操作資料，不持久化、不宣稱正式評分；重新整理即回復示範資料。 */
@Injectable({providedIn: 'root'})
export class ProductPrototype {
  readonly items = signal<SavedMockProduct[]>([]);
  save(draft: ProductDraft, imageUrl: string | null, id?: number, reviewStatus: SavedMockProduct['reviewStatus'] = 'PENDING', resubmit = false): SavedMockProduct {
    const previous = this.items().find(p => p.id === id);
    const item: SavedMockProduct = { id: id ?? Date.now(), draft: {...draft, name: draft.name.trim(), campaignTags: [...draft.campaignTags]}, imageUrl,
      reviewStatus: resubmit ? 'PENDING' : reviewStatus,
      submissionCount: (previous?.submissionCount ?? (reviewStatus === 'REJECTED' || reviewStatus === 'APPROVED' ? 1 : 0)) + (resubmit ? 1 : 0) };
    this.items.update(items => [...items.filter(p => p.id !== item.id), item]);
    return item;
  }
  listItem(item: SavedMockProduct): ProductListItem {
    const status = {reviewStatus: item.reviewStatus, itemStatus: 'ACTIVE' as const, candidateStatus: 'CANDIDATE' as const, submissionCount: item.submissionCount};
    return {id: item.id, name: item.draft.name, imageUrl: item.imageUrl, productTypeId: item.draft.productTypeId,
      productTypeName: PRODUCT_TYPES.find(t => t.id === item.draft.productTypeId)?.name ?? '未分類',
      pricingType: item.draft.pricingType === 'RESALE' ? 'RESALE' : 'NEW', supplierName: item.draft.supplierName, createdByName: '本地操作人員',
      campaignTags: item.draft.campaignTags, finalScore: null, dataCompleteness: null, hasScoreData: false,
      ...status, pricingStatus: item.draft.pricingType === 'RESALE' ? 'PRICED' : 'PENDING_PRICING', updatedAt: null, actions: toProductActionAvailability(status)};
  }
}
