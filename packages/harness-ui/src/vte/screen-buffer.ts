import { createHash } from 'node:crypto';
import {
  defaultCellStyle,
  blankCell,
  continuationCell,
  cloneCell,
  cloneStyle,
  cloneCursorStyle,
  trimRightCells,
  cellsToText,
  createLine,
  compareBufferPoints,
  type TerminalCellStyle,
  type TerminalCursorStyle,
  type TerminalSnapshotLine,
  type TerminalModeState,
  type TerminalSnapshotFrameCore,
  type TerminalSnapshotFrame,
  type TerminalBufferTail,
  type TerminalSelectionPoint,
  type ActiveScreen,
  type ScreenCursor,
  type InternalLine,
} from './types.ts';

export class ScreenBuffer {
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
  private nextLineRevision = 1;

  constructor(cols: number, rows: number, includeScrollback: boolean, scrollbackLimit: number) {
    this.cols = cols;
    this.rows = rows;
    this.includeScrollback = includeScrollback;
    this.scrollbackLimit = scrollbackLimit;
    this.lines = Array.from({ length: rows }, () => this.createBlankLine(defaultCellStyle()));
    this.scrollRegionBottom = Math.max(0, rows - 1);
  }

  resize(cols: number, rows: number, fillStyle: TerminalCellStyle): void {
    const nextLines = Array.from({ length: rows }, (_, rowIdx) => {
      const nextLine = createLine(cols, fillStyle, this.nextLineRevision);
      this.nextLineRevision += 1;
      if (rowIdx < this.lines.length) {
        const prev = this.lines[rowIdx]!;
        nextLine.wrapped = prev.wrapped;
        for (let c = 0; c < Math.min(cols, prev.cells.length); c += 1) {
          nextLine.cells[c] = prev.cells[c]!;
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
    this.lines = Array.from({ length: this.rows }, () => this.createBlankLine(fillStyle));
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
    if (top >= bottom) return false;
    this.scrollRegionTop = top;
    this.scrollRegionBottom = bottom;
    return true;
  }

  scrollRegion(): { top: number; bottom: number } {
    return { top: this.scrollRegionTop, bottom: this.scrollRegionBottom };
  }

  setFollowOutput(follow: boolean): void {
    this.followOutput = follow;
    this.recomputeViewport();
  }

  scrollViewport(delta: number): void {
    if (delta === 0) return;
    const maxTop = this.maxViewportTop();
    const nextTop = Math.max(0, Math.min(maxTop, this.viewportTop + delta));
    this.viewportTop = nextTop;
    this.followOutput = nextTop === maxTop;
  }

  putGlyph(cursor: ScreenCursor, glyph: string, width: number, style: TerminalCellStyle): boolean {
    const w = Math.max(1, Math.min(2, width));
    const line = this.currentLine(cursor);
    if (line.cells[cursor.col]?.continued === true && cursor.col > 0) {
      line.cells[cursor.col - 1] = blankCell(defaultCellStyle());
      this.touchLine(line);
    }
    if (w === 2 && cursor.col === this.cols - 1) {
      this.advanceLine(cursor, true, style);
    }
    const target = this.currentLine(cursor);
    target.cells[cursor.col] = { glyph, width: w, continued: false, style: cloneStyle(style) };
    this.touchLine(target);
    if (w === 2 && cursor.col + 1 < this.cols) {
      target.cells[cursor.col + 1] = continuationCell(style);
      this.touchLine(target);
    }
    if (w === 1 && cursor.col === this.cols - 1) return true;
    cursor.col += w;
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

  appendCombining(cursor: ScreenCursor, ch: string): void {
    const line = this.currentLine(cursor);
    const col = cursor.col > 0 ? cursor.col - 1 : 0;
    const cell = line.cells[col];
    if (cell === undefined || cell.continued) return;
    if (Object.isFrozen(cell)) {
      line.cells[col] = {
        glyph: cell.glyph + ch,
        width: cell.width,
        continued: cell.continued,
        style: cell.style,
      };
    } else {
      cell.glyph += ch;
    }
    this.touchLine(line);
  }

  clearScreen(cursor: ScreenCursor, mode: number, fillStyle: TerminalCellStyle): void {
    if (mode === 2 || mode === 3) {
      this.lines = Array.from({ length: this.rows }, () => this.createBlankLine(fillStyle));
      if (mode === 3) this.scrollback = [];
      cursor.row = 0;
      cursor.col = 0;
      this.recomputeViewport();
      return;
    }
    if (mode === 1) {
      for (let row = 0; row <= cursor.row; row += 1) {
        const end = row === cursor.row ? cursor.col : this.cols;
        const line = this.lines[row]!;
        for (let c = 0; c < end; c += 1) line.cells[c] = blankCell(fillStyle);
        this.touchLine(line);
      }
      this.recomputeViewport();
      return;
    }
    for (let row = cursor.row; row < this.rows; row += 1) {
      const start = row === cursor.row ? cursor.col : 0;
      const line = this.lines[row]!;
      for (let c = start; c < this.cols; c += 1) line.cells[c] = blankCell(fillStyle);
      this.touchLine(line);
    }
    this.recomputeViewport();
  }

  clearLine(cursor: ScreenCursor, mode: number, fillStyle: TerminalCellStyle): void {
    if (mode === 2) {
      this.lines[cursor.row] = this.createBlankLine(fillStyle);
      return;
    }
    const line = this.lines[cursor.row]!;
    if (mode === 1) {
      for (let c = 0; c <= cursor.col; c += 1) line.cells[c] = blankCell(fillStyle);
      this.touchLine(line);
      return;
    }
    for (let c = cursor.col; c < this.cols; c += 1) line.cells[c] = blankCell(fillStyle);
    this.touchLine(line);
  }

  scrollUp(lines: number, fillStyle: TerminalCellStyle, top = 0, bottom = this.rows - 1): void {
    const ct = Math.max(0, Math.min(this.rows - 1, top));
    const cb = Math.max(0, Math.min(this.rows - 1, bottom));
    if (ct >= cb) return;
    const count = Math.max(1, lines);
    for (let i = 0; i < count; i += 1) {
      const shifted = this.lines.splice(ct, 1)[0];
      if (shifted !== undefined && this.includeScrollback && ct === 0) {
        this.scrollback.push(shifted);
        while (this.scrollback.length > this.scrollbackLimit) this.scrollback.shift();
      }
      this.lines.splice(cb, 0, this.createBlankLine(fillStyle));
    }
    this.recomputeViewport();
  }

  scrollDown(lines: number, fillStyle: TerminalCellStyle, top = 0, bottom = this.rows - 1): void {
    const ct = Math.max(0, Math.min(this.rows - 1, top));
    const cb = Math.max(0, Math.min(this.rows - 1, bottom));
    if (ct >= cb) return;
    const count = Math.max(1, lines);
    for (let i = 0; i < count; i += 1) {
      this.lines.splice(cb, 1);
      this.lines.splice(ct, 0, this.createBlankLine(fillStyle));
    }
    this.recomputeViewport();
  }

  insertLines(cursor: ScreenCursor, lines: number, fillStyle: TerminalCellStyle): void {
    if (cursor.row < this.scrollRegionTop || cursor.row > this.scrollRegionBottom) return;
    const max = this.scrollRegionBottom - cursor.row + 1;
    const count = Math.max(1, Math.min(lines, max));
    for (let i = 0; i < count; i += 1) {
      this.lines.splice(this.scrollRegionBottom, 1);
      this.lines.splice(cursor.row, 0, this.createBlankLine(fillStyle));
    }
  }

  deleteLines(cursor: ScreenCursor, lines: number, fillStyle: TerminalCellStyle): void {
    if (cursor.row < this.scrollRegionTop || cursor.row > this.scrollRegionBottom) return;
    const max = this.scrollRegionBottom - cursor.row + 1;
    const count = Math.max(1, Math.min(lines, max));
    for (let i = 0; i < count; i += 1) {
      this.lines.splice(cursor.row, 1);
      this.lines.splice(this.scrollRegionBottom, 0, this.createBlankLine(fillStyle));
    }
  }

  insertChars(cursor: ScreenCursor, chars: number, fillStyle: TerminalCellStyle): void {
    const line = this.lines[cursor.row]!;
    const max = this.cols - cursor.col;
    const count = Math.max(1, Math.min(chars, max));
    for (let c = this.cols - 1; c >= cursor.col + count; c -= 1) {
      line.cells[c] = cloneCell(line.cells[c - count]!);
    }
    for (let c = cursor.col; c < cursor.col + count; c += 1) {
      line.cells[c] = blankCell(fillStyle);
    }
    this.touchLine(line);
  }

  deleteChars(cursor: ScreenCursor, chars: number, fillStyle: TerminalCellStyle): void {
    const line = this.lines[cursor.row]!;
    const max = this.cols - cursor.col;
    const count = Math.max(1, Math.min(chars, max));
    for (let c = cursor.col; c < this.cols - count; c += 1) {
      line.cells[c] = cloneCell(line.cells[c + count]!);
    }
    for (let c = this.cols - count; c < this.cols; c += 1) {
      line.cells[c] = blankCell(fillStyle);
    }
    this.touchLine(line);
  }

  snapshot(
    cursor: ScreenCursor,
    cursorVisible: boolean,
    cursorStyle: TerminalCursorStyle,
    activeScreen: ActiveScreen,
    modes: TerminalModeState,
    includeHash: true,
  ): TerminalSnapshotFrame;
  snapshot(
    cursor: ScreenCursor,
    cursorVisible: boolean,
    cursorStyle: TerminalCursorStyle,
    activeScreen: ActiveScreen,
    modes: TerminalModeState,
    includeHash: false,
  ): TerminalSnapshotFrameCore;
  snapshot(
    cursor: ScreenCursor,
    cursorVisible: boolean,
    cursorStyle: TerminalCursorStyle,
    activeScreen: ActiveScreen,
    modes: TerminalModeState,
    includeHash: boolean,
  ): TerminalSnapshotFrame | TerminalSnapshotFrameCore {
    const combined = [...this.scrollback, ...this.lines];
    const totalRows = combined.length;
    const vt = Math.max(0, Math.min(this.viewportTop, Math.max(0, totalRows - this.rows)));
    const visible = combined.slice(vt, vt + this.rows);
    const richLines = Array.from({ length: this.rows }, (_, i) =>
      this.materializeSnapshotLine(visible[i]!),
    );
    const simpleLines = richLines.map((l) => l.text);
    const core: TerminalSnapshotFrameCore = {
      rows: this.rows,
      cols: this.cols,
      activeScreen,
      modes: {
        bracketedPaste: modes.bracketedPaste,
        decMouseX10: modes.decMouseX10,
        decMouseButtonEvent: modes.decMouseButtonEvent,
        decMouseAnyEvent: modes.decMouseAnyEvent,
        decFocusTracking: modes.decFocusTracking,
        decMouseSgrEncoding: modes.decMouseSgrEncoding,
      },
      cursor: {
        row: cursor.row,
        col: cursor.col,
        visible: cursorVisible,
        style: cloneCursorStyle(cursorStyle),
      },
      viewport: { top: vt, totalRows, followOutput: this.followOutput },
      lines: simpleLines,
      richLines,
    };
    if (!includeHash) return core;
    return { ...core, frameHash: createHash('sha256').update(JSON.stringify(core)).digest('hex') };
  }

  bufferTail(tailLines: number | null): TerminalBufferTail {
    const combined = [...this.scrollback, ...this.lines];
    const total = combined.length;
    const maxTail = tailLines === null ? total : Math.max(1, Math.floor(tailLines));
    const count = Math.min(total, maxTail);
    const start = Math.max(0, total - count);
    return {
      totalRows: total,
      startRow: start,
      lines: combined.slice(start).map((l) => this.materializeSnapshotLine(l).text),
    };
  }

  selectionText(start: TerminalSelectionPoint, end: TerminalSelectionPoint): string {
    const combined = [...this.scrollback, ...this.lines];
    const total = combined.length;
    if (total === 0) return '';
    const maxR = total - 1;
    const maxC = Math.max(0, this.cols - 1);
    const bs = {
      rowAbs: Math.max(0, Math.min(maxR, start.rowAbs)),
      col: Math.max(0, Math.min(maxC, start.col)),
    };
    const be = {
      rowAbs: Math.max(0, Math.min(maxR, end.rowAbs)),
      col: Math.max(0, Math.min(maxC, end.col)),
    };
    const n = compareBufferPoints(bs, be) <= 0 ? { start: bs, end: be } : { start: be, end: bs };
    const rows: string[] = [];
    for (let r = n.start.rowAbs; r <= n.end.rowAbs; r += 1) {
      const line = combined[r];
      if (line === undefined) {
        rows.push('');
        continue;
      }
      const sc = r === n.start.rowAbs ? n.start.col : 0;
      const ec = r === n.end.rowAbs ? n.end.col : maxC;
      if (ec < sc) {
        rows.push('');
        continue;
      }
      let text = '';
      for (let c = sc; c <= ec; c += 1) {
        const cell = line.cells[c];
        if (cell === undefined || cell.continued) continue;
        text += cell.glyph;
      }
      rows.push(text);
    }
    return rows.join('\n');
  }

  private advanceLine(cursor: ScreenCursor, wrapped: boolean, fillStyle: TerminalCellStyle): void {
    cursor.col = 0;
    this.lineFeed(cursor, fillStyle);
    if (cursor.row >= 0 && cursor.row < this.rows) {
      const line = this.lines[cursor.row]!;
      if (line.wrapped !== wrapped) {
        line.wrapped = wrapped;
        this.touchLine(line);
      }
    }
  }

  private currentLine(cursor: ScreenCursor): InternalLine {
    return this.lines[cursor.row]!;
  }

  private createBlankLine(style: TerminalCellStyle): InternalLine {
    const line = createLine(this.cols, style, this.nextLineRevision);
    this.nextLineRevision += 1;
    return line;
  }

  private touchLine(line: InternalLine): void {
    line.revision += 1;
    line.snapshotCache = null;
    line.snapshotCacheRevision = -1;
  }

  private materializeSnapshotLine(line: InternalLine): TerminalSnapshotLine {
    if (
      line.snapshotCache !== null &&
      line.snapshotCacheRevision === line.revision &&
      line.snapshotCacheWrapped === line.wrapped
    )
      return line.snapshotCache;
    const cells = line.cells.map((c) => ({
      glyph: c.glyph,
      width: c.width,
      continued: c.continued,
      style: cloneStyle(c.style),
    }));
    const trimmed = cellsToText(trimRightCells(cells));
    const snap: TerminalSnapshotLine = { wrapped: line.wrapped, text: trimmed, cells };
    line.snapshotCache = snap;
    line.snapshotCacheRevision = line.revision;
    line.snapshotCacheWrapped = line.wrapped;
    return snap;
  }

  private maxViewportTop(): number {
    return Math.max(0, this.scrollback.length + this.rows - this.rows);
  }

  private ensureViewportInRange(): void {
    this.viewportTop = Math.max(0, Math.min(this.maxViewportTop(), this.viewportTop));
  }

  private recomputeViewport(): void {
    if (this.followOutput) {
      this.viewportTop = this.maxViewportTop();
      return;
    }
    this.ensureViewportInRange();
  }
}
