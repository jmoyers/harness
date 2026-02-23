/**
 * Harness home screen benchmark — simulates the real harness layout
 * with sidebar, conversation rail, markdown streaming, status bar,
 * toast, spinner, and partial frame updates.
 *
 * Run: bun packages/harness-ui/bench/harness-home-bench.ts
 */
import { CellBuffer } from '../src/core/cell-buffer.ts';
import { DEFAULT_CELL_STYLE, rgbColor, type CellStyle } from '../src/core/color.ts';
import { Widget } from '../src/widget/widget.ts';
import { renderWidgetTree, type RenderResult } from '../src/widget/renderer.ts';
import { reactive } from '../src/widget/reactive.ts';
import type { ClippedCellBuffer } from '../src/core/cell-buffer.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../src/text-layout.ts';

const layout = new TextLayoutEngine();

const COLS = 300;
const ROWS = 80;
const FRAME_BUDGET_US = 4170;

const THEME = {
  bg: { ...DEFAULT_CELL_STYLE, bg: rgbColor(15, 23, 42) },
  panelBg: { ...DEFAULT_CELL_STYLE, bg: rgbColor(30, 41, 59) },
  headerBg: { ...DEFAULT_CELL_STYLE, fg: rgbColor(56, 189, 248), bg: rgbColor(30, 41, 59), bold: true },
  text: { ...DEFAULT_CELL_STYLE, fg: rgbColor(226, 232, 240) },
  muted: { ...DEFAULT_CELL_STYLE, fg: rgbColor(148, 163, 184) },
  accent: { ...DEFAULT_CELL_STYLE, fg: rgbColor(56, 189, 248) },
  success: { ...DEFAULT_CELL_STYLE, fg: rgbColor(34, 197, 94) },
  error: { ...DEFAULT_CELL_STYLE, fg: rgbColor(239, 68, 68) },
  border: { ...DEFAULT_CELL_STYLE, fg: rgbColor(71, 85, 105) },
  diffAdd: { ...DEFAULT_CELL_STYLE, fg: rgbColor(34, 197, 94), bg: rgbColor(19, 47, 33) },
  diffRem: { ...DEFAULT_CELL_STYLE, fg: rgbColor(239, 68, 68), bg: rgbColor(59, 18, 25) },
  code: { ...DEFAULT_CELL_STYLE, fg: rgbColor(163, 190, 140), bg: rgbColor(30, 41, 59) },
  bold: { ...DEFAULT_CELL_STYLE, fg: rgbColor(251, 191, 36), bold: true },
  heading: { ...DEFAULT_CELL_STYLE, fg: rgbColor(56, 189, 248), bold: true },
};

// Simulated rail with sessions
class RailWidget extends Widget {
  sessions = reactive<string[]>([]);
  activeIndex = reactive(0);

  render(buf: ClippedCellBuffer): void {
    for (let r = 0; r < buf.rows; r += 1) buf.fillRow(r, THEME.panelBg);
    buf.drawText(1, 0, ' Sessions', THEME.headerBg);
    buf.drawText(0, 1, '─'.repeat(buf.cols), THEME.border);
    for (let i = 0; i < this.sessions.length && i + 2 < buf.rows; i += 1) {
      const active = i === this.activeIndex;
      const style = active ? THEME.accent : THEME.text;
      const indicator = active ? '▸ ' : '  ';
      const badge = i % 3 === 0 ? ' ● ' : i % 3 === 1 ? ' ✓ ' : ' ○ ';
      const badgeStyle = i % 3 === 0 ? THEME.success : i % 3 === 1 ? THEME.muted : THEME.error;
      buf.drawText(0, i + 2, indicator, style);
      buf.drawText(2, i + 2, layout.truncate(this.sessions[i]!, buf.cols - 6), style);
      buf.drawText(buf.cols - 4, i + 2, badge, badgeStyle);
    }
  }
}

// Simulated markdown content pane with streaming
class MarkdownPane extends Widget {
  lines = reactive<ReadonlyArray<{ text: string; style: CellStyle }>>([]);
  scrollTop = reactive(0);

  render(buf: ClippedCellBuffer): void {
    for (let r = 0; r < buf.rows; r += 1) buf.fillRow(r, THEME.bg);
    for (let viewRow = 0; viewRow < buf.rows; viewRow += 1) {
      const lineIdx = this.scrollTop + viewRow;
      if (lineIdx >= this.lines.length) break;
      const line = this.lines[lineIdx]!;
      buf.drawText(0, viewRow, layout.truncate(line.text, buf.cols), line.style);
    }
  }
}

// Status bar
class StatusBar extends Widget {
  leftText = reactive('');
  rightText = reactive('');

  render(buf: ClippedCellBuffer): void {
    buf.fillRow(0, THEME.panelBg);
    buf.drawText(1, 0, layout.truncate(this.leftText, buf.cols / 2), THEME.muted);
    const rw = measureDisplayWidth(this.rightText);
    buf.drawText(buf.cols - rw - 1, 0, this.rightText, THEME.muted);
  }
}

// Header
class Header extends Widget {
  title = reactive('');

  render(buf: ClippedCellBuffer): void {
    buf.fillRow(0, THEME.headerBg);
    buf.drawText(1, 0, this.title, THEME.headerBg);
    const hint = 'ctrl+p: palette  ctrl+c: quit';
    buf.drawText(buf.cols - hint.length - 1, 0, hint, THEME.muted);
  }
}

// Separator
class Sep extends Widget {
  render(buf: ClippedCellBuffer): void {
    for (let r = 0; r < buf.rows; r += 1) buf.drawText(0, r, '│', THEME.border);
  }
}

// Build the tree
const root = new class extends Widget { render(): void {} }('root');
root.flexDirection = 'column';

const header = new Header('hdr');
header.height = 1;
header.title = 'harness v3 — nim agent';

const body = new class extends Widget { render(): void {} }('body');
body.flexGrow = 1;
body.flexDirection = 'row';

const rail = new RailWidget('rail');
rail.width = 40;
rail.sessions = Array.from({ length: 20 }, (_, i) => `Session ${i + 1}: ${['Fix auth bug', 'Refactor module', 'Write tests', 'Update deps', 'Review PR'][i % 5]}`);
rail.activeIndex = 2;

const sep = new Sep('sep');
sep.width = 1;

const main = new MarkdownPane('main');
main.flexGrow = 1;

// Simulate rich markdown content with mixed styles
const mdLines: Array<{ text: string; style: CellStyle }> = [];
mdLines.push({ text: '# Agent Session: Fix authentication bug', style: THEME.heading });
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: 'I\'ll analyze the authentication module and fix the session expiry issue.', style: THEME.text });
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: '## Analysis', style: THEME.heading });
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: 'The bug is in `src/auth/session.ts` where the token refresh logic has a race condition.', style: THEME.text });
mdLines.push({ text: 'When two requests arrive simultaneously, both detect the expired token and attempt refresh.', style: THEME.text });
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: '▌ The fix requires a mutex around the refresh operation to serialize concurrent attempts.', style: THEME.muted });
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: '  typescript', style: { ...THEME.code, dim: true } });
for (let i = 0; i < 15; i += 1) {
  mdLines.push({ text: `  ${i === 0 ? 'async function refreshToken(session: Session) {' : i === 14 ? '}' : `  // line ${i} of the fix implementation`}`, style: THEME.code });
}
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: '## Diff', style: THEME.heading });
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: ' src/auth/session.ts +15 -3', style: { ...THEME.text, bold: true } });
for (let i = 0; i < 10; i += 1) {
  if (i % 3 === 0) mdLines.push({ text: `+  const mutex = new Mutex();  // added line ${i}`, style: THEME.diffAdd });
  else if (i % 3 === 1) mdLines.push({ text: `-  await refreshUnsafe(token);  // removed line ${i}`, style: THEME.diffRem });
  else mdLines.push({ text: `   const existing = cache.get(key);  // context`, style: THEME.muted });
}
mdLines.push({ text: '', style: THEME.text });
mdLines.push({ text: '• Fix applied successfully', style: THEME.success });
mdLines.push({ text: '• Tests passing: 142/142', style: THEME.success });
mdLines.push({ text: '• Ready for review', style: THEME.accent });

for (let i = 0; i < 30; i += 1) {
  mdLines.push({ text: `Additional context line ${i} — this simulates a long conversation with scrollback content that fills the terminal viewport and requires scroll management.`, style: THEME.text });
}

main.lines = mdLines;

const status = new StatusBar('st');
status.height = 1;
status.leftText = '~/dev/harness-2';
status.rightText = 'codex · 142 tokens · 0.3s';

body.add(rail, sep, main);
root.add(header, body, status);

// --- Benchmarks ---
function bench(name: string, fn: () => void, iterations: number): number {
  for (let i = 0; i < 20; i += 1) fn();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsed = Bun.nanoseconds() - start;
  const perOpUs = elapsed / iterations / 1000;
  const fps = Math.floor(1_000_000 / perOpUs);
  const perOpMs = perOpUs / 1000;
  console.log(`  ${name.padEnd(50)} ${perOpMs.toFixed(3).padStart(8)}ms  ${fps.toLocaleString().padStart(8)} FPS`);
  return perOpUs;
}

console.log(`\n=== Harness home screen benchmark @ ${COLS}x${ROWS} ===\n`);

console.log('Full frame render (worst case — everything redraws):');
const fullFrame = bench('Full renderWidgetTree', () => renderWidgetTree(root, COLS, ROWS), 500);

console.log('\nComponent isolation:');
const layoutOnly = bench('Layout pass only', () => {
  const { computeLayout } = require('../src/widget/layout.ts');
  computeLayout(root, COLS, ROWS);
}, 2000);

let cachedResult: RenderResult;
cachedResult = renderWidgetTree(root, COLS, ROWS);
const ansiOnly = bench('ANSI generation only (cached buffer)', () => {
  cachedResult.buffer.renderAnsiRows();
}, 500);

console.log('\nPartial updates (typical frame — only status bar changes):');
const partialUpdate = bench('Status bar text change + full re-render', () => {
  status.rightText = `codex · ${Math.floor(Math.random() * 1000)} tokens · ${(Math.random() * 2).toFixed(1)}s`;
  renderWidgetTree(root, COLS, ROWS);
}, 1000);

console.log('\nStreaming simulation (append 1 line to markdown):');
let streamCounter = 0;
const streamUpdate = bench('Append line + full re-render', () => {
  const newLines = [...main.lines, { text: `Streaming token ${streamCounter++}...`, style: THEME.text }];
  main.lines = newLines;
  renderWidgetTree(root, COLS, ROWS);
}, 500);

console.log('\nRail selection change (click different session):');
const railChange = bench('Change active session + full re-render', () => {
  rail.activeIndex = (rail.activeIndex + 1) % rail.sessions.length;
  renderWidgetTree(root, COLS, ROWS);
}, 1000);

// Budget analysis
console.log(`\n--- 240 FPS Budget Analysis (${FRAME_BUDGET_US / 1000}ms per frame) ---\n`);

const scenarios = [
  { name: 'Full redraw (worst case)', us: fullFrame },
  { name: 'Status bar update (typical idle)', us: partialUpdate },
  { name: 'Streaming token append', us: streamUpdate },
  { name: 'Rail selection change', us: railChange },
];

for (const s of scenarios) {
  const pct = (s.us / FRAME_BUDGET_US * 100).toFixed(1);
  const fps = Math.floor(1_000_000 / s.us);
  const ok = s.us < FRAME_BUDGET_US ? '✓' : '✗';
  console.log(`  ${ok} ${s.name.padEnd(45)} ${(s.us / 1000).toFixed(3).padStart(8)}ms  (${pct.padStart(5)}% budget)  ${fps.toLocaleString().padStart(6)} FPS`);
}

console.log('\n=== done ===\n');
