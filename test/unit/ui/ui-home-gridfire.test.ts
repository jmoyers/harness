import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { measureDisplayWidth } from '../../../src/terminal/snapshot-oracle.ts';
import { renderHomeGridfireAnsiRows } from '../../../src/ui/panes/home-gridfire.ts';

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

function displayWidth(text: string): number {
  let width = 0;
  for (const glyph of text) {
    width += Math.max(0, measureDisplayWidth(glyph));
  }
  return width;
}

void test('home gridfire renders ansi rows with fixed viewport width and overlays unicode content', () => {
  const rows = renderHomeGridfireAnsiRows({
    cols: 24,
    rows: 6,
    contentRows: ['a\u0301 b界', 'repo界', 'this line is intentionally longer than viewport'],
    timeMs: 1400,
    overlayTitle: null,
    overlaySubtitle: null,
  });
  assert.equal(rows.length, 6);
  assert.equal(
    rows.some((row) => row.includes('\u001b[')),
    true,
  );
  const stripped = rows.map((row) => stripAnsi(row));
  assert.equal(
    stripped.some((row) => row.includes('repo界')),
    true,
  );
  assert.equal(
    stripped.some((row) => row.includes('界')),
    true,
  );
  for (const row of stripped) {
    assert.equal(displayWidth(row), 24);
  }
});

void test('home gridfire paints centered startup labels and clamps subtitle row in short viewports', () => {
  const rows = renderHomeGridfireAnsiRows({
    cols: 40,
    rows: 1,
    contentRows: [],
    timeMs: 0,
    overlayTitle: 'GSV Sleeper Service',
    overlaySubtitle: '- harness v0.1.0 -',
  });
  const stripped = stripAnsi(rows[0] ?? '');
  assert.equal(stripped.includes('harness v0.1.0'), true);
});

void test('home gridfire can pin startup labels near bottom when requested', () => {
  const rows = renderHomeGridfireAnsiRows({
    cols: 40,
    rows: 6,
    contentRows: [],
    timeMs: 0,
    overlayTitle: 'GSV Sleeper Service',
    overlaySubtitle: '- harness v0.1.0 -',
    overlayPlacement: 'bottom',
  });
  const stripped = rows.map((row) => stripAnsi(row));
  assert.equal((stripped[3] ?? '').includes('GSV Sleeper Service'), true);
  assert.equal((stripped[4] ?? '').includes('- harness v0.1.0 -'), true);
});

void test('home gridfire ignores oversized title overlays and undefined content rows', () => {
  const rows = renderHomeGridfireAnsiRows({
    cols: 8,
    rows: 3,
    contentRows: ['row-0'],
    timeMs: 200,
    overlayTitle: 'this text is too wide',
    overlaySubtitle: '',
  });
  const stripped = rows.map((row) => stripAnsi(row)).join('\n');
  assert.equal(stripped.includes('this text is too wide'), false);
});
