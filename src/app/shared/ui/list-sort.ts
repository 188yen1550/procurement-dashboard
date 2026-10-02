import {
  ChangeDetectionStrategy,
  Component,
  Pipe,
  PipeTransform,
  computed,
  input,
  signal,
} from '@angular/core';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  direction: SortDirection;
}
export interface SortChoice {
  key: string;
  label: string;
}

/** One independent state per list. Changing a column starts ascending. */
export class ListSort {
  readonly state;
  constructor(
    key = '',
    direction: SortDirection = 'asc',
    private readonly onChange?: (state: SortState) => void,
  ) {
    this.state = signal<SortState>({ key, direction });
  }

  set(key: string, direction: SortDirection): void {
    this.state.set({ key, direction });
  }

  toggle(key: string): void {
    const previous = this.state();
    this.set(key, previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc');
    this.onChange?.(this.state());
  }
}

const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
const missing = (value: unknown) =>
  value == null ||
  value === '' ||
  value === '—' ||
  (typeof value === 'number' && !Number.isFinite(value));

function valueAt(row: unknown, path: string): unknown {
  const [field, type] = path.split(':');
  let value = row;
  for (const part of field.split('.')) {
    value =
      value != null && typeof value === 'object'
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }
  if (missing(value)) return null;
  if (type === 'date') return Date.parse(String(value));
  return value;
}

function compare(a: unknown, b: unknown, direction: SortDirection): number {
  // Missing values stay last in both directions, distinct from zero and false.
  if (missing(a)) return missing(b) ? 0 : 1;
  if (missing(b)) return -1;
  const numeric = (v: unknown) =>
    typeof v === 'number' || typeof v === 'boolean' || /^[-+]?\d+(\.\d+)?$/.test(String(v));
  const result =
    numeric(a) && numeric(b) ? Number(a) - Number(b) : collator.compare(String(a), String(b));
  return result * (direction === 'asc' ? 1 : -1);
}

/** Sort copies only; | separates tie-break fields, prefix preserves parent/child grouping. */
export function sortRows<T>(rows: readonly T[], state: SortState, prefix = ''): T[] {
  if (!state.key) return [...rows];
  const paths = state.key.split('|').map((key) => prefix + key);
  return [...rows].sort((a, b) => {
    for (const path of paths) {
      const result = compare(valueAt(a, path), valueAt(b, path), state.direction);
      if (result) return result;
    }
    return 0;
  });
}

@Pipe({ name: 'sortRows' })
export class SortRowsPipe implements PipeTransform {
  transform<T>(rows: readonly T[], state: SortState, prefix = ''): T[] {
    return sortRows(rows, state, prefix);
  }
}

@Component({
  selector: 'th[appSortHeader]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { scope: 'col', '[attr.aria-sort]': 'ariaSort()' },
  template: `<button
    type="button"
    class="list-sort-header"
    (click)="sort().toggle(appSortHeader())"
    [attr.title]="hint()"
  >
    <ng-content /><span aria-hidden="true">{{ arrow() }}</span>
  </button>`,
  styles: [
    `
      .list-sort-header {
        /* 對齊修正：改為佔滿 th 的 flex 容器，水平位置交給 th 的 text-align
           （--sort-header-justify，預設靠左，維持其他頁面原樣），垂直由 align-items 置中；
           不再是 inline-flex——inline 元素會以 baseline 對齊行框，和純文字表頭
           差出約 1px 的高度，同列表頭看起來不等高。 */
        display: flex;
        width: 100%;
        justify-content: var(--sort-header-justify, flex-start);
        align-items: center;
        gap: 0.4rem;
        /* 對齊修正：原本 padding: 0.25rem 0 讓可排序表頭比純文字表頭多出上下
           0.25rem，在 th 使用 vertical-align: top 時文字會整體往下偏移，
           造成同一列表頭高度不一致。點擊範圍由 th 本身的 padding 提供即可。 */
        border: 0;
        padding: 0;
        margin: 0;
        line-height: inherit;
        background: transparent;
        white-space: nowrap;
        color: inherit;
        font: inherit;
        font-weight: inherit;
        text-align: inherit;
        cursor: pointer;
      }
      .list-sort-header span {
        flex: 0 0 auto;
        font-size: 1rem;
        /* 箭頭字形不撐高行高，讓按鈕高度與同列純文字表頭一致 */
        line-height: 1;
      }
      .list-sort-header:hover {
        color: #195789;
      }
      .list-sort-header:focus-visible {
        outline: 2px solid #195789;
        outline-offset: 4px;
        border-radius: 2px;
      }
      :host([aria-sort='ascending']),
      :host([aria-sort='descending']) {
        color: #195789;
      }
    `,
  ],
})
export class SortHeader {
  readonly appSortHeader = input.required<string>();
  readonly sort = input.required<ListSort>();
  readonly ariaSort = computed(() =>
    this.sort().state().key !== this.appSortHeader()
      ? 'none'
      : this.sort().state().direction === 'asc'
        ? 'ascending'
        : 'descending',
  );
  readonly arrow = computed(() =>
    this.ariaSort() === 'none' ? '↕' : this.ariaSort() === 'ascending' ? '↑' : '↓',
  );
  readonly hint = computed(() =>
    this.ariaSort() === 'ascending'
      ? '目前升冪，點擊改為降冪'
      : this.ariaSort() === 'descending'
        ? '目前降冪，點擊改為升冪'
        : '點擊依此欄位升冪排序',
  );
}

@Component({
  selector: 'app-list-sort',
  host: { class: 'list-sort' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="list-sort__controls" role="group" [attr.aria-label]="label() + '排序'">
    <span>排序：</span>
    @for (choice of choices(); track choice.key) {
      <button
        type="button"
        (click)="sort().toggle(choice.key)"
        [attr.aria-pressed]="sort().state().key === choice.key"
        [attr.aria-label]="
          choice.label +
          (sort().state().key === choice.key
            ? sort().state().direction === 'asc'
              ? '，目前升冪，點擊改為降冪'
              : '，目前降冪，點擊改為升冪'
            : '，點擊升冪排序')
        "
      >
        {{ choice.label }}
        <span aria-hidden="true">{{
          sort().state().key !== choice.key ? '↕' : sort().state().direction === 'asc' ? '↑' : '↓'
        }}</span>
      </button>
    }
  </div>`,
  styles: [
    `
      :host {
        display: block;
        margin: 0.75rem 0;
      }
      :host(.list-sort--mobile-only) { display: none; padding: 0 .75rem; }
      @media (max-width: 700px) { :host(.list-sort--mobile-only) { display: block; } }
      .list-sort__controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: var(--list-sort-justify, flex-start);
        gap: 0.4rem;
        font-size: 0.8rem;
        color: #536b80;
      }
      button {
        padding: 0.35rem 0.55rem;
        border: 1px solid #cfdeeb;
        border-radius: 5px;
        color: inherit;
        background: #fff;
        font: inherit;
        cursor: pointer;
      }
      button[aria-pressed='true'] {
        color: #195789;
        background: #eaf3fb;
        border-color: #195789;
      }
      button:focus-visible {
        outline: 2px solid #195789;
        outline-offset: 2px;
      }
    `,
  ],
})
export class ListSortControls {
  readonly sort = input.required<ListSort>();
  readonly choices = input.required<readonly SortChoice[]>();
  readonly label = input('列表');
}
