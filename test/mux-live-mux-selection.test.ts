import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalSnapshotFrameCore } from '../src/terminal/snapshot-oracle.ts';
import {
  clampPanePoint,
  compareSelectionPoints,
  hasAltModifier,
  isCopyShortcutInput,
  isLeftButtonPress,
  isMotionMouseCode,
  isMouseRelease,
  isSelectionDrag,
  isWheelMouseCode,
  mergeUniqueRows,
  normalizeSelection,
  pointFromMouseEvent,
  renderSelectionOverlay,
  selectionPointsEqual,
  selectionText,
  selectionVisibleRows,
  writeTextToClipboard,
  type PaneSelection,
  type SelectionLayout
} from '../src/mux/live-mux/selection.ts';

function patchProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  Object.defineProperty(obj, key, {
    configurable: true,
    writable: true,
    value
  });
  return () => {
    if (descriptor === undefined) {
      delete (obj as Record<string, unknown>)[key as string];
      return;
    }
    Object.defineProperty(obj, key, descriptor);
  };
}

function frameFromRows(rows: readonly string[], top = 0): TerminalSnapshotFrameCore {
  const richLines = rows.map((row) => ({
    cells: row.split('').map((glyph) => ({
      glyph,
      continued: false
    }))
  }));
  const cols = rows.length > 0 ? rows[0]!.length : 0;
  return {
    rows: rows.length,
    cols,
    viewport: {
      top,
      totalRows: top + rows.length
    },
    richLines
  } as unknown as TerminalSnapshotFrameCore;
}

void test('selection point compare/normalize helpers preserve ordering semantics', () => {
  const a = { rowAbs: 10, col: 5 };
  const b = { rowAbs: 11, col: 1 };
  const c = { rowAbs: 10, col: 7 };

  assert.equal(compareSelectionPoints(a, b) < 0, true);
  assert.equal(compareSelectionPoints(c, a) > 0, true);
  assert.equal(selectionPointsEqual(a, { rowAbs: 10, col: 5 }), true);
  assert.equal(selectionPointsEqual(a, b), false);

  const normalizedForward = normalizeSelection({ anchor: a, focus: c, text: '' });
  assert.deepEqual(normalizedForward, { start: a, end: c });

  const normalizedReverse = normalizeSelection({ anchor: c, focus: a, text: '' });
  assert.deepEqual(normalizedReverse, { start: a, end: c });
});

void test('pane point and mouse helpers clamp coordinates and decode button flags', () => {
  const layout: SelectionLayout = {
    paneRows: 3,
    rightCols: 4,
    rightStartCol: 6
  };
  const frame = {
    viewport: {
      top: 10,
      totalRows: 12
    }
  } as Pick<TerminalSnapshotFrameCore, 'viewport'>;

  assert.deepEqual(clampPanePoint(layout, frame, -5, -4), { rowAbs: 0, col: 0 });
  assert.deepEqual(clampPanePoint(layout, frame, 20, 10), { rowAbs: 11, col: 3 });

  assert.deepEqual(pointFromMouseEvent(layout, frame, { row: 0, col: 2 }), { rowAbs: 10, col: 0 });
  assert.deepEqual(pointFromMouseEvent(layout, frame, { row: 99, col: 40 }), { rowAbs: 11, col: 3 });

  assert.equal(isWheelMouseCode(0b0100_0000), true);
  assert.equal(isWheelMouseCode(0), false);
  assert.equal(isMotionMouseCode(0b0010_0000), true);
  assert.equal(isMotionMouseCode(0), false);
  assert.equal(hasAltModifier(0b0000_1000), true);
  assert.equal(hasAltModifier(0), false);

  assert.equal(isLeftButtonPress(0, 'M'), true);
  assert.equal(isLeftButtonPress(0b0000_0001, 'M'), false);
  assert.equal(isLeftButtonPress(0b0100_0000, 'M'), false);
  assert.equal(isLeftButtonPress(0, 'm'), false);

  assert.equal(isMouseRelease('m'), true);
  assert.equal(isMouseRelease('M'), false);
  assert.equal(isSelectionDrag(0b0010_0000, 'M'), true);
  assert.equal(isSelectionDrag(0, 'M'), false);
  assert.equal(isSelectionDrag(0b0010_0000, 'm'), false);
});

void test('overlay and visible row helpers render only visible cells and skip invalid ranges', () => {
  const layout: SelectionLayout = {
    paneRows: 3,
    rightCols: 4,
    rightStartCol: 10
  };

  const frameWithSparseCells = {
    rows: 3,
    cols: 4,
    viewport: {
      top: 10,
      totalRows: 20
    },
    richLines: [
      {
        cells: [
          { glyph: 'A', continued: false },
          { glyph: '', continued: false },
          { glyph: 'B', continued: true }
        ]
      },
      {
        cells: []
      }
    ]
  } as unknown as TerminalSnapshotFrameCore;

  const selection: PaneSelection = {
    anchor: { rowAbs: 10, col: 0 },
    focus: { rowAbs: 12, col: 2 },
    text: ''
  };

  const overlay = renderSelectionOverlay(layout, frameWithSparseCells, selection);
  assert.equal(overlay.includes('\u001b[1;10H\u001b[7mA  '), true);
  assert.equal(overlay.includes('\u001b[2;10H\u001b[7m    '), true);
  assert.equal(overlay.includes('\u001b[3;10H\u001b[7m   '), true);

  assert.deepEqual(selectionVisibleRows(frameWithSparseCells, selection), [0, 1, 2]);
  assert.equal(renderSelectionOverlay(layout, frameWithSparseCells, null), '');
  assert.deepEqual(selectionVisibleRows(frameWithSparseCells, null), []);

  const offscreenSelection: PaneSelection = {
    anchor: { rowAbs: 30, col: 0 },
    focus: { rowAbs: 31, col: 1 },
    text: ''
  };
  assert.equal(renderSelectionOverlay(layout, frameWithSparseCells, offscreenSelection), '');
  assert.deepEqual(selectionVisibleRows(frameWithSparseCells, offscreenSelection), []);

  const zeroWidthFrame = {
    rows: 2,
    cols: 0,
    viewport: {
      top: 5,
      totalRows: 7
    },
    richLines: [
      {
        cells: []
      },
      {
        cells: []
      }
    ]
  } as unknown as TerminalSnapshotFrameCore;
  const zeroWidthSelection: PaneSelection = {
    anchor: { rowAbs: 5, col: 0 },
    focus: { rowAbs: 6, col: 0 },
    text: ''
  };
  assert.equal(renderSelectionOverlay(layout, zeroWidthFrame, zeroWidthSelection), '\u001b[2;10H\u001b[7m \u001b[0m');
});

void test('selectionText and row merge helpers preserve explicit text and visible extraction', () => {
  const frame = frameFromRows(['abcd', 'efgh', 'ijkl'], 10);
  const selection: PaneSelection = {
    anchor: { rowAbs: 10, col: 1 },
    focus: { rowAbs: 11, col: 2 },
    text: ''
  };
  assert.equal(selectionText(frame, selection), 'bcd\nefg');

  assert.equal(
    selectionText(frame, {
      anchor: { rowAbs: 10, col: 0 },
      focus: { rowAbs: 10, col: 1 },
      text: 'explicit-copy'
    }),
    'explicit-copy'
  );
  assert.equal(selectionText(frame, null), '');

  const sparseFrame = {
    rows: 1,
    cols: 4,
    viewport: {
      top: 0,
      totalRows: 1
    },
    richLines: [
      {
        cells: [
          { glyph: 'x', continued: false },
          { glyph: 'y', continued: true }
        ]
      }
    ]
  } as unknown as TerminalSnapshotFrameCore;
  assert.equal(
    selectionText(sparseFrame, {
      anchor: { rowAbs: 0, col: 0 },
      focus: { rowAbs: 0, col: 3 },
      text: ''
    }),
    'x'
  );

  const zeroWidthFrame = {
    rows: 2,
    cols: 0,
    viewport: {
      top: 0,
      totalRows: 2
    },
    richLines: [
      {
        cells: []
      },
      {
        cells: []
      }
    ]
  } as unknown as TerminalSnapshotFrameCore;
  assert.equal(
    selectionText(zeroWidthFrame, {
      anchor: { rowAbs: 0, col: 0 },
      focus: { rowAbs: 1, col: 0 },
      text: ''
    }),
    '\n'
  );

  assert.deepEqual(mergeUniqueRows([], [2, 1]), [2, 1]);
  assert.deepEqual(mergeUniqueRows([3, 1], []), [3, 1]);
  assert.deepEqual(mergeUniqueRows([3, 1], [2, 1]), [1, 2, 3]);
});

void test('copy shortcut detection and clipboard writing support positive and negative branches', () => {
  assert.equal(isCopyShortcutInput(Buffer.from([0x03])), true);
  assert.equal(isCopyShortcutInput(Buffer.from('\u001b[99;55u', 'utf8')), true);
  assert.equal(isCopyShortcutInput(Buffer.from('\u001b[67;12u', 'utf8')), true);
  assert.equal(isCopyShortcutInput(Buffer.from('\u001b[99;u', 'utf8')), false);
  assert.equal(isCopyShortcutInput(Buffer.from('plain text', 'utf8')), false);

  const writes: string[] = [];
  assert.equal(
    writeTextToClipboard('hello', (payload) => {
      writes.push(payload);
      return true;
    }),
    true
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.startsWith('\u001b]52;c;'), true);
  assert.equal(writeTextToClipboard('', () => true), false);
  assert.equal(
    writeTextToClipboard('boom', () => {
      throw new Error('nope');
    }),
    false
  );

  const restoreWrite = patchProperty(process.stdout, 'write', ((payload: string) => {
    writes.push(payload);
    return true;
  }) as typeof process.stdout.write);
  try {
    assert.equal(writeTextToClipboard('default-writer'), true);
  } finally {
    restoreWrite();
  }
});
