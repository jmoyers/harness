/**
 * harness-ui v3 rendering microbenchmarks.
 * Run: bun packages/harness-ui/bench/render-bench.ts
 */
import { CellBuffer } from '../src/core/cell-buffer.ts';
import { DEFAULT_CELL_STYLE, rgbColor, type CellStyle } from '../src/core/color.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../src/text-layout.ts';
import { Widget } from '../src/widget/widget.ts';
import { computeLayout } from '../src/widget/layout.ts';
import { renderWidgetTree } from '../src/widget/renderer.ts';
import { reactive } from '../src/widget/reactive.ts';
import { Vte } from '../src/vte/vte.ts';
import type { ClippedCellBuffer } from '../src/core/cell-buffer.ts';

const RED: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };

function bench(name: string, fn: () => void, iterations: number): void {
  // Warmup
  for (let i = 0; i < Math.min(100, iterations); i += 1) fn();

  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsed = Bun.nanoseconds() - start;

  const totalMs = elapsed / 1_000_000;
  const perOp = elapsed / iterations;
  const opsPerSec = Math.floor(1_000_000_000 / perOp);
  const perOpUnit = perOp < 1000 ? `${perOp.toFixed(0)}ns` : `${(perOp / 1000).toFixed(1)}µs`;
  console.log(`  ${name.padEnd(45)} ${perOpUnit.padStart(10)}  ${opsPerSec.toLocaleString().padStart(12)} ops/s  (${totalMs.toFixed(1)}ms total)`);
}

console.log('\n=== harness-ui v3 microbenchmarks ===\n');

// --- CellBuffer ---
console.log('CellBuffer operations (80x24):');
{
  const buf = new CellBuffer(80, 24);
  bench('drawText (short ASCII)', () => buf.drawText(0, 0, 'hello world', RED), 100_000);
  bench('drawText (40-char line)', () => buf.drawText(0, 0, 'a'.repeat(40), RED), 100_000);
  bench('drawText (80-char full row)', () => buf.drawText(0, 0, 'x'.repeat(80), RED), 50_000);
  bench('fillRow', () => buf.fillRow(0, RED), 100_000);
  bench('fillRect (20x10)', () => buf.fillRect({ x: 0, y: 0, width: 20, height: 10 }, RED), 50_000);
  bench('renderAnsiRows (80x24)', () => buf.renderAnsiRows(), 10_000);
}

console.log('\nCellBuffer operations (200x50):');
{
  const buf = new CellBuffer(200, 50);
  bench('drawText (200-char row)', () => buf.drawText(0, 0, 'x'.repeat(200), RED), 20_000);
  bench('fillRow (200 cols)', () => buf.fillRow(0, RED), 50_000);
  bench('renderAnsiRows (200x50)', () => buf.renderAnsiRows(), 2_000);
}

console.log('\nCellBuffer blit:');
{
  const dst = new CellBuffer(80, 24);
  const src = new CellBuffer(40, 12);
  for (let r = 0; r < 12; r += 1) src.drawText(0, r, 'x'.repeat(40), RED);
  bench('blit (40x12 into 80x24)', () => dst.blit(src, 10, 5), 50_000);
}

// --- TextLayout ---
console.log('\nmeasureDisplayWidth:');
{
  const ascii = 'Hello, World! This is a test string for measurement.';
  const cjk = '你好世界这是一个测试字符串用于宽度测量';
  const mixed = 'Hello 你好 World 世界 test 测试';
  bench('ASCII (52 chars)', () => measureDisplayWidth(ascii), 200_000);
  bench('CJK (19 chars)', () => measureDisplayWidth(cjk), 200_000);
  bench('Mixed ASCII+CJK', () => measureDisplayWidth(mixed), 200_000);
}

// --- Layout ---
console.log('\ncomputeLayout:');
{
  class LW extends Widget { render(): void {} }
  function makeTree(depth: number, breadth: number): Widget {
    const w = new LW();
    w.flexDirection = depth % 2 === 0 ? 'column' : 'row';
    w.flexGrow = 1;
    if (depth > 0) {
      for (let i = 0; i < breadth; i += 1) {
        w.add(makeTree(depth - 1, breadth));
      }
    }
    return w;
  }

  const shallow = makeTree(1, 10);
  bench('layout (1 level, 10 children)', () => computeLayout(shallow, 80, 24), 50_000);

  const medium = makeTree(2, 5);
  bench('layout (2 levels, 5x5=25 widgets)', () => computeLayout(medium, 80, 24), 20_000);

  const deep = makeTree(3, 3);
  bench('layout (3 levels, 3x3x3=27 widgets)', () => computeLayout(deep, 80, 24), 20_000);

  const large = makeTree(2, 10);
  bench('layout (2 levels, 10x10=100 widgets)', () => computeLayout(large, 200, 50), 5_000);
}

// --- Render pipeline ---
console.log('\nrenderWidgetTree (end-to-end):');
{
  class FillW extends Widget {
    render(buf: ClippedCellBuffer): void {
      for (let r = 0; r < buf.rows; r += 1) buf.drawText(0, r, 'x'.repeat(buf.cols), RED);
    }
  }
  class EmptyW extends Widget { render(): void {} }

  const simpleRoot = new FillW('root');
  bench('single widget (80x24)', () => renderWidgetTree(simpleRoot, 80, 24), 10_000);

  const dualPane = new EmptyW('root');
  dualPane.flexDirection = 'row';
  const left = new FillW('left'); left.width = 30;
  const right = new FillW('right'); right.flexGrow = 1;
  dualPane.add(left, right);
  bench('dual-pane layout (80x24)', () => renderWidgetTree(dualPane, 80, 24), 10_000);

  const complexRoot = new EmptyW('root');
  complexRoot.flexDirection = 'column';
  const header = new FillW('h'); header.height = 1;
  const body = new EmptyW('b'); body.flexGrow = 1; body.flexDirection = 'row';
  const sidebar = new FillW('sb'); sidebar.width = 30;
  const main = new FillW('m'); main.flexGrow = 1;
  const status = new FillW('st'); status.height = 1;
  body.add(sidebar, main);
  complexRoot.add(header, body, status);
  bench('header+dual+status (80x24)', () => renderWidgetTree(complexRoot, 80, 24), 5_000);
  bench('header+dual+status (200x50)', () => renderWidgetTree(complexRoot, 200, 50), 2_000);
}

// --- VTE ---
console.log('\nVTE ingestion:');
{
  const plainChunk = 'Hello, World! This is a test.\r\n'.repeat(10);
  const coloredChunk = '\x1b[31mred\x1b[0m \x1b[1;32mbold green\x1b[0m normal\r\n'.repeat(10);
  const heavyEscapes = '\x1b[38;2;255;128;0m\x1b[48;2;0;0;64m█\x1b[0m'.repeat(20) + '\r\n';

  bench('plain text (300 bytes)', () => {
    const vte = new Vte(80, 24);
    vte.ingest(plainChunk);
  }, 10_000);

  bench('colored text (SGR)', () => {
    const vte = new Vte(80, 24);
    vte.ingest(coloredChunk);
  }, 10_000);

  bench('heavy RGB escapes', () => {
    const vte = new Vte(80, 24);
    vte.ingest(heavyEscapes);
  }, 10_000);

  const vteStream = new Vte(80, 24);
  const streamChunk = 'x'.repeat(80) + '\r\n';
  bench('sustained stream (80-char lines)', () => {
    vteStream.ingest(streamChunk);
  }, 50_000);

  bench('VTE snapshot (80x24)', () => {
    vteStream.snapshotWithoutHash();
  }, 10_000);
}

// --- Reactive ---
console.log('\nReactive attribute overhead:');
{
  class ReactiveW extends Widget {
    count = reactive(0);
    label = reactive('');
    render(): void {}
  }

  const rw = new ReactiveW('rw');
  bench('reactive get', () => { const _ = rw.count; }, 1_000_000);
  bench('reactive set (same value, no-op)', () => { rw.count = 0; }, 500_000);

  let n = 0;
  bench('reactive set (new value)', () => { rw.count = n++; }, 500_000);

  bench('reactive set string', () => { rw.label = 'test'; rw.label = ''; }, 200_000);
}

console.log('\n=== done ===\n');
