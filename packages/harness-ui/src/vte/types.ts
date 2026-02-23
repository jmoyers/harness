export type ParserMode =
  | 'normal'
  | 'esc'
  | 'esc-intermediate'
  | 'csi'
  | 'osc'
  | 'osc-esc'
  | 'dcs'
  | 'dcs-esc';

export type ActiveScreen = 'primary' | 'alternate';
export type TerminalCursorShape = 'block' | 'underline' | 'bar';

export interface TerminalCursorStyle {
  shape: TerminalCursorShape;
  blinking: boolean;
}

export type TerminalColor =
  | { kind: 'default' }
  | { kind: 'indexed'; index: number }
  | { kind: 'rgb'; r: number; g: number; b: number };

export interface TerminalCellStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  fg: TerminalColor;
  bg: TerminalColor;
}

export interface TerminalCell {
  glyph: string;
  width: number;
  continued: boolean;
  style: TerminalCellStyle;
}

export interface TerminalSnapshotLine {
  wrapped: boolean;
  text: string;
  cells: TerminalCell[];
}

export interface TerminalModeState {
  bracketedPaste: boolean;
  decMouseX10: boolean;
  decMouseButtonEvent: boolean;
  decMouseAnyEvent: boolean;
  decFocusTracking: boolean;
  decMouseSgrEncoding: boolean;
}

export interface TerminalSnapshotFrameCore {
  rows: number;
  cols: number;
  activeScreen: ActiveScreen;
  modes: TerminalModeState;
  cursor: {
    row: number;
    col: number;
    visible: boolean;
    style: TerminalCursorStyle;
  };
  viewport: {
    top: number;
    totalRows: number;
    followOutput: boolean;
  };
  lines: string[];
  richLines: TerminalSnapshotLine[];
}

export interface TerminalSnapshotFrame extends TerminalSnapshotFrameCore {
  frameHash: string;
}

export interface TerminalBufferTail {
  totalRows: number;
  startRow: number;
  lines: string[];
}

export interface TerminalSelectionPoint {
  rowAbs: number;
  col: number;
}

export interface TerminalQueryState {
  rows: number;
  cols: number;
  cursor: { row: number; col: number };
}

export interface TerminalQueryHooks {
  onCsiQuery?: (payload: string, readState: () => TerminalQueryState) => void;
  onOscQuery?: (payload: string, useBellTerminator: boolean) => void;
  onDcsQuery?: (payload: string) => void;
}

export interface ScreenCursor {
  row: number;
  col: number;
}

export interface InternalLine {
  wrapped: boolean;
  cells: TerminalCell[];
  revision: number;
  snapshotCache: TerminalSnapshotLine | null;
  snapshotCacheRevision: number;
  snapshotCacheWrapped: boolean;
}

export const DEFAULT_COLOR: TerminalColor = Object.freeze({ kind: 'default' } as const);

export const DEFAULT_CURSOR_STYLE: TerminalCursorStyle = {
  shape: 'block',
  blinking: true,
};

export const DEFAULT_CELL_STYLE: Readonly<TerminalCellStyle> = Object.freeze({
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  fg: DEFAULT_COLOR,
  bg: DEFAULT_COLOR,
});

export const DEFAULT_BLANK_CELL: Readonly<TerminalCell> = Object.freeze({
  glyph: ' ',
  width: 1,
  continued: false,
  style: DEFAULT_CELL_STYLE,
});

export const DEFAULT_CONTINUATION_CELL: Readonly<TerminalCell> = Object.freeze({
  glyph: '',
  width: 0,
  continued: true,
  style: DEFAULT_CELL_STYLE,
});

export function cloneCursorStyle(style: TerminalCursorStyle): TerminalCursorStyle {
  return { shape: style.shape, blinking: style.blinking };
}

export function cursorStyleEqual(a: TerminalCursorStyle, b: TerminalCursorStyle): boolean {
  return a.shape === b.shape && a.blinking === b.blinking;
}

export function cloneColor(color: TerminalColor): TerminalColor {
  if (color.kind === 'default') return DEFAULT_COLOR;
  if (color.kind === 'indexed') return { kind: 'indexed', index: color.index };
  return { kind: 'rgb', r: color.r, g: color.g, b: color.b };
}

export function defaultCellStyle(): TerminalCellStyle {
  return DEFAULT_CELL_STYLE as TerminalCellStyle;
}

export function isDefaultStyle(style: TerminalCellStyle): boolean {
  return (
    style === DEFAULT_CELL_STYLE ||
    (!style.bold &&
      !style.dim &&
      !style.italic &&
      !style.underline &&
      !style.inverse &&
      style.fg.kind === 'default' &&
      style.bg.kind === 'default')
  );
}

export function cloneStyle(style: TerminalCellStyle): TerminalCellStyle {
  if (isDefaultStyle(style)) return DEFAULT_CELL_STYLE as TerminalCellStyle;
  return {
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    inverse: style.inverse,
    fg: cloneColor(style.fg),
    bg: cloneColor(style.bg),
  };
}

export function styleEqual(a: TerminalCellStyle, b: TerminalCellStyle): boolean {
  if (a === b) return true;
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    colorEqual(a.fg, b.fg) &&
    colorEqual(a.bg, b.bg)
  );
}

export function colorEqual(a: TerminalColor, b: TerminalColor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'default') return true;
  if (a.kind === 'indexed')
    return a.index === (b as Extract<TerminalColor, { kind: 'indexed' }>).index;
  const rb = b as Extract<TerminalColor, { kind: 'rgb' }>;
  return a.r === rb.r && a.g === rb.g && a.b === rb.b;
}

export function blankCell(style: TerminalCellStyle): TerminalCell {
  if (isDefaultStyle(style)) return DEFAULT_BLANK_CELL as TerminalCell;
  return { glyph: ' ', width: 1, continued: false, style: cloneStyle(style) };
}

export function continuationCell(style: TerminalCellStyle): TerminalCell {
  if (isDefaultStyle(style)) return DEFAULT_CONTINUATION_CELL as TerminalCell;
  return { glyph: '', width: 0, continued: true, style: cloneStyle(style) };
}

export function cloneCell(cell: TerminalCell): TerminalCell {
  return {
    glyph: cell.glyph,
    width: cell.width,
    continued: cell.continued,
    style: cloneStyle(cell.style),
  };
}

export function trimRightCells(cells: readonly TerminalCell[]): readonly TerminalCell[] {
  let end = cells.length;
  while (end > 0) {
    const cell = cells[end - 1]!;
    if (cell.continued) {
      end -= 1;
      continue;
    }
    if (cell.glyph === ' ' && styleEqual(cell.style, defaultCellStyle())) {
      end -= 1;
      continue;
    }
    break;
  }
  return cells.slice(0, end);
}

export function cellsToText(cells: readonly TerminalCell[]): string {
  let value = '';
  for (const cell of cells) {
    if (!cell.continued) value += cell.glyph;
  }
  return value;
}

export function createLine(cols: number, style: TerminalCellStyle, revision: number): InternalLine {
  return {
    wrapped: false,
    cells: Array.from({ length: cols }, () => blankCell(style)),
    revision,
    snapshotCache: null,
    snapshotCacheRevision: -1,
    snapshotCacheWrapped: false,
  };
}

export function compareBufferPoints(a: TerminalSelectionPoint, b: TerminalSelectionPoint): number {
  if (a.rowAbs !== b.rowAbs) return a.rowAbs - b.rowAbs;
  return a.col - b.col;
}
