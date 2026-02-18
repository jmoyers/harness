import { measureDisplayWidth } from '../../terminal/snapshot-oracle.ts';
import { createUiSurface, renderUiSurfaceAnsiRows, type UiStyle } from '../surface.ts';

interface HomeGridfireOptions {
  readonly cols: number;
  readonly rows: number;
  readonly contentRows: readonly string[];
  readonly timeMs: number;
  readonly overlayTitle: string | null;
  readonly overlaySubtitle: string | null;
}

type RgbTriplet = readonly [number, number, number];

const GRID_CHARS = {
  intersection: '+',
  hline: '─',
  vline: '│',
  dot: '·',
  brightDot: '•',
  node: '◊',
  brightNode: '◆',
  empty: ' ',
  light: '░',
  heavy: '▓',
} as const;

const FG_PALETTE: readonly RgbTriplet[] = [
  [14, 11, 28],
  [28, 20, 55],
  [50, 30, 100],
  [75, 45, 155],
  [55, 85, 200],
  [90, 140, 240],
  [150, 190, 255],
  [220, 235, 255],
];

const BG_PALETTE: readonly RgbTriplet[] = [
  [8, 6, 16],
  [12, 10, 22],
  [16, 13, 30],
  [20, 16, 38],
  [18, 20, 45],
  [16, 24, 50],
  [20, 28, 55],
  [24, 32, 58],
];

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function colorLerp(start: RgbTriplet, end: RgbTriplet, t: number): RgbTriplet {
  return [
    Math.round(lerp(start[0], end[0], t)),
    Math.round(lerp(start[1], end[1], t)),
    Math.round(lerp(start[2], end[2], t)),
  ];
}

function paletteColor(palette: readonly RgbTriplet[], t: number): RgbTriplet {
  const normalized = clamp01(t);
  const index = normalized * (palette.length - 1);
  const low = Math.floor(index);
  const high = Math.min(low + 1, palette.length - 1);
  return colorLerp(palette[low]!, palette[high]!, index - low);
}

function styleFromColors(fg: RgbTriplet, bg: RgbTriplet, bold = false): UiStyle {
  return {
    fg: {
      kind: 'rgb',
      r: fg[0],
      g: fg[1],
      b: fg[2],
    },
    bg: {
      kind: 'rgb',
      r: bg[0],
      g: bg[1],
      b: bg[2],
    },
    bold,
  };
}

function writeGlyph(
  surface: ReturnType<typeof createUiSurface>,
  row: number,
  col: number,
  glyph: string,
  width: number,
  style: UiStyle,
): void {
  const start = row * surface.cols + col;
  const first = surface.cells[start]!;
  first.glyph = glyph;
  first.continued = false;
  first.style = style;
  for (let offset = 1; offset < width && col + offset < surface.cols; offset += 1) {
    const trailing = surface.cells[start + offset]!;
    trailing.glyph = '';
    trailing.continued = true;
    trailing.style = style;
  }
}

function displayWidth(text: string): number {
  let width = 0;
  for (const glyph of text) {
    width += Math.max(0, measureDisplayWidth(glyph));
  }
  return width;
}

function spacingX(cols: number): number {
  return Math.max(4, Math.round(cols / 15));
}

function spacingY(rows: number): number {
  return Math.max(2, Math.round(rows / 9));
}

function gridEnergy(col: number, row: number, cols: number, rows: number, phase: number): number {
  const gridX = spacingX(cols);
  const gridY = spacingY(rows);
  const dxGrid = Math.abs((col % gridX) - gridX / 2) / (gridX / 2);
  const dyGrid = Math.abs((row % gridY) - gridY / 2) / (gridY / 2);

  const onHLine = 1 - dyGrid;
  const onVLine = 1 - dxGrid;
  const gridLine = Math.max(onHLine * 0.6, onVLine * 0.4);
  const intersectionBoost = Math.pow(onHLine * onVLine, 0.5) * 0.5;

  const nx = col / Math.max(1, cols);
  const ny = row / Math.max(1, rows);
  const hWave = Math.sin(nx * 12 + phase * 0.8) * 0.5 + 0.5;
  const vWave = Math.sin(ny * 8 - phase * 0.6) * 0.5 + 0.5;
  const crossWave = Math.sin((nx + ny) * 6 + phase * 0.4) * 0.5 + 0.5;
  const lineEnergy = gridLine * (hWave * 0.5 + vWave * 0.3 + crossWave * 0.2);

  const cx = nx - 0.5;
  const cy = (ny - 0.5) * 0.6;
  const dist = Math.sqrt(cx * cx + cy * cy);
  const radialPulse = Math.sin(dist * 10 - phase * 1.5) * 0.3 * (1 - dist);
  const nodePulse = intersectionBoost * (0.6 + Math.sin(phase * 0.7 + col * 0.3 + row * 0.5) * 0.4);
  const ambient = 0.03 + Math.sin(nx * 4 + phase * 0.2) * Math.sin(ny * 3 - phase * 0.15) * 0.03;
  return clamp01(ambient + lineEnergy * 0.6 + nodePulse * 0.5 + Math.max(0, radialPulse) * gridLine);
}

function pickGridGlyph(col: number, row: number, cols: number, rows: number, energy: number): string {
  const onHorizontal = row % spacingY(rows) === 0;
  const onVertical = col % spacingX(cols) === 0;
  if (onHorizontal && onVertical) {
    return energy > 0.6 ? GRID_CHARS.brightNode : energy > 0.3 ? GRID_CHARS.node : GRID_CHARS.intersection;
  }
  if (onHorizontal) {
    return energy > 0.7 ? GRID_CHARS.heavy : energy > 0.4 ? GRID_CHARS.hline : energy > 0.15 ? GRID_CHARS.dot : GRID_CHARS.empty;
  }
  if (onVertical) {
    return energy > 0.7 ? GRID_CHARS.heavy : energy > 0.4 ? GRID_CHARS.vline : energy > 0.15 ? GRID_CHARS.dot : GRID_CHARS.empty;
  }
  return energy > 0.65 ? GRID_CHARS.light : energy > 0.45 ? GRID_CHARS.brightDot : energy > 0.25 ? GRID_CHARS.dot : GRID_CHARS.empty;
}

function paintBackground(surface: ReturnType<typeof createUiSurface>, phase: number): void {
  for (let row = 0; row < surface.rows; row += 1) {
    for (let col = 0; col < surface.cols; col += 1) {
      const energy = gridEnergy(col, row, surface.cols, surface.rows, phase);
      const fg = paletteColor(FG_PALETTE, energy);
      const bg = paletteColor(BG_PALETTE, energy * 0.3);
      const glyph = pickGridGlyph(col, row, surface.cols, surface.rows, energy);
      writeGlyph(surface, row, col, glyph, 1, styleFromColors(fg, bg));
    }
  }
}

function paintOverlayTextRow(
  surface: ReturnType<typeof createUiSurface>,
  row: number,
  text: string,
  phase: number,
): void {
  let col = 0;
  for (const glyph of text) {
    const width = Math.max(0, measureDisplayWidth(glyph));
    if (width === 0) {
      continue;
    }
    if (col >= surface.cols || col + width > surface.cols) {
      break;
    }
    if (glyph !== ' ') {
      const shimmer = clamp01(0.78 + Math.sin(phase * 0.6 + row * 0.17 + col * 0.08) * 0.12);
      const fg: RgbTriplet = [
        Math.round(lerp(160, 245, shimmer)),
        Math.round(lerp(175, 248, shimmer)),
        Math.round(lerp(215, 255, shimmer)),
      ];
      const offset = row * surface.cols + col;
      const background = surface.cells[offset]!.style.bg as Extract<UiStyle['bg'], { kind: 'rgb' }>;
      const bg: RgbTriplet = [background.r, background.g, background.b];
      writeGlyph(surface, row, col, glyph, width, styleFromColors(fg, bg));
    }
    col += width;
  }
}

function paintCenteredLabel(
  surface: ReturnType<typeof createUiSurface>,
  row: number,
  text: string | null,
  phase: number,
): void {
  if (text === null || text.length === 0) {
    return;
  }
  const width = displayWidth(text);
  if (width <= 0 || width > surface.cols) {
    return;
  }
  let col = Math.floor((surface.cols - width) / 2);
  let index = 0;
  for (const glyph of text) {
    const glyphWidth = Math.max(0, measureDisplayWidth(glyph));
    if (glyphWidth === 0) {
      continue;
    }
    const shimmer = clamp01(0.78 + Math.sin(phase * 0.6 + index * 0.25) * 0.12);
    const fg: RgbTriplet = [
      Math.round(lerp(160, 245, shimmer)),
      Math.round(lerp(175, 248, shimmer)),
      Math.round(lerp(215, 255, shimmer)),
    ];
    const bg: RgbTriplet = [
      Math.round(lerp(8, 14, shimmer)),
      Math.round(lerp(6, 11, shimmer)),
      Math.round(lerp(18, 28, shimmer)),
    ];
    writeGlyph(surface, row, col, glyph, glyphWidth, styleFromColors(fg, bg));
    col += glyphWidth;
    index += 1;
  }
}

export function renderHomeGridfireAnsiRows(options: HomeGridfireOptions): readonly string[] {
  const safeCols = Math.max(1, options.cols);
  const safeRows = Math.max(1, options.rows);
  const surface = createUiSurface(safeCols, safeRows);
  const phase = options.timeMs / 1000;

  paintBackground(surface, phase);

  for (let row = 0; row < safeRows; row += 1) {
    const line = options.contentRows[row] ?? '';
    paintOverlayTextRow(surface, row, line, phase);
  }

  const centerRow = Math.floor(safeRows / 2);
  paintCenteredLabel(surface, centerRow, options.overlayTitle, phase);
  paintCenteredLabel(surface, Math.min(safeRows - 1, centerRow + 2), options.overlaySubtitle, phase);

  return renderUiSurfaceAnsiRows(surface);
}
