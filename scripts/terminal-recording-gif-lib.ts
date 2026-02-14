import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type {
  TerminalSnapshotFrame
} from '../src/terminal/snapshot-oracle.ts';
import {
  readTerminalRecording
} from '../src/recording/terminal-recording.ts';

declare class Float16Array extends Uint16Array {
  constructor(length: number);
  constructor(array: ArrayLike<number>);
  constructor(buffer: ArrayBufferLike, byteOffset?: number, length?: number);
  static readonly BYTES_PER_ELEMENT: number;
}

type GifEncPalette = number[][];
type TerminalRecording = ReturnType<typeof readTerminalRecording>;

interface GifEncEncoder {
  writeFrame(
    index: Uint8Array,
    width: number,
    height: number,
    options: {
      palette: GifEncPalette;
      delay: number;
      repeat?: number;
    }
  ): void;
  finish(): void;
  bytesView(): Uint8Array;
}

interface GifEncModule {
  GIFEncoder: () => GifEncEncoder;
  quantize: (rgba: Uint8Array | Uint8ClampedArray, maxColors: number) => GifEncPalette;
  applyPalette: (
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifEncPalette
  ) => Uint8Array;
}

const require = createRequire(import.meta.url);
const gifenc = require('gifenc') as GifEncModule;

type Rgb = readonly [number, number, number];

interface ResolvedTerminalColors {
  readonly foreground: Rgb;
  readonly background: Rgb;
}

interface ColorLookup {
  readonly defaults: {
    foreground: Rgb;
    background: Rgb;
  };
  readonly indexedPalette: Map<number, Rgb>;
}

interface RenderGlyphStyle {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

interface RenderGlyph {
  readonly glyph: string;
  readonly col: number;
  readonly row: number;
  readonly widthCells: number;
  readonly style: RenderGlyphStyle;
  readonly foreground: Rgb;
}

interface RenderCursor {
  readonly row: number;
  readonly col: number;
  readonly shape: 'block' | 'underline' | 'bar';
  readonly color: Rgb;
}

interface RenderPlan {
  readonly cols: number;
  readonly rows: number;
  readonly backgroundCells: Rgb[][];
  readonly glyphs: readonly RenderGlyph[];
  readonly cursor: RenderCursor | null;
}

interface TerminalRecordingGifOptions {
  recordingPath: string;
  outputPath: string;
  cellWidthPx?: number;
  cellHeightPx?: number;
  fontSizePx?: number;
  fontFamily?: string;
  defaultFrameDurationMs?: number;
  maxColors?: number;
  includeCursor?: boolean;
}

interface TerminalRecordingGifResult {
  recordingPath: string;
  outputPath: string;
  width: number;
  height: number;
  frameCount: number;
  bytes: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHexColor(value: string, fallback: Rgb): Rgb {
  const normalized = value.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(normalized)) {
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 16);
  return [
    (parsed >> 16) & 0xff,
    (parsed >> 8) & 0xff,
    parsed & 0xff
  ];
}

function indexedColor(index: number): Rgb {
  if (index < 0 || index > 255) {
    return [0, 0, 0];
  }
  const ansi16: Rgb[] = [
    [0, 0, 0],
    [205, 49, 49],
    [13, 188, 121],
    [229, 229, 16],
    [36, 114, 200],
    [188, 63, 188],
    [17, 168, 205],
    [229, 229, 229],
    [102, 102, 102],
    [241, 76, 76],
    [35, 209, 139],
    [245, 245, 67],
    [59, 142, 234],
    [214, 112, 214],
    [41, 184, 219],
    [255, 255, 255]
  ];
  if (index < ansi16.length) {
    return ansi16[index]!;
  }
  if (index <= 231) {
    const cube = index - 16;
    const red = Math.floor(cube / 36);
    const green = Math.floor((cube % 36) / 6);
    const blue = cube % 6;
    const scale = [0, 95, 135, 175, 215, 255];
    return [scale[red]!, scale[green]!, scale[blue]!];
  }
  const gray = 8 + (index - 232) * 10;
  return [gray, gray, gray];
}

function indexedColorWithPalette(index: number, lookup: ColorLookup): Rgb {
  const paletteValue = lookup.indexedPalette.get(index);
  if (paletteValue !== undefined) {
    return paletteValue;
  }
  return indexedColor(index);
}

function colorToRgb(
  color: TerminalSnapshotFrame['richLines'][number]['cells'][number]['style']['fg'],
  fallback: Rgb,
  lookup: ColorLookup
): Rgb {
  if (color.kind === 'default') {
    return fallback;
  }
  if (color.kind === 'indexed') {
    return indexedColorWithPalette(color.index, lookup);
  }
  return [clampByte(color.r), clampByte(color.g), clampByte(color.b)];
}

function resolveCellColors(
  frame: TerminalSnapshotFrame,
  row: number,
  col: number,
  lookup: ColorLookup
): ResolvedTerminalColors {
  const cell = frame.richLines[row]?.cells[col];
  if (cell === undefined) {
    return {
      foreground: lookup.defaults.foreground,
      background: lookup.defaults.background
    };
  }

  let foreground = colorToRgb(cell.style.fg, lookup.defaults.foreground, lookup);
  let background = colorToRgb(cell.style.bg, lookup.defaults.background, lookup);
  if (cell.style.inverse) {
    const swapped = foreground;
    foreground = background;
    background = swapped;
  }

  return {
    foreground,
    background
  };
}

function createRenderPlan(
  frame: TerminalSnapshotFrame,
  lookup: ColorLookup,
  includeCursor: boolean
): RenderPlan {
  const backgroundCells: Rgb[][] = [];
  const glyphs: RenderGlyph[] = [];

  for (let row = 0; row < frame.rows; row += 1) {
    const rowBackground: Rgb[] = [];
    for (let col = 0; col < frame.cols; col += 1) {
      const resolved = resolveCellColors(frame, row, col, lookup);
      rowBackground.push(resolved.background);

      const cell = frame.richLines[row]?.cells[col];
      if (cell === undefined || cell.continued) {
        continue;
      }
      if (cell.glyph.length === 0 || cell.glyph === ' ') {
        if (cell.style.underline) {
          glyphs.push({
            glyph: '',
            col,
            row,
            widthCells: Math.max(1, cell.width),
            style: {
              bold: cell.style.bold,
              italic: cell.style.italic,
              underline: true
            },
            foreground: resolved.foreground
          });
        }
        continue;
      }

      glyphs.push({
        glyph: cell.glyph,
        col,
        row,
        widthCells: Math.max(1, cell.width),
        style: {
          bold: cell.style.bold,
          italic: cell.style.italic,
          underline: cell.style.underline
        },
        foreground: resolved.foreground
      });
    }
    backgroundCells.push(rowBackground);
  }

  let cursor: RenderCursor | null = null;
  if (
    includeCursor &&
    frame.cursor.visible &&
    frame.cursor.row >= 0 &&
    frame.cursor.row < frame.rows &&
    frame.cursor.col >= 0 &&
    frame.cursor.col < frame.cols
  ) {
    cursor = {
      row: frame.cursor.row,
      col: frame.cursor.col,
      shape: frame.cursor.style.shape,
      color: resolveCellColors(
        frame,
        frame.cursor.row,
        frame.cursor.col,
        lookup
      ).foreground
    };
  }

  return {
    cols: frame.cols,
    rows: frame.rows,
    backgroundCells,
    glyphs,
    cursor
  };
}

function rgbCss(rgb: Rgb): string {
  return `rgb(${String(rgb[0])} ${String(rgb[1])} ${String(rgb[2])})`;
}

function drawCursor(
  ctx: SKRSContext2D,
  cursor: RenderCursor | null,
  cellWidthPx: number,
  cellHeightPx: number
): void {
  if (cursor === null) {
    return;
  }
  const x = cursor.col * cellWidthPx;
  const y = cursor.row * cellHeightPx;
  ctx.fillStyle = rgbCss(cursor.color);
  if (cursor.shape === 'bar') {
    ctx.fillRect(x, y, Math.max(1, Math.floor(cellWidthPx / 6)), cellHeightPx);
    return;
  }
  if (cursor.shape === 'underline') {
    ctx.fillRect(x, y + cellHeightPx - Math.max(1, Math.floor(cellHeightPx / 8)), cellWidthPx, Math.max(1, Math.floor(cellHeightPx / 8)));
    return;
  }
  ctx.globalAlpha = 0.35;
  ctx.fillRect(x, y, cellWidthPx, cellHeightPx);
  ctx.globalAlpha = 1;
}

function renderFrameRgba(
  frame: TerminalSnapshotFrame,
  lookup: ColorLookup,
  cellWidthPx: number,
  cellHeightPx: number,
  fontSizePx: number,
  fontFamily: string,
  includeCursor: boolean
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = frame.cols * cellWidthPx;
  const height = frame.rows * cellHeightPx;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const renderPlan = createRenderPlan(frame, lookup, includeCursor);

  for (let row = 0; row < renderPlan.rows; row += 1) {
    for (let col = 0; col < renderPlan.cols; col += 1) {
      const color = renderPlan.backgroundCells[row]?.[col] ?? lookup.defaults.background;
      ctx.fillStyle = rgbCss(color);
      ctx.fillRect(col * cellWidthPx, row * cellHeightPx, cellWidthPx, cellHeightPx);
    }
  }

  const textYOffset = Math.max(0, Math.floor((cellHeightPx - fontSizePx) / 2));
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (const glyph of renderPlan.glyphs) {
    const x = glyph.col * cellWidthPx;
    const y = glyph.row * cellHeightPx;
    const fontParts: string[] = [];
    if (glyph.style.italic) {
      fontParts.push('italic');
    }
    if (glyph.style.bold) {
      fontParts.push('700');
    }
    fontParts.push(`${String(fontSizePx)}px`);
    fontParts.push(fontFamily);
    ctx.font = fontParts.join(' ');
    ctx.fillStyle = rgbCss(glyph.foreground);
    if (glyph.glyph.length > 0) {
      ctx.fillText(glyph.glyph, x, y + textYOffset, glyph.widthCells * cellWidthPx);
    }
    if (glyph.style.underline) {
      const underlineHeight = Math.max(1, Math.floor(cellHeightPx / 12));
      ctx.fillRect(
        x,
        y + cellHeightPx - underlineHeight,
        glyph.widthCells * cellWidthPx,
        underlineHeight
      );
    }
  }

  drawCursor(ctx, renderPlan.cursor, cellWidthPx, cellHeightPx);
  const imageData = ctx.getImageData(0, 0, width, height);
  return {
    rgba: imageData.data,
    width,
    height
  };
}

function frameDelayMs(
  recording: TerminalRecording,
  index: number,
  defaultFrameDurationMs: number
): number {
  const current = recording.frames[index];
  if (current === undefined) {
    return defaultFrameDurationMs;
  }
  const next = recording.frames[index + 1];
  if (next === undefined) {
    if (recording.finishedAtMs !== null) {
      const finalDelta = Math.round(recording.finishedAtMs - current.atMs);
      if (Number.isFinite(finalDelta) && finalDelta > 0) {
        return Math.max(10, finalDelta);
      }
    }
    return defaultFrameDurationMs;
  }
  const delta = Math.round(next.atMs - current.atMs);
  if (!Number.isFinite(delta) || delta <= 0) {
    return defaultFrameDurationMs;
  }
  return Math.max(10, delta);
}

function buildFrameDelaysMs(
  recording: TerminalRecording,
  defaultFrameDurationMs: number
): number[] {
  const delaysMs = recording.frames.map((_, idx) => frameDelayMs(recording, idx, defaultFrameDurationMs));
  const normalizedDelaysMs: number[] = [];
  let remainderMs = 0;

  for (const delayMs of delaysMs) {
    const correctedMs = delayMs + remainderMs;
    const roundedMs = Math.max(10, Math.round(correctedMs));
    normalizedDelaysMs.push(roundedMs);
    remainderMs = correctedMs - roundedMs;
  }

  return normalizedDelaysMs;
}

function parseIndexedPalette(
  recording: TerminalRecording,
  defaultForeground: Rgb,
  defaultBackground: Rgb
): Map<number, Rgb> {
  const palette = new Map<number, Rgb>();
  const source = recording.header.ansiPaletteIndexedHex;
  if (source !== undefined) {
    for (const [key, value] of Object.entries(source)) {
      const parsedKey = Number.parseInt(key, 10);
      if (!Number.isInteger(parsedKey) || parsedKey < 0 || parsedKey > 255) {
        continue;
      }
      const fallback = parsedKey === 0 ? defaultBackground : defaultForeground;
      palette.set(parsedKey, parseHexColor(value, fallback));
    }
  }
  return palette;
}

export function renderTerminalRecordingToGif(
  options: TerminalRecordingGifOptions
): Promise<TerminalRecordingGifResult> {
  const recording = readTerminalRecording(options.recordingPath);
  if (recording.frames.length === 0) {
    throw new Error('recording does not contain any frames');
  }

  const cellWidthPx = Math.max(4, Math.floor(options.cellWidthPx ?? 9));
  const cellHeightPx = Math.max(8, Math.floor(options.cellHeightPx ?? 18));
  const fontSizePx = Math.max(6, Math.floor(options.fontSizePx ?? 14));
  const fontFamily = options.fontFamily ?? 'Menlo, SF Mono, Monaco, monospace';
  const defaultFrameDurationMs = Math.max(10, Math.floor(options.defaultFrameDurationMs ?? 66));
  const maxColors = Math.max(2, Math.min(256, Math.floor(options.maxColors ?? 256)));
  const includeCursor = options.includeCursor ?? true;

  const defaultForeground = parseHexColor(recording.header.defaultForegroundHex, [208, 215, 222]);
  const defaultBackground = parseHexColor(recording.header.defaultBackgroundHex, [15, 20, 25]);
  const colorLookup: ColorLookup = {
    defaults: {
      foreground: defaultForeground,
      background: defaultBackground
    },
    indexedPalette: parseIndexedPalette(recording, defaultForeground, defaultBackground)
  };
  const delaysMs = buildFrameDelaysMs(recording, defaultFrameDurationMs);
  const gif = gifenc.GIFEncoder();

  let width = 0;
  let height = 0;

  for (let idx = 0; idx < recording.frames.length; idx += 1) {
    const sample = recording.frames[idx]!;
    const rendered = renderFrameRgba(
      sample.frame,
      colorLookup,
      cellWidthPx,
      cellHeightPx,
      fontSizePx,
      fontFamily,
      includeCursor
    );
    if (idx === 0) {
      width = rendered.width;
      height = rendered.height;
    }
    const palette = gifenc.quantize(rendered.rgba, maxColors);
    const bitmap = gifenc.applyPalette(rendered.rgba, palette);
    const frameOptions: {
      palette: GifEncPalette;
      delay: number;
      repeat?: number;
    } = {
      palette,
      delay: delaysMs[idx] ?? Math.max(10, Math.round(defaultFrameDurationMs))
    };
    if (idx === 0) {
      frameOptions.repeat = 0;
    }
    gif.writeFrame(bitmap, rendered.width, rendered.height, frameOptions);
  }

  gif.finish();
  const bytes = Buffer.from(gif.bytesView());
  writeFileSync(options.outputPath, bytes);

  return Promise.resolve({
    recordingPath: options.recordingPath,
    outputPath: options.outputPath,
    width,
    height,
    frameCount: recording.frames.length,
    bytes: bytes.byteLength
  });
}

export const __terminalGifInternals = {
  indexedColor,
  indexedColorWithPalette,
  parseHexColor,
  frameDelayMs,
  buildFrameDelaysMs,
  parseIndexedPalette,
  createRenderPlan,
  renderFrameRgba
};
