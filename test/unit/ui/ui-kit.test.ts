import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  DEFAULT_UI_MODAL_THEME,
  SINGLE_LINE_UI_BOX_GLYPHS,
  UiKit,
} from '../packages/harness-ui/src/kit.ts';
import { DEFAULT_UI_STYLE, SurfaceBuffer, type UiStyle } from '../packages/harness-ui/src/surface.ts';

const UI_KIT = new UiKit();

function createUiSurface(
  cols: number,
  rows: number,
  baseStyle: UiStyle = DEFAULT_UI_STYLE,
): SurfaceBuffer {
  return new SurfaceBuffer(cols, rows, baseStyle);
}

function renderUiSurfaceAnsiRows(surface: SurfaceBuffer): readonly string[] {
  return surface.renderAnsiRows();
}

function truncateUiText(text: string, width: number): string {
  return UI_KIT.truncateText(text, width);
}

function formatUiButton(
  content: Parameters<UiKit['formatButton']>[0],
): ReturnType<UiKit['formatButton']> {
  return UI_KIT.formatButton(content);
}

function drawUiAlignedText(
  surface: SurfaceBuffer,
  col: number,
  row: number,
  width: number,
  text: string,
  style: Parameters<UiKit['drawAlignedText']>[5],
  align: Parameters<UiKit['drawAlignedText']>[6] = 'left',
): void {
  UI_KIT.drawAlignedText(surface, col, row, width, text, style, align);
}

function paintUiRow(
  surface: SurfaceBuffer,
  row: number,
  text: string,
  textStyle: Parameters<UiKit['paintRow']>[3],
  fillStyle: Parameters<UiKit['paintRow']>[4] = textStyle,
  col = 0,
): void {
  UI_KIT.paintRow(surface, row, text, textStyle, fillStyle, col);
}

function paintUiRowWithTrailingLabel(
  surface: SurfaceBuffer,
  row: number,
  leftText: string,
  trailingLabel: string,
  leftStyle: Parameters<UiKit['paintRowWithTrailingLabel']>[4],
  trailingStyle: Parameters<UiKit['paintRowWithTrailingLabel']>[5],
  fillStyle: Parameters<UiKit['paintRowWithTrailingLabel']>[6] = leftStyle,
  options: Parameters<UiKit['paintRowWithTrailingLabel']>[7] = {},
): void {
  UI_KIT.paintRowWithTrailingLabel(
    surface,
    row,
    leftText,
    trailingLabel,
    leftStyle,
    trailingStyle,
    fillStyle,
    options,
  );
}

function fillUiRect(
  surface: SurfaceBuffer,
  rect: Parameters<UiKit['fillRect']>[1],
  style: Parameters<UiKit['fillRect']>[2],
): void {
  UI_KIT.fillRect(surface, rect, style);
}

function strokeUiRect(
  surface: SurfaceBuffer,
  rect: Parameters<UiKit['strokeRect']>[1],
  style: Parameters<UiKit['strokeRect']>[2],
  glyphs: Parameters<UiKit['strokeRect']>[3] = SINGLE_LINE_UI_BOX_GLYPHS,
): void {
  UI_KIT.strokeRect(surface, rect, style, glyphs);
}

function layoutUiModalRect(
  viewportCols: number,
  viewportRows: number,
  width: number,
  height: number,
  anchor: Parameters<UiKit['layoutModalRect']>[4] = 'center',
  marginRows = 1,
): ReturnType<UiKit['layoutModalRect']> {
  return UI_KIT.layoutModalRect(viewportCols, viewportRows, width, height, anchor, marginRows);
}

function drawUiModal(
  surface: SurfaceBuffer,
  rect: Parameters<UiKit['drawModal']>[1],
  content: Parameters<UiKit['drawModal']>[2],
  theme: Parameters<UiKit['drawModal']>[3] = undefined,
): ReturnType<UiKit['drawModal']> {
  return UI_KIT.drawModal(surface, rect, content, theme);
}

function buildUiModalOverlay(
  options: Parameters<UiKit['buildModalOverlay']>[0],
): ReturnType<UiKit['buildModalOverlay']> {
  return UI_KIT.buildModalOverlay(options);
}

function isUiModalOverlayHit(
  overlay: Parameters<UiKit['isModalOverlayHit']>[0],
  col: number,
  row: number,
): boolean {
  return UI_KIT.isModalOverlayHit(overlay, col, row);
}

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

void test('ui kit formats button labels with icon and padding defaults', () => {
  assert.equal(
    formatUiButton({ label: 'new conversation', prefixIcon: '+' }),
    '[ + new conversation ]',
  );
  assert.equal(formatUiButton({ label: '  ', prefixIcon: '' }), '[ button ]');
  assert.equal(
    formatUiButton({ label: 'archive', prefixIcon: 'x', suffixIcon: '!', paddingX: 2.9 }),
    '[  x archive !  ]',
  );
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

void test('ui kit paints row with a trailing label aligned to the right edge', () => {
  const surface = createUiSurface(20, 1);
  paintUiRowWithTrailingLabel(
    surface,
    0,
    'left content',
    '[+ thread]',
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
  );

  const row = stripAnsi(renderUiSurfaceAnsiRows(surface)[0] ?? '');
  assert.equal(row.endsWith('[+ thread]'), true);
  assert.equal(row.startsWith('left'), true);
  assert.equal(row.includes('…'), true);

  const clippedSurface = createUiSurface(10, 1);
  paintUiRowWithTrailingLabel(
    clippedSurface,
    0,
    'long left content',
    '[+ thread]',
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
  );
  const clippedRow = stripAnsi(renderUiSurfaceAnsiRows(clippedSurface)[0] ?? '');
  assert.equal(clippedRow.endsWith('[+ thread]'), true);
  assert.equal(clippedRow.includes('long left'), false);

  const zeroWidthSurface = createUiSurface(8, 1);
  paintUiRowWithTrailingLabel(
    zeroWidthSurface,
    0,
    'ignored',
    '[x]',
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
    {
      width: 0,
    },
  );
  const zeroWidthRow = stripAnsi(renderUiSurfaceAnsiRows(zeroWidthSurface)[0] ?? '');
  assert.equal(zeroWidthRow, '        ');

  const noTrailingLabelSurface = createUiSurface(14, 1);
  paintUiRowWithTrailingLabel(
    noTrailingLabelSurface,
    0,
    'left',
    '',
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
    DEFAULT_UI_STYLE,
  );
  const noTrailingLabelRow = stripAnsi(renderUiSurfaceAnsiRows(noTrailingLabelSurface)[0] ?? '');
  assert.equal(noTrailingLabelRow.startsWith('left'), true);
  assert.equal(noTrailingLabelRow.includes('[+ thread]'), false);
});

void test('ui kit fillUiRect clamps rectangles and leaves out-of-bounds writes untouched', () => {
  const surface = createUiSurface(5, 2);
  fillUiRect(
    surface,
    {
      col: 99,
      row: 99,
      width: 5,
      height: 5,
    },
    {
      fg: { kind: 'indexed', index: 1 },
      bg: { kind: 'indexed', index: 2 },
      bold: true,
    },
  );
  fillUiRect(
    surface,
    {
      col: -2,
      row: 0,
      width: 4,
      height: 2,
    },
    {
      fg: { kind: 'indexed', index: 1 },
      bg: { kind: 'indexed', index: 2 },
      bold: true,
    },
  );

  const rows = renderUiSurfaceAnsiRows(surface).map((row) => stripAnsi(row));
  assert.equal(rows[0], '  '.padEnd(5, ' '));
  assert.equal(rows[1], '  '.padEnd(5, ' '));
});

void test('ui kit strokeUiRect supports point, horizontal, vertical, and boxed rectangles', () => {
  const style = {
    fg: { kind: 'indexed', index: 250 } as const,
    bg: { kind: 'default' } as const,
    bold: false,
  };

  const pointSurface = createUiSurface(2, 2);
  strokeUiRect(
    pointSurface,
    { col: 0, row: 0, width: 1, height: 1 },
    style,
    SINGLE_LINE_UI_BOX_GLYPHS,
  );
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
    height: 10,
  });

  const bottomClamped = layoutUiModalRect(12, 5, 40, 40, 'bottom', 2);
  assert.deepEqual(bottomClamped, {
    col: 0,
    row: 0,
    width: 12,
    height: 5,
  });

  const minimumClamped = layoutUiModalRect(20, 8, -5, -2, 'center', 0);
  assert.deepEqual(minimumClamped, {
    col: 9,
    row: 3,
    width: 1,
    height: 1,
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
      height: 6,
    },
    {
      title: 'Add Directory',
      bodyLines: ['path: ~/dev/harness', 'type to edit'],
      footer: 'enter save',
      paddingX: 1,
    },
  );
  assert.notEqual(rect, null);
  assert.deepEqual(rect, {
    col: 3,
    row: 1,
    width: 20,
    height: 6,
  });
  const rows = renderUiSurfaceAnsiRows(surface).map((row) => stripAnsi(row));
  assert.equal(rows[1]?.includes('┌'), true);
  assert.equal(rows[2]?.includes('Add Directory'), true);
  assert.equal(rows[6]?.includes('└'), true);
  assert.equal(
    rows.some((row) => row.includes('enter save')),
    true,
  );

  const tiny = createUiSurface(4, 4);
  const tinyRect = drawUiModal(
    tiny,
    {
      col: 0,
      row: 0,
      width: 4,
      height: 4,
    },
    {
      title: 'x',
      bodyLines: ['y'],
      footer: 'z',
      paddingX: 1,
    },
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
      height: 2,
    },
    {
      title: 'x',
      bodyLines: ['y'],
      footer: 'z',
    },
  );
  assert.deepEqual(normalizedInnerNullRect, {
    col: 0,
    row: 0,
    width: 2,
    height: 2,
  });

  const overflowBody = createUiSurface(20, 6);
  drawUiModal(
    overflowBody,
    {
      col: 1,
      row: 1,
      width: 12,
      height: 4,
    },
    {
      title: 'T',
      bodyLines: ['line-1', 'line-2', 'line-3'],
      footer: 'F',
    },
  );
  const overflowRows = renderUiSurfaceAnsiRows(overflowBody).map((row) => stripAnsi(row));
  assert.equal(
    overflowRows.some((row) => row.includes('line-1')),
    false,
  );
  assert.equal(
    overflowRows.some((row) => row.includes('F')),
    true,
  );

  const themedSurface = createUiSurface(12, 5);
  drawUiModal(
    themedSurface,
    {
      col: 0,
      row: 0,
      width: 12,
      height: 5,
    },
    {
      title: '',
      bodyLines: ['body'],
      footer: 'tail',
    },
    {
      frameStyle: {
        fg: { kind: 'indexed', index: 196 },
        bg: { kind: 'indexed', index: 236 },
        bold: true,
      },
      titleStyle: {
        fg: { kind: 'indexed', index: 226 },
        bg: { kind: 'indexed', index: 236 },
        bold: false,
      },
      bodyStyle: {
        fg: { kind: 'indexed', index: 118 },
        bg: { kind: 'indexed', index: 236 },
        bold: false,
      },
    },
  );
  const themedRows = renderUiSurfaceAnsiRows(themedSurface);
  assert.equal(
    themedRows.some((row) => row.includes('\u001b[0;1;38;5;196;48;5;236m')),
    true,
  );
  assert.equal(
    themedRows.some((row) => stripAnsi(row).includes('body')),
    true,
  );

  const noFooterRoomSurface = createUiSurface(10, 4);
  drawUiModal(
    noFooterRoomSurface,
    {
      col: 1,
      row: 1,
      width: 6,
      height: 3,
    },
    {
      title: 'X',
      bodyLines: ['ignored'],
      footer: 'tail',
    },
  );
  const noFooterRoomRows = renderUiSurfaceAnsiRows(noFooterRoomSurface).map((row) =>
    stripAnsi(row),
  );
  assert.equal(
    noFooterRoomRows.some((row) => row.includes('tail')),
    false,
  );

  const undefinedBodyLinesSurface = createUiSurface(16, 6);
  drawUiModal(
    undefinedBodyLinesSurface,
    {
      col: 1,
      row: 1,
      width: 12,
      height: 4,
    },
    {
      title: 'T',
      footer: 'tail',
    },
  );
  const undefinedBodyLinesRows = renderUiSurfaceAnsiRows(undefinedBodyLinesSurface).map((row) =>
    stripAnsi(row),
  );
  assert.equal(
    undefinedBodyLinesRows.some((row) => row.includes('tail')),
    true,
  );

  const offscreen = drawUiModal(
    tiny,
    {
      col: 50,
      row: 50,
      width: 2,
      height: 2,
    },
    {
      bodyLines: [],
    },
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
      footerStyle: DEFAULT_UI_MODAL_THEME.footerStyle,
    },
  });

  assert.equal(overlay.left, 10);
  assert.equal(overlay.top, 4);
  assert.equal(overlay.rows.length, 5);
  assert.equal(stripAnsi(overlay.rows[0] ?? '').includes('┌'), true);
  assert.equal(
    overlay.rows.some((row) => stripAnsi(row).includes('Edit Title')),
    true,
  );
  assert.equal(
    overlay.rows.some((row) => stripAnsi(row).includes('esc done')),
    true,
  );

  const minimalOverlay = buildUiModalOverlay({
    viewportCols: 12,
    viewportRows: 4,
    width: 8,
    height: 3,
    bodyLines: ['x'],
    paddingX: 0,
  });
  assert.equal(minimalOverlay.rows.length, 3);
  assert.equal(
    minimalOverlay.rows.some((row) => stripAnsi(row).includes('x')),
    true,
  );

  const fallbackBodyOverlay = buildUiModalOverlay({
    viewportCols: 12,
    viewportRows: 4,
    width: 8,
    height: 3,
  });
  assert.equal(fallbackBodyOverlay.rows.length, 3);
});

void test('ui kit modal hit-test returns true only for points inside overlay bounds', () => {
  const overlay = buildUiModalOverlay({
    viewportCols: 40,
    viewportRows: 10,
    width: 20,
    height: 5,
    anchor: 'center',
    title: 'Hit Test',
    bodyLines: ['body'],
  });

  assert.equal(isUiModalOverlayHit(overlay, overlay.left + 1, overlay.top + 1), true);
  assert.equal(
    isUiModalOverlayHit(overlay, overlay.left + overlay.width, overlay.top + overlay.height),
    true,
  );
  assert.equal(isUiModalOverlayHit(overlay, overlay.left, overlay.top + 1), false);
  assert.equal(isUiModalOverlayHit(overlay, overlay.left + 1, overlay.top), false);
  assert.equal(
    isUiModalOverlayHit(overlay, overlay.left + overlay.width + 1, overlay.top + 1),
    false,
  );
  assert.equal(
    isUiModalOverlayHit(overlay, overlay.left + 1, overlay.top + overlay.height + 1),
    false,
  );
  assert.equal(isUiModalOverlayHit(overlay, 0, 1), false);
  assert.equal(isUiModalOverlayHit(overlay, 1, 0), false);
});
