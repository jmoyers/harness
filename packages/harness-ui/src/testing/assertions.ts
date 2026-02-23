import type { CellBuffer } from '../core/cell-buffer.ts';
import type { CellStyle } from '../core/color.ts';
import type { Widget } from '../widget/widget.ts';
import type { FocusManager } from '../widget/focus.ts';

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function fail(message: string): never {
  throw new AssertionError(message);
}

export class RowAssertion {
  private _text: string;
  private _row: number;
  private _negated = false;

  constructor(text: string, row: number) {
    this._text = text;
    this._row = row;
  }

  get not(): RowAssertion {
    const clone = new RowAssertion(this._text, this._row);
    clone._negated = !this._negated;
    return clone;
  }

  toContain(substring: string): void {
    const contains = this._text.includes(substring);
    if (this._negated) {
      if (contains)
        fail(
          `Row ${this._row}: expected NOT to contain "${substring}" but found it in "${this._text}"`,
        );
    } else {
      if (!contains)
        fail(`Row ${this._row}: expected to contain "${substring}" but got "${this._text}"`);
    }
  }

  toStartWith(prefix: string): void {
    const starts = this._text.startsWith(prefix);
    if (this._negated) {
      if (starts) fail(`Row ${this._row}: expected NOT to start with "${prefix}" but it does`);
    } else {
      if (!starts)
        fail(
          `Row ${this._row}: expected to start with "${prefix}" but got "${this._text.slice(0, prefix.length + 10)}"`,
        );
    }
  }

  toEndWith(suffix: string): void {
    const ends = this._text.endsWith(suffix);
    if (this._negated) {
      if (ends) fail(`Row ${this._row}: expected NOT to end with "${suffix}" but it does`);
    } else {
      if (!ends)
        fail(
          `Row ${this._row}: expected to end with "${suffix}" but got "...${this._text.slice(-suffix.length - 10)}"`,
        );
    }
  }

  toEqual(expected: string): void {
    const equal = this._text === expected;
    if (this._negated) {
      if (equal) fail(`Row ${this._row}: expected NOT to equal "${expected}"`);
    } else {
      if (!equal) fail(`Row ${this._row}: expected "${expected}" but got "${this._text}"`);
    }
  }
}

export class CellAssertion {
  private _buffer: CellBuffer;
  private _col: number;
  private _row: number;
  private _negated = false;

  constructor(buffer: CellBuffer, col: number, row: number) {
    this._buffer = buffer;
    this._col = col;
    this._row = row;
  }

  get not(): CellAssertion {
    const clone = new CellAssertion(this._buffer, this._col, this._row);
    clone._negated = !this._negated;
    return clone;
  }

  toHaveGlyph(expected: string): void {
    const cell = this._buffer.getCell(this._col, this._row);
    if (cell === null) {
      if (!this._negated) fail(`Cell (${this._col},${this._row}): out of bounds`);
      return;
    }
    const match = cell.glyph === expected;
    if (this._negated) {
      if (match) fail(`Cell (${this._col},${this._row}): expected glyph NOT to be "${expected}"`);
    } else {
      if (!match)
        fail(
          `Cell (${this._col},${this._row}): expected glyph "${expected}" but got "${cell.glyph}"`,
        );
    }
  }

  toHaveStyle(expected: Partial<CellStyle>): void {
    const cell = this._buffer.getCell(this._col, this._row);
    if (cell === null) {
      if (!this._negated) fail(`Cell (${this._col},${this._row}): out of bounds`);
      return;
    }
    let allMatch = true;
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      const actual = cell.style[key as keyof CellStyle];
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof actual === 'object' &&
        actual !== null
      ) {
        if (JSON.stringify(actual) !== JSON.stringify(value)) {
          allMatch = false;
          mismatches.push(`${key}: ${JSON.stringify(actual)} !== ${JSON.stringify(value)}`);
        }
      } else if (actual !== value) {
        allMatch = false;
        mismatches.push(`${key}: ${String(actual)} !== ${String(value)}`);
      }
    }
    if (this._negated) {
      if (allMatch)
        fail(`Cell (${this._col},${this._row}): expected style NOT to match but it did`);
    } else {
      if (!allMatch)
        fail(`Cell (${this._col},${this._row}): style mismatch — ${mismatches.join(', ')}`);
    }
  }

  toBeContinuation(): void {
    const cell = this._buffer.getCell(this._col, this._row);
    if (cell === null) {
      if (!this._negated) fail(`Cell (${this._col},${this._row}): out of bounds`);
      return;
    }
    if (this._negated) {
      if (cell.continued)
        fail(`Cell (${this._col},${this._row}): expected NOT to be a continuation cell`);
    } else {
      if (!cell.continued)
        fail(`Cell (${this._col},${this._row}): expected to be a continuation cell`);
    }
  }
}

export class WidgetAssertion {
  private _root: Widget;
  private _selector: string;
  private _focusManager: FocusManager;
  private _negated = false;

  constructor(root: Widget, selector: string, focusManager: FocusManager) {
    this._root = root;
    this._selector = selector;
    this._focusManager = focusManager;
  }

  get not(): WidgetAssertion {
    const clone = new WidgetAssertion(this._root, this._selector, this._focusManager);
    clone._negated = !this._negated;
    return clone;
  }

  private _resolve(): Widget | null {
    return this._root.queryOne(this._selector);
  }

  toExist(): void {
    const widget = this._resolve();
    if (this._negated) {
      if (widget !== null) fail(`Widget "${this._selector}": expected NOT to exist but it does`);
    } else {
      if (widget === null) fail(`Widget "${this._selector}": expected to exist but not found`);
    }
  }

  toBeVisible(): void {
    const widget = this._resolve();
    if (widget === null) {
      if (!this._negated) fail(`Widget "${this._selector}": not found`);
      return;
    }
    if (this._negated) {
      if (widget.visible) fail(`Widget "${this._selector}": expected NOT to be visible`);
    } else {
      if (!widget.visible) fail(`Widget "${this._selector}": expected to be visible`);
    }
  }

  toBeFocused(): void {
    const widget = this._resolve();
    if (widget === null) {
      if (!this._negated) fail(`Widget "${this._selector}": not found`);
      return;
    }
    const isFocused = this._focusManager.focused === widget;
    if (this._negated) {
      if (isFocused) fail(`Widget "${this._selector}": expected NOT to be focused`);
    } else {
      if (!isFocused) fail(`Widget "${this._selector}": expected to be focused`);
    }
  }

  toHaveRect(expected: { x?: number; y?: number; width?: number; height?: number }): void {
    const widget = this._resolve();
    if (widget === null) {
      if (!this._negated) fail(`Widget "${this._selector}": not found`);
      return;
    }
    const rect = widget.absoluteRect;
    const mismatches: string[] = [];
    if (expected.x !== undefined && rect.x !== expected.x)
      mismatches.push(`x: ${rect.x} !== ${expected.x}`);
    if (expected.y !== undefined && rect.y !== expected.y)
      mismatches.push(`y: ${rect.y} !== ${expected.y}`);
    if (expected.width !== undefined && rect.width !== expected.width)
      mismatches.push(`width: ${rect.width} !== ${expected.width}`);
    if (expected.height !== undefined && rect.height !== expected.height)
      mismatches.push(`height: ${rect.height} !== ${expected.height}`);
    const allMatch = mismatches.length === 0;
    if (this._negated) {
      if (allMatch) fail(`Widget "${this._selector}": expected rect NOT to match but it did`);
    } else {
      if (!allMatch) fail(`Widget "${this._selector}": rect mismatch — ${mismatches.join(', ')}`);
    }
  }
}

export class ScreenAssertion {
  private _rows: readonly string[];
  private _negated = false;

  constructor(rows: readonly string[]) {
    this._rows = rows;
  }

  get not(): ScreenAssertion {
    const clone = new ScreenAssertion(this._rows);
    clone._negated = !this._negated;
    return clone;
  }

  toMatchLines(expected: readonly string[]): void {
    const matches =
      this._rows.length === expected.length && this._rows.every((row, i) => row === expected[i]);
    if (this._negated) {
      if (matches) fail('Screen: expected NOT to match lines but it did');
    } else {
      if (!matches) {
        const diffs: string[] = [];
        const maxRows = Math.max(this._rows.length, expected.length);
        for (let i = 0; i < maxRows; i += 1) {
          const actual = this._rows[i] ?? '<missing>';
          const exp = expected[i] ?? '<missing>';
          if (actual !== exp) {
            diffs.push(`  row ${i}:\n    got:    "${actual}"\n    expect: "${exp}"`);
          }
        }
        fail(`Screen: line mismatch:\n${diffs.join('\n')}`);
      }
    }
  }

  toContainRow(substring: string): void {
    const found = this._rows.some((row) => row.includes(substring));
    if (this._negated) {
      if (found) fail(`Screen: expected no row to contain "${substring}" but found it`);
    } else {
      if (!found) fail(`Screen: expected some row to contain "${substring}" but none did`);
    }
  }
}
