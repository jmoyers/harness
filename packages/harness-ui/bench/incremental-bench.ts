/**
 * Incremental rendering benchmark — compares full redraw vs dirty-tracked.
 * Run: bun packages/harness-ui/bench/incremental-bench.ts
 */
import { CellBuffer } from '../src/core/cell-buffer.ts';
import { FrameBuffer } from '../src/core/frame-buffer.ts';
import { DEFAULT_CELL_STYLE, rgbColor, type CellStyle } from '../src/core/color.ts';

const COLS = 300;
const ROWS = 80;
const FRAME_BUDGET_US = 4170;

const RED: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };
const BLUE: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(0, 128, 255), bold: true };
const GREEN: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(0, 200, 0) };

function bench(name: string, fn: () => void, iterations: number): number {
  for (let i = 0; i < 20; i += 1) fn();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsed = Bun.nanoseconds() - start;
  const perOpUs = elapsed / iterations / 1000;
  const fps = Math.floor(1_000_000 / perOpUs);
  const perOpMs = perOpUs / 1000;
  console.log(`  ${name.padEnd(55)} ${perOpMs.toFixed(4).padStart(10)}ms  ${fps.toLocaleString().padStart(8)} FPS`);
  return perOpUs;
}

console.log(`\n=== Incremental rendering benchmark @ ${COLS}x${ROWS} ===\n`);

// Fill a buffer with a realistic mixed-style scene
function fillScene(buf: CellBuffer): void {
  buf.fillRow(0, BLUE);
  buf.drawText(1, 0, 'harness v3 — session view', BLUE);
  for (let r = 1; r < 20; r += 1) {
    buf.fillRow(r, { ...DEFAULT_CELL_STYLE, bg: rgbColor(30, 41, 59) });
    buf.drawText(1, r, `Session ${r}: some conversation title here`, r === 5 ? GREEN : RED);
  }
  buf.drawText(0, 20, '│'.repeat(1), { ...DEFAULT_CELL_STYLE, fg: rgbColor(71, 85, 105) });
  for (let r = 1; r < ROWS - 1; r += 1) {
    buf.drawText(40, r, '│', { ...DEFAULT_CELL_STYLE, fg: rgbColor(71, 85, 105) });
    if (r < 15) {
      buf.drawText(42, r, `# Markdown heading line ${r}`, { ...DEFAULT_CELL_STYLE, fg: rgbColor(56, 189, 248), bold: true });
    } else if (r < 30) {
      buf.drawText(42, r, `+  added line ${r} with green highlight`, { ...DEFAULT_CELL_STYLE, fg: rgbColor(34, 197, 94), bg: rgbColor(19, 47, 33) });
    } else {
      buf.drawText(42, r, `Regular body text content for line ${r} of the conversation viewport`, RED);
    }
  }
  buf.fillRow(ROWS - 1, BLUE);
  buf.drawText(1, ROWS - 1, '~/dev/harness  codex · 142 tokens', { ...DEFAULT_CELL_STYLE, fg: rgbColor(148, 163, 184), bg: rgbColor(30, 41, 59) });
}

// --- Old path: full CellBuffer.renderAnsiRows every frame ---
console.log('OLD PATH (full renderAnsiRows every frame):');
{
  const buf = new CellBuffer(COLS, ROWS);
  fillScene(buf);
  bench('Full ANSI generation (every frame)', () => buf.renderAnsiRows(), 500);
}

// --- New path: FrameBuffer with dirty tracking ---
console.log('\nNEW PATH (FrameBuffer — incremental):');
{
  const fb = new FrameBuffer(COLS, ROWS);
  fillScene(fb.buffer);
  fb.commit();
  fb.renderAnsiRows();

  // First frame — everything dirty
  fb.markAllDirty();
  bench('First frame (all dirty)', () => {
    fb.markAllDirty();
    fb.renderAnsiRows();
  }, 500);

  // No changes — everything cached
  bench('No-change frame (all cached)', () => {
    fb.renderAnsiRows();
  }, 10_000);

  // Status bar only changes (1 row)
  bench('Status bar update (1 row dirty)', () => {
    fb.buffer.drawText(50, ROWS - 1, `${Math.floor(Math.random() * 999)} tokens`, BLUE);
    fb.commit();
    fb.renderChangedAnsiRows();
  }, 5_000);

  // Cursor blink (1 cell change)
  bench('Cursor blink (1 cell, 1 row dirty)', () => {
    const style = Math.random() > 0.5 ? RED : { ...RED, inverse: true };
    fb.buffer.drawText(50, 10, '█', style);
    fb.commit();
    fb.renderChangedAnsiRows();
  }, 5_000);

  // Streaming: 1 new line appended
  let streamRow = 40;
  bench('Stream append (1 row dirty)', () => {
    streamRow = 40 + (streamRow % 30);
    fb.buffer.drawText(42, streamRow, `New streaming token ${streamRow}`, GREEN);
    fb.commit();
    fb.renderChangedAnsiRows();
    streamRow += 1;
  }, 5_000);

  // Rail selection change (1-2 rows)
  bench('Rail selection (2 rows dirty)', () => {
    const oldActive = 5;
    const newActive = 6;
    fb.buffer.drawText(1, oldActive + 2, '  Session 5: some conversation', RED);
    fb.buffer.drawText(1, newActive + 2, '▸ Session 6: some conversation', GREEN);
    fb.commit();
    fb.renderChangedAnsiRows();
  }, 5_000);

  // Scroll (all main pane rows change — ~60 rows)
  bench('Scroll main pane (60 rows dirty)', () => {
    for (let r = 1; r < ROWS - 1; r += 1) {
      fb.buffer.drawText(42, r, `Scrolled content line ${r + Math.floor(Math.random() * 100)}`, RED);
    }
    fb.commit();
    fb.renderChangedAnsiRows();
  }, 500);
}

// --- Budget analysis ---
console.log(`\n--- 240 FPS Partial Update Budget (${FRAME_BUDGET_US / 1000}ms) ---\n`);

const fb2 = new FrameBuffer(COLS, ROWS);
fillScene(fb2.buffer);
fb2.commit();
fb2.renderAnsiRows();

const scenarios: Array<{ name: string; fn: () => void; iters: number }> = [
  {
    name: 'No change (cached)',
    fn: () => fb2.renderAnsiRows(),
    iters: 10_000,
  },
  {
    name: 'Status bar only',
    fn: () => {
      fb2.buffer.drawText(50, ROWS - 1, `${Math.floor(Math.random() * 999)}tk`, BLUE);
      fb2.commit();
      fb2.renderChangedAnsiRows();
    },
    iters: 5_000,
  },
  {
    name: 'Cursor blink',
    fn: () => {
      fb2.buffer.drawText(50, 10, '█', Math.random() > 0.5 ? RED : { ...RED, inverse: true });
      fb2.commit();
      fb2.renderChangedAnsiRows();
    },
    iters: 5_000,
  },
  {
    name: 'Stream 1 line',
    fn: () => {
      fb2.buffer.drawText(42, 35, `Token ${Math.floor(Math.random() * 999)}`, GREEN);
      fb2.commit();
      fb2.renderChangedAnsiRows();
    },
    iters: 5_000,
  },
  {
    name: 'Full scroll (60 rows)',
    fn: () => {
      for (let r = 1; r < ROWS - 1; r += 1) {
        fb2.buffer.drawText(42, r, `Scroll ${r}`, RED);
      }
      fb2.commit();
      fb2.renderChangedAnsiRows();
    },
    iters: 500,
  },
];

for (const s of scenarios) {
  const us = bench(s.name, s.fn, s.iters);
  const pct = (us / FRAME_BUDGET_US * 100).toFixed(1);
  const ok = us < FRAME_BUDGET_US ? '✓' : '✗';
  console.log(`    ${ok} ${pct}% of frame budget\n`);
}

console.log('=== done ===\n');
