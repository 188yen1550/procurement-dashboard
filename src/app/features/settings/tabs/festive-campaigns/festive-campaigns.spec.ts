/**
 * 檔案用途：驗證「節慶檔期」分頁（2026-09-24 檔期規則改版）。
 * 重點：規則表單驗證與後端訊息一致、代碼不帶年份、天氣型不可編輯（D1）、
 * 以 id 識別列（修正 B4）、送出內容為日期規則而非起訖日、即時預覽 debounce、
 * 節慶不帶地域／只有季節可指定地域、偏移天數的 ? 說明且僅節慶顯示、
 * 列表只查節慶與季節（天氣檔期移到「天氣連動」分頁）（2026-09-24）。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { FestiveCampaignResponsePayload } from '../../api/settings-api.contract';
import { SettingsApiService } from '../../api/settings-api.service';
import {
  CAMPAIGN_RULE_MESSAGES,
  FestiveCampaigns,
  isValidCampaignCode,
  OFFSET_DAYS_TIP,
  validateCampaignRule,
} from './festive-campaigns';

function campaign(overrides: Partial<FestiveCampaignResponsePayload>): FestiveCampaignResponsePayload {
  return {
    id: 1,
    campaignCode: 'DRAGON_BOAT',
    campaignName: '端午節',
    category: 'FESTIVAL',
    startDate: '2026-06-19',
    endDate: '2026-06-21',
    preparationLeadDays: 30,
    campaignStatus: 'UPCOMING',
    statusSource: 'AUTO',
    isManualOverride: false,
    manualOverrideCycle: null,
    regionCoverageRatio: 1,
    tags: [{ tag: '粽子', matchTier: 'CORE' }],
    dateRuleType: 'LUNAR_DATE',
    ruleMonth: 5,
    ruleDay: 5,
    ruleWeekOrdinal: null,
    ruleWeekday: null,
    ruleSolarTerm: null,
    ruleOffsetDays: 0,
    durationDays: 3,
    endMonth: null,
    endDay: null,
    observedHolidayRule: 'NONE',
    expandLongWeekend: false,
    regions: [],
    cycleYear: 2026,
    occurrenceOverridden: false,
    observedHolidays: [],
    ruleDescription: '每年農曆 5 月 5 日起 3 天',
    ...overrides,
  };
}

describe('festive campaign rule validation', () => {
  it('rejects dates that do not exist but allows 2/29', () => {
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'FIXED_DATE', ruleMonth: 2, ruleDay: 30, durationDays: 1 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.date);
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'FIXED_DATE', ruleMonth: 4, ruleDay: 31, durationDays: 1 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.date);
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'FIXED_DATE', ruleMonth: 2, ruleDay: 29, durationDays: 1 }))
      .toBeNull();
  });

  it('checks each rule type with the backend messages', () => {
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'NTH_WEEKDAY', ruleMonth: 5, ruleWeekOrdinal: 0, ruleWeekday: 7, durationDays: 1 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.nthWeekday);
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'NTH_WEEKDAY', ruleMonth: 5, ruleWeekOrdinal: -1, ruleWeekday: 7, durationDays: 1 }))
      .toBeNull();
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'LUNAR_DATE', ruleMonth: 5, ruleDay: 31, durationDays: 1 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.lunar);
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'SOLAR_TERM', durationDays: 1 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.solarTerm);
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'LUNAR_DATE', ruleMonth: 1, ruleDay: 1, ruleOffsetDays: -31, durationDays: 1 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.offset);
    expect(validateCampaignRule({ category: 'FESTIVAL', dateRuleType: 'LUNAR_DATE', ruleMonth: 5, ruleDay: 5, durationDays: 61 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.duration);
    expect(validateCampaignRule({ category: 'SEASON', dateRuleType: 'FIXED_DATE', ruleMonth: 12, ruleDay: 1 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.seasonEnd);
    expect(validateCampaignRule({ category: 'SEASON', dateRuleType: 'FIXED_DATE', ruleMonth: 12, ruleDay: 1, endMonth: 2, endDay: 31 }))
      .toBeNull();
    expect(validateCampaignRule({ category: 'SEASON', dateRuleType: 'FIXED_DATE', ruleMonth: 12, ruleDay: 1, endMonth: 2, endDay: 28, ruleOffsetDays: 3 }))
      .toBe(CAMPAIGN_RULE_MESSAGES.offsetFestivalOnly);
  });

  it('rejects campaign codes carrying a year (D5)', () => {
    expect(isValidCampaignCode('DRAGON_BOAT')).toBe(true);
    expect(isValidCampaignCode('MID_AUTUMN_2026')).toBe(false);
    expect(isValidCampaignCode('dragon_boat')).toBe(false);
  });
});

describe('FestiveCampaigns', () => {
  let fixture: ComponentFixture<FestiveCampaigns>;
  let component: FestiveCampaigns;

  const list = [
    campaign({ id: 1 }),
    // 同名檔期（B4：原本以名稱比對，編輯第二筆會改到第一筆）。
    // regions 模擬規則改版前留下的節慶地域舊資料：畫面須一律顯示全國。
    campaign({ id: 2, campaignCode: 'DRAGON_BOAT_SOUTH', regions: ['SOUTH'] }),
    campaign({
      id: 4,
      campaignCode: 'SUMMER_SOUTH',
      campaignName: '南部夏季',
      category: 'SEASON',
      dateRuleType: 'FIXED_DATE',
      ruleMonth: 6,
      ruleDay: 1,
      durationDays: null,
      endMonth: 8,
      endDay: 31,
      ruleDescription: '每年 6/1 至 8 月底',
      regions: ['SOUTH'],
    }),
  ];

  const api = {
    getFestiveCampaigns: vi.fn(() => of(list)),
    createFestiveCampaign: vi.fn((body: object) => of(campaign({ id: 9, ...body }))),
    updateFestiveCampaign: vi.fn((id: number, body: object) => of(campaign({ id, ...body }))),
    switchFestiveCampaignStatus: vi.fn((id: number) => of(campaign({ id, isManualOverride: true }))),
    previewFestiveCampaignOccurrences: vi.fn(() =>
      of([{ cycleYear: 2026, startDate: '2026-06-19', endDate: '2026-06-21', observedHolidays: [], overridden: false }]),
    ),
    getFestiveCampaignOccurrenceOverrides: vi.fn(() => of([])),
    upsertFestiveCampaignOccurrenceOverride: vi.fn(),
    deleteFestiveCampaignOccurrenceOverride: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [FestiveCampaigns],
      providers: [{ provide: SettingsApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(FestiveCampaigns);
    component = fixture.componentInstance;
    vi.spyOn(TestBed.inject(DialogService), 'notify').mockReturnValue(of(undefined));
    fixture.detectChanges();
  });

  it('lists rule description, current occurrence and regions', () => {
    const text = fixture.nativeElement.querySelector('tbody').textContent;
    expect(text).toContain('每年農曆 5 月 5 日起 3 天');
    expect(text).toContain('2026-06-19 – 2026-06-21');
    expect(text).toContain('全國');
    expect(component.rows().find((row) => row.id === 4)?.regionsText).toBe('南部');
  });

  it('always shows festivals as nationwide, even with legacy region rows', () => {
    expect(component.rows().find((row) => row.id === 2)?.regionsText).toBe('全國');
  });

  it('only requests festival and season campaigns (weather lives in the weather tab)', () => {
    expect(api.getFestiveCampaigns).toHaveBeenCalledWith(['FESTIVAL', 'SEASON']);
  });

  it('edits the campaign by id even when names collide (B4)', () => {
    component.openEdit(component.rows().find((row) => row.id === 2)!);
    component.draftName.set('端午節（南部）');
    component.save();
    expect(api.updateFestiveCampaign).toHaveBeenCalledWith(2, expect.objectContaining({ campaignName: '端午節（南部）' }));
    expect(component.rows().find((row) => row.id === 1)?.name).toBe('端午節');
  });

  it('sends the date rule instead of start/end dates when creating', () => {
    component.openCreate();
    component.draftCode.set('MOTHERS_DAY');
    component.draftName.set('母親節');
    component.draftRuleType.set('NTH_WEEKDAY');
    component.draftMonth.set(5);
    component.draftWeekOrdinal.set(2);
    component.draftWeekday.set(7);
    component.draftDuration.set(1);
    component.save();
    const body = (api.createFestiveCampaign.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      campaignCode: 'MOTHERS_DAY',
      category: 'FESTIVAL',
      dateRuleType: 'NTH_WEEKDAY',
      ruleMonth: 5,
      ruleWeekOrdinal: 2,
      ruleWeekday: 7,
      ruleDay: null,
      regions: [],
    });
    expect(body['startDate']).toBeUndefined();
  });

  it('offers region selection only for seasons and never sends regions for festivals', () => {
    component.openCreate();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[name="region-SOUTH"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('一律視為全國性');

    component.draftCategory.set('SEASON');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[name="region-SOUTH"]')).not.toBeNull();
    component.toggleRegion('SOUTH');
    expect(component.rulePayload().regions).toEqual(['SOUTH']);

    // 切回節慶：送出內容不帶地域；再切回季節時原勾選仍在
    component.draftCategory.set('FESTIVAL');
    expect(component.rulePayload().regions).toEqual([]);
    component.draftCategory.set('SEASON');
    expect(component.rulePayload().regions).toEqual(['SOUTH']);
  });

  it('explains the offset days with a help tip on festivals', () => {
    component.openCreate();
    fixture.detectChanges();
    const tip = fixture.nativeElement
      .querySelector('[name="ruleOffsetDays"]')
      .closest('label')
      .querySelector('app-info-tip button');
    expect(tip.getAttribute('aria-label')).toBe('說明：' + OFFSET_DAYS_TIP);
  });

  it('hides the offset for seasons and always sends 0, restoring the draft when switching back', () => {
    component.openCreate();
    component.draftOffset.set(-1);
    component.draftCategory.set('SEASON');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[name="ruleOffsetDays"]')).toBeNull();
    expect(component.rulePayload().ruleOffsetDays).toBe(0);
    component.draftCategory.set('FESTIVAL');
    expect(component.rulePayload().ruleOffsetDays).toBe(-1);
  });

  it('blocks saving a code with a year before calling the API', () => {
    component.openCreate();
    component.draftCode.set('MOON_2026');
    component.draftName.set('中秋');
    component.draftRuleType.set('LUNAR_DATE');
    component.draftMonth.set(8);
    component.draftDay.set(15);
    component.save();
    expect(api.createFestiveCampaign).not.toHaveBeenCalled();
  });

  it('turns off long-weekend expansion when observed holidays are turned off', () => {
    component.openCreate();
    component.setObserved(true);
    component.draftExpand.set(true);
    component.setObserved(false);
    expect(component.rulePayload().expandLongWeekend).toBe(false);
    expect(component.rulePayload().observedHolidayRule).toBe('NONE');
  });

  it('forces season campaigns to the fixed-date rule type', () => {
    component.openCreate();
    component.draftRuleType.set('LUNAR_DATE');
    component.draftCategory.set('SEASON');
    expect(component.rulePayload().dateRuleType).toBe('FIXED_DATE');
    expect(component.rulePayload().durationDays).toBeNull();
  });

  it('previews occurrences 300ms after the rule settles, not on every keystroke', async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    component.openCreate();
    component.draftRuleType.set('LUNAR_DATE');
    component.draftMonth.set(5);
    fixture.detectChanges();
    await wait(100);
    component.draftDay.set(5);
    fixture.detectChanges();
    await wait(150);
    // 距最後一次變更未滿 300ms：還沒呼叫
    expect(api.previewFestiveCampaignOccurrences).not.toHaveBeenCalled();
    await wait(250);
    fixture.detectChanges();
    expect(api.previewFestiveCampaignOccurrences).toHaveBeenCalledTimes(1);
    expect(component.preview().status).toBe('ok');
    expect(fixture.nativeElement.querySelector('.occurrence-preview').textContent).toContain('2026-06-19');
  });

  it('explains that a manual status only lasts for the current occurrence', () => {
    component.openStatus(component.rows()[0]);
    component.draftManualOverride.set(true);
    component.draftStatus.set('EXPIRED');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('只對本期有效');
    expect(fixture.nativeElement.textContent).toContain('本期停用');
    component.applyStatus();
    expect(api.switchFestiveCampaignStatus).toHaveBeenCalledWith(1, { status: 'EXPIRED', overrideEnabled: true });
  });
});
