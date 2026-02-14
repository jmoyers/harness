import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { startCodexLiveSession, type CodexLiveEvent } from '../src/codex/live-session.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';
import { renderSnapshotAnsiRow, type TerminalSnapshotFrame } from '../src/terminal/snapshot-oracle.ts';
import {
  createNormalizedEvent,
  type EventScope,
  type NormalizedEventEnvelope
} from '../src/events/normalized-events.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import {
  EventPaneViewport,
  classifyPaneAt,
  computeDualPaneLayout,
  diffRenderedRows,
  padOrTrimDisplay,
  parseMuxInputChunk,
  routeMuxInputTokens
} from '../src/mux/dual-pane-core.ts';

interface MuxOptions {
  codexArgs: string[];
  storePath: string;
  conversationId: string;
  turnId: string;
  scope: EventScope;
}

interface TerminalPaletteProbe {
  foregroundHex?: string;
  backgroundHex?: string;
}

interface FocusEventExtraction {
  readonly sanitized: Buffer;
  readonly focusInCount: number;
  readonly focusOutCount: number;
}

interface RenderCursorStyle {
  readonly shape: 'block' | 'underline' | 'bar';
  readonly blinking: boolean;
}

interface SelectionPoint {
  readonly row: number;
  readonly col: number;
}

interface PaneSelection {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
}

interface PaneSelectionDrag {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly hasDragged: boolean;
}

const ENABLE_INPUT_MODES = '\u001b[>1u\u001b[?1000h\u001b[?1002h\u001b[?1004h\u001b[?1006h';
const DISABLE_INPUT_MODES = '\u001b[?2004l\u001b[?1006l\u001b[?1004l\u001b[?1002l\u001b[?1000l\u001b[<u';
const DEFAULT_RESIZE_MIN_INTERVAL_MS = 33;
const DEFAULT_PTY_RESIZE_SETTLE_MS = 75;

function restoreTerminalState(newline: boolean): void {
  try {
    process.stdout.write(`${DISABLE_INPUT_MODES}\u001b[?25h\u001b[0m${newline ? '\n' : ''}`);
  } catch {
    // Best-effort restore only.
  }

  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Best-effort restore only.
    }
    try {
      process.stdin.pause();
    } catch {
      // Best-effort restore only.
    }
  }
}

function extractFocusEvents(chunk: Buffer): FocusEventExtraction {
  const text = chunk.toString('utf8');
  const focusInMatches = text.match(/\u001b\[I/g);
  const focusOutMatches = text.match(/\u001b\[O/g);
  const focusInCount = focusInMatches?.length ?? 0;
  const focusOutCount = focusOutMatches?.length ?? 0;

  if (focusInCount === 0 && focusOutCount === 0) {
    return {
      sanitized: chunk,
      focusInCount: 0,
      focusOutCount: 0
    };
  }

  const sanitizedText = text.replaceAll('\u001b[I', '').replaceAll('\u001b[O', '');
  return {
    sanitized: Buffer.from(sanitizedText, 'utf8'),
    focusInCount,
    focusOutCount
  };
}

function appendDebugRecord(debugPath: string | null, record: Record<string, unknown>): void {
  if (debugPath === null) {
    return;
  }
  try {
    appendFileSync(
      debugPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        ...record
      })}\n`,
      'utf8'
    );
  } catch {
    // Debug tracing must never break the live session loop.
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeExitCode(exit: PtyExit): number {
  if (exit.code !== null) {
    return exit.code;
  }
  if (exit.signal !== null) {
    return 128;
  }
  return 1;
}

function mapToNormalizedEvent(
  event: CodexLiveEvent,
  scope: EventScope,
  idFactory: () => string
): NormalizedEventEnvelope | null {
  if (event.type === 'terminal-output') {
    return createNormalizedEvent(
      'provider',
      'provider-text-delta',
      scope,
      {
        kind: 'text-delta',
        threadId: scope.conversationId,
        turnId: scope.turnId ?? 'turn-live',
        delta: event.chunk.toString('utf8')
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'turn-completed') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'provider',
      'provider-turn-completed',
      scope,
      {
        kind: 'turn',
        threadId: asString(payloadObject['thread-id'], scope.conversationId),
        turnId: asString(payloadObject['turn-id'], scope.turnId ?? 'turn-live'),
        status: 'completed'
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'attention-required') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'meta',
      'meta-attention-raised',
      scope,
      {
        kind: 'attention',
        threadId: asString(payloadObject['thread-id'], scope.conversationId),
        turnId: asString(payloadObject['turn-id'], scope.turnId ?? 'turn-live'),
        reason: event.reason,
        detail: asString(payloadObject.type, 'notify')
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'notify') {
    const payloadObject = event.record.payload;
    return createNormalizedEvent(
      'meta',
      'meta-notify-observed',
      scope,
      {
        kind: 'notify',
        notifyType: asString(payloadObject.type, 'unknown'),
        raw: payloadObject
      },
      () => new Date(),
      idFactory
    );
  }

  if (event.type === 'session-exit') {
    return createNormalizedEvent(
      'meta',
      'meta-attention-cleared',
      scope,
      {
        kind: 'attention',
        threadId: scope.conversationId,
        turnId: scope.turnId ?? 'turn-live',
        reason: 'stalled',
        detail: 'session-exit'
      },
      () => new Date(),
      idFactory
    );
  }

  return null;
}

function summarizeEvent(event: NormalizedEventEnvelope): string {
  const turnId = event.scope.turnId ?? '-';
  const payload = event.payload;

  if (event.type === 'meta-notify-observed' && payload.kind === 'notify') {
    return `${event.ts} notify ${payload.notifyType}`;
  }

  if (event.type === 'meta-attention-raised' && payload.kind === 'attention') {
    return `${event.ts} attention ${payload.reason}`;
  }

  if (event.type === 'provider-turn-completed') {
    return `${event.ts} turn completed (${turnId})`;
  }

  if (event.type === 'meta-attention-cleared') {
    return `${event.ts} session exited`;
  }

  return `${event.ts} ${event.type}`;
}

function terminalSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 120, rows: 40 };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseOscRgbHex(value: string): string | null {
  if (!value.startsWith('rgb:')) {
    return null;
  }

  const components = value.slice(4).split('/');
  if (components.length !== 3) {
    return null;
  }

  const bytes: string[] = [];
  for (const component of components) {
    const normalized = component.trim();
    if (normalized.length < 1 || normalized.length > 4) {
      return null;
    }
    if (!/^[0-9a-fA-F]+$/.test(normalized)) {
      return null;
    }

    const raw = Number.parseInt(normalized, 16);
    if (Number.isNaN(raw)) {
      return null;
    }
    const max = (1 << (normalized.length * 4)) - 1;
    const scaled = Math.round((raw * 255) / max);
    bytes.push(scaled.toString(16).padStart(2, '0'));
  }

  return `${bytes[0]}${bytes[1]}${bytes[2]}`;
}

function extractOscColorReplies(buffer: string): {
  readonly remainder: string;
  readonly foregroundHex?: string;
  readonly backgroundHex?: string;
} {
  let remainder = buffer;
  let foregroundHex: string | undefined;
  let backgroundHex: string | undefined;

  while (true) {
    const start = remainder.indexOf('\u001b]');
    if (start < 0) {
      break;
    }
    if (start > 0) {
      remainder = remainder.slice(start);
    }

    const bellTerminator = remainder.indexOf('\u0007', 2);
    const stTerminator = remainder.indexOf('\u001b\\', 2);
    let end = -1;
    let terminatorLength = 0;

    if (bellTerminator >= 0 && (stTerminator < 0 || bellTerminator < stTerminator)) {
      end = bellTerminator;
      terminatorLength = 1;
    } else if (stTerminator >= 0) {
      end = stTerminator;
      terminatorLength = 2;
    }

    if (end < 0) {
      break;
    }

    const payload = remainder.slice(2, end);
    remainder = remainder.slice(end + terminatorLength);
    const separator = payload.indexOf(';');
    if (separator < 0) {
      continue;
    }

    const code = payload.slice(0, separator);
    const value = payload.slice(separator + 1);
    const hex = parseOscRgbHex(value);
    if (hex === null) {
      continue;
    }

    if (code === '10') {
      foregroundHex = hex;
      continue;
    }

    if (code === '11') {
      backgroundHex = hex;
    }
  }

  if (remainder.length > 512) {
    remainder = remainder.slice(-512);
  }

  return {
    remainder,
    foregroundHex,
    backgroundHex
  };
}

async function probeTerminalPalette(timeoutMs = 80): Promise<TerminalPaletteProbe> {
  return await new Promise((resolve) => {
    let finished = false;
    let buffer = '';
    let foregroundHex: string | undefined;
    let backgroundHex: string | undefined;

    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      resolve({ foregroundHex, backgroundHex });
    };

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const extracted = extractOscColorReplies(buffer);
      buffer = extracted.remainder;

      if (extracted.foregroundHex !== undefined) {
        foregroundHex = extracted.foregroundHex;
      }
      if (extracted.backgroundHex !== undefined) {
        backgroundHex = extracted.backgroundHex;
      }

      if (foregroundHex !== undefined && backgroundHex !== undefined) {
        finish();
      }
    };

    const timer = setTimeout(() => {
      finish();
    }, timeoutMs);

    process.stdin.on('data', onData);
    process.stdout.write('\u001b]10;?\u0007\u001b]11;?\u0007');
  });
}

function parseArgs(argv: string[]): MuxOptions {
  const conversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;

  return {
    codexArgs: argv,
    storePath: process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite',
    conversationId,
    turnId,
    scope: {
      tenantId: process.env.HARNESS_TENANT_ID ?? 'tenant-local',
      userId: process.env.HARNESS_USER_ID ?? 'user-local',
      workspaceId: process.env.HARNESS_WORKSPACE_ID ?? basename(process.cwd()),
      worktreeId: process.env.HARNESS_WORKTREE_ID ?? 'worktree-local',
      conversationId,
      turnId
    }
  };
}

function buildRenderRows(
  layout: ReturnType<typeof computeDualPaneLayout>,
  leftFrame: TerminalSnapshotFrame,
  events: EventPaneViewport,
  conversationId: string,
  selectionActive: boolean
): string[] {
  const rightView = events.view(layout.rightCols, layout.paneRows);

  const rows: string[] = [];
  for (let row = 0; row < layout.paneRows; row += 1) {
    const left = renderSnapshotAnsiRow(leftFrame, row, layout.leftCols);
    const right = padOrTrimDisplay(rightView.lines[row] ?? '', layout.rightCols);
    rows.push(`${left}\u001b[0m│${right}`);
  }

  const mode = rightView.followOutput
    ? 'events=live'
    : `events=scroll(${String(rightView.top + 1)}/${String(rightView.totalRows)})`;
  const leftMode = leftFrame.viewport.followOutput
    ? 'pty=live'
    : `pty=scroll(${String(leftFrame.viewport.top + 1)}/${String(leftFrame.viewport.totalRows)})`;
  const selection = selectionActive ? 'select=drag' : 'select=idle';
  const status = padOrTrimDisplay(
    `[mux] conversation=${conversationId} ${leftMode} ${mode} ${selection} drag copy alt-pass ctrl-] quit`,
    layout.cols
  );
  rows.push(status);

  return rows;
}

function cursorStyleToDecscusr(style: RenderCursorStyle): string {
  if (style.shape === 'block') {
    return style.blinking ? '\u001b[1 q' : '\u001b[2 q';
  }
  if (style.shape === 'underline') {
    return style.blinking ? '\u001b[3 q' : '\u001b[4 q';
  }
  return style.blinking ? '\u001b[5 q' : '\u001b[6 q';
}

function cursorStyleEqual(left: RenderCursorStyle | null, right: RenderCursorStyle): boolean {
  if (left === null) {
    return false;
  }
  return left.shape === right.shape && left.blinking === right.blinking;
}

function compareSelectionPoints(left: SelectionPoint, right: SelectionPoint): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }
  return left.col - right.col;
}

function selectionPointsEqual(left: SelectionPoint, right: SelectionPoint): boolean {
  return left.row === right.row && left.col === right.col;
}

function normalizeSelection(selection: PaneSelection): { start: SelectionPoint; end: SelectionPoint } {
  if (compareSelectionPoints(selection.anchor, selection.focus) <= 0) {
    return {
      start: selection.anchor,
      end: selection.focus
    };
  }
  return {
    start: selection.focus,
    end: selection.anchor
  };
}

function clampPanePoint(layout: ReturnType<typeof computeDualPaneLayout>, row: number, col: number): SelectionPoint {
  return {
    row: Math.max(0, Math.min(layout.paneRows - 1, row)),
    col: Math.max(0, Math.min(layout.leftCols - 1, col))
  };
}

function pointFromMouseEvent(
  layout: ReturnType<typeof computeDualPaneLayout>,
  event: { col: number; row: number }
): SelectionPoint {
  return clampPanePoint(layout, event.row - 1, event.col - 1);
}

function isWheelMouseCode(code: number): boolean {
  return (code & 0b0100_0000) !== 0;
}

function isMotionMouseCode(code: number): boolean {
  return (code & 0b0010_0000) !== 0;
}

function hasAltModifier(code: number): boolean {
  return (code & 0b0000_1000) !== 0;
}

function isLeftButtonPress(code: number, final: 'M' | 'm'): boolean {
  if (final !== 'M') {
    return false;
  }
  if (isWheelMouseCode(code) || isMotionMouseCode(code)) {
    return false;
  }
  return (code & 0b0000_0011) === 0;
}

function isMouseRelease(final: 'M' | 'm'): boolean {
  return final === 'm';
}

function isSelectionDrag(code: number, final: 'M' | 'm'): boolean {
  return final === 'M' && isMotionMouseCode(code);
}

function cellGlyphForOverlay(frame: TerminalSnapshotFrame, row: number, col: number): string {
  const line = frame.richLines[row];
  if (line === undefined) {
    return ' ';
  }
  const cell = line.cells[col];
  if (cell === undefined) {
    return ' ';
  }
  if (cell.continued) {
    return ' ';
  }
  return cell.glyph.length > 0 ? cell.glyph : ' ';
}

function renderSelectionOverlay(
  frame: TerminalSnapshotFrame,
  selection: PaneSelection | null
): string {
  if (selection === null) {
    return '';
  }

  const { start, end } = normalizeSelection(selection);
  let output = '';
  for (let row = start.row; row <= end.row; row += 1) {
    const rowStartCol = row === start.row ? start.col : 0;
    const rowEndCol = row === end.row ? end.col : frame.cols - 1;
    if (rowEndCol < rowStartCol) {
      continue;
    }

    output += `\u001b[${String(row + 1)};${String(rowStartCol + 1)}H\u001b[7m`;
    for (let col = rowStartCol; col <= rowEndCol; col += 1) {
      output += cellGlyphForOverlay(frame, row, col);
    }
    output += '\u001b[0m';
  }

  return output;
}

function selectionText(frame: TerminalSnapshotFrame, selection: PaneSelection | null): string {
  if (selection === null) {
    return '';
  }

  const { start, end } = normalizeSelection(selection);
  const rows: string[] = [];
  for (let row = start.row; row <= end.row; row += 1) {
    const rowStartCol = row === start.row ? start.col : 0;
    const rowEndCol = row === end.row ? end.col : frame.cols - 1;
    if (rowEndCol < rowStartCol) {
      rows.push('');
      continue;
    }

    let line = '';
    for (let col = rowStartCol; col <= rowEndCol; col += 1) {
      const lineRef = frame.richLines[row];
      const cell = lineRef?.cells[col];
      if (cell === undefined || cell.continued) {
        continue;
      }
      line += cell.glyph;
    }
    rows.push(line);
  }
  return rows.join('\n');
}

function isCopyShortcutInput(input: Buffer): boolean {
  if (input.length === 1 && input[0] === 0x03) {
    return true;
  }

  const text = input.toString('utf8');
  return /\u001b\[(99|67);(\d+)u/.test(text);
}

function writeTextToClipboard(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  try {
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    process.stdout.write(`\u001b]52;c;${encoded}\u0007`);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('codex:live:mux requires a TTY stdin/stdout\n');
    return 2;
  }

  const options = parseArgs(process.argv.slice(2));
  const store = new SqliteEventStore(options.storePath);
  const debugPath = process.env.HARNESS_MUX_DEBUG_PATH ?? null;

  const maxEventLines = 1000;
  const events = new EventPaneViewport(maxEventLines);

  let size = terminalSize();
  let layout = computeDualPaneLayout(size.cols, size.rows);
  const resizeMinIntervalMs = parsePositiveInt(
    process.env.HARNESS_MUX_RESIZE_MIN_INTERVAL_MS,
    DEFAULT_RESIZE_MIN_INTERVAL_MS
  );
  const ptyResizeSettleMs = parsePositiveInt(
    process.env.HARNESS_MUX_PTY_RESIZE_SETTLE_MS,
    DEFAULT_PTY_RESIZE_SETTLE_MS
  );

  process.stdin.setRawMode(true);
  process.stdin.resume();

  const probedPalette = await probeTerminalPalette();

  const liveSession = startCodexLiveSession({
    args: options.codexArgs,
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color'
    },
    terminalForegroundHex: process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex,
    terminalBackgroundHex: process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex
  });

  const idFactory = (): string => `event-${randomUUID()}`;
  let exit: PtyExit | null = null;
  let dirty = true;
  let stop = false;
  let inputRemainder = '';
  let previousRows: readonly string[] = [];
  let forceFullClear = true;
  let renderedCursorVisible: boolean | null = null;
  let renderedCursorStyle: RenderCursorStyle | null = null;
  let renderedBracketedPaste: boolean | null = null;
  let renderScheduled = false;
  let selection: PaneSelection | null = null;
  let selectionDrag: PaneSelectionDrag | null = null;
  let resizeTimer: NodeJS.Timeout | null = null;
  let pendingSize: { cols: number; rows: number } | null = null;
  let lastResizeApplyAtMs = 0;
  let ptyResizeTimer: NodeJS.Timeout | null = null;
  let pendingPtySize: { cols: number; rows: number } | null = null;
  let currentPtySize: { cols: number; rows: number } | null = null;

  const scheduleRender = (): void => {
    if (renderScheduled) {
      return;
    }
    renderScheduled = true;
    setImmediate(() => {
      renderScheduled = false;
      render();
      if (dirty) {
        scheduleRender();
      }
    });
  };

  const markDirty = (): void => {
    dirty = true;
    scheduleRender();
  };

  const applyPtyResize = (ptySize: { cols: number; rows: number }): void => {
    if (
      currentPtySize !== null &&
      currentPtySize.cols === ptySize.cols &&
      currentPtySize.rows === ptySize.rows
    ) {
      return;
    }
    currentPtySize = ptySize;
    liveSession.resize(ptySize.cols, ptySize.rows);
    appendDebugRecord(debugPath, {
      kind: 'resize-pty-apply',
      ptyCols: ptySize.cols,
      ptyRows: ptySize.rows
    });
    markDirty();
  };

  const flushPendingPtyResize = (): void => {
    ptyResizeTimer = null;
    const ptySize = pendingPtySize;
    if (ptySize === null) {
      return;
    }
    pendingPtySize = null;
    applyPtyResize(ptySize);
  };

  const schedulePtyResize = (ptySize: { cols: number; rows: number }, immediate = false): void => {
    pendingPtySize = ptySize;
    appendDebugRecord(debugPath, {
      kind: 'resize-pty-schedule',
      ptyCols: ptySize.cols,
      ptyRows: ptySize.rows,
      immediate,
      settleMs: ptyResizeSettleMs
    });
    if (immediate) {
      if (ptyResizeTimer !== null) {
        clearTimeout(ptyResizeTimer);
        ptyResizeTimer = null;
      }
      flushPendingPtyResize();
      return;
    }

    if (ptyResizeTimer !== null) {
      clearTimeout(ptyResizeTimer);
    }
    ptyResizeTimer = setTimeout(flushPendingPtyResize, ptyResizeSettleMs);
  };

  const applyLayout = (nextSize: { cols: number; rows: number }, forceImmediatePtyResize = false): void => {
    const nextLayout = computeDualPaneLayout(nextSize.cols, nextSize.rows);
    schedulePtyResize(
      {
        cols: nextLayout.leftCols,
        rows: nextLayout.paneRows
      },
      forceImmediatePtyResize
    );
    if (
      nextLayout.cols === layout.cols &&
      nextLayout.rows === layout.rows &&
      nextLayout.leftCols === layout.leftCols &&
      nextLayout.rightCols === layout.rightCols &&
      nextLayout.paneRows === layout.paneRows
    ) {
      return;
    }
    size = nextSize;
    layout = nextLayout;
    // Force a full clear on actual layout changes to avoid stale diagonal artifacts during drag.
    previousRows = [];
    forceFullClear = true;
    appendDebugRecord(debugPath, {
      kind: 'resize-layout-apply',
      cols: nextLayout.cols,
      rows: nextLayout.rows,
      leftCols: nextLayout.leftCols,
      rightCols: nextLayout.rightCols,
      paneRows: nextLayout.paneRows
    });
    markDirty();
  };

  const flushPendingResize = (): void => {
    resizeTimer = null;
    const nextSize = pendingSize;
    if (nextSize === null) {
      return;
    }

    const nowMs = Date.now();
    const elapsedMs = nowMs - lastResizeApplyAtMs;
    if (elapsedMs < resizeMinIntervalMs) {
      resizeTimer = setTimeout(flushPendingResize, resizeMinIntervalMs - elapsedMs);
      return;
    }

    pendingSize = null;
    applyLayout(nextSize);
    lastResizeApplyAtMs = Date.now();

    if (pendingSize !== null && resizeTimer === null) {
      resizeTimer = setTimeout(flushPendingResize, resizeMinIntervalMs);
    }
  };

  const queueResize = (nextSize: { cols: number; rows: number }): void => {
    pendingSize = nextSize;
    if (resizeTimer !== null) {
      return;
    }

    const nowMs = Date.now();
    const elapsedMs = nowMs - lastResizeApplyAtMs;
    const delayMs = elapsedMs >= resizeMinIntervalMs ? 0 : resizeMinIntervalMs - elapsedMs;
    resizeTimer = setTimeout(flushPendingResize, delayMs);
  };

  const appendEventLine = (line: string): void => {
    events.append(line);
    markDirty();
  };

  const render = (): void => {
    if (!dirty) {
      return;
    }

    const leftFrame = liveSession.snapshot();
    const renderSelection =
      selectionDrag !== null && selectionDrag.hasDragged
        ? {
            anchor: selectionDrag.anchor,
            focus: selectionDrag.focus
          }
        : selection;
    const rows = buildRenderRows(layout, leftFrame, events, options.conversationId, renderSelection !== null);
    const diff = diffRenderedRows(rows, previousRows);

    let output = '';
    if (forceFullClear) {
      output += '\u001b[?25l\u001b[H\u001b[2J';
      forceFullClear = false;
      renderedCursorVisible = false;
      renderedCursorStyle = null;
      renderedBracketedPaste = null;
    }
    output += diff.output;

    const shouldEnableBracketedPaste = leftFrame.modes.bracketedPaste;
    if (renderedBracketedPaste !== shouldEnableBracketedPaste) {
      output += shouldEnableBracketedPaste ? '\u001b[?2004h' : '\u001b[?2004l';
      renderedBracketedPaste = shouldEnableBracketedPaste;
    }

    if (!cursorStyleEqual(renderedCursorStyle, leftFrame.cursor.style)) {
      output += cursorStyleToDecscusr(leftFrame.cursor.style);
      renderedCursorStyle = leftFrame.cursor.style;
    }

    output += renderSelectionOverlay(leftFrame, renderSelection);

    const shouldShowCursor =
      leftFrame.viewport.followOutput &&
      leftFrame.cursor.visible &&
      leftFrame.cursor.row >= 0 &&
      leftFrame.cursor.row < layout.paneRows &&
      leftFrame.cursor.col >= 0 &&
      leftFrame.cursor.col < layout.leftCols;

    if (shouldShowCursor) {
      if (renderedCursorVisible !== true) {
        output += '\u001b[?25h';
        renderedCursorVisible = true;
      }
      output += `\u001b[${String(leftFrame.cursor.row + 1)};${String(leftFrame.cursor.col + 1)}H`;
    } else {
      if (renderedCursorVisible !== false) {
        output += '\u001b[?25l';
        renderedCursorVisible = false;
      }
    }

    if (output.length > 0) {
      process.stdout.write(output);
    }
    appendDebugRecord(debugPath, {
      kind: 'render',
      changedRows: diff.changedRows,
      leftViewportTop: leftFrame.viewport.top,
      leftViewportFollow: leftFrame.viewport.followOutput,
      leftViewportTotalRows: leftFrame.viewport.totalRows,
      leftCursorRow: leftFrame.cursor.row,
      leftCursorCol: leftFrame.cursor.col,
      leftCursorVisible: leftFrame.cursor.visible,
      shouldShowCursor
    });

    previousRows = diff.nextRows;
    dirty = false;
  };

  liveSession.onEvent((event) => {
    const normalized = mapToNormalizedEvent(event, options.scope, idFactory);
    if (normalized !== null) {
      store.appendEvents([normalized]);
      if (normalized.type !== 'provider-text-delta') {
        appendEventLine(summarizeEvent(normalized));
      }
    }

    if (event.type === 'terminal-output') {
      markDirty();
    }

    if (event.type === 'session-exit') {
      exit = event.exit;
      stop = true;
      markDirty();
    }
  });

  const onInput = (chunk: Buffer): void => {
    if (chunk.length === 1 && chunk[0] === 0x1d) {
      stop = true;
      liveSession.close();
      return;
    }

    if ((selection !== null || selectionDrag !== null) && chunk.length === 1 && chunk[0] === 0x1b) {
      selection = null;
      selectionDrag = null;
      appendDebugRecord(debugPath, {
        kind: 'selection-clear-escape'
      });
      markDirty();
      return;
    }

    const focusExtraction = extractFocusEvents(chunk);
    if (focusExtraction.focusInCount > 0) {
      process.stdout.write(ENABLE_INPUT_MODES);
      markDirty();
    }
    if (focusExtraction.focusOutCount > 0) {
      markDirty();
    }

    if (focusExtraction.sanitized.length === 0) {
      appendDebugRecord(debugPath, {
        kind: 'input-focus-only',
        rawBytesHex: chunk.toString('hex'),
        focusInCount: focusExtraction.focusInCount,
        focusOutCount: focusExtraction.focusOutCount
      });
      return;
    }

    if (selection !== null && isCopyShortcutInput(focusExtraction.sanitized)) {
      const selectedFrame = liveSession.snapshot();
      const copied = writeTextToClipboard(selectionText(selectedFrame, selection));
      appendEventLine(`${new Date().toISOString()} selection ${copied ? 'copied' : 'copy-failed'}`);
      appendDebugRecord(debugPath, {
        kind: 'selection-copy-shortcut',
        copied,
        rawBytesHex: chunk.toString('hex'),
        sanitizedBytesHex: focusExtraction.sanitized.toString('hex')
      });
      if (copied) {
        markDirty();
      }
      return;
    }

    const parsed = parseMuxInputChunk(inputRemainder, focusExtraction.sanitized);
    inputRemainder = parsed.remainder;

    const routedTokens: Array<(typeof parsed.tokens)[number]> = [];
    for (const token of parsed.tokens) {
      if (token.kind !== 'mouse') {
        routedTokens.push(token);
        continue;
      }

      const target = classifyPaneAt(layout, token.event.col, token.event.row);
      const isLeftTarget = target === 'left';
      const point = pointFromMouseEvent(layout, token.event);
      const startSelection = isLeftTarget && isLeftButtonPress(token.event.code, token.event.final) && !hasAltModifier(token.event.code);
      const updateSelection =
        selectionDrag !== null &&
        isLeftTarget &&
        isSelectionDrag(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code);
      const releaseSelection = selectionDrag !== null && isMouseRelease(token.event.final);

      if (startSelection) {
        selection = null;
        selectionDrag = {
          anchor: point,
          focus: point,
          hasDragged: false
        };
        appendDebugRecord(debugPath, {
          kind: 'selection-start',
          row: point.row,
          col: point.col
        });
        markDirty();
        continue;
      }

      if (updateSelection && selectionDrag !== null) {
        selectionDrag = {
          anchor: selectionDrag.anchor,
          focus: point,
          hasDragged: selectionDrag.hasDragged || !selectionPointsEqual(selectionDrag.anchor, point)
        };
        markDirty();
        continue;
      }

      if (releaseSelection && selectionDrag !== null) {
        const finalized = {
          anchor: selectionDrag.anchor,
          focus: point,
          hasDragged: selectionDrag.hasDragged || !selectionPointsEqual(selectionDrag.anchor, point)
        };
        selection = finalized.hasDragged
          ? {
              anchor: finalized.anchor,
              focus: finalized.focus
            }
          : null;
        appendDebugRecord(debugPath, {
          kind: 'selection-release',
          row: point.row,
          col: point.col,
          hasDragged: finalized.hasDragged
        });
        selectionDrag = null;
        markDirty();
        continue;
      }

      routedTokens.push(token);
    }

    const routed = routeMuxInputTokens(routedTokens, layout);
    if (routed.leftPaneScrollRows !== 0) {
      liveSession.scrollViewport(routed.leftPaneScrollRows);
      markDirty();
    }
    if (routed.rightPaneScrollRows !== 0) {
      events.scrollBy(routed.rightPaneScrollRows, layout.rightCols, layout.paneRows);
      markDirty();
    }

    for (const forwardChunk of routed.forwardToSession) {
      liveSession.write(forwardChunk);
    }

    appendDebugRecord(debugPath, {
      kind: 'input',
      rawBytesHex: chunk.toString('hex'),
      sanitizedBytesHex: focusExtraction.sanitized.toString('hex'),
      focusInCount: focusExtraction.focusInCount,
      focusOutCount: focusExtraction.focusOutCount,
      tokenCount: parsed.tokens.length,
      routedTokenCount: routedTokens.length,
      remainderLength: inputRemainder.length,
      routedForwardCount: routed.forwardToSession.length,
      leftPaneScrollRows: routed.leftPaneScrollRows,
      rightPaneScrollRows: routed.rightPaneScrollRows
    });
  };

  const onResize = (): void => {
    const nextSize = terminalSize();
    appendDebugRecord(debugPath, {
      kind: 'resize-observed',
      cols: nextSize.cols,
      rows: nextSize.rows
    });
    queueResize(nextSize);
  };

  process.stdin.on('data', onInput);
  process.stdout.on('resize', onResize);

  process.stdout.write(ENABLE_INPUT_MODES);
  applyLayout(size, true);
  scheduleRender();

  try {
    while (!stop) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  } finally {
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (ptyResizeTimer !== null) {
      clearTimeout(ptyResizeTimer);
      ptyResizeTimer = null;
    }
    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    liveSession.close();
    store.close();
    restoreTerminalState(true);
  }

  if (exit === null) {
    return 0;
  }
  return normalizeExitCode(exit);
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error: unknown) {
  restoreTerminalState(true);
  process.stderr.write(
    `codex:live:mux fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
