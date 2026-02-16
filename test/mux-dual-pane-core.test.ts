import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  EventPaneViewport,
  classifyPaneAt,
  computeDualPaneLayout,
  diffRenderedRows,
  padOrTrimDisplay,
  parseMuxInputChunk,
  routeMuxInputTokens,
  wheelDeltaRowsFromCode
} from '../src/mux/dual-pane-core.ts';

void test('computeDualPaneLayout normalizes dimensions and computes pane widths', () => {
  const wide = computeDualPaneLayout(120, 40);
  assert.equal(wide.cols, 120);
  assert.equal(wide.rows, 40);
  assert.equal(wide.paneRows, 39);
  assert.equal(wide.statusRow, 40);
  assert.equal(wide.leftCols, 36);
  assert.equal(wide.rightCols, 83);
  assert.equal(wide.separatorCol, 37);
  assert.equal(wide.rightStartCol, 38);

  const tiny = computeDualPaneLayout(2, 1);
  assert.equal(tiny.cols, 3);
  assert.equal(tiny.rows, 2);
  assert.equal(tiny.leftCols, 1);
  assert.equal(tiny.rightCols, 1);

  const narrow = computeDualPaneLayout(30, 6);
  assert.equal(narrow.leftCols > 0, true);
  assert.equal(narrow.rightCols > 0, true);
  assert.equal(narrow.leftCols + narrow.rightCols + 1, narrow.cols);

  const customWide = computeDualPaneLayout(120, 40, {
    leftCols: 50
  });
  assert.equal(customWide.leftCols, 50);
  assert.equal(customWide.rightCols, 69);

  const customWideTooSmall = computeDualPaneLayout(120, 40, {
    leftCols: 5
  });
  assert.equal(customWideTooSmall.leftCols, 28);

  const customWideTooLarge = computeDualPaneLayout(120, 40, {
    leftCols: 500
  });
  assert.equal(customWideTooLarge.rightCols, 20);

  const customNarrow = computeDualPaneLayout(30, 6, {
    leftCols: 500
  });
  assert.equal(customNarrow.leftCols, 28);
  assert.equal(customNarrow.rightCols, 1);
});

void test('classifyPaneAt maps terminal coordinates into pane regions', () => {
  const layout = computeDualPaneLayout(100, 20);
  assert.equal(classifyPaneAt(layout, 1, 1), 'left');
  assert.equal(classifyPaneAt(layout, layout.leftCols, layout.paneRows), 'left');
  assert.equal(classifyPaneAt(layout, layout.separatorCol, 2), 'separator');
  assert.equal(classifyPaneAt(layout, layout.rightStartCol, 2), 'right');
  assert.equal(classifyPaneAt(layout, 5, layout.statusRow), 'status');
  assert.equal(classifyPaneAt(layout, 0, 1), 'outside');
  assert.equal(classifyPaneAt(layout, 1, layout.rows + 1), 'outside');
});

void test('parseMuxInputChunk tokenizes SGR mouse sequences and keeps partial tails', () => {
  const parsed = parseMuxInputChunk('', Buffer.from(`abc\u001b[<64;77;3Mdef`, 'utf8'));
  assert.equal(parsed.remainder, '');
  assert.equal(parsed.tokens.length, 3);
  const firstToken = parsed.tokens[0];
  assert.notEqual(firstToken, undefined);
  if (firstToken?.kind !== 'passthrough') {
    assert.fail('expected first token to be passthrough');
  }
  assert.equal(firstToken.text, 'abc');

  const mouseToken = parsed.tokens[1];
  assert.notEqual(mouseToken, undefined);
  if (mouseToken?.kind !== 'mouse') {
    assert.fail('expected second token to be mouse');
  }
  assert.equal(mouseToken.event.code, 64);
  assert.equal(mouseToken.event.col, 77);
  assert.equal(mouseToken.event.row, 3);
  assert.equal(mouseToken.event.final, 'M');

  const partialA = parseMuxInputChunk('', Buffer.from('\u001b[<65;12;', 'utf8'));
  assert.equal(partialA.tokens.length, 0);
  assert.equal(partialA.remainder, '\u001b[<65;12;');

  const partialB = parseMuxInputChunk(partialA.remainder, Buffer.from('4mZ', 'utf8'));
  assert.equal(partialB.remainder, '');
  assert.equal(partialB.tokens.length, 2);
  const completedMouse = partialB.tokens[0];
  assert.notEqual(completedMouse, undefined);
  if (completedMouse?.kind !== 'mouse') {
    assert.fail('expected completed mouse token');
  }
  assert.equal(completedMouse.event.final, 'm');

  const malformedTail = parseMuxInputChunk('', Buffer.from(`x\u001b[<oops`, 'utf8'));
  assert.equal(malformedTail.remainder, '');
  assert.equal(malformedTail.tokens.length, 2);
  const mergedMalformed = malformedTail.tokens
    .filter((token) => token.kind === 'passthrough')
    .map((token) => token.text)
    .join('');
  assert.equal(mergedMalformed, `x\u001b[<oops`);

  const malformedSgrBody = parseMuxInputChunk('', Buffer.from('\u001b[<;;;M', 'utf8'));
  assert.equal(malformedSgrBody.remainder, '');
  assert.equal(malformedSgrBody.tokens.length, 1);
  const malformedBodyToken = malformedSgrBody.tokens[0];
  assert.notEqual(malformedBodyToken, undefined);
  if (malformedBodyToken?.kind !== 'passthrough') {
    assert.fail('expected passthrough token for malformed sgr body');
  }
  assert.equal(malformedBodyToken.text, '\u001b[<;;;M');
});

void test('wheelDeltaRowsFromCode returns expected per-notch scroll deltas', () => {
  assert.equal(wheelDeltaRowsFromCode(0), null);
  assert.equal(wheelDeltaRowsFromCode(64), -1);
  assert.equal(wheelDeltaRowsFromCode(65), 1);
});

void test('routeMuxInputTokens forwards left-pane input and consumes right-pane wheel', () => {
  const layout = computeDualPaneLayout(120, 30);
  const rightCol = layout.rightStartCol;

  const tokens = [
    { kind: 'passthrough', text: 'hello' },
    {
      kind: 'mouse',
      event: {
        sequence: `\u001b[<64;${String(rightCol)};2M`,
        code: 64,
        col: rightCol,
        row: 2,
        final: 'M'
      }
    },
    {
      kind: 'mouse',
      event: {
        sequence: '\u001b[<65;2;2M',
        code: 65,
        col: 2,
        row: 2,
        final: 'M'
      }
    },
    {
      kind: 'mouse',
      event: {
        sequence: '\u001b[<0;2;2M',
        code: 0,
        col: 2,
        row: 2,
        final: 'M'
      }
    },
    {
      kind: 'mouse',
      event: {
        sequence: `\u001b[<0;${String(rightCol)};2M`,
        code: 0,
        col: rightCol,
        row: 2,
        final: 'M'
      }
    },
    {
      kind: 'mouse',
      event: {
        sequence: `\u001b[<0;${String(layout.separatorCol)};2M`,
        code: 0,
        col: layout.separatorCol,
        row: 2,
        final: 'M'
      }
    }
  ] as const;

  const routed = routeMuxInputTokens(tokens, layout);
  assert.equal(routed.leftPaneScrollRows, 1);
  assert.equal(routed.rightPaneScrollRows, -1);
  assert.equal(routed.forwardToSession.length, 2);
  assert.equal(routed.forwardToSession[0]?.toString('utf8'), 'hello');
  assert.equal(routed.forwardToSession[1]?.toString('utf8'), '\u001b[<0;2;2M');
});

void test('EventPaneViewport supports follow mode, manual scroll, and trimming', () => {
  const empty = new EventPaneViewport();
  const emptyView = empty.view(8, 3);
  assert.deepEqual(emptyView.lines, ['', '', '']);
  assert.equal(emptyView.followOutput, true);
  assert.equal(emptyView.top, 0);
  assert.equal(emptyView.totalRows, 1);

  const viewport = new EventPaneViewport(3);
  viewport.append('first line');
  viewport.append('second line');
  viewport.append('third line');
  viewport.append('fourth line');

  const initial = viewport.view(10, 2);
  assert.equal(initial.followOutput, true);
  assert.equal(initial.lines.length, 2);
  assert.deepEqual(initial.lines, ['fourth lin', 'e']);

  const scrolled = viewport.scrollBy(-100, 10, 2);
  assert.equal(scrolled.followOutput, false);
  assert.equal(scrolled.top, 0);

  viewport.append('fifth line');
  const stillScrolled = viewport.view(10, 2);
  assert.equal(stillScrolled.followOutput, false);
  assert.equal(stillScrolled.top, 0);

  const repinned = viewport.scrollBy(100, 10, 2);
  assert.equal(repinned.followOutput, true);
  assert.equal(repinned.top > 0, true);

  const clamped = viewport.view(0, 0);
  assert.equal(clamped.lines.length, 1);

  const unpinnedThenViewRepin = viewport.scrollBy(-1, 10, 2);
  assert.equal(unpinnedThenViewRepin.followOutput, false);
  viewport.scrollBy(1, 10, 2);
  const repinViaView = viewport.view(10, 2);
  assert.equal(repinViaView.followOutput, true);

  const repinByViewDimensions = new EventPaneViewport(10);
  repinByViewDimensions.append('a');
  repinByViewDimensions.append('b');
  repinByViewDimensions.append('c');
  const unpinned = repinByViewDimensions.scrollBy(-1, 5, 1);
  assert.equal(unpinned.followOutput, false);
  const repinnedFromView = repinByViewDimensions.view(5, 20);
  assert.equal(repinnedFromView.followOutput, true);
});

void test('padOrTrimDisplay clamps width and handles wide characters', () => {
  assert.equal(padOrTrimDisplay('abc', 0), '');
  assert.equal(padOrTrimDisplay('abc', 5), 'abc  ');
  assert.equal(padOrTrimDisplay('hello', 3), 'hel');
  assert.equal(padOrTrimDisplay('界a', 2), '界');
});

void test('diffRenderedRows emits only changed rows and clears removed rows', () => {
  const first = diffRenderedRows(['row1', 'row2'], []);
  assert.deepEqual(first.changedRows, [0, 1]);
  assert.equal(first.nextRows.length, 2);
  assert.equal(first.output.includes('\u001b[1;1H\u001b[2Krow1'), true);
  assert.equal(first.output.includes('\u001b[2;1H\u001b[2Krow2'), true);

  const second = diffRenderedRows(['row1', 'row2'], first.nextRows);
  assert.equal(second.output, '');
  assert.deepEqual(second.changedRows, []);

  const third = diffRenderedRows(['row1'], first.nextRows);
  assert.deepEqual(third.changedRows, [1]);
  assert.equal(third.output.includes('\u001b[2;1H\u001b[2K'), true);
});
