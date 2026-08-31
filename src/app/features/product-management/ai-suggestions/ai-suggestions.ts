import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
type AiState = 'default' | 'disabled' | 'loading' | 'empty' | 'error';
interface Suggestion {
  id: number;
  name: string;
  category: string;
  supplier: string;
  trend: number;
  direction: 'UP' | 'STABLE';
  reason: string;
  audienceMatch: number;
  risk: string;
  candidateStatus: 'AI_SUGGESTED';
  selected: boolean;
}
const SUGGESTIONS: readonly Suggestion[] = [
  {
    id: 201,
    name: '旅行用全能轉接充電器',
    category: '3C／家電',
    supplier: '沐光科技',
    trend: 88,
    direction: 'UP',
    reason: '近 3 日搜尋熱度持續上升，且符合旅遊旺季需求。',
    audienceMatch: 84,
    risk: '需確認安規認證與插座規格。',
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  },
  {
    id: 202,
    name: '超輕量防曬折疊傘',
    category: '生活雜貨',
    supplier: '晴日生活',
    trend: 82,
    direction: 'UP',
    reason: '熱度分數超過 70，進入夏季防曬高峰。',
    audienceMatch: 78,
    risk: '同類商品競爭者多，需確認差異化。',
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  },
  {
    id: 203,
    name: '親子野餐防水地墊',
    category: '寢具家用',
    supplier: '戶外樂園',
    trend: 76,
    direction: 'STABLE',
    reason: '核心客群關鍵字與親子、家庭情境高度吻合。',
    audienceMatch: 92,
    risk: '大型包裝可能提高物流成本。',
    candidateStatus: 'AI_SUGGESTED',
    selected: false,
  },
];
@Component({
  selector: 'app-ai-suggestions',
  imports: [FormsModule, RouterLink],
  templateUrl: './ai-suggestions.html',
  styleUrl: './ai-suggestions.scss',
})
export class AiSuggestions {
  readonly stateOptions: readonly AiState[] = ['default', 'disabled', 'loading', 'empty', 'error'];
  readonly pageState = signal<AiState>('default');
  readonly query = signal('');
  readonly items = signal<Suggestion[]>(SUGGESTIONS.map((i) => ({ ...i })));
  readonly statusMessage = signal('');
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.items().filter(
      (i) => !q || i.name.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q),
    );
  });
  setState(state: AiState): void {
    this.pageState.set(state);
    if (state === 'empty') this.items.set([]);
    else if (!this.items().length && state !== 'error') this.reset();
    this.statusMessage.set(`已切換為 ${state} 狀態。`);
  }
  promote(id: number): void {
    if (this.pageState() === 'disabled') return;
    const item = this.items().find((i) => i.id === id);
    this.items.update((items) => items.filter((i) => i.id !== id));
    this.statusMessage.set(`「${item?.name}」已在本地加入 CANDIDATE 正式候選清單。`);
  }
  toggle(id: number): void {
    this.items.update((items) =>
      items.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)),
    );
  }
  promoteSelected(): void {
    const selected = this.items().filter((i) => i.selected);
    this.items.update((items) => items.filter((i) => !i.selected));
    this.statusMessage.set(`已在本地將 ${selected.length} 筆加入正式候選。`);
  }
  reset(): void {
    this.items.set(SUGGESTIONS.map((i) => ({ ...i })));
    this.pageState.set('default');
    this.query.set('');
    this.statusMessage.set('已恢復 AI 建議 Mock 資料。');
  }
}
