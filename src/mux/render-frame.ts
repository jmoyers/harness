import { padOrTrimDisplay } from './dual-pane-core.ts';

interface RenderCursorStyle {
  readonly shape: 'block' | 'underline' | 'bar';
  readonly blinking: boolean;
}

interface MuxPerfStatusRow {
  readonly fps: number;
  readonly kbPerSecond: number;
  readonly renderAvgMs: number;
  readonly renderMaxMs: number;
  readonly outputHandleAvgMs: number;
  readonly outputHandleMaxMs: number;
  readonly eventLoopP95Ms: number;
}

interface MuxPaneLayout {
  readonly cols: number;
  readonly paneRows: number;
  readonly leftCols: number;
  readonly rightCols: number;
  readonly separatorCol: number;
  readonly rightStartCol: number;
}

interface MuxModalOverlay {
  readonly left: number;
  readonly top: number;
  readonly rows: readonly string[];
}

const MUTED_SEPARATOR = '\u001b[0;38;5;240m│\u001b[0m';

export function buildRenderRows(
  layout: MuxPaneLayout,
  railRows: readonly string[],
  rightRows: readonly string[],
  perf: MuxPerfStatusRow
): string[] {
  const rows: string[] = [];
  const separatorAnchor = `\u001b[${String(layout.separatorCol)}G`;
  const rightAnchor = `\u001b[${String(layout.rightStartCol)}G`;
  for (let row = 0; row < layout.paneRows; row += 1) {
    const left = railRows[row] ?? ' '.repeat(layout.leftCols);
    const right = rightRows[row] ?? ' '.repeat(layout.rightCols);
    rows.push(`${left}\u001b[0m${separatorAnchor}${MUTED_SEPARATOR}${rightAnchor}${right}`);
  }
  const status = padOrTrimDisplay(
    `[mux] fps=${perf.fps.toFixed(1)} kb/s=${perf.kbPerSecond.toFixed(1)} render=${perf.renderAvgMs.toFixed(2)}/${perf.renderMaxMs.toFixed(2)}ms output=${perf.outputHandleAvgMs.toFixed(2)}/${perf.outputHandleMaxMs.toFixed(2)}ms loop.p95=${perf.eventLoopP95Ms.toFixed(1)}ms`,
    layout.cols
  );
  rows.push(status);
  return rows;
}

export function applyModalOverlay(
  rows: string[],
  overlay: MuxModalOverlay
): void {
  for (let rowOffset = 0; rowOffset < overlay.rows.length; rowOffset += 1) {
    const targetRow = overlay.top + rowOffset;
    if (targetRow < 0 || targetRow >= rows.length) {
      continue;
    }
    const overlayRow = overlay.rows[rowOffset];
    if (overlayRow === undefined) {
      continue;
    }
    rows[targetRow] = `${rows[targetRow] ?? ''}\u001b[${String(overlay.left + 1)}G${overlayRow}`;
  }
}

export function cursorStyleToDecscusr(style: RenderCursorStyle): string {
  if (style.shape === 'block') {
    return style.blinking ? '\u001b[1 q' : '\u001b[2 q';
  }
  if (style.shape === 'underline') {
    return style.blinking ? '\u001b[3 q' : '\u001b[4 q';
  }
  return style.blinking ? '\u001b[5 q' : '\u001b[6 q';
}

export function cursorStyleEqual(
  left: RenderCursorStyle | null,
  right: RenderCursorStyle
): boolean {
  if (left === null) {
    return false;
  }
  return left.shape === right.shape && left.blinking === right.blinking;
}

export function renderCanonicalFrameAnsi(
  rows: readonly string[],
  cursorStyle: RenderCursorStyle,
  cursorVisible: boolean,
  cursorRow: number,
  cursorCol: number
): string {
  let output = '\u001b[?25l\u001b[H\u001b[2J';
  output += cursorStyleToDecscusr(cursorStyle);
  for (let row = 0; row < rows.length; row += 1) {
    output += `\u001b[${String(row + 1)};1H\u001b[2K${rows[row] ?? ''}`;
  }
  if (cursorVisible) {
    output += '\u001b[?25h';
    output += `\u001b[${String(cursorRow + 1)};${String(cursorCol + 1)}H`;
  } else {
    output += '\u001b[?25l';
  }
  return output;
}
