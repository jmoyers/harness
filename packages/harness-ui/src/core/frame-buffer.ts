import { DEFAULT_CELL_STYLE, cellStyleEqual, cellStyleToSgr, type CellStyle } from './color.ts';
import { CellBuffer } from './cell-buffer.ts';

export class FrameBuffer {
  private front: CellBuffer;
  private back: CellBuffer;
  private rowDirty: boolean[];
  private rowAnsiCache: (string | null)[];
  private _cols: number;
  private _rows: number;

  constructor(cols: number, rows: number, baseStyle: CellStyle = DEFAULT_CELL_STYLE) {
    this._cols = Math.max(1, Math.floor(cols));
    this._rows = Math.max(1, Math.floor(rows));
    this.front = new CellBuffer(this._cols, this._rows, baseStyle);
    this.back = new CellBuffer(this._cols, this._rows, baseStyle);
    this.rowDirty = Array.from({ length: this._rows }, () => true);
    this.rowAnsiCache = Array.from({ length: this._rows }, () => null);
  }

  get cols(): number {
    return this._cols;
  }
  get rows(): number {
    return this._rows;
  }

  get buffer(): CellBuffer {
    return this.back;
  }

  clearBackBuffer(baseStyle: CellStyle = DEFAULT_CELL_STYLE): void {
    for (let row = 0; row < this._rows; row += 1) {
      this.back.fillRow(row, baseStyle);
    }
  }

  resize(cols: number, rows: number, baseStyle: CellStyle = DEFAULT_CELL_STYLE): void {
    this._cols = Math.max(1, Math.floor(cols));
    this._rows = Math.max(1, Math.floor(rows));
    this.front = new CellBuffer(this._cols, this._rows, baseStyle);
    this.back = new CellBuffer(this._cols, this._rows, baseStyle);
    this.rowDirty = Array.from({ length: this._rows }, () => true);
    this.rowAnsiCache = Array.from({ length: this._rows }, () => null);
  }

  commit(): FrameDiff {
    const changedRows: number[] = [];

    for (let row = 0; row < this._rows; row += 1) {
      if (this.isRowChanged(row)) {
        changedRows.push(row);
        this.rowDirty[row] = true;
        this.rowAnsiCache[row] = null;
        this.copyRow(row);
      }
    }

    return {
      totalRows: this._rows,
      changedRows,
      changedCount: changedRows.length,
      fullRedraw: changedRows.length === this._rows,
    };
  }

  renderAnsiRows(): readonly string[] {
    const result: string[] = [];
    for (let row = 0; row < this._rows; row += 1) {
      const cached = this.rowAnsiCache[row];
      if (cached !== null && cached !== undefined) {
        result.push(cached);
        continue;
      }
      const rendered = this.renderSingleAnsiRow(row);
      this.rowAnsiCache[row] = rendered;
      this.rowDirty[row] = false;
      result.push(rendered);
    }
    return result;
  }

  renderChangedAnsiRows(): readonly { row: number; ansi: string }[] {
    const changed: { row: number; ansi: string }[] = [];
    for (let row = 0; row < this._rows; row += 1) {
      if (this.rowAnsiCache[row] !== null && !this.rowDirty[row]) continue;
      const rendered = this.renderSingleAnsiRow(row);
      this.rowAnsiCache[row] = rendered;
      this.rowDirty[row] = false;
      changed.push({ row, ansi: rendered });
    }
    return changed;
  }

  markAllDirty(): void {
    for (let i = 0; i < this._rows; i += 1) {
      this.rowDirty[i] = true;
      this.rowAnsiCache[i] = null;
    }
  }

  markRowDirty(row: number): void {
    if (row >= 0 && row < this._rows) {
      this.rowDirty[row] = true;
      this.rowAnsiCache[row] = null;
    }
  }

  dirtyRowCount(): number {
    let count = 0;
    for (let i = 0; i < this._rows; i += 1) {
      if (this.rowDirty[i]) count += 1;
    }
    return count;
  }

  private isRowChanged(row: number): boolean {
    for (let col = 0; col < this._cols; col += 1) {
      const f = this.front.getCell(col, row);
      const b = this.back.getCell(col, row);
      if (f === null || b === null) return true;
      if (f.glyph !== b.glyph) return true;
      if (f.continued !== b.continued) return true;
      if (f.style !== b.style && !cellStyleEqual(f.style, b.style)) return true;
    }
    return false;
  }

  private copyRow(row: number): void {
    for (let col = 0; col < this._cols; col += 1) {
      const f = this.front.getCell(col, row);
      const b = this.back.getCell(col, row);
      if (f === null || b === null) continue;
      f.glyph = b.glyph;
      f.continued = b.continued;
      f.style = b.style;
    }
  }

  private renderSingleAnsiRow(row: number): string {
    const segments: string[] = [];
    let lastStyle: CellStyle | null = null;
    for (let col = 0; col < this._cols; col += 1) {
      const cell = this.front.getCell(col, row);
      if (cell === null) continue;
      if (
        lastStyle !== cell.style &&
        (lastStyle === null || !cellStyleEqual(lastStyle, cell.style))
      ) {
        segments.push(cellStyleToSgr(cell.style));
        lastStyle = cell.style;
      }
      if (!cell.continued) {
        segments.push(cell.glyph.length > 0 ? cell.glyph : ' ');
      }
    }
    segments.push('\u001b[0m');
    return segments.join('');
  }
}

export interface FrameDiff {
  readonly totalRows: number;
  readonly changedRows: readonly number[];
  readonly changedCount: number;
  readonly fullRedraw: boolean;
}
