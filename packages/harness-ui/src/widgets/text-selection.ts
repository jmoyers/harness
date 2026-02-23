import { Message } from '../widget/message.ts';
import { type Color } from '../core/color.ts';
import type { CellBuffer } from '../core/cell-buffer.ts';

export interface SelectionPoint {
  readonly row: number;
  readonly col: number;
}

export interface SelectionRange {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
}

export class TextCopied extends Message {
  constructor(readonly text: string) {
    super();
  }
}

export function comparePoints(a: SelectionPoint, b: SelectionPoint): number {
  if (a.row !== b.row) return a.row - b.row;
  return a.col - b.col;
}

export function normalizeRange(range: SelectionRange): {
  start: SelectionPoint;
  end: SelectionPoint;
} {
  if (comparePoints(range.anchor, range.focus) <= 0) {
    return { start: range.anchor, end: range.focus };
  }
  return { start: range.focus, end: range.anchor };
}

export function isEmptySelection(range: SelectionRange): boolean {
  return range.anchor.row === range.focus.row && range.anchor.col === range.focus.col;
}

export function extractSelectedText(
  range: SelectionRange,
  getRowText: (row: number) => string,
  totalRows: number,
): string {
  const { start, end } = normalizeRange(range);
  if (start.row === end.row) {
    const line = getRowText(start.row);
    return line.slice(start.col, end.col);
  }

  const lines: string[] = [];
  for (let row = start.row; row <= end.row && row < totalRows; row += 1) {
    const line = getRowText(row);
    if (row === start.row) {
      lines.push(line.slice(start.col));
    } else if (row === end.row) {
      lines.push(line.slice(0, end.col));
    } else {
      lines.push(line);
    }
  }
  return lines.join('\n');
}

export interface SelectionHighlightStyle {
  readonly fg?: Color;
  readonly bg: Color;
}

const DEFAULT_HIGHLIGHT: SelectionHighlightStyle = {
  bg: { kind: 'indexed', index: 24 },
};

export function applySelectionHighlight(
  buffer: CellBuffer,
  range: SelectionRange,
  style: SelectionHighlightStyle = DEFAULT_HIGHLIGHT,
  viewportOffset = 0,
): void {
  const { start, end } = normalizeRange(range);

  for (let absRow = start.row; absRow <= end.row; absRow += 1) {
    const viewRow = absRow - viewportOffset;
    if (viewRow < 0 || viewRow >= buffer.rows) continue;

    const startCol = absRow === start.row ? start.col : 0;
    const endCol = absRow === end.row ? end.col : buffer.cols;

    for (let col = startCol; col < endCol && col < buffer.cols; col += 1) {
      const cell = buffer.getCell(col, viewRow);
      if (cell === null) continue;
      cell.style = {
        ...cell.style,
        bg: style.bg,
        ...(style.fg !== undefined ? { fg: style.fg } : {}),
      };
    }
  }
}

export class TextSelectionState {
  private _active = false;
  private _anchor: SelectionPoint = { row: 0, col: 0 };
  private _focus: SelectionPoint = { row: 0, col: 0 };
  private _hasDragged = false;

  get active(): boolean {
    return this._active;
  }
  get anchor(): SelectionPoint {
    return this._anchor;
  }
  get focus(): SelectionPoint {
    return this._focus;
  }
  get hasDragged(): boolean {
    return this._hasDragged;
  }

  get range(): SelectionRange | null {
    if (!this._active) return null;
    return { anchor: this._anchor, focus: this._focus };
  }

  get isEmpty(): boolean {
    return !this._active || isEmptySelection({ anchor: this._anchor, focus: this._focus });
  }

  startDrag(point: SelectionPoint): void {
    this._active = true;
    this._anchor = point;
    this._focus = point;
    this._hasDragged = false;
  }

  updateDrag(point: SelectionPoint): void {
    if (!this._active) return;
    this._focus = point;
    if (point.row !== this._anchor.row || point.col !== this._anchor.col) {
      this._hasDragged = true;
    }
  }

  endDrag(point: SelectionPoint): SelectionRange | null {
    if (!this._active) return null;
    this._focus = point;
    if (!this._hasDragged) {
      this.clear();
      return null;
    }
    return { anchor: this._anchor, focus: this._focus };
  }

  clear(): void {
    this._active = false;
    this._hasDragged = false;
  }

  selectedText(getRowText: (row: number) => string, totalRows: number): string {
    if (this.isEmpty) return '';
    return extractSelectedText({ anchor: this._anchor, focus: this._focus }, getRowText, totalRows);
  }
}

export function wordBoundaries(text: string, col: number): { start: number; end: number } {
  if (col < 0 || col >= text.length) return { start: col, end: col };

  const isWordChar = (c: string): boolean => /\w/.test(c);
  const charIsWord = isWordChar(text[col]!);

  let start = col;
  let end = col;

  if (charIsWord) {
    while (start > 0 && isWordChar(text[start - 1]!)) start -= 1;
    while (end < text.length && isWordChar(text[end]!)) end += 1;
  } else {
    while (start > 0 && !isWordChar(text[start - 1]!) && text[start - 1] !== ' ') start -= 1;
    while (end < text.length && !isWordChar(text[end]!) && text[end] !== ' ') end += 1;
  }

  return { start, end };
}

export function selectWord(text: string, col: number, row: number): SelectionRange {
  const { start, end } = wordBoundaries(text, col);
  return {
    anchor: { row, col: start },
    focus: { row, col: end },
  };
}
