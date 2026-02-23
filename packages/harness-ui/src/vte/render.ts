import {
  defaultCellStyle,
  styleEqual,
  cursorStyleEqual,
  type TerminalCellStyle,
  type TerminalSnapshotFrameCore,
  type TerminalSnapshotFrame,
} from './types.ts';
import { styleToAnsi } from './sgr.ts';

export function renderSnapshotAnsiRow(
  frame: TerminalSnapshotFrameCore,
  rowIndex: number,
  cols: number,
): string {
  const line = frame.richLines[rowIndex];
  const defStyle = defaultCellStyle();

  if (line === undefined) {
    return `${styleToAnsi(defStyle)}${' '.repeat(cols)}\u001b[0m`;
  }

  let output = '';
  let previousStyle: TerminalCellStyle | null = null;

  for (let col = 0; col < cols; col += 1) {
    const cell = line.cells[col] ?? {
      glyph: ' ',
      width: 1,
      continued: false,
      style: defStyle,
    };
    if (cell.continued) continue;
    if (previousStyle === null || !styleEqual(previousStyle, cell.style)) {
      output += styleToAnsi(cell.style);
      previousStyle = cell.style;
    }
    output += cell.glyph;
    if (cell.width === 2) col += 1;
  }

  output += '\u001b[0m';
  return output;
}

export function renderSnapshotText(frame: TerminalSnapshotFrame): string {
  return frame.lines.join('\n');
}

export interface TerminalReplayStep {
  kind: 'output' | 'resize';
  chunk?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalFrameDiff {
  equal: boolean;
  reasons: string[];
}

export function diffTerminalFrames(
  expected: TerminalSnapshotFrame,
  actual: TerminalSnapshotFrame,
): TerminalFrameDiff {
  const reasons: string[] = [];

  if (expected.rows !== actual.rows || expected.cols !== actual.cols) {
    reasons.push('dimensions-mismatch');
  }
  if (expected.activeScreen !== actual.activeScreen) {
    reasons.push('active-screen-mismatch');
  }
  if (expected.modes.bracketedPaste !== actual.modes.bracketedPaste) {
    reasons.push('bracketed-paste-mode-mismatch');
  }
  if (expected.modes.decMouseX10 !== actual.modes.decMouseX10) {
    reasons.push('dec-mouse-x10-mode-mismatch');
  }
  if (expected.modes.decMouseButtonEvent !== actual.modes.decMouseButtonEvent) {
    reasons.push('dec-mouse-button-event-mode-mismatch');
  }
  if (expected.modes.decMouseAnyEvent !== actual.modes.decMouseAnyEvent) {
    reasons.push('dec-mouse-any-event-mode-mismatch');
  }
  if (expected.modes.decFocusTracking !== actual.modes.decFocusTracking) {
    reasons.push('dec-focus-tracking-mode-mismatch');
  }
  if (expected.modes.decMouseSgrEncoding !== actual.modes.decMouseSgrEncoding) {
    reasons.push('dec-mouse-sgr-encoding-mode-mismatch');
  }

  if (expected.cursor.row !== actual.cursor.row || expected.cursor.col !== actual.cursor.col) {
    reasons.push('cursor-position-mismatch');
  }
  if (expected.cursor.visible !== actual.cursor.visible) {
    reasons.push('cursor-visibility-mismatch');
  }
  if (!cursorStyleEqual(expected.cursor.style, actual.cursor.style)) {
    reasons.push('cursor-style-mismatch');
  }

  const rowCount = Math.max(expected.richLines.length, actual.richLines.length);
  for (let row = 0; row < rowCount; row += 1) {
    const eLine = expected.richLines[row];
    const aLine = actual.richLines[row];
    if (eLine === undefined || aLine === undefined) {
      reasons.push(`line-${String(row)}-missing`);
      continue;
    }
    if (eLine.text !== aLine.text || eLine.wrapped !== aLine.wrapped) {
      reasons.push(`line-${String(row)}-text-mismatch`);
    }
    const cellCount = Math.max(eLine.cells.length, aLine.cells.length);
    for (let col = 0; col < cellCount; col += 1) {
      const eCell = eLine.cells[col];
      const aCell = aLine.cells[col];
      if (eCell === undefined || aCell === undefined) {
        reasons.push(`cell-${String(row)}-${String(col)}-missing`);
        continue;
      }
      if (
        eCell.glyph !== aCell.glyph ||
        eCell.width !== aCell.width ||
        eCell.continued !== aCell.continued ||
        !styleEqual(eCell.style, aCell.style)
      ) {
        reasons.push(`cell-${String(row)}-${String(col)}-mismatch`);
      }
    }
  }

  return { equal: reasons.length === 0, reasons };
}
