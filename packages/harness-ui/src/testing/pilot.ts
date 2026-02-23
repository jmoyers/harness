import { CellBuffer } from '../core/cell-buffer.ts';
import { DEFAULT_CELL_STYLE, type CellStyle } from '../core/color.ts';
import type { Widget } from '../widget/widget.ts';
import { renderWidgetTree } from '../widget/renderer.ts';
import { FocusManager } from '../widget/focus.ts';
import type { KeyEvent } from '../widget/input.ts';
import { dispatchKeyToBindings } from '../widget/keybinding.ts';
import { RowAssertion, CellAssertion, WidgetAssertion, ScreenAssertion } from './assertions.ts';

export interface TestPilotOptions {
  readonly cols: number;
  readonly rows: number;
  readonly baseStyle?: CellStyle;
}

export class TestPilot {
  private _root: Widget;
  private _cols: number;
  private _rows: number;
  private _baseStyle: CellStyle;
  private _buffer: CellBuffer;
  private _ansiRows: readonly string[] = [];
  private _strippedRows: string[] = [];
  private _focusManager: FocusManager;

  constructor(root: Widget, options: TestPilotOptions) {
    this._root = root;
    this._cols = Math.max(1, Math.floor(options.cols));
    this._rows = Math.max(1, Math.floor(options.rows));
    this._baseStyle = options.baseStyle ?? DEFAULT_CELL_STYLE;
    this._buffer = new CellBuffer(this._cols, this._rows, this._baseStyle);
    this._focusManager = new FocusManager();
    this._focusManager.setRoot(this._root);
    this._root._mountRecursive();
    this._render();
  }

  get root(): Widget {
    return this._root;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get buffer(): CellBuffer {
    return this._buffer;
  }

  get focusManager(): FocusManager {
    return this._focusManager;
  }

  private _render(): void {
    const result = renderWidgetTree(this._root, this._cols, this._rows, this._baseStyle);
    this._buffer = result.buffer;
    this._ansiRows = result.rows;
    this._strippedRows = result.rows.map(stripAnsi);
  }

  pressKey(descriptor: string): void {
    const event = descriptorToKeyEvent(descriptor);
    const handled = dispatchKeyToBindings(this._focusManager.focused, event);
    if (!handled) {
      const focused = this._focusManager.focused;
      if (focused !== null) {
        const handler = (focused as unknown as Record<string, unknown>)['handleKeypress'];
        if (typeof handler === 'function') {
          (handler as (e: KeyEvent) => boolean).call(focused, event);
        }
      }
    }
    this._render();
  }

  type(text: string): void {
    for (const char of text) {
      this.pressKey(char);
    }
  }

  click(col: number, row: number, _button = 0): void {
    const widget = this._hitTest(col, row);
    if (widget !== null && widget.focusable) {
      this._focusManager.focus(widget);
    }
    this._render();
  }

  scroll(_col: number, _row: number, _delta: number): void {
    this._render();
  }

  resize(cols: number, rows: number): void {
    this._cols = Math.max(1, Math.floor(cols));
    this._rows = Math.max(1, Math.floor(rows));
    this._render();
  }

  focusNext(): void {
    this._focusManager.focusNext();
    this._render();
  }

  focusPrevious(): void {
    this._focusManager.focusPrevious();
    this._render();
  }

  dumpScreen(): string {
    const border = '─'.repeat(this._cols);
    const lines: string[] = [`┌${border}┐`];
    for (let r = 0; r < this._strippedRows.length; r += 1) {
      const row = this._strippedRows[r] ?? '';
      const padded =
        row.length < this._cols
          ? row + ' '.repeat(this._cols - row.length)
          : row.slice(0, this._cols);
      lines.push(`│${padded}│ ${r}`);
    }
    lines.push(`└${border}┘`);
    return lines.join('\n');
  }

  rowText(row: number): string {
    if (row < 0 || row >= this._strippedRows.length) return '';
    return this._strippedRows[row]!;
  }

  allRowText(): readonly string[] {
    return this._strippedRows;
  }

  ansiRow(row: number): string {
    if (row < 0 || row >= this._ansiRows.length) return '';
    return this._ansiRows[row]!;
  }

  expectRow(row: number): RowAssertion {
    return new RowAssertion(this.rowText(row), row);
  }

  expectCell(col: number, row: number): CellAssertion {
    return new CellAssertion(this._buffer, col, row);
  }

  expectWidget(selector: string): WidgetAssertion {
    return new WidgetAssertion(this._root, selector, this._focusManager);
  }

  expectScreen(): ScreenAssertion {
    return new ScreenAssertion(this._strippedRows);
  }

  private _hitTest(col: number, row: number): Widget | null {
    return hitTestWidget(this._root, col, row);
  }
}

function hitTestWidget(widget: Widget, col: number, row: number): Widget | null {
  if (!widget.visible) return null;
  const rect = widget.absoluteRect;
  const inside =
    col >= rect.x && col < rect.x + rect.width && row >= rect.y && row < rect.y + rect.height;
  if (!inside) return null;

  for (let i = widget.children.length - 1; i >= 0; i -= 1) {
    const child = widget.children[i]!;
    const hit = hitTestWidget(child, col, row);
    if (hit !== null) return hit;
  }

  return widget;
}

function stripAnsi(value: string): string {
  let output = '';
  let i = 0;
  while (i < value.length) {
    if (value[i] === '\u001b' && value[i + 1] === '[') {
      i += 2;
      while (i < value.length && value[i] !== 'm') i += 1;
      if (i < value.length) i += 1;
      continue;
    }
    output += value[i];
    i += 1;
  }
  return output;
}

function descriptorToKeyEvent(descriptor: string): KeyEvent {
  const parts = descriptor.toLowerCase().split('+');
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key = '';

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === 'ctrl') ctrl = true;
    else if (trimmed === 'alt') alt = true;
    else if (trimmed === 'shift') shift = true;
    else key = trimmed;
  }

  if (key === '') key = descriptor;

  return { key, raw: Buffer.from([]), ctrl, alt, shift };
}

export function createTestPilot(root: Widget, options: TestPilotOptions): TestPilot {
  return new TestPilot(root, options);
}
