import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import {
  TextSelectionState,
  comparePoints,
  normalizeRange,
  isEmptySelection,
  extractSelectedText,
  applySelectionHighlight,
  wordBoundaries,
  selectWord,
} from '../../packages/harness-ui/src/widgets/text-selection.ts';
import { CellBuffer } from '../../packages/harness-ui/src/core/cell-buffer.ts';
import { DEFAULT_CELL_STYLE } from '../../packages/harness-ui/src/core/color.ts';

beforeEach(() => {
  resetAutoIdCounter();
});

describe('comparePoints', () => {
  test('same point returns 0', () => {
    assert.equal(comparePoints({ row: 1, col: 5 }, { row: 1, col: 5 }), 0);
  });

  test('earlier row is less', () => {
    assert.ok(comparePoints({ row: 0, col: 5 }, { row: 1, col: 0 }) < 0);
  });

  test('same row, earlier col is less', () => {
    assert.ok(comparePoints({ row: 1, col: 2 }, { row: 1, col: 5 }) < 0);
  });
});

describe('normalizeRange', () => {
  test('already normalized stays same', () => {
    const r = normalizeRange({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 5 } });
    assert.deepEqual(r.start, { row: 0, col: 0 });
    assert.deepEqual(r.end, { row: 1, col: 5 });
  });

  test('reversed gets normalized', () => {
    const r = normalizeRange({ anchor: { row: 1, col: 5 }, focus: { row: 0, col: 0 } });
    assert.deepEqual(r.start, { row: 0, col: 0 });
    assert.deepEqual(r.end, { row: 1, col: 5 });
  });
});

describe('isEmptySelection', () => {
  test('same point is empty', () => {
    assert.equal(isEmptySelection({ anchor: { row: 1, col: 3 }, focus: { row: 1, col: 3 } }), true);
  });

  test('different points is not empty', () => {
    assert.equal(
      isEmptySelection({ anchor: { row: 1, col: 3 }, focus: { row: 1, col: 5 } }),
      false,
    );
  });
});

describe('extractSelectedText', () => {
  const lines = ['hello world', 'foo bar baz', 'last line'];
  const getRow = (r: number) => lines[r] ?? '';

  test('single line selection', () => {
    const text = extractSelectedText(
      { anchor: { row: 0, col: 6 }, focus: { row: 0, col: 11 } },
      getRow,
      3,
    );
    assert.equal(text, 'world');
  });

  test('multi-line selection', () => {
    const text = extractSelectedText(
      { anchor: { row: 0, col: 6 }, focus: { row: 1, col: 3 } },
      getRow,
      3,
    );
    assert.equal(text, 'world\nfoo');
  });

  test('full lines selection', () => {
    const text = extractSelectedText(
      { anchor: { row: 0, col: 0 }, focus: { row: 2, col: 9 } },
      getRow,
      3,
    );
    assert.equal(text, 'hello world\nfoo bar baz\nlast line');
  });

  test('reversed range normalizes', () => {
    const text = extractSelectedText(
      { anchor: { row: 0, col: 11 }, focus: { row: 0, col: 6 } },
      getRow,
      3,
    );
    assert.equal(text, 'world');
  });
});

describe('applySelectionHighlight', () => {
  test('highlights cells in range', () => {
    const buf = new CellBuffer(10, 3);
    buf.drawText(0, 0, 'hello', DEFAULT_CELL_STYLE);
    buf.drawText(0, 1, 'world', DEFAULT_CELL_STYLE);

    applySelectionHighlight(buf, { anchor: { row: 0, col: 2 }, focus: { row: 0, col: 5 } });

    const highlighted = buf.getCell(2, 0)!;
    assert.equal(highlighted.style.bg.kind, 'indexed');
    const unhighlighted = buf.getCell(0, 0)!;
    assert.equal(unhighlighted.style.bg.kind, 'default');
  });

  test('multi-line highlight', () => {
    const buf = new CellBuffer(10, 3);
    buf.drawText(0, 0, 'aaaaaaaaaa', DEFAULT_CELL_STYLE);
    buf.drawText(0, 1, 'bbbbbbbbbb', DEFAULT_CELL_STYLE);

    applySelectionHighlight(buf, { anchor: { row: 0, col: 5 }, focus: { row: 1, col: 3 } });

    assert.equal(buf.getCell(5, 0)!.style.bg.kind, 'indexed');
    assert.equal(buf.getCell(9, 0)!.style.bg.kind, 'indexed');
    assert.equal(buf.getCell(0, 1)!.style.bg.kind, 'indexed');
    assert.equal(buf.getCell(2, 1)!.style.bg.kind, 'indexed');
    assert.equal(buf.getCell(3, 1)!.style.bg.kind, 'default');
  });

  test('viewport offset shifts rows', () => {
    const buf = new CellBuffer(10, 3);
    buf.drawText(0, 0, 'visible', DEFAULT_CELL_STYLE);

    applySelectionHighlight(
      buf,
      { anchor: { row: 5, col: 0 }, focus: { row: 5, col: 5 } },
      undefined,
      5,
    );
    assert.equal(buf.getCell(0, 0)!.style.bg.kind, 'indexed');
  });
});

describe('TextSelectionState', () => {
  test('starts inactive', () => {
    const s = new TextSelectionState();
    assert.equal(s.active, false);
    assert.equal(s.isEmpty, true);
    assert.equal(s.range, null);
  });

  test('startDrag activates', () => {
    const s = new TextSelectionState();
    s.startDrag({ row: 1, col: 5 });
    assert.equal(s.active, true);
    assert.deepEqual(s.anchor, { row: 1, col: 5 });
  });

  test('updateDrag moves focus', () => {
    const s = new TextSelectionState();
    s.startDrag({ row: 0, col: 0 });
    s.updateDrag({ row: 1, col: 10 });
    assert.deepEqual(s.focus, { row: 1, col: 10 });
    assert.equal(s.hasDragged, true);
  });

  test('endDrag returns range if dragged', () => {
    const s = new TextSelectionState();
    s.startDrag({ row: 0, col: 0 });
    s.updateDrag({ row: 1, col: 5 });
    const range = s.endDrag({ row: 1, col: 5 });
    assert.notEqual(range, null);
    assert.deepEqual(range!.anchor, { row: 0, col: 0 });
    assert.deepEqual(range!.focus, { row: 1, col: 5 });
  });

  test('endDrag without movement returns null and clears', () => {
    const s = new TextSelectionState();
    s.startDrag({ row: 1, col: 3 });
    const range = s.endDrag({ row: 1, col: 3 });
    assert.equal(range, null);
    assert.equal(s.active, false);
  });

  test('clear resets state', () => {
    const s = new TextSelectionState();
    s.startDrag({ row: 0, col: 0 });
    s.updateDrag({ row: 2, col: 10 });
    s.clear();
    assert.equal(s.active, false);
    assert.equal(s.isEmpty, true);
  });

  test('selectedText extracts from range', () => {
    const lines = ['hello world', 'foo bar'];
    const s = new TextSelectionState();
    s.startDrag({ row: 0, col: 6 });
    s.updateDrag({ row: 0, col: 11 });
    const text = s.selectedText((r) => lines[r] ?? '', 2);
    assert.equal(text, 'world');
  });
});

describe('wordBoundaries', () => {
  test('finds word boundaries', () => {
    const { start, end } = wordBoundaries('hello world', 2);
    assert.equal(start, 0);
    assert.equal(end, 5);
  });

  test('second word', () => {
    const { start, end } = wordBoundaries('hello world', 8);
    assert.equal(start, 6);
    assert.equal(end, 11);
  });

  test('on space between words', () => {
    const { start, end } = wordBoundaries('hello world', 5);
    assert.equal(start, 5);
    assert.equal(end, 5);
  });

  test('out of bounds returns col', () => {
    const { start, end } = wordBoundaries('hello', 10);
    assert.equal(start, 10);
    assert.equal(end, 10);
  });
});

describe('selectWord', () => {
  test('returns range for word at position', () => {
    const range = selectWord('hello world', 2, 0);
    assert.deepEqual(range.anchor, { row: 0, col: 0 });
    assert.deepEqual(range.focus, { row: 0, col: 5 });
  });
});
