import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUiModalOverlay,
  DEFAULT_UI_MODAL_THEME,
  drawUiAlignedText,
  drawUiModal,
  fillUiRect,
  layoutUiModalRect,
  paintUiRow,
  SINGLE_LINE_UI_BOX_GLYPHS,
  strokeUiRect,
  truncateUiText
} from '../src/ui/kit.ts';
import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  renderUiSurfaceAnsiRows
} from '../src/ui/surface.ts';

function stripAnsi(value: string): string {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    if (char === '\u001b' && value[index + 1] === '[') {
      index += 2;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      if (index < value.length && value[index] === 'm') {
        index += 1;
      }
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

void test('ui kit truncates text deterministically with ellipsis', () => {
  assert.equal(truncateUiText('', 10), '');
  assert.equal(truncateUiText('abcdef', 0), '');
  assert.equal(truncateUiText('abc', 10), 'abc');
  assert.equal(truncateUiText('abcdef', 1), '…');
  assert.equal(truncateUiText('abcdef', 4), 'abc…');
  assert.equal(truncateUiText('界界界', 5), '界界…');
  assert.equal(truncateUiText('界界界', 4), '界…');
});

void test('ui kit aligned text and row paint helpers draw left/center/right', () => {
  const surface = createUiSurface(12, 3);
  paintUiRow(surface, 0, 'left', DEFAULT_UI_STYLE, DEFAULT_UI_STYLE, 0);
  drawUiAlignedText(surface, 0, 1, 12, 'mid', DEFAULT_UI_STYLE, 'center');
  drawUiAlignedText(surface, 0, 2, 12, 'right', DEFAULT_UI_STYLE, 'right');
  drawUiAlignedText(surface, 0, 2, 0, 'ignored', DEFAULT_UI_STYLE, 'left');

  const rows = renderUiSurfaceAnsiRows(surface).map((row) => stripAnsi(row));
  assert.equal(rows[0]?.startsWith('left'), true);
  assert.equal(rows[1]?.includes('    mid'), true);
  assert.equal(rows[2]?.endsWith('right'), true);
});

void test('ui kit fillUiRect clamps rectangles and leaves out-of-bounds writes untouched', () => {
  const surface = createUiSurface(5, 2);
  fillUiRect(
    surface,
    {
      col: 99,
      row: 99,
      width: 5,
      height: 5
    },
    {
      fg: { kind: 'indexed', index: 1 },
      bg: { kind: 'indexed', index: 2 },
      bold: true
    }
  );
  fillUiRect(
    surface,
    {
      col: -2,
      row: 0,
      width: 4,
      height: 2
    },
    {
      fg: { kind: 'indexed', index: 1 },
      bg: { kind: 'indexed', index: 2 },
      bold: true
    }
  );

  const rows = renderUiSurfaceAnsiRows(surface).map((row) => stripAnsi(row));
  assert.equal(rows[0], '  '.padEnd(5, ' '));
  assert.equal(rows[1], '  '.padEnd(5, ' '));
});

void test('ui kit strokeUiRect supports point, horizontal, vertical, and boxed rectangles', () => {
  const style = {
    fg: { kind: 'indexed', index: 250 } as const,
    bg: { kind: 'default' } as const,
    bold: false
  };

  const pointSurface = createUiSurface(2, 2);
  strokeUiRect(pointSurface, { col: 0, row: 0, width: 1, height: 1 }, style, SINGLE_LINE_UI_BOX_GLYPHS);
  assert.equal(stripAnsi(renderUiSurfaceAnsiRows(pointSurface)[0] ?? '').startsWith('┌'), true);

  const horizontalSurface = createUiSurface(5, 1);
  strokeUiRect(horizontalSurface, { col: 0, row: 0, width: 5, height: 1 }, style);
  assert.equal(stripAnsi(renderUiSurfaceAnsiRows(horizontalSurface)[0] ?? ''), '─────');

  const verticalSurface = createUiSurface(1, 4);
  strokeUiRect(verticalSurface, { col: 0, row: 0, width: 1, height: 4 }, style);
  const verticalRows = renderUiSurfaceAnsiRows(verticalSurface).map((row) => stripAnsi(row));
  assert.deepEqual(verticalRows, ['│', '│', '│', '│']);

  const boxedSurface = createUiSurface(6, 4);
  strokeUiRect(boxedSurface, { col: 1, row: 0, width: 4, height: 4 }, style);
  strokeUiRect(boxedSurface, { col: 50, row: 50, width: 2, height: 2 }, style);
  const boxedRows = renderUiSurfaceAnsiRows(boxedSurface).map((row) => stripAnsi(row));
  assert.equal(boxedRows[0]?.includes('┌──┐'), true);
  assert.equal(boxedRows[3]?.includes('└──┘'), true);
});

void test('ui kit modal layout positions center and bottom anchors with clamping', () => {
  const centered = layoutUiModalRect(100, 40, 30, 10, 'center', 0);
  assert.deepEqual(centered, {
    col: 35,
    row: 15,
    width: 30,
    height: 10
  });

  const bottomClamped = layoutUiModalRect(12, 5, 40, 40, 'bottom', 2);
  assert.deepEqual(bottomClamped, {
    col: 0,
    row: 0,
    width: 12,
    height: 5
  });

  const minimumClamped = layoutUiModalRect(20, 8, -5, -2, 'center', 0);
  assert.deepEqual(minimumClamped, {
    col: 9,
    row: 3,
    width: 1,
    height: 1
  });
});

void test('ui kit drawUiModal renders title body and footer with clipping branches', () => {
  const surface = createUiSurface(30, 8);
  const rect = drawUiModal(
    surface,
    {
      col: 3,
      row: 1,
      width: 20,
      height: 6
    },
    {
      title: 'Add Directory',
      bodyLines: ['path: ~/dev/harness', 'type to edit'],
      footer: 'enter save',
      paddingX: 1
    }
  );
  assert.notEqual(rect, null);
  assert.deepEqual(rect, {
    col: 3,
    row: 1,
    width: 20,
    height: 6
  });
  const rows = renderUiSurfaceAnsiRows(surface).map((row) => stripAnsi(row));
  assert.equal(rows[1]?.includes('┌'), true);
  assert.equal(rows[2]?.includes('Add Directory'), true);
  assert.equal(rows[6]?.includes('└'), true);
  assert.equal(rows.some((row) => row.includes('enter save')), true);

  const tiny = createUiSurface(4, 4);
  const tinyRect = drawUiModal(
    tiny,
    {
      col: 0,
      row: 0,
      width: 4,
      height: 4
    },
    {
      title: 'x',
      bodyLines: ['y'],
      footer: 'z',
      paddingX: 1
    }
  );
  assert.notEqual(tinyRect, null);
  const tinyRows = renderUiSurfaceAnsiRows(tiny).map((row) => stripAnsi(row));
  assert.equal(tinyRows[1], '│  │');

  const normalizedInnerNull = createUiSurface(3, 3);
  const normalizedInnerNullRect = drawUiModal(
    normalizedInnerNull,
    {
      col: 0,
      row: 0,
      width: 2,
      height: 2
    },
    {
      title: 'x',
      bodyLines: ['y'],
      footer: 'z'
    }
  );
  assert.deepEqual(normalizedInnerNullRect, {
    col: 0,
    row: 0,
    width: 2,
    height: 2
  });

  const overflowBody = createUiSurface(20, 6);
  drawUiModal(
    overflowBody,
    {
      col: 1,
      row: 1,
      width: 12,
      height: 4
    },
    {
      title: 'T',
      bodyLines: ['line-1', 'line-2', 'line-3'],
      footer: 'F'
    }
  );
  const overflowRows = renderUiSurfaceAnsiRows(overflowBody).map((row) => stripAnsi(row));
  assert.equal(overflowRows.some((row) => row.includes('line-1')), false);
  assert.equal(overflowRows.some((row) => row.includes('F')), true);

  const themedSurface = createUiSurface(12, 5);
  drawUiModal(
    themedSurface,
    {
      col: 0,
      row: 0,
      width: 12,
      height: 5
    },
    {
      title: '',
      bodyLines: ['body'],
      footer: 'tail'
    },
    {
      frameStyle: {
        fg: { kind: 'indexed', index: 196 },
        bg: { kind: 'indexed', index: 236 },
        bold: true
      },
      titleStyle: {
        fg: { kind: 'indexed', index: 226 },
        bg: { kind: 'indexed', index: 236 },
        bold: false
      },
      bodyStyle: {
        fg: { kind: 'indexed', index: 118 },
        bg: { kind: 'indexed', index: 236 },
        bold: false
      }
    }
  );
  const themedRows = renderUiSurfaceAnsiRows(themedSurface);
  assert.equal(themedRows.some((row) => row.includes('\u001b[0;1;38;5;196;48;5;236m')), true);
  assert.equal(themedRows.some((row) => stripAnsi(row).includes('body')), true);

  const noFooterRoomSurface = createUiSurface(10, 4);
  drawUiModal(
    noFooterRoomSurface,
    {
      col: 1,
      row: 1,
      width: 6,
      height: 3
    },
    {
      title: 'X',
      bodyLines: ['ignored'],
      footer: 'tail'
    }
  );
  const noFooterRoomRows = renderUiSurfaceAnsiRows(noFooterRoomSurface).map((row) => stripAnsi(row));
  assert.equal(noFooterRoomRows.some((row) => row.includes('tail')), false);

  const undefinedBodyLinesSurface = createUiSurface(16, 6);
  drawUiModal(
    undefinedBodyLinesSurface,
    {
      col: 1,
      row: 1,
      width: 12,
      height: 4
    },
    {
      title: 'T',
      footer: 'tail'
    }
  );
  const undefinedBodyLinesRows = renderUiSurfaceAnsiRows(undefinedBodyLinesSurface).map((row) =>
    stripAnsi(row)
  );
  assert.equal(undefinedBodyLinesRows.some((row) => row.includes('tail')), true);

  const offscreen = drawUiModal(
    tiny,
    {
      col: 50,
      row: 50,
      width: 2,
      height: 2
    },
    {
      bodyLines: []
    }
  );
  assert.equal(offscreen, null);
});

void test('ui kit buildUiModalOverlay returns positioned modal rows and supports partial themes', () => {
  const overlay = buildUiModalOverlay({
    viewportCols: 40,
    viewportRows: 10,
    width: 20,
    height: 5,
    anchor: 'bottom',
    marginRows: 1,
    title: 'Edit Title',
    bodyLines: ['title: untitled task 1'],
    footer: 'esc done',
    theme: {
      footerStyle: DEFAULT_UI_MODAL_THEME.footerStyle
    }
  });

  assert.equal(overlay.left, 10);
  assert.equal(overlay.top, 4);
  assert.equal(overlay.rows.length, 5);
  assert.equal(stripAnsi(overlay.rows[0] ?? '').includes('┌'), true);
  assert.equal(overlay.rows.some((row) => stripAnsi(row).includes('Edit Title')), true);
  assert.equal(overlay.rows.some((row) => stripAnsi(row).includes('esc done')), true);

  const minimalOverlay = buildUiModalOverlay({
    viewportCols: 12,
    viewportRows: 4,
    width: 8,
    height: 3,
    bodyLines: ['x'],
    paddingX: 0
  });
  assert.equal(minimalOverlay.rows.length, 3);
  assert.equal(minimalOverlay.rows.some((row) => stripAnsi(row).includes('x')), true);

  const fallbackBodyOverlay = buildUiModalOverlay({
    viewportCols: 12,
    viewportRows: 4,
    width: 8,
    height: 3
  });
  assert.equal(fallbackBodyOverlay.rows.length, 3);
});
