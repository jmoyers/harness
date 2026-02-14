import assert from 'node:assert/strict';
import test from 'node:test';
import { measureDisplayWidth } from '../src/terminal/snapshot-oracle.ts';
import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  drawUiText,
  fillUiRow,
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

void test('ui surface clamps dimensions and renders default row', () => {
  const surface = createUiSurface(0, 0);
  const rows = renderUiSurfaceAnsiRows(surface);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.includes('\u001b[0;39;49m'), true);
  assert.equal(stripAnsi(rows[0] ?? ''), ' ');
  assert.equal(measureDisplayWidth(stripAnsi(rows[0] ?? '')), 1);
});

void test('ui surface renders blank fallback for non-continued empty glyph cell', () => {
  const surface = createUiSurface(1, 1);
  const mutableSurface = surface as unknown as {
    cells: Array<{ glyph: string; continued: boolean }>;
  };
  mutableSurface.cells[0]!.glyph = '';
  mutableSurface.cells[0]!.continued = false;

  const row = renderUiSurfaceAnsiRows(surface)[0] ?? '';
  assert.equal(stripAnsi(row), ' ');
});

void test('ui surface fill row and draw text apply style transitions', () => {
  const surface = createUiSurface(6, 2);
  fillUiRow(surface, -1, DEFAULT_UI_STYLE);
  fillUiRow(surface, 10, DEFAULT_UI_STYLE);
  fillUiRow(surface, 1, {
    fg: { kind: 'indexed', index: 231 },
    bg: { kind: 'rgb', r: 1, g: 2, b: 3 },
    bold: true
  });
  drawUiText(surface, 0, 1, 'ok', {
    fg: { kind: 'rgb', r: 20, g: 30, b: 40 },
    bg: { kind: 'indexed', index: 24 },
    bold: false
  });

  const rows = renderUiSurfaceAnsiRows(surface);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.includes('\u001b[0;1;38;5;231;48;2;1;2;3m'), true);
  assert.equal(rows[1]?.includes('\u001b[0;38;2;20;30;40;48;5;24m'), true);
  assert.equal(stripAnsi(rows[1] ?? '').startsWith('ok'), true);
});

void test('ui surface draw text handles bounds, combining marks, and wide glyph wrapping', () => {
  const surface = createUiSurface(4, 1, {
    fg: { kind: 'indexed', index: 244 },
    bg: { kind: 'default' },
    bold: false
  });
  drawUiText(surface, 8, 0, 'x');
  drawUiText(surface, 0, -1, 'x');
  drawUiText(surface, 0, 0, 'a\u0301界b', {
    fg: { kind: 'indexed', index: 33 },
    bg: { kind: 'default' },
    bold: false
  });
  drawUiText(surface, 3, 0, '界', {
    fg: { kind: 'indexed', index: 160 },
    bg: { kind: 'default' },
    bold: true
  });

  const rows = renderUiSurfaceAnsiRows(surface);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.includes('\u001b[0;38;5;33;49m'), true);
  assert.equal(rows[0]?.includes('\u001b[0;1;38;5;160;49m'), false);
  const plain = stripAnsi(rows[0] ?? '');
  assert.equal(measureDisplayWidth(plain), 4);
  assert.equal(plain.startsWith('a界'), true);

  const overflowSurface = createUiSurface(2, 1);
  drawUiText(overflowSurface, 0, 0, 'abcd');
  const overflowRow = stripAnsi(renderUiSurfaceAnsiRows(overflowSurface)[0] ?? '');
  assert.equal(overflowRow, 'ab');
});

void test('ui surface style comparison covers indexed and rgb fg/bg delta branches', () => {
  const surface = createUiSurface(8, 1);
  drawUiText(surface, 0, 0, 'a', {
    fg: { kind: 'indexed', index: 30 },
    bg: { kind: 'default' },
    bold: false
  });
  drawUiText(surface, 1, 0, 'b', {
    fg: { kind: 'indexed', index: 31 },
    bg: { kind: 'default' },
    bold: false
  });
  drawUiText(surface, 2, 0, 'c', {
    fg: { kind: 'rgb', r: 1, g: 2, b: 3 },
    bg: { kind: 'default' },
    bold: false
  });
  drawUiText(surface, 3, 0, 'd', {
    fg: { kind: 'rgb', r: 1, g: 2, b: 4 },
    bg: { kind: 'default' },
    bold: false
  });
  drawUiText(surface, 4, 0, 'e', {
    fg: { kind: 'default' },
    bg: { kind: 'indexed', index: 52 },
    bold: false
  });
  drawUiText(surface, 5, 0, 'f', {
    fg: { kind: 'default' },
    bg: { kind: 'indexed', index: 53 },
    bold: false
  });
  drawUiText(surface, 6, 0, 'g', {
    fg: { kind: 'default' },
    bg: { kind: 'rgb', r: 9, g: 8, b: 7 },
    bold: false
  });
  drawUiText(surface, 7, 0, 'h', {
    fg: { kind: 'default' },
    bg: { kind: 'rgb', r: 9, g: 8, b: 6 },
    bold: false
  });

  const row = renderUiSurfaceAnsiRows(surface)[0] ?? '';
  assert.equal(row.includes('\u001b[0;38;5;30;49m'), true);
  assert.equal(row.includes('\u001b[0;38;5;31;49m'), true);
  assert.equal(row.includes('\u001b[0;38;2;1;2;3;49m'), true);
  assert.equal(row.includes('\u001b[0;38;2;1;2;4;49m'), true);
  assert.equal(row.includes('\u001b[0;39;48;5;52m'), true);
  assert.equal(row.includes('\u001b[0;39;48;5;53m'), true);
  assert.equal(row.includes('\u001b[0;39;48;2;9;8;7m'), true);
  assert.equal(row.includes('\u001b[0;39;48;2;9;8;6m'), true);
  assert.equal(stripAnsi(row), 'abcdefgh');
});
