/**
 * 檔案用途：驗證「自訂屬性與因子」分頁（2026-09-24 由評估模式、商品類型兩個分頁合併）。
 * 重點在這次拆分新增／修正的行為：相依順序、下一步連結、修正後的文案、
 * 與父元件共用的 CustomDefinitionsStore。既有 CRUD 邏輯原樣搬移，不在這裡重測一遍。
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DialogService } from '../../../../core/dialog/dialog.service';
import { SettingsApiService } from '../../api/settings-api.service';
import { CustomDefinitionsStore } from '../../state/custom-definitions.store';
import { CustomExtensions } from './custom-extensions';

describe('CustomExtensions', () => {
  let fixture: ComponentFixture<CustomExtensions>;
  let component: CustomExtensions;
  let store: CustomDefinitionsStore;
  let dialog: DialogService;

  const settingsApi = {
    getFactorDefinitions: vi.fn(() => of([])),
    getCustomFieldDefinitions: vi.fn(() => of([])),
    createFactorDefinition: vi.fn((body: { factorCode: string; factorName: string; strategyCode: string }) =>
      of({
        id: 7,
        factorCode: body.factorCode,
        factorName: body.factorName,
        category: null,
        strategyCode: body.strategyCode,
        dataSourceCode: 'MOQ',
        customFieldDefinitionId: null,
        strategyParams: null,
        isActive: true,
        isSuperseded: false,
      }),
    ),
    updateFactorDefinition: vi.fn(() => of({})),
    createCustomFieldDefinition: vi.fn((body: { fieldCode: string; fieldName: string }) =>
      of({
        id: 3,
        fieldCode: body.fieldCode,
        fieldName: body.fieldName,
        helpText: null,
        fieldType: 'RAW_NUMBER',
        isRequired: false,
        isActive: true,
        applicableRootProductTypeIds: [],
        scaleLabels: null,
        isSuperseded: false,
      }),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [CustomExtensions],
      providers: [CustomDefinitionsStore, { provide: SettingsApiService, useValue: settingsApi }],
    }).compileComponents();
    fixture = TestBed.createComponent(CustomExtensions);
    component = fixture.componentInstance;
    store = TestBed.inject(CustomDefinitionsStore);
    dialog = TestBed.inject(DialogService);
    fixture.componentRef.setInput('productTypes', [
      { id: 1, name: '食品／生鮮', level: 1 },
      { id: 2, name: '冷凍', level: 2 },
    ]);
    fixture.detectChanges();
  });

  it('lists custom fields before factors, following the dependency order', () => {
    const headings = Array.from(fixture.nativeElement.querySelectorAll('h3'), (h) => (h as HTMLElement).textContent);
    expect(headings[0]).toContain('自訂商品屬性');
    expect(headings[1]).toContain('自訂計分因子');
    expect(component.availableMajorTypes().map((t) => t.name)).toEqual(['食品／生鮮']);
  });

  it('no longer points users to a section that is not on this page', () => {
    const notify = vi.spyOn(dialog, 'notify').mockReturnValue(of(undefined));
    component.openCreateFactorDefinition();
    component.newFactorCode.set('SHELF');
    component.newFactorName.set('保存期限');
    component.updateNewFactorSourceKind('CUSTOM_FIELD');
    component.submitFactorDefinition();
    const message = (notify.mock.calls[0][2] as string[])[0];
    expect(message).toContain('同一頁上方');
    expect(message).not.toContain('下方');
  });

  it('reports the up-to-date product form behaviour after creating a custom field', () => {
    const status = vi.fn();
    component.status.subscribe(status);
    component.openCreateCustomField();
    component.newFieldCode.set('SHELF_DAYS');
    component.newFieldName.set('保存期限天數');
    component.submitCustomFieldDefinition();
    expect(status.mock.calls[0][0]).not.toContain('下一階段');
    expect(store.customFieldDefinitions()).toHaveLength(1);
  });

  it('writes created factors into the shared store and offers the score band next step', () => {
    const navigate = vi.fn();
    component.navigateTab.subscribe(navigate);
    component.openCreateFactorDefinition();
    component.newFactorCode.set('MOQ_FIT');
    component.newFactorName.set('訂購量適配');
    component.newFactorDataSource.set('MOQ');
    component.submitFactorDefinition();
    fixture.detectChanges();

    // 父元件的評估模式權重編輯器讀同一份 store，新增後立刻看得到。
    expect(store.factorDefinitions().map((f) => f.factorCode)).toEqual(['MOQ_FIT']);
    const nextStep = fixture.nativeElement.querySelector('.next-step');
    expect(nextStep.textContent).toContain('訂購量適配');
    nextStep.querySelector('button').click();
    expect(navigate).toHaveBeenCalledWith('scoreBands');
  });

  // 2026-09-27：社群聲量熱度這類次數型因子改用對數換算（strategyParams.logCurve）。
  it('sends logCurve for a target-band factor when the log option is checked', () => {
    component.openCreateFactorDefinition();
    component.newFactorCode.set('MOQ_FIT');
    component.newFactorName.set('訂購量適配');
    component.newFactorDataSource.set('MOQ');
    fixture.detectChanges();
    expect(component.newFactorStrategy()).toBe('TARGET_BAND_NORMALIZE');
    expect(fixture.nativeElement.textContent).toContain('對數換算');
    component.newFactorLogCurve.set(true);
    component.submitFactorDefinition();
    expect(settingsApi.createFactorDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ strategyCode: 'TARGET_BAND_NORMALIZE', strategyParams: { logCurve: 1 } }),
    );
  });

  it('keeps logCurve when editing an existing log-curve factor, so saving does not silently drop it', () => {
    component.openEditFactorDefinition({
      id: 2,
      factorCode: 'SOCIAL_BUZZ',
      factorName: '社群聲量熱度',
      category: 'FORECAST',
      strategyCode: 'TARGET_BAND_NORMALIZE',
      dataSourceCode: 'MOQ',
      customFieldDefinitionId: null,
      strategyParams: { logCurve: 1 },
      isActive: true,
      isSuperseded: false,
    });
    expect(component.newFactorLogCurve()).toBe(true);
    component.submitFactorDefinition();
    expect(settingsApi.updateFactorDefinition).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ strategyParams: { logCurve: 1 } }),
    );
  });

  it('lets the flow bar jump to the evaluation modes tab', () => {
    const navigate = vi.fn();
    component.navigateTab.subscribe(navigate);
    fixture.nativeElement.querySelector('.extension-flow button').click();
    expect(navigate).toHaveBeenCalledWith('modes');
  });
});
