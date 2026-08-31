import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AiSuggestions } from './ai-suggestions';
describe('AiSuggestions', () => {
  let fixture: ComponentFixture<AiSuggestions>;
  let component: AiSuggestions;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiSuggestions],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(AiSuggestions);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  it('shows AI_SUGGESTED items separately', () => {
    expect(component.items().length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('AI_SUGGESTED');
    expect(fixture.nativeElement.textContent).toContain('加入 CANDIDATE 候選');
  });
  it('filters suggestions locally', () => {
    component.query.set('沐光');
    expect(component.filtered().length).toBe(1);
  });
  it('promotes one item locally', () => {
    component.promote(201);
    expect(component.items().some((i) => i.id === 201)).toBe(false);
    expect(component.statusMessage()).toContain('CANDIDATE');
  });
  it('promotes selected items in a batch', () => {
    component.toggle(202);
    component.promoteSelected();
    expect(component.items().some((i) => i.id === 202)).toBe(false);
  });
  it('explains that suggestions must be promoted before scoring and review', () => {
    expect(fixture.nativeElement.textContent).toContain('不是正式候選');
    expect(fixture.nativeElement.textContent).toContain('Top 10');
  });
  it('renders disabled loading empty and error states', () => {
    component.setState('disabled');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('加入候選操作目前已停用');
    component.setState('loading');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('正在載入 AI 建議');
    component.setState('empty');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('目前沒有 AI 建議品項');
    component.setState('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('載入失敗');
  });
});
