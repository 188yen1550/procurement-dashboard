/** 檔案用途：驗證 Header 可建立與輸出導覽事件；不涉及真實身分 API。 */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Header } from './header';

describe('Header', () => {
  let component: Header;
  let fixture: ComponentFixture<Header>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Header],
    }).compileComponents();

    fixture = TestBed.createComponent(Header);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the logged-in user name alongside the role badge when provided', () => {
    component.userName = '王小明';
    component.roleLabel = '操作人員';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('王小明');
    expect(fixture.nativeElement.textContent).toContain('操作人員');
    expect(fixture.nativeElement.querySelector('.user-name').textContent.trim()).toBe('王小明');
  });

  it('hides the user name element entirely when there is no name (not an empty badge)', () => {
    component.userName = '';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.user-name')).toBeNull();
  });
});
