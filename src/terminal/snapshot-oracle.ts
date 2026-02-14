import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

type ParserMode = 'normal' | 'esc' | 'csi' | 'osc' | 'osc-esc';
type ActiveScreen = 'primary' | 'alternate';
type TerminalCursorShape = 'block' | 'underline' | 'bar';

interface TerminalCursorStyle {
  shape: TerminalCursorShape;
  blinking: boolean;
}

type TerminalColor =
  | { kind: 'default' }
  | { kind: 'indexed'; index: number }
  | { kind: 'rgb'; r: number; g: number; b: number };

interface TerminalCellStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  fg: TerminalColor;
  bg: TerminalColor;
}

interface TerminalCell {
  glyph: string;
  width: number;
  continued: boolean;
  style: TerminalCellStyle;
}

interface TerminalSnapshotLine {
  wrapped: boolean;
  text: string;
  cells: TerminalCell[];
}

export interface TerminalSnapshotFrame {
  rows: number;
  cols: number;
  activeScreen: ActiveScreen;
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
  frameHash: string;
}

interface ScreenCursor {
  row: number;
  col: number;
}

interface InternalLine {
  wrapped: boolean;
  cells: TerminalCell[];
}

const DEFAULT_COLOR: TerminalColor = { kind: 'default' };
const DEFAULT_CURSOR_STYLE: TerminalCursorStyle = {
  shape: 'block',
  blinking: true
};

function cloneCursorStyle(style: TerminalCursorStyle): TerminalCursorStyle {
  return {
    shape: style.shape,
    blinking: style.blinking
  };
}

function cursorStyleEqual(left: TerminalCursorStyle, right: TerminalCursorStyle): boolean {
  return left.shape === right.shape && left.blinking === right.blinking;
}

function cloneColor(color: TerminalColor): TerminalColor {
  if (color.kind === 'default') {
    return DEFAULT_COLOR;
  }
  if (color.kind === 'indexed') {
    return {
      kind: 'indexed',
      index: color.index
    };
  }
  return {
    kind: 'rgb',
    r: color.r,
    g: color.g,
    b: color.b
  };
}

function defaultCellStyle(): TerminalCellStyle {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    fg: DEFAULT_COLOR,
    bg: DEFAULT_COLOR
  };
}

function cloneStyle(style: TerminalCellStyle): TerminalCellStyle {
  return {
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    inverse: style.inverse,
    fg: cloneColor(style.fg),
    bg: cloneColor(style.bg)
  };
}

function styleEqual(left: TerminalCellStyle, right: TerminalCellStyle): boolean {
  return (
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.inverse === right.inverse &&
    colorEqual(left.fg, right.fg) &&
    colorEqual(left.bg, right.bg)
  );
}

function colorEqual(left: TerminalColor, right: TerminalColor): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case 'default':
      return true;
    case 'indexed':
      return left.index === (right as Extract<TerminalColor, { kind: 'indexed' }>).index;
    case 'rgb': {
      const typedRight = right as Extract<TerminalColor, { kind: 'rgb' }>;
      return left.r === typedRight.r && left.g === typedRight.g && left.b === typedRight.b;
    }
  }
}

function blankCell(style: TerminalCellStyle): TerminalCell {
  return {
    glyph: ' ',
    width: 1,
    continued: false,
    style: cloneStyle(style)
  };
}

function continuationCell(style: TerminalCellStyle): TerminalCell {
  return {
    glyph: '',
    width: 0,
    continued: true,
    style: cloneStyle(style)
  };
}

function cloneCell(cell: TerminalCell): TerminalCell {
  return {
    glyph: cell.glyph,
    width: cell.width,
    continued: cell.continued,
    style: cloneStyle(cell.style)
  };
}

function trimRightCells(cells: readonly TerminalCell[]): readonly TerminalCell[] {
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

function cellsToText(cells: readonly TerminalCell[]): string {
  let value = '';
  for (const cell of cells) {
    if (cell.continued) {
      continue;
    }
    value += cell.glyph;
  }
  return value;
}

function createLine(cols: number, style: TerminalCellStyle): InternalLine {
  return {
    wrapped: false,
    cells: Array.from({ length: cols }, () => blankCell(style))
  };
}

class ScreenBuffer {
  cols: number;
  rows: number;
  private readonly includeScrollback: boolean;
  private readonly scrollbackLimit: number;
  private lines: InternalLine[];
  private scrollback: InternalLine[] = [];
  private followOutput = true;
  private viewportTop = 0;
  private scrollRegionTop = 0;
  private scrollRegionBottom: number;

  constructor(cols: number, rows: number, includeScrollback: boolean, scrollbackLimit: number) {
    this.cols = cols;
    this.rows = rows;
    this.includeScrollback = includeScrollback;
    this.scrollbackLimit = scrollbackLimit;
    this.lines = Array.from({ length: rows }, () => createLine(cols, defaultCellStyle()));
    this.scrollRegionBottom = Math.max(0, rows - 1);
  }

  resize(cols: number, rows: number, fillStyle: TerminalCellStyle): void {
    const nextLines = Array.from({ length: rows }, (_, rowIdx) => {
      const nextLine = createLine(cols, fillStyle);
      if (rowIdx < this.lines.length) {
        const previousLine = this.lines[rowIdx]!;
        nextLine.wrapped = previousLine.wrapped;
        for (let colIdx = 0; colIdx < Math.min(cols, previousLine.cells.length); colIdx += 1) {
          nextLine.cells[colIdx] = previousLine.cells[colIdx]!;
        }
      }
      return nextLine;
    });

    this.cols = cols;
    this.rows = rows;
    this.lines = nextLines;
    if (
      this.scrollRegionTop < 0 ||
      this.scrollRegionTop >= rows ||
      this.scrollRegionBottom < 0 ||
      this.scrollRegionBottom >= rows ||
      this.scrollRegionTop >= this.scrollRegionBottom
    ) {
      this.resetScrollRegion();
    } else {
      this.scrollRegionTop = Math.max(0, Math.min(this.scrollRegionTop, rows - 1));
      this.scrollRegionBottom = Math.max(0, Math.min(this.scrollRegionBottom, rows - 1));
    }
    this.ensureViewportInRange();
  }

  clear(fillStyle: TerminalCellStyle): void {
    this.lines = Array.from({ length: this.rows }, () => createLine(this.cols, fillStyle));
    this.scrollback = [];
    this.recomputeViewport();
  }

  resetScrollRegion(): void {
    this.scrollRegionTop = 0;
    this.scrollRegionBottom = Math.max(0, this.rows - 1);
  }

  setScrollRegion(topOneBased: number, bottomOneBased: number): boolean {
    const top = Math.max(1, Math.min(this.rows, topOneBased)) - 1;
    const bottom = Math.max(1, Math.min(this.rows, bottomOneBased)) - 1;
    if (top >= bottom) {
      return false;
    }
    this.scrollRegionTop = top;
    this.scrollRegionBottom = bottom;
    return true;
  }

  scrollRegion(): { top: number; bottom: number } {
    return {
      top: this.scrollRegionTop,
      bottom: this.scrollRegionBottom
    };
  }

  setFollowOutput(followOutput: boolean): void {
    this.followOutput = followOutput;
    this.recomputeViewport();
  }

  scrollViewport(deltaRows: number): void {
    if (deltaRows === 0) {
      return;
    }

    const maxTop = this.maxViewportTop();
    const nextTop = Math.max(0, Math.min(maxTop, this.viewportTop + deltaRows));
    this.viewportTop = nextTop;
    this.followOutput = nextTop === maxTop;
  }

  putGlyph(cursor: ScreenCursor, glyph: string, width: number, style: TerminalCellStyle): boolean {
    const normalizedWidth = Math.max(1, Math.min(2, width));

    if (this.currentLine(cursor).cells[cursor.col]?.continued === true && cursor.col > 0) {
      this.currentLine(cursor).cells[cursor.col - 1] = blankCell(defaultCellStyle());
    }

    if (normalizedWidth === 2 && cursor.col === this.cols - 1) {
      this.advanceLine(cursor, true, style);
    }

    this.currentLine(cursor).cells[cursor.col] = {
      glyph,
      width: normalizedWidth,
      continued: false,
      style: cloneStyle(style)
    };

    if (normalizedWidth === 2 && cursor.col + 1 < this.cols) {
      this.currentLine(cursor).cells[cursor.col + 1] = continuationCell(style);
    }

    if (normalizedWidth === 1 && cursor.col === this.cols - 1) {
      return true;
    }

    cursor.col += normalizedWidth;
    if (cursor.col >= this.cols) {
      this.advanceLine(cursor, true, style);
      return false;
    }
    return false;
  }

  lineFeed(cursor: ScreenCursor, fillStyle: TerminalCellStyle): void {
    if (cursor.row === this.scrollRegionBottom) {
      this.scrollUp(1, fillStyle, this.scrollRegionTop, this.scrollRegionBottom);
      return;
    }
    cursor.row = Math.min(this.rows - 1, cursor.row + 1);
  }

  reverseLineFeed(cursor: ScreenCursor, fillStyle: TerminalCellStyle): void {
    if (cursor.row === this.scrollRegionTop) {
      this.scrollDown(1, fillStyle, this.scrollRegionTop, this.scrollRegionBottom);
      return;
    }
    cursor.row = Math.max(0, cursor.row - 1);
  }

  appendCombining(cursor: ScreenCursor, combiningChar: string): void {
    const targetCol = cursor.col > 0 ? cursor.col - 1 : 0;
    const targetCell = this.currentLine(cursor).cells[targetCol];
    if (targetCell === undefined || targetCell.continued) {
      return;
    }
    targetCell.glyph += combiningChar;
  }

  clearScreen(cursor: ScreenCursor, mode: number, fillStyle: TerminalCellStyle): void {
    if (mode === 2 || mode === 3) {
      this.lines = Array.from({ length: this.rows }, () => createLine(this.cols, fillStyle));
      if (mode === 3) {
        this.scrollback = [];
      }
      cursor.row = 0;
      cursor.col = 0;
      this.recomputeViewport();
      return;
    }

    if (mode === 1) {
      for (let row = 0; row <= cursor.row; row += 1) {
        const end = row === cursor.row ? cursor.col : this.cols;
        for (let col = 0; col < end; col += 1) {
          this.lines[row]!.cells[col] = blankCell(fillStyle);
        }
      }
      this.recomputeViewport();
      return;
    }

    for (let row = cursor.row; row < this.rows; row += 1) {
      const start = row === cursor.row ? cursor.col : 0;
      for (let col = start; col < this.cols; col += 1) {
        this.lines[row]!.cells[col] = blankCell(fillStyle);
      }
    }
    this.recomputeViewport();
  }

  clearLine(cursor: ScreenCursor, mode: number, fillStyle: TerminalCellStyle): void {
    if (mode === 2) {
      this.lines[cursor.row] = createLine(this.cols, fillStyle);
      return;
    }

    if (mode === 1) {
      for (let col = 0; col <= cursor.col; col += 1) {
        this.lines[cursor.row]!.cells[col] = blankCell(fillStyle);
      }
      return;
    }

    for (let col = cursor.col; col < this.cols; col += 1) {
      this.lines[cursor.row]!.cells[col] = blankCell(fillStyle);
    }
  }

  scrollUp(lines: number, fillStyle: TerminalCellStyle, top = 0, bottom = this.rows - 1): void {
    const clampedTop = Math.max(0, Math.min(this.rows - 1, top));
    const clampedBottom = Math.max(0, Math.min(this.rows - 1, bottom));
    if (clampedTop >= clampedBottom) {
      return;
    }
    const count = Math.max(1, lines);
    for (let idx = 0; idx < count; idx += 1) {
      const shifted = this.lines.splice(clampedTop, 1)[0];
      if (
        shifted !== undefined &&
        this.includeScrollback &&
        clampedTop === 0
      ) {
        this.scrollback.push(shifted);
        while (this.scrollback.length > this.scrollbackLimit) {
          this.scrollback.shift();
        }
      }
      this.lines.splice(clampedBottom, 0, createLine(this.cols, fillStyle));
    }
    this.recomputeViewport();
  }

  scrollDown(lines: number, fillStyle: TerminalCellStyle, top = 0, bottom = this.rows - 1): void {
    const clampedTop = Math.max(0, Math.min(this.rows - 1, top));
    const clampedBottom = Math.max(0, Math.min(this.rows - 1, bottom));
    if (clampedTop >= clampedBottom) {
      return;
    }
    const count = Math.max(1, lines);
    for (let idx = 0; idx < count; idx += 1) {
      this.lines.splice(clampedBottom, 1);
      this.lines.splice(clampedTop, 0, createLine(this.cols, fillStyle));
    }
    this.recomputeViewport();
  }

  insertLines(cursor: ScreenCursor, lines: number, fillStyle: TerminalCellStyle): void {
    if (cursor.row < this.scrollRegionTop || cursor.row > this.scrollRegionBottom) {
      return;
    }

    const maxCount = this.scrollRegionBottom - cursor.row + 1;
    const count = Math.max(1, Math.min(lines, maxCount));
    for (let idx = 0; idx < count; idx += 1) {
      this.lines.splice(this.scrollRegionBottom, 1);
      this.lines.splice(cursor.row, 0, createLine(this.cols, fillStyle));
    }
  }

  deleteLines(cursor: ScreenCursor, lines: number, fillStyle: TerminalCellStyle): void {
    if (cursor.row < this.scrollRegionTop || cursor.row > this.scrollRegionBottom) {
      return;
    }

    const maxCount = this.scrollRegionBottom - cursor.row + 1;
    const count = Math.max(1, Math.min(lines, maxCount));
    for (let idx = 0; idx < count; idx += 1) {
      this.lines.splice(cursor.row, 1);
      this.lines.splice(this.scrollRegionBottom, 0, createLine(this.cols, fillStyle));
    }
  }

  insertChars(cursor: ScreenCursor, chars: number, fillStyle: TerminalCellStyle): void {
    const line = this.lines[cursor.row]!;
    const maxCount = this.cols - cursor.col;
    const count = Math.max(1, Math.min(chars, maxCount));
    for (let col = this.cols - 1; col >= cursor.col + count; col -= 1) {
      line.cells[col] = cloneCell(line.cells[col - count]!);
    }
    for (let col = cursor.col; col < cursor.col + count; col += 1) {
      line.cells[col] = blankCell(fillStyle);
    }
  }

  deleteChars(cursor: ScreenCursor, chars: number, fillStyle: TerminalCellStyle): void {
    const line = this.lines[cursor.row]!;
    const maxCount = this.cols - cursor.col;
    const count = Math.max(1, Math.min(chars, maxCount));
    for (let col = cursor.col; col < this.cols - count; col += 1) {
      line.cells[col] = cloneCell(line.cells[col + count]!);
    }
    for (let col = this.cols - count; col < this.cols; col += 1) {
      line.cells[col] = blankCell(fillStyle);
    }
  }

  snapshot(
    cursor: ScreenCursor,
    cursorVisible: boolean,
    cursorStyle: TerminalCursorStyle,
    activeScreen: ActiveScreen
  ): TerminalSnapshotFrame {
    const combined = [...this.scrollback, ...this.lines];
    const totalRows = combined.length;
    const viewportTop = Math.max(0, Math.min(this.viewportTop, Math.max(0, totalRows - this.rows)));
    const visible = combined.slice(viewportTop, viewportTop + this.rows);

    const richLines = Array.from({ length: this.rows }, (_, rowIdx) => {
      const line = visible[rowIdx]!;
      const cells = line.cells.map((cell) => ({
        glyph: cell.glyph,
        width: cell.width,
        continued: cell.continued,
        style: cloneStyle(cell.style)
      }));
      const trimmedText = cellsToText(trimRightCells(cells));
      return {
        wrapped: line.wrapped,
        text: trimmedText,
        cells
      };
    });

    const simpleLines = richLines.map((line) => line.text);

    const frameWithoutHash = {
      rows: this.rows,
      cols: this.cols,
      activeScreen,
      cursor: {
        row: cursor.row,
        col: cursor.col,
        visible: cursorVisible,
        style: cloneCursorStyle(cursorStyle)
      },
      viewport: {
        top: viewportTop,
        totalRows,
        followOutput: this.followOutput
      },
      lines: simpleLines,
      richLines
    };

    const frameHash = createHash('sha256').update(JSON.stringify(frameWithoutHash)).digest('hex');

    return {
      ...frameWithoutHash,
      frameHash
    };
  }

  private advanceLine(cursor: ScreenCursor, wrapped: boolean, fillStyle: TerminalCellStyle): void {
    cursor.col = 0;
    this.lineFeed(cursor, fillStyle);
    if (cursor.row >= 0 && cursor.row < this.rows) {
      this.lines[cursor.row]!.wrapped = wrapped;
    }
  }

  private currentLine(cursor: ScreenCursor): InternalLine {
    return this.lines[cursor.row]!;
  }

  private maxViewportTop(): number {
    const totalRows = this.scrollback.length + this.rows;
    return Math.max(0, totalRows - this.rows);
  }

  private ensureViewportInRange(): void {
    const maxTop = this.maxViewportTop();
    this.viewportTop = Math.max(0, Math.min(maxTop, this.viewportTop));
  }

  private recomputeViewport(): void {
    if (this.followOutput) {
      this.viewportTop = this.maxViewportTop();
      return;
    }
    this.ensureViewportInRange();
  }
}

function colorToParams(color: TerminalColor, isBackground: boolean): number[] {
  if (color.kind === 'default') {
    return [isBackground ? 49 : 39];
  }

  if (color.kind === 'indexed') {
    if (color.index >= 0 && color.index <= 7) {
      return [(isBackground ? 40 : 30) + color.index];
    }
    if (color.index >= 8 && color.index <= 15) {
      return [(isBackground ? 100 : 90) + (color.index - 8)];
    }
    return [isBackground ? 48 : 38, 5, color.index];
  }

  return [isBackground ? 48 : 38, 2, color.r, color.g, color.b];
}

function styleToAnsi(style: TerminalCellStyle): string {
  const params: number[] = [0];
  if (style.bold) {
    params.push(1);
  }
  if (style.dim) {
    params.push(2);
  }
  if (style.italic) {
    params.push(3);
  }
  if (style.underline) {
    params.push(4);
  }
  if (style.inverse) {
    params.push(7);
  }
  params.push(...colorToParams(style.fg, false));
  params.push(...colorToParams(style.bg, true));
  return `\u001b[${params.join(';')}m`;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

function isWideCodePoint(codePoint: number): boolean {
  const ranges: ReadonlyArray<readonly [number, number]> = [
    [0x1100, 0x115f],
    [0x2329, 0x232a],
    [0x2e80, 0xa4cf],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe10, 0xfe19],
    [0xfe30, 0xfe6f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x1f300, 0x1faff]
  ];

  for (const [start, end] of ranges) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

export function measureDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;

    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
      continue;
    }

    if (/\p{Mark}/u.test(char)) {
      continue;
    }

    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function wrapTextForColumns(text: string, cols: number): string[] {
  if (cols <= 0) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const char of text) {
    if (char === '\n') {
      lines.push(current);
      current = '';
      currentWidth = 0;
      continue;
    }

    const charWidth = Math.max(1, measureDisplayWidth(char));
    if (currentWidth + charWidth > cols) {
      lines.push(current);
      current = '';
      currentWidth = 0;
    }

    current += char;
    currentWidth += charWidth;
  }

  lines.push(current);
  return lines;
}

function applySgrParams(style: TerminalCellStyle, params: number[]): TerminalCellStyle {
  const nextStyle = cloneStyle(style);
  const queue = params.length === 0 ? [0] : [...params];

  for (let idx = 0; idx < queue.length; idx += 1) {
    const param = queue[idx]!;

    if (param === 0) {
      return defaultCellStyle();
    }
    if (param === 1) {
      nextStyle.bold = true;
      continue;
    }
    if (param === 2) {
      nextStyle.dim = true;
      continue;
    }
    if (param === 3) {
      nextStyle.italic = true;
      continue;
    }
    if (param === 4) {
      nextStyle.underline = true;
      continue;
    }
    if (param === 7) {
      nextStyle.inverse = true;
      continue;
    }
    if (param === 21 || param === 22) {
      nextStyle.bold = false;
      nextStyle.dim = false;
      continue;
    }
    if (param === 23) {
      nextStyle.italic = false;
      continue;
    }
    if (param === 24) {
      nextStyle.underline = false;
      continue;
    }
    if (param === 27) {
      nextStyle.inverse = false;
      continue;
    }
    if (param >= 30 && param <= 37) {
      nextStyle.fg = { kind: 'indexed', index: param - 30 };
      continue;
    }
    if (param >= 90 && param <= 97) {
      nextStyle.fg = { kind: 'indexed', index: 8 + (param - 90) };
      continue;
    }
    if (param === 39) {
      nextStyle.fg = DEFAULT_COLOR;
      continue;
    }
    if (param >= 40 && param <= 47) {
      nextStyle.bg = { kind: 'indexed', index: param - 40 };
      continue;
    }
    if (param >= 100 && param <= 107) {
      nextStyle.bg = { kind: 'indexed', index: 8 + (param - 100) };
      continue;
    }
    if (param === 49) {
      nextStyle.bg = DEFAULT_COLOR;
      continue;
    }

    if (param !== 38 && param !== 48) {
      continue;
    }

    const isBackground = param === 48;
    const mode = queue[idx + 1];
    if (mode === 5) {
      const value = queue[idx + 2];
      if (typeof value === 'number' && Number.isFinite(value)) {
        const parsedColor: TerminalColor = {
          kind: 'indexed',
          index: clampColor(value)
        };
        if (isBackground) {
          nextStyle.bg = parsedColor;
        } else {
          nextStyle.fg = parsedColor;
        }
      }
      idx += 2;
      continue;
    }

    if (mode === 2) {
      const red = queue[idx + 2];
      const green = queue[idx + 3];
      const blue = queue[idx + 4];
      if (
        typeof red === 'number' &&
        typeof green === 'number' &&
        typeof blue === 'number' &&
        Number.isFinite(red) &&
        Number.isFinite(green) &&
        Number.isFinite(blue)
      ) {
        const parsedColor: TerminalColor = {
          kind: 'rgb',
          r: clampColor(red),
          g: clampColor(green),
          b: clampColor(blue)
        };
        if (isBackground) {
          nextStyle.bg = parsedColor;
        } else {
          nextStyle.fg = parsedColor;
        }
      }
      idx += 4;
    }
  }

  return nextStyle;
}

export class TerminalSnapshotOracle {
  private readonly decoder = new StringDecoder('utf8');
  private readonly primary: ScreenBuffer;
  private readonly alternate: ScreenBuffer;
  private activeScreen: ActiveScreen = 'primary';
  private cursor: ScreenCursor = { row: 0, col: 0 };
  private savedCursor: ScreenCursor | null = null;
  private mode: ParserMode = 'normal';
  private csiBuffer = '';
  private cursorVisible = true;
  private cursorStyle: TerminalCursorStyle = cloneCursorStyle(DEFAULT_CURSOR_STYLE);
  private style: TerminalCellStyle = defaultCellStyle();
  private originMode = false;
  private pendingWrap = false;
  private tabStops = new Set<number>();

  constructor(cols: number, rows: number, scrollbackLimit = 5000) {
    this.primary = new ScreenBuffer(cols, rows, true, scrollbackLimit);
    this.alternate = new ScreenBuffer(cols, rows, false, 0);
    this.resetTabStops(cols);
  }

  ingest(chunk: string | Uint8Array): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(Buffer.from(chunk));
    for (const char of text) {
      this.processChar(char);
    }
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) {
      return;
    }
    this.primary.resize(cols, rows, this.style);
    this.alternate.resize(cols, rows, this.style);
    this.cursor.row = Math.max(0, Math.min(rows - 1, this.cursor.row));
    this.cursor.col = Math.max(0, Math.min(cols - 1, this.cursor.col));
    this.resetTabStops(cols);
    if (this.pendingWrap && this.cursor.col !== cols - 1) {
      this.pendingWrap = false;
    }
  }

  setFollowOutput(followOutput: boolean): void {
    this.currentScreen().setFollowOutput(followOutput);
  }

  scrollViewport(deltaRows: number): void {
    this.currentScreen().scrollViewport(deltaRows);
  }

  snapshot(): TerminalSnapshotFrame {
    return this.currentScreen().snapshot(this.cursor, this.cursorVisible, this.cursorStyle, this.activeScreen);
  }

  private currentScreen(): ScreenBuffer {
    return this.activeScreen === 'primary' ? this.primary : this.alternate;
  }

  private processChar(char: string): void {
    if (this.mode === 'normal') {
      this.processNormal(char);
      return;
    }
    if (this.mode === 'esc') {
      this.processEsc(char);
      return;
    }
    if (this.mode === 'csi') {
      this.processCsi(char);
      return;
    }
    if (this.mode === 'osc') {
      this.processOsc(char);
      return;
    }
    this.processOscEsc(char);
  }

  private processNormal(char: string): void {
    const codePoint = char.codePointAt(0)!;
    if (char === '\u001b') {
      this.mode = 'esc';
      return;
    }
    if (char === '\r') {
      this.cursor.col = 0;
      this.pendingWrap = false;
      return;
    }
    if (char === '\n') {
      this.currentScreen().lineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      return;
    }
    if (char === '\t') {
      if (this.pendingWrap) {
        this.currentScreen().lineFeed(this.cursor, this.style);
        this.cursor.col = 0;
        this.pendingWrap = false;
      }
      this.cursor.col = this.nextTabStop(this.cursor.col, this.currentScreen().cols);
      return;
    }
    if (char === '\b') {
      this.cursor.col = Math.max(0, this.cursor.col - 1);
      this.pendingWrap = false;
      return;
    }
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
      return;
    }

    if (this.pendingWrap) {
      this.currentScreen().lineFeed(this.cursor, this.style);
      this.cursor.col = 0;
      this.pendingWrap = false;
    }

    const width = measureDisplayWidth(char);
    if (width === 0) {
      this.currentScreen().appendCombining(this.cursor, char);
      return;
    }

    this.pendingWrap = this.currentScreen().putGlyph(this.cursor, char, width, this.style);
  }

  private processEsc(char: string): void {
    if (char === '[') {
      this.mode = 'csi';
      this.csiBuffer = '';
      return;
    }
    if (char === ']') {
      this.mode = 'osc';
      return;
    }
    if (char === '7') {
      this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
      this.mode = 'normal';
      return;
    }
    if (char === '8') {
      if (this.savedCursor !== null) {
        this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
      }
      this.mode = 'normal';
      return;
    }
    if (char === 'D') {
      this.currentScreen().lineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      this.mode = 'normal';
      return;
    }
    if (char === 'E') {
      this.cursor.col = 0;
      this.currentScreen().lineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      this.mode = 'normal';
      return;
    }
    if (char === 'M') {
      this.currentScreen().reverseLineFeed(this.cursor, this.style);
      this.pendingWrap = false;
      this.mode = 'normal';
      return;
    }
    if (char === 'H') {
      this.tabStops.add(this.cursor.col);
      this.mode = 'normal';
      return;
    }
    if (char === 'c') {
      this.hardReset();
      this.mode = 'normal';
      return;
    }
    this.mode = 'normal';
  }

  private processCsi(char: string): void {
    const code = char.charCodeAt(0);
    if (code >= 0x40 && code <= 0x7e) {
      const finalByte = char;
      const rawParams = this.csiBuffer;
      this.mode = 'normal';
      this.csiBuffer = '';
      this.applyCsi(rawParams, finalByte);
      return;
    }

    this.csiBuffer += char;
  }

  private processOsc(char: string): void {
    if (char === '\u0007') {
      this.mode = 'normal';
      return;
    }
    if (char === '\u001b') {
      this.mode = 'osc-esc';
    }
  }

  private processOscEsc(char: string): void {
    if (char === '\\') {
      this.mode = 'normal';
      return;
    }
    this.mode = 'osc';
  }

  private applyCsi(rawParams: string, finalByte: string): void {
    const privateMode = rawParams.startsWith('?');
    const params = (privateMode ? rawParams.slice(1) : rawParams).split(';').map((part) => {
      if (part.length === 0) {
        return NaN;
      }
      return Number(part);
    });
    const first = Number.isFinite(params[0]) ? (params[0] as number) : 1;

    if (privateMode) {
      if (finalByte === 'h') {
        this.applyPrivateMode(params, true);
        return;
      }
      if (finalByte === 'l') {
        this.applyPrivateMode(params, false);
        return;
      }
    }

    if (finalByte === 'q' && rawParams.endsWith(' ')) {
      const trimmed = rawParams.slice(0, -1).trim();
      const value = trimmed.length === 0 ? 0 : Number(trimmed);
      if (Number.isFinite(value)) {
        this.applyCursorStyleParam(value);
      }
      return;
    }

    if (finalByte === 'm') {
      const cleaned = params.filter((value) => Number.isFinite(value));
      this.style = applySgrParams(this.style, cleaned);
      return;
    }

    if (finalByte === 'A') {
      const bounds = this.activeRowBounds();
      this.cursor.row = Math.max(bounds.top, this.cursor.row - first);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'B') {
      const bounds = this.activeRowBounds();
      this.cursor.row = Math.min(bounds.bottom, this.cursor.row + first);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'C') {
      this.cursor.col = Math.min(this.currentScreen().cols - 1, this.cursor.col + first);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'D') {
      this.cursor.col = Math.max(0, this.cursor.col - first);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'G') {
      this.cursor.col = Math.max(0, Math.min(this.currentScreen().cols - 1, first - 1));
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'H' || finalByte === 'f') {
      const row = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      const col = Number.isFinite(params[1]) ? (params[1] as number) : 1;
      const bounds = this.activeRowBounds();
      const targetRow = this.originMode ? bounds.top + row - 1 : row - 1;
      this.cursor.row = Math.max(bounds.top, Math.min(bounds.bottom, targetRow));
      this.cursor.col = Math.max(0, Math.min(this.currentScreen().cols - 1, col - 1));
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'J') {
      const mode = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      this.currentScreen().clearScreen(this.cursor, mode, this.style);
      return;
    }
    if (finalByte === 'K') {
      const mode = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      this.currentScreen().clearLine(this.cursor, mode, this.style);
      return;
    }
    if (finalByte === 'S') {
      const region = this.currentScreen().scrollRegion();
      this.currentScreen().scrollUp(first, this.style, region.top, region.bottom);
      return;
    }
    if (finalByte === 'T') {
      const region = this.currentScreen().scrollRegion();
      this.currentScreen().scrollDown(first, this.style, region.top, region.bottom);
      return;
    }
    if (finalByte === 'L') {
      this.currentScreen().insertLines(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'M') {
      this.currentScreen().deleteLines(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === '@') {
      this.currentScreen().insertChars(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'P') {
      this.currentScreen().deleteChars(this.cursor, first, this.style);
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 'g') {
      const mode = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      if (mode === 0) {
        this.tabStops.delete(this.cursor.col);
      } else if (mode === 3) {
        this.tabStops.clear();
      }
      return;
    }
    if (finalByte === 'r') {
      const top = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      const bottom = Number.isFinite(params[1]) ? (params[1] as number) : this.currentScreen().rows;
      if (this.currentScreen().setScrollRegion(top, bottom)) {
        this.homeCursor();
      }
      this.pendingWrap = false;
      return;
    }
    if (finalByte === 's') {
      this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
      return;
    }
    if (finalByte === 'u' && this.savedCursor !== null) {
      this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
      this.pendingWrap = false;
    }
  }

  private applyPrivateMode(params: number[], enabled: boolean): void {
    for (const value of params) {
      if (!Number.isFinite(value)) {
        continue;
      }

      if (value === 25) {
        this.cursorVisible = enabled;
        continue;
      }

      if (value === 1047) {
        this.activeScreen = enabled ? 'alternate' : 'primary';
        if (enabled) {
          this.originMode = false;
          this.alternate.clear(this.style);
          this.alternate.resetScrollRegion();
          this.cursor = { row: 0, col: 0 };
        }
        this.pendingWrap = false;
        continue;
      }

      if (value === 1048) {
        if (enabled) {
          this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
        } else if (this.savedCursor !== null) {
          this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
        }
        this.pendingWrap = false;
        continue;
      }

      if (value === 1049) {
        if (enabled) {
          this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
          this.originMode = false;
          this.activeScreen = 'alternate';
          this.alternate.clear(this.style);
          this.alternate.resetScrollRegion();
          this.cursor = { row: 0, col: 0 };
        } else {
          this.activeScreen = 'primary';
          if (this.savedCursor !== null) {
            this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
          }
        }
        this.pendingWrap = false;
        continue;
      }

      if (value === 6) {
        this.originMode = enabled;
        this.homeCursor();
        this.pendingWrap = false;
      }
    }
  }

  private applyCursorStyleParam(value: number): void {
    if (value === 0 || value === 1) {
      this.cursorStyle = {
        shape: 'block',
        blinking: true
      };
      return;
    }
    if (value === 2) {
      this.cursorStyle = {
        shape: 'block',
        blinking: false
      };
      return;
    }
    if (value === 3) {
      this.cursorStyle = {
        shape: 'underline',
        blinking: true
      };
      return;
    }
    if (value === 4) {
      this.cursorStyle = {
        shape: 'underline',
        blinking: false
      };
      return;
    }
    if (value === 5) {
      this.cursorStyle = {
        shape: 'bar',
        blinking: true
      };
      return;
    }
    if (value === 6) {
      this.cursorStyle = {
        shape: 'bar',
        blinking: false
      };
    }
  }

  private hardReset(): void {
    const style = defaultCellStyle();
    this.activeScreen = 'primary';
    this.cursor = { row: 0, col: 0 };
    this.savedCursor = null;
    this.cursorVisible = true;
    this.cursorStyle = cloneCursorStyle(DEFAULT_CURSOR_STYLE);
    this.style = style;
    this.originMode = false;
    this.pendingWrap = false;

    this.primary.clear(style);
    this.primary.resetScrollRegion();
    this.primary.setFollowOutput(true);
    this.alternate.clear(style);
    this.alternate.resetScrollRegion();
    this.alternate.setFollowOutput(true);

    this.resetTabStops(this.primary.cols);
  }

  private activeRowBounds(): { top: number; bottom: number } {
    if (!this.originMode) {
      return {
        top: 0,
        bottom: this.currentScreen().rows - 1
      };
    }
    return this.currentScreen().scrollRegion();
  }

  private homeCursor(): void {
    const bounds = this.activeRowBounds();
    this.cursor.row = bounds.top;
    this.cursor.col = 0;
    this.pendingWrap = false;
  }

  private resetTabStops(cols: number): void {
    this.tabStops.clear();
    for (let col = 8; col < cols; col += 8) {
      this.tabStops.add(col);
    }
  }

  private nextTabStop(currentCol: number, cols: number): number {
    const sortedStops = [...this.tabStops].sort((left, right) => left - right);
    for (const stop of sortedStops) {
      if (stop > currentCol) {
        return Math.min(cols - 1, stop);
      }
    }
    return cols - 1;
  }
}

export function renderSnapshotAnsiRow(
  frame: TerminalSnapshotFrame,
  rowIndex: number,
  cols: number
): string {
  const line = frame.richLines[rowIndex];
  const defaultStyle = defaultCellStyle();

  if (line === undefined) {
    return `${styleToAnsi(defaultStyle)}${' '.repeat(cols)}\u001b[0m`;
  }

  let output = '';
  let previousStyle: TerminalCellStyle | null = null;

  for (let col = 0; col < cols; col += 1) {
    const cell = line.cells[col]!;
    if (cell.continued) {
      continue;
    }

    if (previousStyle === null || !styleEqual(previousStyle, cell.style)) {
      output += styleToAnsi(cell.style);
      previousStyle = cell.style;
    }

    output += cell.glyph;
    if (cell.width === 2) {
      col += 1;
    }
  }

  output += '\u001b[0m';
  return output;
}

export function renderSnapshotText(frame: TerminalSnapshotFrame): string {
  return frame.lines.join('\n');
}

interface TerminalReplayStep {
  kind: 'output' | 'resize';
  chunk?: string;
  cols?: number;
  rows?: number;
}

export function replayTerminalSteps(
  steps: readonly TerminalReplayStep[],
  initialCols: number,
  initialRows: number
): TerminalSnapshotFrame[] {
  const oracle = new TerminalSnapshotOracle(initialCols, initialRows);
  const snapshots: TerminalSnapshotFrame[] = [];

  for (const step of steps) {
    if (step.kind === 'output') {
      oracle.ingest(step.chunk ?? '');
      snapshots.push(oracle.snapshot());
      continue;
    }

    const cols = step.cols ?? initialCols;
    const rows = step.rows ?? initialRows;
    oracle.resize(cols, rows);
    snapshots.push(oracle.snapshot());
  }

  return snapshots;
}

interface TerminalFrameDiff {
  equal: boolean;
  reasons: string[];
}

export function diffTerminalFrames(expected: TerminalSnapshotFrame, actual: TerminalSnapshotFrame): TerminalFrameDiff {
  const reasons: string[] = [];

  if (expected.rows !== actual.rows || expected.cols !== actual.cols) {
    reasons.push('dimensions-mismatch');
  }

  if (expected.activeScreen !== actual.activeScreen) {
    reasons.push('active-screen-mismatch');
  }

  if (expected.cursor.row !== actual.cursor.row || expected.cursor.col !== actual.cursor.col) {
    reasons.push('cursor-position-mismatch');
  }

  if (expected.cursor.visible !== actual.cursor.visible) {
    reasons.push('cursor-visibility-mismatch');
  }

  if (!cursorStyleEqual(expected.cursor.style, actual.cursor.style)) {
    reasons.push('cursor-style-mismatch');
  }

  const rowCount = Math.max(expected.richLines.length, actual.richLines.length);
  for (let row = 0; row < rowCount; row += 1) {
    const expectedLine = expected.richLines[row];
    const actualLine = actual.richLines[row];
    if (expectedLine === undefined || actualLine === undefined) {
      reasons.push(`line-${String(row)}-missing`);
      continue;
    }

    if (expectedLine.text !== actualLine.text || expectedLine.wrapped !== actualLine.wrapped) {
      reasons.push(`line-${String(row)}-text-mismatch`);
    }

    const cellCount = Math.max(expectedLine.cells.length, actualLine.cells.length);
    for (let col = 0; col < cellCount; col += 1) {
      const expectedCell = expectedLine.cells[col];
      const actualCell = actualLine.cells[col];
      if (expectedCell === undefined || actualCell === undefined) {
        reasons.push(`cell-${String(row)}-${String(col)}-missing`);
        continue;
      }
      if (
        expectedCell.glyph !== actualCell.glyph ||
        expectedCell.width !== actualCell.width ||
        expectedCell.continued !== actualCell.continued ||
        !styleEqual(expectedCell.style, actualCell.style)
      ) {
        reasons.push(`cell-${String(row)}-${String(col)}-mismatch`);
      }
    }
  }

  return {
    equal: reasons.length === 0,
    reasons
  };
}
