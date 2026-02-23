import { measureDisplayWidth } from '../text-layout.ts';
import { DEFAULT_CELL_STYLE, cellStyleEqual, cellStyleToSgr, type CellStyle } from './color.ts';

function isAsciiOnly(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

export interface Cell {
  glyph: string;
  continued: boolean;
  style: CellStyle;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class CellBuffer {
  public readonly cols: number;
  public readonly rows: number;
  public readonly baseStyle: CellStyle;
  private readonly cells: Cell[];

  constructor(cols: number, rows: number, baseStyle: CellStyle = DEFAULT_CELL_STYLE) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.baseStyle = baseStyle;
    this.cells = Array.from(
      { length: this.cols * this.rows },
      (): Cell => ({
        glyph: ' ',
        continued: false,
        style: this.baseStyle,
      }),
    );
  }

  private offset(col: number, row: number): number {
    return row * this.cols + col;
  }

  public getCell(col: number, row: number): Cell | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.cells[this.offset(col, row)]!;
  }

  public fillRow(row: number, style: CellStyle): void {
    if (row < 0 || row >= this.rows) return;
    for (let col = 0; col < this.cols; col += 1) {
      const cell = this.cells[this.offset(col, row)]!;
      cell.glyph = ' ';
      cell.continued = false;
      cell.style = style;
    }
  }

  public fillRect(rect: Rect, style: CellStyle): void {
    const startCol = Math.max(0, Math.floor(rect.x));
    const startRow = Math.max(0, Math.floor(rect.y));
    const endCol = Math.min(this.cols, Math.floor(rect.x + rect.width));
    const endRow = Math.min(this.rows, Math.floor(rect.y + rect.height));
    for (let row = startRow; row < endRow; row += 1) {
      for (let col = startCol; col < endCol; col += 1) {
        const cell = this.cells[this.offset(col, row)]!;
        cell.glyph = ' ';
        cell.continued = false;
        cell.style = style;
      }
    }
  }

  public drawText(
    colStart: number,
    row: number,
    text: string,
    style: CellStyle = this.baseStyle,
  ): void {
    if (row < 0 || row >= this.rows || colStart >= this.cols) return;

    let col = Math.max(0, colStart);
    const rowOffset = row * this.cols;
    const maxCol = this.cols;

    if (isAsciiOnly(text)) {
      for (let i = 0; i < text.length; i += 1) {
        if (col >= maxCol) break;
        const cell = this.cells[rowOffset + col]!;
        cell.glyph = text[i]!;
        cell.continued = false;
        cell.style = style;
        col += 1;
      }
      return;
    }

    let lastGlyphCol: number | null = null;
    for (const glyph of text) {
      const width = Math.max(0, measureDisplayWidth(glyph));
      if (width === 0) {
        if (lastGlyphCol !== null) {
          this.cells[rowOffset + lastGlyphCol]!.glyph += glyph;
        }
        continue;
      }
      if (col >= maxCol) break;

      if (width === 1) {
        const cell = this.cells[rowOffset + col]!;
        cell.glyph = glyph;
        cell.continued = false;
        cell.style = style;
        lastGlyphCol = col;
        col += 1;
        continue;
      }

      if (col + width > maxCol) break;
      const first = this.cells[rowOffset + col]!;
      first.glyph = glyph;
      first.continued = false;
      first.style = style;
      for (let o = 1; o < width && col + o < maxCol; o += 1) {
        const cell = this.cells[rowOffset + col + o]!;
        cell.glyph = '';
        cell.continued = true;
        cell.style = style;
      }
      lastGlyphCol = col;
      col += width;
    }
  }

  public blit(source: CellBuffer, destX: number, destY: number): void {
    const dx = Math.floor(destX);
    const dy = Math.floor(destY);

    const srcStartCol = Math.max(0, -dx);
    const srcStartRow = Math.max(0, -dy);
    const srcEndCol = Math.min(source.cols, this.cols - dx);
    const srcEndRow = Math.min(source.rows, this.rows - dy);

    for (let srcRow = srcStartRow; srcRow < srcEndRow; srcRow += 1) {
      const dstRow = dy + srcRow;
      for (let srcCol = srcStartCol; srcCol < srcEndCol; srcCol += 1) {
        const dstCol = dx + srcCol;
        const src = source.cells[source.offset(srcCol, srcRow)]!;
        const dst = this.cells[this.offset(dstCol, dstRow)]!;
        dst.glyph = src.glyph;
        dst.continued = src.continued;
        dst.style = src.style;
      }
    }
  }

  public clip(rect: Rect): ClippedCellBuffer {
    return new ClippedCellBuffer(this, rect);
  }

  public renderAnsiRows(): readonly string[] {
    const result: string[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      const segments: string[] = [];
      let lastStyle: CellStyle | null = null;
      const rowOffset = row * this.cols;
      for (let col = 0; col < this.cols; col += 1) {
        const cell = this.cells[rowOffset + col]!;
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
      result.push(segments.join(''));
    }
    return result;
  }
}

export class ClippedCellBuffer {
  public readonly cols: number;
  public readonly rows: number;
  private readonly target: CellBuffer;
  private readonly originX: number;
  private readonly originY: number;

  constructor(target: CellBuffer, rect: Rect) {
    this.target = target;
    this.originX = Math.max(0, Math.floor(rect.x));
    this.originY = Math.max(0, Math.floor(rect.y));
    this.cols = Math.max(0, Math.min(Math.floor(rect.width), target.cols - this.originX));
    this.rows = Math.max(0, Math.min(Math.floor(rect.height), target.rows - this.originY));
  }

  public getCell(col: number, row: number): Cell | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.target.getCell(this.originX + col, this.originY + row);
  }

  public fillRow(row: number, style: CellStyle): void {
    if (row < 0 || row >= this.rows) return;
    const absRow = this.originY + row;
    for (let col = 0; col < this.cols; col += 1) {
      const cell = this.target.getCell(this.originX + col, absRow);
      if (cell === null) continue;
      cell.glyph = ' ';
      cell.continued = false;
      cell.style = style;
    }
  }

  public drawText(colStart: number, row: number, text: string, style: CellStyle): void {
    if (row < 0 || row >= this.rows || colStart >= this.cols) return;

    let col = Math.max(0, colStart);
    let lastGlyphCol: number | null = null;
    for (const glyph of text) {
      const width = Math.max(0, measureDisplayWidth(glyph));
      if (width === 0) {
        if (lastGlyphCol !== null) {
          const cell = this.target.getCell(this.originX + lastGlyphCol, this.originY + row);
          if (cell !== null) cell.glyph += glyph;
        }
        continue;
      }
      if (col >= this.cols) break;

      if (width === 1) {
        const cell = this.target.getCell(this.originX + col, this.originY + row);
        if (cell !== null) {
          cell.glyph = glyph;
          cell.continued = false;
          cell.style = style;
        }
        lastGlyphCol = col;
        col += 1;
        continue;
      }

      if (col + width > this.cols) break;
      const first = this.target.getCell(this.originX + col, this.originY + row);
      if (first !== null) {
        first.glyph = glyph;
        first.continued = false;
        first.style = style;
      }
      for (let o = 1; o < width && col + o < this.cols; o += 1) {
        const cell = this.target.getCell(this.originX + col + o, this.originY + row);
        if (cell !== null) {
          cell.glyph = '';
          cell.continued = true;
          cell.style = style;
        }
      }
      lastGlyphCol = col;
      col += width;
    }
  }

  public clip(rect: Rect): ClippedCellBuffer {
    return new ClippedCellBuffer(this.target, {
      x: this.originX + Math.max(0, Math.floor(rect.x)),
      y: this.originY + Math.max(0, Math.floor(rect.y)),
      width: rect.width,
      height: rect.height,
    });
  }

  public blit(source: CellBuffer, destX: number, destY: number): void {
    const dx = Math.floor(destX);
    const dy = Math.floor(destY);

    const srcStartCol = Math.max(0, -dx);
    const srcStartRow = Math.max(0, -dy);
    const srcEndCol = Math.min(source.cols, this.cols - dx);
    const srcEndRow = Math.min(source.rows, this.rows - dy);

    for (let srcRow = srcStartRow; srcRow < srcEndRow; srcRow += 1) {
      const dstRow = this.originY + dy + srcRow;
      for (let srcCol = srcStartCol; srcCol < srcEndCol; srcCol += 1) {
        const dstCol = this.originX + dx + srcCol;
        const src = source.getCell(srcCol, srcRow);
        const dst = this.target.getCell(dstCol, dstRow);
        if (src === null || dst === null) continue;
        dst.glyph = src.glyph;
        dst.continued = src.continued;
        dst.style = src.style;
      }
    }
  }
}
