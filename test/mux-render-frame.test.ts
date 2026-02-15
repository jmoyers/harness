import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyModalOverlay,
  buildRenderRows,
  cursorStyleEqual,
  cursorStyleToDecscusr,
  renderCanonicalFrameAnsi
} from '../src/mux/render-frame.ts';

void test('mux render frame builds pane rows with status footer and fallback padding', () => {
  const rows = buildRenderRows(
    {
      cols: 20,
      paneRows: 2,
      leftCols: 4,
      rightCols: 6,
      separatorCol: 5,
      rightStartCol: 6
    },
    ['LEFT'],
    [],
    {
      fps: 6.25,
      kbPerSecond: 1.7,
      renderAvgMs: 2.1,
      renderMaxMs: 3.4,
      outputHandleAvgMs: 0.6,
      outputHandleMaxMs: 0.9,
      eventLoopP95Ms: 12.2
    }
  );

  assert.equal(rows.length, 3);
  assert.equal((rows[0] ?? '').includes('\u001b[5G│\u001b[6G'), true);
  assert.equal((rows[1] ?? '').includes('    \u001b[0m\u001b[5G│\u001b[6G      '), true);
  assert.equal((rows[2] ?? '').length, 20);
  assert.equal((rows[2] ?? '').startsWith('[mux] fps=6.3'), true);
});

void test('mux render frame applies modal overlays with clipping and sparse rows', () => {
  const rows = ['row0', 'row1', 'row2'];
  const overlayRows = new Array<string>(4);
  overlayRows[1] = 'A';
  overlayRows[3] = 'B';
  applyModalOverlay(rows, {
    left: 2,
    top: -1,
    rows: overlayRows
  });

  assert.equal(rows[0], 'row0\u001b[3GA');
  assert.equal(rows[1], 'row1');
  assert.equal(rows[2], 'row2\u001b[3GB');
});

void test('mux render frame handles defined right rows and sparse target rows', () => {
  const combined = buildRenderRows(
    {
      cols: 32,
      paneRows: 1,
      leftCols: 6,
      rightCols: 8,
      separatorCol: 7,
      rightStartCol: 8
    },
    ['L'],
    ['RIGHT'],
    {
      fps: 1,
      kbPerSecond: 2,
      renderAvgMs: 3,
      renderMaxMs: 4,
      outputHandleAvgMs: 5,
      outputHandleMaxMs: 6,
      eventLoopP95Ms: 7
    }
  );
  assert.equal((combined[0] ?? '').includes('RIGHT'), true);

  const sparseRows = new Array<string>(2);
  applyModalOverlay(sparseRows, {
    left: 0,
    top: 0,
    rows: ['overlay']
  });
  assert.equal(sparseRows[0], '\u001b[1Goverlay');
});

void test('mux render frame cursor style helpers cover all DEC style sequences', () => {
  assert.equal(cursorStyleToDecscusr({ shape: 'block', blinking: true }), '\u001b[1 q');
  assert.equal(cursorStyleToDecscusr({ shape: 'block', blinking: false }), '\u001b[2 q');
  assert.equal(cursorStyleToDecscusr({ shape: 'underline', blinking: true }), '\u001b[3 q');
  assert.equal(cursorStyleToDecscusr({ shape: 'underline', blinking: false }), '\u001b[4 q');
  assert.equal(cursorStyleToDecscusr({ shape: 'bar', blinking: true }), '\u001b[5 q');
  assert.equal(cursorStyleToDecscusr({ shape: 'bar', blinking: false }), '\u001b[6 q');

  assert.equal(cursorStyleEqual(null, { shape: 'block', blinking: false }), false);
  assert.equal(
    cursorStyleEqual(
      { shape: 'underline', blinking: true },
      { shape: 'underline', blinking: true }
    ),
    true
  );
  assert.equal(
    cursorStyleEqual(
      { shape: 'underline', blinking: true },
      { shape: 'bar', blinking: true }
    ),
    false
  );
});

void test('mux render frame renders canonical output with visible and hidden cursor variants', () => {
  const visible = renderCanonicalFrameAnsi(
    ['A', 'B'],
    { shape: 'block', blinking: false },
    true,
    1,
    3
  );
  assert.equal(visible.startsWith('\u001b[?25l\u001b[H\u001b[2J'), true);
  assert.equal(visible.includes('\u001b[2 q'), true);
  assert.equal(visible.includes('\u001b[1;1H\u001b[2KA'), true);
  assert.equal(visible.includes('\u001b[2;1H\u001b[2KB'), true);
  assert.equal(visible.endsWith('\u001b[?25h\u001b[2;4H'), true);

  const hidden = renderCanonicalFrameAnsi(
    ['Z'],
    { shape: 'bar', blinking: true },
    false,
    0,
    0
  );
  assert.equal(hidden.includes('\u001b[5 q'), true);
  assert.equal(hidden.endsWith('\u001b[?25l'), true);

  const sparse = new Array<string>(1);
  const sparseOutput = renderCanonicalFrameAnsi(
    sparse,
    { shape: 'block', blinking: true },
    false,
    0,
    0
  );
  assert.equal(sparseOutput.includes('\u001b[1;1H\u001b[2K'), true);
});
