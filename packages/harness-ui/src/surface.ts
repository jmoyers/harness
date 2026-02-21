import { measureDisplayWidth } from './text-layout.ts';

export type UiColor =
  | { kind: 'default' }
  | { kind: 'indexed'; index: number }
  | { kind: 'rgb'; r: number; g: number; b: number };

export interface UiStyle {
  readonly fg: UiColor;
  readonly bg: UiColor;
  readonly bold: boolean;
}

export interface UiCell {
  glyph: string;
  continued: boolean;
  style: UiStyle;
}

const DEFAULT_COLOR: UiColor = {
  kind: 'default',
};

export const DEFAULT_UI_STYLE: UiStyle = {
  fg: DEFAULT_COLOR,
  bg: DEFAULT_COLOR,
  bold: false,
};

function cloneColor(color: UiColor): UiColor {
  if (color.kind === 'default') {
    return DEFAULT_COLOR;
  }
  if (color.kind === 'indexed') {
    return {
      kind: 'indexed',
      index: color.index,
    };
  }
  return {
    kind: 'rgb',
    r: color.r,
    g: color.g,
    b: color.b,
  };
}

function cloneStyle(style: UiStyle): UiStyle {
  return {
    fg: cloneColor(style.fg),
    bg: cloneColor(style.bg),
    bold: style.bold,
  };
}

function styleEqual(left: UiStyle, right: UiStyle): boolean {
  if (left.bold !== right.bold) {
    return false;
  }
  if (left.fg.kind !== right.fg.kind || left.bg.kind !== right.bg.kind) {
    return false;
  }

  if (left.fg.kind === 'indexed') {
    if (left.fg.index !== (right.fg as Extract<UiColor, { kind: 'indexed' }>).index) {
      return false;
    }
  } else if (left.fg.kind === 'rgb') {
    const typedRight = right.fg as Extract<UiColor, { kind: 'rgb' }>;
    if (left.fg.r !== typedRight.r || left.fg.g !== typedRight.g || left.fg.b !== typedRight.b) {
      return false;
    }
  }

  if (left.bg.kind === 'indexed') {
    if (left.bg.index !== (right.bg as Extract<UiColor, { kind: 'indexed' }>).index) {
      return false;
    }
  } else if (left.bg.kind === 'rgb') {
    const typedRight = right.bg as Extract<UiColor, { kind: 'rgb' }>;
    if (left.bg.r !== typedRight.r || left.bg.g !== typedRight.g || left.bg.b !== typedRight.b) {
      return false;
    }
  }

  return true;
}

function colorSgrCodes(color: UiColor, target: 'fg' | 'bg'): readonly string[] {
  const prefix = target === 'fg' ? '38' : '48';
  if (color.kind === 'default') {
    return [target === 'fg' ? '39' : '49'];
  }
  if (color.kind === 'indexed') {
    return [prefix, '5', String(color.index)];
  }
  return [prefix, '2', String(color.r), String(color.g), String(color.b)];
}

function styleToSgr(style: UiStyle): string {
  const codes: string[] = ['0'];
  if (style.bold) {
    codes.push('1');
  }
  codes.push(...colorSgrCodes(style.fg, 'fg'));
  codes.push(...colorSgrCodes(style.bg, 'bg'));
  return `\u001b[${codes.join(';')}m`;
}

export class SurfaceBuffer {
  public readonly cols: number;
  public readonly rows: number;
  public readonly baseStyle: UiStyle;
  public readonly cells: UiCell[];

  constructor(cols: number, rows: number, baseStyle: UiStyle = DEFAULT_UI_STYLE) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.baseStyle = cloneStyle(baseStyle);
    this.cells = Array.from({ length: this.cols * this.rows }, () => ({
      glyph: ' ',
      continued: false,
      style: cloneStyle(this.baseStyle),
    }));
  }

  private cellOffset(col: number, row: number): number {
    return row * this.cols + col;
  }

  public fillRow(row: number, style: UiStyle): void {
    if (row < 0 || row >= this.rows) {
      return;
    }
    const typedStyle = cloneStyle(style);
    for (let col = 0; col < this.cols; col += 1) {
      const cell = this.cells[this.cellOffset(col, row)]!;
      cell.glyph = ' ';
      cell.continued = false;
      cell.style = typedStyle;
    }
  }

  public drawText(
    colStart: number,
    row: number,
    text: string,
    style: UiStyle = this.baseStyle,
  ): void {
    if (row < 0 || row >= this.rows || colStart >= this.cols) {
      return;
    }

    let col = Math.max(0, colStart);
    let lastGlyphCol: number | null = null;
    const typedStyle = cloneStyle(style);
    for (const glyph of text) {
      const width = Math.max(0, measureDisplayWidth(glyph));
      if (width === 0) {
        if (lastGlyphCol !== null) {
          const cell = this.cells[this.cellOffset(lastGlyphCol, row)]!;
          cell.glyph += glyph;
        }
        continue;
      }
      if (col >= this.cols) {
        break;
      }

      if (width === 1) {
        const cell = this.cells[this.cellOffset(col, row)]!;
        cell.glyph = glyph;
        cell.continued = false;
        cell.style = typedStyle;
        lastGlyphCol = col;
        col += 1;
        continue;
      }

      if (col + width > this.cols) {
        break;
      }
      const first = this.cells[this.cellOffset(col, row)]!;
      first.glyph = glyph;
      first.continued = false;
      first.style = typedStyle;
      for (let offset = 1; offset < width && col + offset < this.cols; offset += 1) {
        const cell = this.cells[this.cellOffset(col + offset, row)]!;
        cell.glyph = '';
        cell.continued = true;
        cell.style = typedStyle;
      }
      lastGlyphCol = col;
      col += width;
    }
  }

  public renderAnsiRows(): readonly string[] {
    const rows: string[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      let output = '';
      let lastStyle: UiStyle | null = null;
      for (let col = 0; col < this.cols; col += 1) {
        const cell = this.cells[this.cellOffset(col, row)]!;
        if (lastStyle === null || !styleEqual(lastStyle, cell.style)) {
          output += styleToSgr(cell.style);
          lastStyle = cell.style;
        }
        output += cell.continued ? '' : cell.glyph.length > 0 ? cell.glyph : ' ';
      }
      output += '\u001b[0m';
      rows.push(output);
    }
    return rows;
  }
}
