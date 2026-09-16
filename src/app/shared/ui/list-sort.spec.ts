import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ListSort, ListSortControls, SortHeader, SortRowsPipe, sortRows } from './list-sort';

@Component({
  imports: [SortHeader, SortRowsPipe, ListSortControls],
  template: `<table>
      <thead>
        <tr>
          <th appSortHeader="name" [sort]="sort">名稱</th>
          <th appSortHeader="score" [sort]="sort">分數</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows() | sortRows: sort.state(); track row.id) {
          <tr>
            <td>{{ row.name }}</td>
            <td>{{ row.score }}</td>
          </tr>
        }
      </tbody>
    </table>
    <app-list-sort [sort]="cards" [choices]="[{ key: 'name', label: '名稱' }]" label="卡片" />`,
})
class Host {
  readonly sort = new ListSort();
  readonly cards = new ListSort();
  rows = signal([
    { id: 1, name: '商品10', score: 9 },
    { id: 2, name: '商品2', score: 100 },
    { id: 3, name: '商品1', score: null },
  ]);
}

describe('shared list sorting', () => {
  it('sorts numeric values and decimal strings rather than text', () => {
    const rows = [{ value: '100' }, { value: '9.5' }, { value: '-2' }];
    expect(sortRows(rows, { key: 'value', direction: 'asc' }).map((r) => r.value)).toEqual([
      '-2',
      '9.5',
      '100',
    ]);
    expect(sortRows(rows, { key: 'value', direction: 'desc' }).map((r) => r.value)).toEqual([
      '100',
      '9.5',
      '-2',
    ]);
  });

  it('keeps missing values last in both directions and distinguishes zero', () => {
    const rows = [
      { value: null },
      { value: 0 },
      { value: undefined },
      { value: 10 },
      { value: NaN },
    ];
    for (const direction of ['asc', 'desc'] as const) {
      const sorted = sortRows(rows, { key: 'value', direction });
      expect(sorted.slice(0, 2).map((r) => r.value)).toEqual(
        direction === 'asc' ? [0, 10] : [10, 0],
      );
      expect(sorted.slice(2).map((r) => r.value)).toEqual([null, undefined, NaN]);
    }
  });

  it('uses natural ordering for names containing numbers and preserves equal-row order', () => {
    const rows = [
      { id: 1, name: '商品10' },
      { id: 2, name: '商品2' },
      { id: 3, name: '商品2' },
    ];
    expect(sortRows(rows, { key: 'name', direction: 'asc' }).map((r) => r.id)).toEqual([2, 3, 1]);
    expect(sortRows(rows, { key: 'name', direction: 'desc' }).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('sorts actual timestamps across timezones and leaves invalid dates last', () => {
    const rows = [
      { date: '2026-09-15T10:00:00+08:00' },
      { date: '2026-09-15T03:00:00Z' },
      { date: 'invalid' },
    ];
    expect(sortRows(rows, { key: 'date:date', direction: 'desc' })).toEqual([
      rows[1],
      rows[0],
      rows[2],
    ]);
  });

  it('sorts grouped categories without detaching children from their parents', () => {
    const rows = [
      { major: { name: 'B' }, minors: [{ name: 'B2' }, { name: 'B1' }] },
      { major: { name: 'A' }, minors: [{ name: 'A1' }] },
    ];
    const state = { key: 'name', direction: 'asc' as const };
    const sorted = sortRows(rows, state, 'major.');
    expect(sorted.map((r) => r.major.name)).toEqual(['A', 'B']);
    expect(sortRows(sorted[1].minors, state).map((r) => r.name)).toEqual(['B1', 'B2']);
    expect(rows[0].minors.map((r) => r.name)).toEqual(['B2', 'B1']);
  });

  it('supports secondary fields for combined columns', () => {
    const rows = [
      { actual: 10, target: 20 },
      { actual: 2, target: 30 },
      { actual: 10, target: 15 },
    ];
    expect(sortRows(rows, { key: 'actual|target', direction: 'asc' })).toEqual([
      rows[1],
      rows[2],
      rows[0],
    ]);
  });

  it('toggles one column and starts a newly selected column ascending', () => {
    const changed = vi.fn();
    const state = new ListSort('', 'asc', changed);
    state.toggle('name');
    expect(state.state()).toEqual({ key: 'name', direction: 'asc' });
    state.toggle('name');
    expect(state.state().direction).toBe('desc');
    state.toggle('score');
    expect(state.state()).toEqual({ key: 'score', direction: 'asc' });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('renders sortable headers, updates aria-sort, and keeps sorting after data replacement', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const headers = root.querySelectorAll('th');
    const names = () =>
      Array.from(root.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent);
    expect(headers[2].querySelector('button')).toBeNull();
    const button = headers[0].querySelector('button')!;
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    fixture.detectChanges();
    expect(names()).toEqual(['商品1', '商品2', '商品10']);
    expect(headers[0].getAttribute('aria-sort')).toBe('ascending');
    button.click();
    fixture.detectChanges();
    expect(names()).toEqual(['商品10', '商品2', '商品1']);
    expect(headers[0].getAttribute('aria-sort')).toBe('descending');
    headers[1].querySelector('button')!.click();
    fixture.detectChanges();
    expect(headers[0].getAttribute('aria-sort')).toBe('none');
    expect(names()).toEqual(['商品10', '商品2', '商品1']);
    fixture.componentInstance.rows.set([
      { id: 4, name: '新商品', score: 5 },
      ...fixture.componentInstance.rows(),
    ]);
    fixture.detectChanges();
    expect(names()[0]).toBe('新商品');
    fixture.destroy();
  });

  it('keeps card-list sorting independent of table sorting', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('app-list-sort button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(fixture.componentInstance.cards.state().direction).toBe('asc');
    button.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.cards.state().direction).toBe('desc');
    expect(fixture.componentInstance.sort.state().key).toBe('');
    fixture.destroy();
  });
});
