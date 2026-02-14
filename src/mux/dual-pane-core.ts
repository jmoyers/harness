import { measureDisplayWidth, wrapTextForColumns } from '../terminal/snapshot-oracle.ts';

const MIN_PANE_COLS = 20;
const LEFT_RATIO_NUMERATOR = 68;
const LEFT_RATIO_DENOMINATOR = 100;
const SCROLL_STEP_ROWS = 3;

interface DualPaneLayout {
  readonly cols: number;
  readonly rows: number;
  readonly paneRows: number;
  readonly statusRow: number;
  readonly leftCols: number;
  readonly rightCols: number;
  readonly separatorCol: number;
  readonly rightStartCol: number;
}

type PaneTarget = 'left' | 'right' | 'separator' | 'status' | 'outside';

interface SgrMouseEvent {
  readonly sequence: string;
  readonly code: number;
  readonly col: number;
  readonly row: number;
  readonly final: 'M' | 'm';
}

type MuxInputToken =
  | {
      readonly kind: 'passthrough';
      readonly text: string;
    }
  | {
      readonly kind: 'mouse';
      readonly event: SgrMouseEvent;
    };

interface ParsedMuxInput {
  readonly tokens: readonly MuxInputToken[];
  readonly remainder: string;
}

interface RoutedMuxInput {
  readonly forwardToSession: readonly Buffer[];
  readonly leftPaneScrollRows: number;
  readonly rightPaneScrollRows: number;
}

interface EventPaneView {
  readonly lines: readonly string[];
  readonly followOutput: boolean;
  readonly top: number;
  readonly totalRows: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function computeDualPaneLayout(cols: number, rows: number): DualPaneLayout {
  const normalizedCols = Math.max(3, cols);
  const normalizedRows = Math.max(2, rows);
  const paneRows = Math.max(1, normalizedRows - 1);
  const statusRow = paneRows + 1;

  const availablePaneCols = normalizedCols - 1;
  let leftCols = Math.floor((normalizedCols * LEFT_RATIO_NUMERATOR) / LEFT_RATIO_DENOMINATOR);
  leftCols = clamp(leftCols, 1, availablePaneCols - 1);

  if (normalizedCols >= MIN_PANE_COLS * 2 + 1) {
    leftCols = Math.max(MIN_PANE_COLS, leftCols);
    const maxLeft = availablePaneCols - MIN_PANE_COLS;
    leftCols = Math.min(leftCols, maxLeft);
  }

  const rightCols = availablePaneCols - leftCols;

  return {
    cols: normalizedCols,
    rows: normalizedRows,
    paneRows,
    statusRow,
    leftCols,
    rightCols,
    separatorCol: leftCols + 1,
    rightStartCol: leftCols + 2
  };
}

export function classifyPaneAt(layout: DualPaneLayout, col: number, row: number): PaneTarget {
  if (col < 1 || row < 1 || col > layout.cols || row > layout.rows) {
    return 'outside';
  }

  if (row === layout.statusRow) {
    return 'status';
  }

  if (col <= layout.leftCols) {
    return 'left';
  }

  if (col === layout.separatorCol) {
    return 'separator';
  }

  return 'right';
}

const SGR_MOUSE_PREFIX = '\u001b[<';
const NUMERIC_SGR_BODY = /^\d+;\d+;\d+$/;
const PARTIAL_SGR_BODY = /^[0-9;]*$/;

function parseSgrMouseEvent(sequence: string): SgrMouseEvent | null {
  const final = sequence.endsWith('m') ? 'm' : 'M';

  const body = sequence.slice(SGR_MOUSE_PREFIX.length, -1);
  if (!NUMERIC_SGR_BODY.test(body)) {
    return null;
  }

  const [codePart, colPart, rowPart] = body.split(';');
  const code = Number.parseInt(codePart!, 10);
  const col = Number.parseInt(colPart!, 10);
  const row = Number.parseInt(rowPart!, 10);

  return {
    sequence,
    code,
    col,
    row,
    final
  };
}

function splitPartialMouseTail(text: string): { passthrough: string; remainder: string } {
  const tailStart = text.lastIndexOf(SGR_MOUSE_PREFIX);
  if (tailStart < 0) {
    return {
      passthrough: text,
      remainder: ''
    };
  }

  const candidate = text.slice(tailStart + SGR_MOUSE_PREFIX.length);
  if (PARTIAL_SGR_BODY.test(candidate)) {
    return {
      passthrough: text.slice(0, tailStart),
      remainder: text.slice(tailStart)
    };
  }

  return {
    passthrough: text,
    remainder: ''
  };
}

export function parseMuxInputChunk(previousRemainder: string, chunk: Buffer): ParsedMuxInput {
  const input = `${previousRemainder}${chunk.toString('utf8')}`;
  const tokens: MuxInputToken[] = [];

  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf(SGR_MOUSE_PREFIX, cursor);
    if (start < 0) {
      break;
    }

    if (start > cursor) {
      tokens.push({
        kind: 'passthrough',
        text: input.slice(cursor, start)
      });
    }

    let end = -1;
    let index = start + SGR_MOUSE_PREFIX.length;
    while (index < input.length) {
      const char = input[index]!;
      if (char === 'M' || char === 'm') {
        end = index;
        break;
      }
      const isDigit = char >= '0' && char <= '9';
      if (isDigit || char === ';') {
        index += 1;
        continue;
      }
      break;
    }

    if (end < 0) {
      cursor = start;
      break;
    }

    const sequence = input.slice(start, end + 1);
    const parsed = parseSgrMouseEvent(sequence);
    if (parsed === null) {
      tokens.push({
        kind: 'passthrough',
        text: sequence
      });
    } else {
      tokens.push({
        kind: 'mouse',
        event: parsed
      });
    }

    cursor = end + 1;
  }

  const tail = input.slice(cursor);
  const splitTail = splitPartialMouseTail(tail);
  if (splitTail.passthrough.length > 0) {
    tokens.push({
      kind: 'passthrough',
      text: splitTail.passthrough
    });
  }

  return {
    tokens,
    remainder: splitTail.remainder
  };
}

export function wheelDeltaRowsFromCode(code: number): number | null {
  if ((code & 0b0100_0000) === 0) {
    return null;
  }

  return (code & 0b0000_0001) === 0 ? -SCROLL_STEP_ROWS : SCROLL_STEP_ROWS;
}

export function routeMuxInputTokens(tokens: readonly MuxInputToken[], layout: DualPaneLayout): RoutedMuxInput {
  const forwardToSession: Buffer[] = [];
  let leftPaneScrollRows = 0;
  let rightPaneScrollRows = 0;

  for (const token of tokens) {
    if (token.kind === 'passthrough') {
      if (token.text.length > 0) {
        forwardToSession.push(Buffer.from(token.text, 'utf8'));
      }
      continue;
    }

    const target = classifyPaneAt(layout, token.event.col, token.event.row);
    if (target === 'right') {
      const deltaRows = wheelDeltaRowsFromCode(token.event.code);
      if (deltaRows !== null) {
        rightPaneScrollRows += deltaRows;
      }
      continue;
    }

    if (target === 'left') {
      const deltaRows = wheelDeltaRowsFromCode(token.event.code);
      if (deltaRows !== null) {
        leftPaneScrollRows += deltaRows;
        continue;
      }
      forwardToSession.push(Buffer.from(token.event.sequence, 'utf8'));
    }
  }

  return {
    forwardToSession,
    leftPaneScrollRows,
    rightPaneScrollRows
  };
}

function wrappedEventRows(lines: readonly string[], cols: number): string[] {
  if (lines.length === 0) {
    return [''];
  }

  const wrapped: string[] = [];
  for (const line of lines) {
    wrapped.push(...wrapTextForColumns(line, cols));
  }
  return wrapped;
}

export class EventPaneViewport {
  private readonly maxLines: number;

  private readonly lines: string[] = [];

  private followOutput = true;

  private top = 0;

  constructor(maxLines = 1000) {
    this.maxLines = Math.max(1, maxLines);
  }

  append(line: string): void {
    this.lines.push(line);
    while (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
  }

  view(cols: number, paneRows: number): EventPaneView {
    const safeCols = Math.max(1, cols);
    const safeRows = Math.max(1, paneRows);
    const wrapped = wrappedEventRows(this.lines, safeCols);
    const maxTop = Math.max(0, wrapped.length - safeRows);

    if (this.followOutput) {
      this.top = maxTop;
    } else {
      this.top = clamp(this.top, 0, maxTop);
      if (this.top === maxTop) {
        this.followOutput = true;
      }
    }

    const rendered = wrapped.slice(this.top, this.top + safeRows);
    while (rendered.length < safeRows) {
      rendered.push('');
    }

    return {
      lines: rendered,
      followOutput: this.followOutput,
      top: this.top,
      totalRows: wrapped.length
    };
  }

  scrollBy(deltaRows: number, cols: number, paneRows: number): EventPaneView {
    const safeCols = Math.max(1, cols);
    const safeRows = Math.max(1, paneRows);
    const wrapped = wrappedEventRows(this.lines, safeCols);
    const maxTop = Math.max(0, wrapped.length - safeRows);

    const baselineTop = this.followOutput ? maxTop : this.top;
    this.top = clamp(baselineTop + deltaRows, 0, maxTop);
    this.followOutput = this.top === maxTop;

    return this.view(safeCols, safeRows);
  }
}

export function padOrTrimDisplay(text: string, width: number): string {
  if (width <= 0) {
    return '';
  }

  let output = '';
  let outputWidth = 0;
  for (const char of text) {
    const charWidth = Math.max(1, measureDisplayWidth(char));
    if (outputWidth + charWidth > width) {
      break;
    }

    output += char;
    outputWidth += charWidth;
  }

  if (outputWidth < width) {
    output += ' '.repeat(width - outputWidth);
  }

  return output;
}

interface DiffRenderedRowsResult {
  readonly output: string;
  readonly nextRows: readonly string[];
  readonly changedRows: readonly number[];
}

export function diffRenderedRows(currentRows: readonly string[], previousRows: readonly string[]): DiffRenderedRowsResult {
  const changedRows: number[] = [];
  let output = '';

  const rowCount = Math.max(currentRows.length, previousRows.length);
  const nextRows: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const current = currentRows[row] ?? '';
    const previous = previousRows[row] ?? '';
    nextRows.push(current);

    if (current === previous) {
      continue;
    }

    changedRows.push(row);
    output += `\u001b[${String(row + 1)};1H\u001b[2K${current}`;
  }

  return {
    output,
    nextRows,
    changedRows
  };
}
