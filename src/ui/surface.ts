import { measureDisplayWidth } from '../terminal/snapshot-oracle.ts';

export type UiColor =
  | { kind: 'default' }
  | { kind: 'indexed'; index: number }
  | { kind: 'rgb'; r: number; g: number; b: number };

export interface UiStyle {
  readonly fg: UiColor;
  readonly bg: UiColor;
  readonly bold: boolean;
}

interface UiCell {
  glyph: string;
  continued: boolean;
  style: UiStyle;
}

export interface UiSurface {
  readonly cols: number;
  readonly rows: number;
  readonly baseStyle: UiStyle;
  readonly cells: UiCell[];
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

function createCell(style: UiStyle): UiCell {
  return {
    glyph: ' ',
    continued: false,
    style: cloneStyle(style),
  };
}

function cellOffset(surface: UiSurface, col: number, row: number): number {
  return row * surface.cols + col;
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

export function createUiSurface(
  cols: number,
  rows: number,
  baseStyle: UiStyle = DEFAULT_UI_STYLE,
): UiSurface {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const typedBaseStyle = cloneStyle(baseStyle);
  return {
    cols: safeCols,
    rows: safeRows,
    baseStyle: typedBaseStyle,
    cells: Array.from({ length: safeCols * safeRows }, () => createCell(typedBaseStyle)),
  };
}

export function fillUiRow(surface: UiSurface, row: number, style: UiStyle): void {
  if (row < 0 || row >= surface.rows) {
    return;
  }
  const typedStyle = cloneStyle(style);
  for (let col = 0; col < surface.cols; col += 1) {
    const cell = surface.cells[cellOffset(surface, col, row)]!;
    cell.glyph = ' ';
    cell.continued = false;
    cell.style = typedStyle;
  }
}

export function drawUiText(
  surface: UiSurface,
  colStart: number,
  row: number,
  text: string,
  style: UiStyle = surface.baseStyle,
): void {
  if (row < 0 || row >= surface.rows || colStart >= surface.cols) {
    return;
  }
  let col = Math.max(0, colStart);
  let lastGlyphCol: number | null = null;
  const typedStyle = cloneStyle(style);

  for (const glyph of text) {
    const width = Math.max(0, measureDisplayWidth(glyph));
    if (width === 0) {
      if (lastGlyphCol !== null) {
        const cell = surface.cells[cellOffset(surface, lastGlyphCol, row)]!;
        cell.glyph += glyph;
      }
      continue;
    }
    if (col >= surface.cols) {
      break;
    }

    if (width === 1) {
      const cell = surface.cells[cellOffset(surface, col, row)]!;
      cell.glyph = glyph;
      cell.continued = false;
      cell.style = typedStyle;
      lastGlyphCol = col;
      col += 1;
      continue;
    }

    if (col + width > surface.cols) {
      break;
    }

    const first = surface.cells[cellOffset(surface, col, row)]!;
    first.glyph = glyph;
    first.continued = false;
    first.style = typedStyle;
    for (let offset = 1; offset < width && col + offset < surface.cols; offset += 1) {
      const cell = surface.cells[cellOffset(surface, col + offset, row)]!;
      cell.glyph = '';
      cell.continued = true;
      cell.style = typedStyle;
    }
    lastGlyphCol = col;
    col += width;
  }
}

export function renderUiSurfaceAnsiRows(surface: UiSurface): readonly string[] {
  const rows: string[] = [];
  for (let row = 0; row < surface.rows; row += 1) {
    let output = '';
    let lastStyle: UiStyle | null = null;
    for (let col = 0; col < surface.cols; col += 1) {
      const cell = surface.cells[cellOffset(surface, col, row)]!;
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
