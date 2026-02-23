import { CellBuffer } from '../core/cell-buffer.ts';
import type { FrameBuffer } from '../core/frame-buffer.ts';
import { type FrameDiff } from '../core/frame-buffer.ts';
import { DEFAULT_CELL_STYLE, type CellStyle } from '../core/color.ts';
import type { Widget } from './widget.ts';
import { computeLayout } from './layout.ts';

export interface RenderResult {
  readonly buffer: CellBuffer;
  readonly rows: readonly string[];
}

export interface IncrementalRenderResult {
  readonly frameBuffer: FrameBuffer;
  readonly diff: FrameDiff;
  readonly rows: readonly string[];
  readonly changedRows: readonly { row: number; ansi: string }[];
}

interface RenderableEntry {
  widget: Widget;
  zIndex: number;
  depth: number;
}

function collectVisible(widget: Widget, depth: number, out: RenderableEntry[]): void {
  if (!widget.visible) return;
  out.push({ widget, zIndex: widget.zIndex, depth });
  if (widget.manualChildRendering) return;
  for (const child of widget.children) {
    collectVisible(child, depth + 1, out);
  }
}

function stableZSort(entries: RenderableEntry[]): void {
  entries.sort((a, b) => {
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.depth - b.depth;
  });
}

function renderIntoBuffer(root: Widget, buffer: CellBuffer, cols: number, rows: number): void {
  computeLayout(root, cols, rows);

  const entries: RenderableEntry[] = [];
  collectVisible(root, 0, entries);
  stableZSort(entries);

  for (const entry of entries) {
    const rect = entry.widget.absoluteRect;
    if (rect.width <= 0 || rect.height <= 0) continue;

    const clipped = buffer.clip({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });

    entry.widget.render(clipped);
  }
}

export function renderWidgetTree(
  root: Widget,
  cols: number,
  rows: number,
  baseStyle: CellStyle = DEFAULT_CELL_STYLE,
): RenderResult {
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));

  const buffer = new CellBuffer(safeCols, safeRows, baseStyle);
  renderIntoBuffer(root, buffer, safeCols, safeRows);

  const ansiRows = buffer.renderAnsiRows();
  return { buffer, rows: ansiRows };
}

export function renderWidgetTreeIncremental(
  root: Widget,
  frameBuffer: FrameBuffer,
  cols: number,
  rows: number,
  baseStyle: CellStyle = DEFAULT_CELL_STYLE,
): IncrementalRenderResult {
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));

  if (frameBuffer.cols !== safeCols || frameBuffer.rows !== safeRows) {
    frameBuffer.resize(safeCols, safeRows, baseStyle);
  }

  frameBuffer.clearBackBuffer(baseStyle);
  renderIntoBuffer(root, frameBuffer.buffer, safeCols, safeRows);

  const diff = frameBuffer.commit();
  const changedRows = frameBuffer.renderChangedAnsiRows();
  const rows_ = frameBuffer.renderAnsiRows();

  return {
    frameBuffer,
    diff,
    rows: rows_,
    changedRows,
  };
}
