import { Component, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

type SettingsState = 'default' | 'disabled' | 'loading' | 'error';
type SettingsTab = 'modes' | 'risks' | 'audience' | 'productTypes' | 'campaigns' | 'accounts';
interface EvaluationMode {
  code: string;
  name: string;
  description: string;
  weights: { business: number; audience: number; history: number; forecast: number };
}

@Component({
  selector: 'app-settings',
  imports: [FormsModule, ReactiveFormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  readonly stateOptions: readonly SettingsState[] = ['default', 'disabled', 'loading', 'error'];
  readonly activeTab = signal<SettingsTab>('modes');
  readonly pageState = signal<SettingsState>('default');
  readonly saved = signal(false);
  readonly statusMessage = signal('');
  readonly activeMode = signal('BALANCED');
  readonly modes: readonly EvaluationMode[] = [
    {
      code: 'BALANCED',
      name: '均衡模式',
      description: '商業條件、客群、歷史與預測各佔四分之一。',
      weights: { business: 25, audience: 25, history: 25, forecast: 25 },
    },
    {
      code: 'VOLUME',
      name: '衝量模式',
      description: '優先考量客群匹配與預測人氣。',
      weights: { business: 15, audience: 30, history: 15, forecast: 40 },
    },
    {
      code: 'PROFIT',
      name: '高利潤模式',
      description: '提高商業條件權重，同時保留人氣預測。',
      weights: { business: 45, audience: 15, history: 15, forecast: 25 },
    },
  ];
  readonly riskOptions = signal([
    { name: '實際供貨風險', keywords: '缺貨、延遲、供貨不穩', active: true },
    { name: '商品品質與客訴風險', keywords: '瑕疵、過敏、客訴', active: true },
    { name: '市場不確定性與需求變動風險', keywords: '熱度下降、需求波動、競品', active: true },
  ]);
  readonly productTypes = signal([
    { name: '食品／生鮮', system: true, used: 12, active: true },
    { name: '日用品', system: true, used: 8, active: true },
    { name: '3C／家電', system: true, used: 6, active: true },
    { name: '生活雜貨', system: true, used: 4, active: true },
    { name: '美妝保養', system: true, used: 3, active: true },
    { name: '服飾配件', system: true, used: 0, active: true },
    { name: '寢具家用', system: true, used: 2, active: true },
    { name: '精品禮盒', system: true, used: 1, active: true },
    { name: '其他', system: true, used: 0, active: true },
  ]);
  readonly campaigns = signal([
    {
      name: '中秋節',
      category: '🎊 節慶',
      range: '2026/08/15–2026/09/25',
      status: 'ACTIVE',
      override: false,
    },
    {
      name: '雙十連假',
      category: '🎊 節慶',
      range: '2026/09/15–2026/10/10',
      status: 'PREPARING',
      override: false,
    },
    {
      name: '秋冬換季',
      category: '🍂 季節',
      range: '2026/10/01–2026/11/15',
      status: 'UPCOMING',
      override: true,
    },
  ]);
  readonly accounts = signal([
    { username: 'manager01', name: '林經理', role: 'MANAGER', active: true },
    { username: 'buyer01', name: '陳小姐', role: 'PURCHASER', active: true },
    { username: 'buyer02', name: '王先生', role: 'PURCHASER', active: false },
  ]);
  readonly modal = signal<
    null | 'risk' | 'productType' | 'campaign' | 'campaignStatus' | 'account'
  >(null);
  readonly selectedCampaign = signal('');
  readonly draftName = signal('');
  readonly draftKeywords = signal('');
  readonly draftUsername = signal('');
  readonly draftRole = signal<'PURCHASER' | 'MANAGER'>('PURCHASER');
  readonly draftPassword = signal('');
  readonly draftCategory = signal<'FESTIVAL' | 'SEASON'>('FESTIVAL');
  readonly draftStart = signal('');
  readonly draftEnd = signal('');
  readonly draftLeadDays = signal(30);
  readonly draftTags = signal([{ tag: '', tier: 'CORE' }]);
  readonly draftStatus = signal('ACTIVE');
  readonly form = new FormBuilder().nonNullable.group({
    name: ['核心家庭團購客群', [Validators.required, Validators.maxLength(100)]],
    ageMin: [28, [Validators.required, Validators.min(18), Validators.max(99)]],
    ageMax: [45, [Validators.required, Validators.min(18), Validators.max(99)]],
    priceSensitivity: ['MEDIUM', Validators.required],
    preferenceDescription: [
      '重視實用性、安全性與團購價格優勢，偏好家庭共用與節慶情境商品。',
      [Validators.required, Validators.maxLength(500)],
    ],
    keywords: ['家庭, 實用, 親子, 團購優惠', Validators.required],
  });
  setTab(tab: SettingsTab): void {
    this.activeTab.set(tab);
    this.statusMessage.set('已切換設定分類。');
  }
  setState(state: SettingsState): void {
    this.pageState.set(state);
    if (state === 'disabled') this.form.disable();
    else this.form.enable();
    this.statusMessage.set(`已切換為 ${state} 狀態。`);
  }
  saveAudience(): void {
    if (this.form.invalid || this.ageRangeInvalid()) {
      this.form.markAllAsTouched();
      this.statusMessage.set('請修正客群設定欄位。');
      return;
    }
    this.saved.set(true);
    this.form.markAsPristine();
    this.statusMessage.set('核心客群已儲存至本地 Mock 狀態。');
  }
  selectMode(code: string): void {
    if (this.pageState() === 'disabled') return;
    this.activeMode.set(code);
    this.statusMessage.set(`已在本地切換為 ${this.modes.find((m) => m.code === code)?.name}。`);
  }
  openModal(type: Exclude<ReturnType<typeof this.modal>, null>, campaign = ''): void {
    this.selectedCampaign.set(campaign);
    this.modal.set(type);
  }
  editCampaign(name: string): void {
    const campaign = this.campaigns().find((item) => item.name === name);
    if (!campaign) return;
    this.selectedCampaign.set(name);
    this.draftName.set(campaign.name);
    this.draftCategory.set(campaign.category.includes('節慶') ? 'FESTIVAL' : 'SEASON');
    const [start, end] = campaign.range.split('–').map((date) => date.replaceAll('/', '-'));
    this.draftStart.set(start ?? '');
    this.draftEnd.set(end ?? '');
    this.draftTags.set([{ tag: '示範標籤', tier: 'CORE' }]);
    this.modal.set('campaign');
  }
  closeModal(): void {
    this.modal.set(null);
    this.draftName.set('');
    this.draftKeywords.set('');
    this.draftUsername.set('');
    this.draftPassword.set('');
    this.draftTags.set([{ tag: '', tier: 'CORE' }]);
  }
  addTagRow(): void {
    // 後端 enum 是 CORE/GENERAL/WEAK（FestiveCampaignTagMatchTier），
    // 不可寫成 NORMAL——GENERAL 帶有實際計分權重 0.6，字串必須逐字對應。
    this.draftTags.update((rows) => [...rows, { tag: '', tier: 'GENERAL' }]);
  }
  removeTagRow(index: number): void {
    this.draftTags.update((rows) => rows.filter((_, i) => i !== index));
  }
  saveModal(): void {
    const type = this.modal();
    if (type === 'risk' && this.draftName().trim() && this.draftKeywords().trim())
      this.riskOptions.update((items) => [
        ...items,
        { name: this.draftName().trim(), keywords: this.draftKeywords().trim(), active: true },
      ]);
    else if (type === 'productType' && this.draftName().trim())
      this.productTypes.update((items) => [
        ...items,
        { name: this.draftName().trim(), system: false, used: 0, active: true },
      ]);
    else if (
      type === 'campaign' &&
      this.draftName().trim() &&
      this.draftStart() &&
      this.draftEnd() &&
      this.draftTags().some((row) => row.tag.trim())
    ) {
      const value = {
        name: this.draftName().trim(),
        category: this.draftCategory() === 'FESTIVAL' ? '🎊 節慶' : '🍂 季節',
        range: `${this.draftStart()}–${this.draftEnd()}`,
        status: 'UPCOMING',
        override: false,
      };
      this.campaigns.update((items) =>
        this.selectedCampaign()
          ? items.map((item) =>
              item.name === this.selectedCampaign() ? { ...item, ...value } : item,
            )
          : [...items, value],
      );
    } else if (
      type === 'account' &&
      this.draftUsername().trim() &&
      this.draftName().trim() &&
      this.draftPassword().trim()
    )
      this.accounts.update((items) => [
        ...items,
        {
          username: this.draftUsername().trim(),
          name: this.draftName().trim(),
          role: this.draftRole(),
          active: true,
        },
      ]);
    else {
      this.statusMessage.set('請完整填寫必填欄位。');
      return;
    }
    this.statusMessage.set('已儲存至本地 Mock 狀態。');
    this.closeModal();
  }
  removeProductType(name: string): void {
    const item = this.productTypes().find((type) => type.name === name);
    if (!item) return;
    if (item.used > 0) {
      this.statusMessage.set('此類型已被品項使用，不可刪除，請改為停用。');
      return;
    }
    this.productTypes.update((items) => items.filter((type) => type.name !== name));
  }
  disableProductType(name: string): void {
    this.productTypes.update((items) =>
      items.map((item) => (item.name === name ? { ...item, active: false } : item)),
    );
  }
  disableAccount(username: string): void {
    this.accounts.update((items) =>
      items.map((item) => (item.username === username ? { ...item, active: false } : item)),
    );
    this.statusMessage.set('已停用帳號；稽核關聯資料仍保留。');
  }
  applyCampaignStatus(): void {
    this.campaigns.update((items) =>
      items.map((item) =>
        item.name === this.selectedCampaign()
          ? { ...item, status: this.draftStatus(), override: true }
          : item,
      ),
    );
    this.modal.set(null);
  }
  retry(): void {
    this.pageState.set('default');
    this.form.enable();
    this.statusMessage.set('設定資料已恢復。');
  }
  fieldInvalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }
  ageRangeInvalid(): boolean {
    return this.form.controls.ageMin.value > this.form.controls.ageMax.value;
  }
}
