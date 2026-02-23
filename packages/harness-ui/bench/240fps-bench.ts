/**
 * 240 FPS target benchmark at 1440p terminal sizes.
 * Run: bun packages/harness-ui/bench/240fps-bench.ts
 */
import { CellBuffer } from '../src/core/cell-buffer.ts';
import { DEFAULT_CELL_STYLE, rgbColor, cellStyleToSgr, cellStyleEqual, type CellStyle } from '../src/core/color.ts';
import { measureDisplayWidth } from '../src/text-layout.ts';
import { Widget } from '../src/widget/widget.ts';
import { renderWidgetTree } from '../src/widget/renderer.ts';
import type { ClippedCellBuffer } from '../src/core/cell-buffer.ts';

const RED: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };
const BLUE: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(0, 128, 255), bold: true };
const GREEN: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(0, 200, 0) };

function bench(name: string, fn: () => void, iterations: number): { perOpUs: number; opsPerSec: number } {
  for (let i = 0; i < Math.min(50, iterations); i += 1) fn();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsed = Bun.nanoseconds() - start;
  const perOp = elapsed / iterations;
  const opsPerSec = Math.floor(1_000_000_000 / perOp);
  const perOpUs = perOp / 1000;
  const perOpUnit = perOpUs < 1 ? `${(perOp).toFixed(0)}ns` : perOpUs < 1000 ? `${perOpUs.toFixed(1)}µs` : `${(perOpUs / 1000).toFixed(2)}ms`;
  console.log(`  ${name.padEnd(50)} ${perOpUnit.padStart(10)}  ${opsPerSec.toLocaleString().padStart(12)} ops/s`);
  return { perOpUs, opsPerSec };
}

const COLS = 300;
const ROWS = 80;
const FRAME_BUDGET_MS = 4.17;

console.log(`\n=== 240 FPS target @ ${COLS}x${ROWS} (${FRAME_BUDGET_MS}ms budget) ===\n`);

// --- Individual component costs ---
console.log('Component costs:');

const buf = new CellBuffer(COLS, ROWS);
const fillResult = bench('fillRow (300 cols)', () => buf.fillRow(0, RED), 50_000);

const drawShort = bench('drawText (20-char ASCII)', () => buf.drawText(0, 0, 'hello world test str', RED), 100_000);
const drawFull = bench('drawText (300-char full row)', () => buf.drawText(0, 0, 'x'.repeat(COLS), RED), 20_000);

const ansiResult = bench('renderAnsiRows (300x80)', () => buf.renderAnsiRows(), 500);

const styleEqSame = bench('cellStyleEqual (same ref)', () => cellStyleEqual(RED, RED), 1_000_000);
const styleEqDiff = bench('cellStyleEqual (diff styles)', () => cellStyleEqual(RED, BLUE), 1_000_000);
const sgrResult = bench('cellStyleToSgr', () => cellStyleToSgr(RED), 500_000);

console.log('\nmeasureDisplayWidth at scale:');
bench('ASCII 300 chars', () => measureDisplayWidth('x'.repeat(300)), 50_000);
bench('ASCII 20 chars', () => measureDisplayWidth('hello world test str'), 200_000);

// --- Simulated frame rendering ---
console.log('\nSimulated full frame render:');

class FillWidget extends Widget {
  s: CellStyle;
  constructor(id: string, s: CellStyle) { super(id); this.s = s; }
  render(buf: ClippedCellBuffer): void {
    for (let r = 0; r < buf.rows; r += 1) {
      buf.drawText(0, r, 'x'.repeat(buf.cols), this.s);
    }
  }
}
class EmptyWidget extends Widget { render(): void {} }

const simple = new FillWidget('root', RED);
const simpleResult = bench('single fill widget', () => renderWidgetTree(simple, COLS, ROWS), 500);

const harness = new EmptyWidget('root');
harness.flexDirection = 'column';
const hdr = new FillWidget('h', BLUE); hdr.height = 1;
const body = new EmptyWidget('body'); body.flexGrow = 1; body.flexDirection = 'row';
const rail = new FillWidget('rail', GREEN); rail.width = 40;
const main = new FillWidget('main', RED); main.flexGrow = 1;
const status = new FillWidget('st', BLUE); status.height = 1;
body.add(rail, main);
harness.add(hdr, body, status);
const harnessResult = bench('harness layout (header+rail+main+status)', () => renderWidgetTree(harness, COLS, ROWS), 500);

// --- Incremental: only ANSI generation (if we cache buffers) ---
console.log('\nANSI generation only (cached buffer):');
for (let r = 0; r < ROWS; r += 1) {
  buf.drawText(0, r, 'x'.repeat(COLS), r % 2 === 0 ? RED : BLUE);
}
const ansiOnly = bench('renderAnsiRows (pre-filled, alternating styles)', () => buf.renderAnsiRows(), 500);

// --- stdout.write simulation ---
console.log('\nstdout.write simulation:');
const rows = buf.renderAnsiRows();
const fullFrame = rows.join('\n');
const frameBytes = Buffer.byteLength(fullFrame);
console.log(`  Frame size: ${(frameBytes / 1024).toFixed(1)} KB (${frameBytes.toLocaleString()} bytes)`);

// --- Budget analysis ---
console.log('\n--- Frame budget analysis (4.17ms @ 240 FPS) ---');
const components = [
  { name: 'Layout + render + composit', us: harnessResult.perOpUs },
  { name: 'ANSI row generation', us: ansiOnly.perOpUs },
];
let totalUs = 0;
for (const c of components) {
  totalUs += c.us;
}
console.log('');
for (const c of components) {
  const pct = ((c.us / (FRAME_BUDGET_MS * 1000)) * 100).toFixed(1);
  console.log(`  ${c.name.padEnd(40)} ${(c.us / 1000).toFixed(2).padStart(8)}ms  (${pct}% of budget)`);
}
const remainingMs = FRAME_BUDGET_MS - (totalUs / 1000);
console.log(`  ${'TOTAL rendering'.padEnd(40)} ${(totalUs / 1000).toFixed(2).padStart(8)}ms  (${((totalUs / 1000 / FRAME_BUDGET_MS) * 100).toFixed(1)}% of budget)`);
console.log(`  ${'Remaining for I/O + app logic'.padEnd(40)} ${remainingMs.toFixed(2).padStart(8)}ms`);
console.log(`  ${'Achievable FPS (render only)'.padEnd(40)} ${Math.floor(1_000_000 / totalUs).toLocaleString().padStart(8)}`);

const writeUs = frameBytes / 1000;
console.log(`\n  Estimated stdout write @ 1GB/s:         ${(writeUs / 1000).toFixed(2)}ms`);
const totalWithWrite = totalUs + writeUs;
console.log(`  Total with write:                        ${(totalWithWrite / 1000).toFixed(2)}ms`);
console.log(`  Achievable FPS (render + write):          ${Math.floor(1_000_000 / totalWithWrite).toLocaleString()}`);

console.log('\n--- Bottleneck identification ---');
const bottlenecks = [
  { name: 'renderAnsiRows', us: ansiOnly.perOpUs },
  { name: 'Widget render (fill cells)', us: harnessResult.perOpUs - ansiOnly.perOpUs },
  { name: 'stdout write (estimated)', us: writeUs },
];
bottlenecks.sort((a, b) => b.us - a.us);
for (const b of bottlenecks) {
  const bar = '█'.repeat(Math.max(1, Math.round(b.us / 50)));
  console.log(`  ${b.name.padEnd(35)} ${(b.us / 1000).toFixed(2).padStart(8)}ms  ${bar}`);
}

console.log('\n=== done ===\n');
