import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { computeDualPaneLayoutWithLayers } from '../../../packages/harness-ui/src/layout.ts';

test('ui layout computes dual-pane geometry with status row and base layers', () => {
  const layout = computeDualPaneLayoutWithLayers(100, 30);
  assert.equal(layout.cols, 100);
  assert.equal(layout.rows, 30);
  assert.equal(layout.paneRows, 29);
  assert.equal(layout.statusRow, 30);
  assert.equal(layout.leftPane.cols + layout.separator.cols + layout.rightPane.cols, 100);
  assert.equal(
    layout.layers.some((layer) => layer.id === 'left-pane'),
    true,
  );
  assert.equal(
    layout.layers.some((layer) => layer.id === 'right-pane'),
    true,
  );
  assert.equal(
    layout.layers.some((layer) => layer.id === 'status'),
    true,
  );
});

test('ui layout overlays anchor to right pane and clip against viewport by default', () => {
  const layout = computeDualPaneLayoutWithLayers(80, 20, {
    overlays: [
      {
        id: 'command-menu',
        anchor: 'right-pane',
        col: 1,
        row: 1,
        cols: 200,
        rows: 40,
      },
    ],
  });

  const overlay = layout.layers.find((layer) => layer.id === 'command-menu');
  assert.notEqual(overlay, undefined);
  assert.equal(overlay?.kind, 'overlay');
  if (overlay === undefined) {
    return;
  }
  assert.equal(overlay.rect.col >= layout.rightPane.col, true);
  assert.equal(overlay.rect.row >= layout.rightPane.row, true);
  assert.equal(
    overlay.rect.col + overlay.rect.cols - 1 <= layout.viewport.col + layout.viewport.cols - 1,
    true,
  );
  assert.equal(
    overlay.rect.row + overlay.rect.rows - 1 <= layout.viewport.row + layout.viewport.rows - 1,
    true,
  );
});

test('ui layout preserves overlay geometry when clipping is disabled and sorts by z-index', () => {
  const layout = computeDualPaneLayoutWithLayers(60, 18, {
    overlays: [
      {
        id: 'overlay-high',
        col: 50,
        row: 10,
        cols: 30,
        rows: 12,
        zIndex: 300,
        clipToViewport: false,
      },
      {
        id: 'overlay-low',
        col: 2,
        row: 2,
        cols: 10,
        rows: 3,
        zIndex: 200,
      },
    ],
  });

  const overlayHigh = layout.layers.find((layer) => layer.id === 'overlay-high');
  const overlayLow = layout.layers.find((layer) => layer.id === 'overlay-low');
  assert.notEqual(overlayHigh, undefined);
  assert.notEqual(overlayLow, undefined);
  if (overlayHigh === undefined || overlayLow === undefined) {
    return;
  }
  assert.deepEqual(overlayHigh?.rect, {
    col: 50,
    row: 10,
    cols: 30,
    rows: 12,
  });
  assert.equal(layout.layers.indexOf(overlayLow), layout.layers.indexOf(overlayHigh) - 1);
});

test('ui layout enforces minimum pane widths when viewport is wide enough', () => {
  const layout = computeDualPaneLayoutWithLayers(120, 24, {
    leftCols: 3,
  });
  assert.equal(layout.leftCols >= 28, true);
  assert.equal(layout.rightCols >= 20, true);
});

test('ui layout normalizes non-finite inputs and drops fully clipped overlays', () => {
  const normalized = computeDualPaneLayoutWithLayers(Number.NaN, Number.POSITIVE_INFINITY, {
    leftCols: 10_000,
    paneWidthPercent: Number.NaN,
    statusRows: Number.NaN,
    overlays: [
      {
        id: 'left-anchor',
        anchor: 'left-pane',
        col: 1,
        row: 1,
        cols: 2,
        rows: 1,
      },
      {
        id: 'status-anchor',
        anchor: 'status',
        col: 1,
        row: 1,
        cols: 2,
        rows: 1,
      },
      {
        id: 'clipped-away',
        col: 99,
        row: 99,
        cols: 3,
        rows: 2,
      },
    ],
  });
  assert.equal(normalized.cols, 3);
  assert.equal(normalized.rows >= 2, true);
  assert.equal(normalized.leftCols, 1);
  assert.equal(
    normalized.layers.some((layer) => layer.id === 'left-anchor'),
    true,
  );
  assert.equal(
    normalized.layers.some((layer) => layer.id === 'status-anchor'),
    true,
  );
  assert.equal(
    normalized.layers.some((layer) => layer.id === 'clipped-away'),
    false,
  );

  const clampedLow = computeDualPaneLayoutWithLayers(80, 20, {
    leftCols: -500,
  });
  assert.equal(clampedLow.leftCols >= 1, true);
});
