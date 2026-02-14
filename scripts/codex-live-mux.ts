import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import { openCodexControlPlaneClient } from '../src/control-plane/codex-session-stream.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import type { StreamSessionEvent } from '../src/control-plane/stream-protocol.ts';
import {
  parseSessionSummaryRecord,
  parseSessionSummaryList
} from '../src/control-plane/session-summary.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';
import {
  TerminalSnapshotOracle,
  renderSnapshotAnsiRow,
  type TerminalSnapshotFrame
} from '../src/terminal/snapshot-oracle.ts';
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
  routeMuxInputTokens,
  wheelDeltaRowsFromCode
} from '../src/mux/dual-pane-core.ts';
import { detectMuxGlobalShortcut } from '../src/mux/input-shortcuts.ts';
import {
  buildConversationRailLines,
  cycleConversationId,
  type ConversationRailSessionSummary
} from '../src/mux/conversation-rail.ts';

interface MuxOptions {
  codexArgs: string[];
  storePath: string;
  initialConversationId: string;
  controlPlaneHost: string | null;
  controlPlanePort: number | null;
  controlPlaneAuthToken: string | null;
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
  readonly rowAbs: number;
  readonly col: number;
}

interface PaneSelection {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly text: string;
}

interface PaneSelectionDrag {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly hasDragged: boolean;
}

interface ConversationState {
  readonly sessionId: string;
  turnId: string;
  scope: EventScope;
  oracle: TerminalSnapshotOracle;
  events: EventPaneViewport;
  status: ConversationRailSessionSummary['status'];
  attentionReason: string | null;
  startedAt: string;
  lastEventAt: string | null;
  exitedAt: string | null;
  lastExit: PtyExit | null;
  live: boolean;
  attached: boolean;
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

function mapTerminalOutputToNormalizedEvent(
  chunk: Buffer,
  scope: EventScope,
  idFactory: () => string
): NormalizedEventEnvelope {
  return createNormalizedEvent(
    'provider',
    'provider-text-delta',
    scope,
    {
      kind: 'text-delta',
      threadId: scope.conversationId,
      turnId: scope.turnId ?? 'turn-live',
      delta: chunk.toString('utf8')
    },
    () => new Date(),
    idFactory
  );
}

function mapSessionEventToNormalizedEvent(
  event: StreamSessionEvent,
  scope: EventScope,
  idFactory: () => string
): NormalizedEventEnvelope | null {
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

function sanitizeProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return env;
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

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
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
  const codexArgs: string[] = [];
  let controlPlaneHost = process.env.HARNESS_CONTROL_PLANE_HOST ?? null;
  let controlPlanePortRaw = process.env.HARNESS_CONTROL_PLANE_PORT ?? null;
  let controlPlaneAuthToken = process.env.HARNESS_CONTROL_PLANE_AUTH_TOKEN ?? null;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--harness-server-host') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --harness-server-host');
      }
      controlPlaneHost = value;
      idx += 1;
      continue;
    }

    if (arg === '--harness-server-port') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --harness-server-port');
      }
      controlPlanePortRaw = value;
      idx += 1;
      continue;
    }

    if (arg === '--harness-server-token') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --harness-server-token');
      }
      controlPlaneAuthToken = value;
      idx += 1;
      continue;
    }

    codexArgs.push(arg);
  }

  let controlPlanePort: number | null = null;
  if (controlPlanePortRaw !== null) {
    const parsed = Number.parseInt(controlPlanePortRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`invalid --harness-server-port value: ${controlPlanePortRaw}`);
    }
    controlPlanePort = parsed;
  }

  if ((controlPlaneHost === null) !== (controlPlanePort === null)) {
    throw new Error('both control-plane host and port must be set together');
  }

  const initialConversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;

  return {
    codexArgs,
    storePath: process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite',
    initialConversationId,
    controlPlaneHost,
    controlPlanePort,
    controlPlaneAuthToken,
    scope: {
      tenantId: process.env.HARNESS_TENANT_ID ?? 'tenant-local',
      userId: process.env.HARNESS_USER_ID ?? 'user-local',
      workspaceId: process.env.HARNESS_WORKSPACE_ID ?? basename(process.cwd()),
      worktreeId: process.env.HARNESS_WORKTREE_ID ?? 'worktree-local',
      conversationId: initialConversationId,
      turnId
    }
  };
}

function createConversationScope(baseScope: EventScope, conversationId: string, turnId: string): EventScope {
  return {
    tenantId: baseScope.tenantId,
    userId: baseScope.userId,
    workspaceId: baseScope.workspaceId,
    worktreeId: baseScope.worktreeId,
    conversationId,
    turnId
  };
}

function createConversationState(
  sessionId: string,
  turnId: string,
  baseScope: EventScope,
  cols: number,
  rows: number
): ConversationState {
  return {
    sessionId,
    turnId,
    scope: createConversationScope(baseScope, sessionId, turnId),
    oracle: new TerminalSnapshotOracle(cols, rows),
    events: new EventPaneViewport(1000),
    status: 'running',
    attentionReason: null,
    startedAt: new Date().toISOString(),
    lastEventAt: null,
    exitedAt: null,
    lastExit: null,
    live: true,
    attached: false
  };
}

function applySummaryToConversation(
  target: ConversationState,
  summary: ReturnType<typeof parseSessionSummaryRecord>
): void {
  if (summary === null) {
    return;
  }
  target.status = summary.status;
  target.attentionReason = summary.attentionReason;
  target.startedAt = summary.startedAt;
  target.lastEventAt = summary.lastEventAt;
  target.exitedAt = summary.exitedAt;
  target.lastExit = summary.lastExit;
  target.live = summary.live;
}

function conversationSummary(conversation: ConversationState): ConversationRailSessionSummary {
  return {
    sessionId: conversation.sessionId,
    status: conversation.status,
    attentionReason: conversation.attentionReason,
    live: conversation.live,
    startedAt: conversation.startedAt,
    lastEventAt: conversation.lastEventAt
  };
}

function conversationOrder(conversations: ReadonlyMap<string, ConversationState>): readonly string[] {
  return [...conversations.values()]
    .sort((left, right) => {
      if (left.startedAt !== right.startedAt) {
        return left.startedAt.localeCompare(right.startedAt);
      }
      return left.sessionId.localeCompare(right.sessionId);
    })
    .map((session) => session.sessionId);
}

function buildRenderRows(
  layout: ReturnType<typeof computeDualPaneLayout>,
  leftFrame: TerminalSnapshotFrame,
  events: EventPaneViewport,
  conversations: readonly ConversationRailSessionSummary[],
  activeConversationId: string | null,
  selectionActive: boolean,
  ctrlCExits: boolean
): string[] {
  const railRows = Math.max(3, Math.min(8, Math.floor(layout.paneRows / 3)));
  const railLines = buildConversationRailLines(
    conversations,
    activeConversationId,
    layout.rightCols,
    railRows
  );
  const eventRows = Math.max(1, layout.paneRows - railLines.length);
  const rightView = events.view(layout.rightCols, eventRows);

  const rows: string[] = [];
  for (let row = 0; row < layout.paneRows; row += 1) {
    const left = renderSnapshotAnsiRow(leftFrame, row, layout.leftCols);
    const right =
      row < railLines.length
        ? railLines[row]!
        : padOrTrimDisplay(rightView.lines[row - railLines.length] ?? '', layout.rightCols);
    rows.push(`${left}\u001b[0m│${right}`);
  }

  const mode = rightView.followOutput
    ? 'events=live'
    : `events=scroll(${String(rightView.top + 1)}/${String(rightView.totalRows)})`;
  const leftMode = leftFrame.viewport.followOutput
    ? 'pty=live'
    : `pty=scroll(${String(leftFrame.viewport.top + 1)}/${String(leftFrame.viewport.totalRows)})`;
  const selection = selectionActive ? 'select=drag' : 'select=idle';
  const quitHint = ctrlCExits ? 'ctrl-c/ctrl-] quit' : 'ctrl-] quit';
  const status = padOrTrimDisplay(
    `[mux] conversation=${activeConversationId ?? '-'} ${leftMode} ${mode} ${selection} ctrl-t new ctrl-n/p switch drag copy alt-pass ${quitHint}`,
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
  if (left.rowAbs !== right.rowAbs) {
    return left.rowAbs - right.rowAbs;
  }
  return left.col - right.col;
}

function selectionPointsEqual(left: SelectionPoint, right: SelectionPoint): boolean {
  return left.rowAbs === right.rowAbs && left.col === right.col;
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

function clampPanePoint(
  layout: ReturnType<typeof computeDualPaneLayout>,
  frame: TerminalSnapshotFrame,
  rowAbs: number,
  col: number
): SelectionPoint {
  const maxRowAbs = Math.max(0, frame.viewport.totalRows - 1);
  return {
    rowAbs: Math.max(0, Math.min(maxRowAbs, rowAbs)),
    col: Math.max(0, Math.min(layout.leftCols - 1, col))
  };
}

function pointFromMouseEvent(
  layout: ReturnType<typeof computeDualPaneLayout>,
  frame: TerminalSnapshotFrame,
  event: { col: number; row: number }
): SelectionPoint {
  const rowViewport = Math.max(0, Math.min(layout.paneRows - 1, event.row - 1));
  return clampPanePoint(layout, frame, frame.viewport.top + rowViewport, event.col - 1);
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
  const visibleStartAbs = frame.viewport.top;
  const visibleEndAbs = frame.viewport.top + frame.rows - 1;
  const paintStartAbs = Math.max(start.rowAbs, visibleStartAbs);
  const paintEndAbs = Math.min(end.rowAbs, visibleEndAbs);
  if (paintEndAbs < paintStartAbs) {
    return '';
  }

  let output = '';
  for (let rowAbs = paintStartAbs; rowAbs <= paintEndAbs; rowAbs += 1) {
    const row = rowAbs - frame.viewport.top;
    const rowStartCol = rowAbs === start.rowAbs ? start.col : 0;
    const rowEndCol = rowAbs === end.rowAbs ? end.col : frame.cols - 1;
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

function selectionVisibleRows(
  frame: TerminalSnapshotFrame,
  selection: PaneSelection | null
): readonly number[] {
  if (selection === null) {
    return [];
  }

  const { start, end } = normalizeSelection(selection);
  const visibleStartAbs = frame.viewport.top;
  const visibleEndAbs = frame.viewport.top + frame.rows - 1;
  const paintStartAbs = Math.max(start.rowAbs, visibleStartAbs);
  const paintEndAbs = Math.min(end.rowAbs, visibleEndAbs);
  if (paintEndAbs < paintStartAbs) {
    return [];
  }

  const rows: number[] = [];
  for (let rowAbs = paintStartAbs; rowAbs <= paintEndAbs; rowAbs += 1) {
    rows.push(rowAbs - frame.viewport.top);
  }
  return rows;
}

function mergeUniqueRows(
  left: readonly number[],
  right: readonly number[]
): readonly number[] {
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0) {
    return left;
  }
  const merged = new Set<number>();
  for (const row of left) {
    merged.add(row);
  }
  for (const row of right) {
    merged.add(row);
  }
  return [...merged].sort((a, b) => a - b);
}

function selectionText(frame: TerminalSnapshotFrame, selection: PaneSelection | null): string {
  if (selection === null) {
    return '';
  }

  if (selection.text.length > 0) {
    return selection.text;
  }

  const { start, end } = normalizeSelection(selection);
  const rows: string[] = [];
  const visibleStartAbs = frame.viewport.top;
  const visibleEndAbs = frame.viewport.top + frame.rows - 1;
  const readStartAbs = Math.max(start.rowAbs, visibleStartAbs);
  const readEndAbs = Math.min(end.rowAbs, visibleEndAbs);
  for (let rowAbs = readStartAbs; rowAbs <= readEndAbs; rowAbs += 1) {
    const row = rowAbs - frame.viewport.top;
    const rowStartCol = rowAbs === start.rowAbs ? start.col : 0;
    const rowEndCol = rowAbs === end.rowAbs ? end.col : frame.cols - 1;
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
  const ctrlCExits = parseBooleanEnv(process.env.HARNESS_MUX_CTRL_C_EXITS, false);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  const probedPalette = await probeTerminalPalette();
  const controlPlaneClient = await openCodexControlPlaneClient(
    options.controlPlaneHost !== null && options.controlPlanePort !== null
      ? {
          mode: 'remote',
          host: options.controlPlaneHost,
          port: options.controlPlanePort,
          authToken: options.controlPlaneAuthToken ?? undefined
        }
      : {
          mode: 'embedded'
        },
    {
    startEmbeddedServer: async () =>
      await startControlPlaneStreamServer({
        startSession: (input) =>
          startCodexLiveSession({
            args: input.args,
            env: input.env,
            initialCols: input.initialCols,
            initialRows: input.initialRows,
            terminalForegroundHex: input.terminalForegroundHex,
              terminalBackgroundHex: input.terminalBackgroundHex
          })
      })
  });
  const streamClient = controlPlaneClient.client;

  const sessionEnv = {
    ...sanitizeProcessEnv(),
    TERM: process.env.TERM ?? 'xterm-256color'
  };
  const conversations = new Map<string, ConversationState>();
  let activeConversationId: string | null = null;

  const ensureConversation = (sessionId: string): ConversationState => {
    const existing = conversations.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const state = createConversationState(
      sessionId,
      `turn-${randomUUID()}`,
      options.scope,
      layout.leftCols,
      layout.paneRows
    );
    conversations.set(sessionId, state);
    return state;
  };

  const activeConversation = (): ConversationState => {
    if (activeConversationId === null) {
      throw new Error('active conversation is not set');
    }
    const state = conversations.get(activeConversationId);
    if (state === undefined) {
      throw new Error(`active conversation missing: ${activeConversationId}`);
    }
    return state;
  };

  const startConversation = async (sessionId: string): Promise<ConversationState> => {
    await streamClient.sendCommand({
      type: 'pty.start',
      sessionId,
      args: options.codexArgs,
      env: sessionEnv,
      initialCols: layout.leftCols,
      initialRows: layout.paneRows,
      terminalForegroundHex: process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex,
      terminalBackgroundHex: process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex,
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
      worktreeId: options.scope.worktreeId
    });
    const state = ensureConversation(sessionId);
    const statusRecord = await streamClient.sendCommand({
      type: 'session.status',
      sessionId
    });
    const statusSummary = parseSessionSummaryRecord(statusRecord);
    if (statusSummary !== null) {
      applySummaryToConversation(state, statusSummary);
    }
    await streamClient.sendCommand({
      type: 'pty.subscribe-events',
      sessionId
    });
    return state;
  };

  const hydrateConversationList = async (): Promise<void> => {
    const listed = await streamClient.sendCommand({
      type: 'session.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
      worktreeId: options.scope.worktreeId,
      sort: 'attention-first'
    });
    const summaries = parseSessionSummaryList(listed['sessions']);
    for (const summary of summaries) {
      const conversation = ensureConversation(summary.sessionId);
      applySummaryToConversation(conversation, summary);
      await streamClient.sendCommand({
        type: 'pty.subscribe-events',
        sessionId: summary.sessionId
      });
    }
  };

  await hydrateConversationList();
  if (!conversations.has(options.initialConversationId)) {
    await startConversation(options.initialConversationId);
  }
  if (activeConversationId === null) {
    activeConversationId = options.initialConversationId;
  }

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
  let previousSelectionRows: readonly number[] = [];
  let renderScheduled = false;
  let selection: PaneSelection | null = null;
  let selectionDrag: PaneSelectionDrag | null = null;
  let selectionPinnedFollowOutput: boolean | null = null;
  let resizeTimer: NodeJS.Timeout | null = null;
  let pendingSize: { cols: number; rows: number } | null = null;
  let lastResizeApplyAtMs = 0;
  let ptyResizeTimer: NodeJS.Timeout | null = null;
  let pendingPtySize: { cols: number; rows: number } | null = null;
  let currentPtySize: { cols: number; rows: number } | null = null;

  const requestStop = (): void => {
    if (stop) {
      return;
    }
    stop = true;
    if (activeConversationId !== null) {
      streamClient.sendSignal(activeConversationId, 'terminate');
    }
    markDirty();
  };

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
    const conversation = activeConversation();
    conversation.oracle.resize(ptySize.cols, ptySize.rows);
    streamClient.sendResize(conversation.sessionId, ptySize.cols, ptySize.rows);
    appendDebugRecord(debugPath, {
      kind: 'resize-pty-apply',
      sessionId: conversation.sessionId,
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
    for (const conversation of conversations.values()) {
      conversation.oracle.resize(nextLayout.leftCols, nextLayout.paneRows);
    }
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

  const appendEventLine = (line: string, sessionId: string | null = activeConversationId): void => {
    if (sessionId === null) {
      return;
    }
    const conversation = conversations.get(sessionId);
    if (conversation === undefined) {
      return;
    }
    conversation.events.append(line);
    markDirty();
  };

  let controlPlaneOps = Promise.resolve();
  const queueControlPlaneOp = (task: () => Promise<void>): void => {
    controlPlaneOps = controlPlaneOps
      .then(task)
      .catch((error: unknown) => {
        appendEventLine(
          `${new Date().toISOString()} control-plane error ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  };

  const attachConversation = async (sessionId: string): Promise<void> => {
    const conversation = conversations.get(sessionId);
    if (conversation === undefined) {
      return;
    }
    if (!conversation.live) {
      return;
    }
    if (!conversation.attached) {
      await streamClient.sendCommand({
        type: 'pty.attach',
        sessionId,
        sinceCursor: 0
      });
      conversation.attached = true;
    }
    await streamClient.sendCommand({
      type: 'pty.subscribe-events',
      sessionId
    });
  };

  const detachConversation = async (sessionId: string): Promise<void> => {
    const conversation = conversations.get(sessionId);
    if (conversation === undefined) {
      return;
    }
    if (!conversation.attached) {
      return;
    }
    await streamClient.sendCommand({
      type: 'pty.detach',
      sessionId
    });
    conversation.attached = false;
  };

  const activateConversation = async (sessionId: string): Promise<void> => {
    if (activeConversationId === sessionId) {
      return;
    }
    const previousActiveId = activeConversationId;
    selection = null;
    selectionDrag = null;
    releaseViewportPinForSelection();
    if (previousActiveId !== null) {
      await detachConversation(previousActiveId);
    }
    activeConversationId = sessionId;
    forceFullClear = true;
    currentPtySize = null;
    await attachConversation(sessionId);
    schedulePtyResize(
      {
        cols: layout.leftCols,
        rows: layout.paneRows
      },
      true
    );
    appendEventLine(`${new Date().toISOString()} switched ${sessionId}`, sessionId);
    markDirty();
  };

  const createAndActivateConversation = async (): Promise<void> => {
    const sessionId = `conversation-${randomUUID()}`;
    await startConversation(sessionId);
    await activateConversation(sessionId);
  };

  const pinViewportForSelection = (): void => {
    if (selectionPinnedFollowOutput !== null) {
      return;
    }
    const follow = activeConversation().oracle.snapshot().viewport.followOutput;
    selectionPinnedFollowOutput = follow;
    if (follow) {
      activeConversation().oracle.setFollowOutput(false);
    }
  };

  const releaseViewportPinForSelection = (): void => {
    if (selectionPinnedFollowOutput === null) {
      return;
    }
    const shouldRepin = selectionPinnedFollowOutput;
    selectionPinnedFollowOutput = null;
    if (shouldRepin) {
      activeConversation().oracle.setFollowOutput(true);
    }
  };

  const render = (): void => {
    if (!dirty) {
      return;
    }

    const active = activeConversation();
    const leftFrame = active.oracle.snapshot();
    const renderSelection =
      selectionDrag !== null && selectionDrag.hasDragged
        ? {
            anchor: selectionDrag.anchor,
            focus: selectionDrag.focus,
            text: ''
          }
        : selection;
    const selectionRows = selectionVisibleRows(leftFrame, renderSelection);
    const rows = buildRenderRows(
      layout,
      leftFrame,
      active.events,
      [...conversations.values()].map((conversation) => conversationSummary(conversation)),
      activeConversationId,
      renderSelection !== null,
      ctrlCExits
    );
    const diff = diffRenderedRows(rows, previousRows);
    const overlayResetRows = mergeUniqueRows(previousSelectionRows, selectionRows);

    let output = '';
    if (forceFullClear) {
      output += '\u001b[?25l\u001b[H\u001b[2J';
      forceFullClear = false;
      renderedCursorVisible = false;
      renderedCursorStyle = null;
      renderedBracketedPaste = null;
    }
    output += diff.output;

    if (overlayResetRows.length > 0) {
      const changedRows = new Set<number>(diff.changedRows);
      for (const row of overlayResetRows) {
        if (row < 0 || row >= layout.paneRows || changedRows.has(row)) {
          continue;
        }
        const rowContent = rows[row] ?? '';
        output += `\u001b[${String(row + 1)};1H\u001b[2K${rowContent}`;
      }
    }

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
      overlayResetRows,
      leftViewportTop: leftFrame.viewport.top,
      leftViewportFollow: leftFrame.viewport.followOutput,
      leftViewportTotalRows: leftFrame.viewport.totalRows,
      leftCursorRow: leftFrame.cursor.row,
      leftCursorCol: leftFrame.cursor.col,
      leftCursorVisible: leftFrame.cursor.visible,
      shouldShowCursor
    });

    previousRows = diff.nextRows;
    previousSelectionRows = selectionRows;
    dirty = false;
  };

  const initialActiveId = activeConversationId;
  activeConversationId = null;
  if (initialActiveId !== null) {
    await activateConversation(initialActiveId);
  }

  const removeEnvelopeListener = streamClient.onEnvelope((envelope) => {
    if (envelope.kind === 'pty.output') {
      const conversation = ensureConversation(envelope.sessionId);
      const chunk = Buffer.from(envelope.chunkBase64, 'base64');
      conversation.oracle.ingest(chunk);

      const normalized = mapTerminalOutputToNormalizedEvent(chunk, conversation.scope, idFactory);
      store.appendEvents([normalized]);
      conversation.lastEventAt = normalized.ts;
      if (activeConversationId === envelope.sessionId) {
        markDirty();
      }
      return;
    }

    if (envelope.kind === 'pty.event') {
      const conversation = ensureConversation(envelope.sessionId);
      const normalized = mapSessionEventToNormalizedEvent(envelope.event, conversation.scope, idFactory);
      if (normalized !== null) {
        store.appendEvents([normalized]);
        appendEventLine(summarizeEvent(normalized), envelope.sessionId);
      }
      if (envelope.event.type === 'attention-required') {
        conversation.status = 'needs-input';
        conversation.attentionReason = envelope.event.reason;
      } else if (envelope.event.type === 'turn-completed') {
        conversation.status = 'completed';
        conversation.attentionReason = null;
      } else if (envelope.event.type === 'notify') {
        // no status change
      }
      if (envelope.event.type === 'session-exit') {
        conversation.status = 'exited';
        conversation.live = false;
        conversation.attentionReason = null;
        conversation.lastExit = envelope.event.exit;
        conversation.exitedAt = new Date().toISOString();
        conversation.attached = false;
        if (activeConversationId === envelope.sessionId) {
          const fallback = conversationOrder(conversations).find((sessionId) => {
            const candidate = conversations.get(sessionId);
            return candidate !== undefined && candidate.live;
          });
          if (fallback !== undefined) {
            queueControlPlaneOp(async () => {
              await activateConversation(fallback);
            });
          }
        }
      }
      markDirty();
      return;
    }

    if (envelope.kind === 'pty.exit') {
      const conversation = conversations.get(envelope.sessionId);
      if (conversation !== undefined) {
        conversation.status = 'exited';
        conversation.live = false;
        conversation.attentionReason = null;
        conversation.lastExit = envelope.exit;
        conversation.exitedAt = new Date().toISOString();
        conversation.attached = false;
        if (activeConversationId === envelope.sessionId) {
          const fallback = conversationOrder(conversations).find((sessionId) => {
            const candidate = conversations.get(sessionId);
            return candidate !== undefined && candidate.live;
          });
          if (fallback !== undefined) {
            queueControlPlaneOp(async () => {
              await activateConversation(fallback);
            });
          }
        }
      }
      markDirty();
    }
  });

  const onInput = (chunk: Buffer): void => {
    if ((selection !== null || selectionDrag !== null) && chunk.length === 1 && chunk[0] === 0x1b) {
      selection = null;
      selectionDrag = null;
      releaseViewportPinForSelection();
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

    if (
      ctrlCExits &&
      selection === null &&
      selectionDrag === null &&
      focusExtraction.sanitized.length === 1 &&
      focusExtraction.sanitized[0] === 0x03
    ) {
      requestStop();
      return;
    }

    const globalShortcut = detectMuxGlobalShortcut(focusExtraction.sanitized);
    if (globalShortcut === 'quit') {
      requestStop();
      return;
    }
    if (globalShortcut === 'new-conversation') {
      queueControlPlaneOp(async () => {
        await createAndActivateConversation();
      });
      return;
    }
    if (globalShortcut === 'next-conversation' || globalShortcut === 'previous-conversation') {
      const orderedIds = conversationOrder(conversations);
      const direction = globalShortcut === 'next-conversation' ? 'next' : 'previous';
      const targetId = cycleConversationId(orderedIds, activeConversationId, direction);
      if (targetId !== null) {
        queueControlPlaneOp(async () => {
          await activateConversation(targetId);
        });
      }
      return;
    }

    if (selection !== null && isCopyShortcutInput(focusExtraction.sanitized)) {
      const selectedFrame = activeConversation().oracle.snapshot();
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

    const inputConversation = activeConversation();
    let snapshotForInput = inputConversation.oracle.snapshot();
    const routedTokens: Array<(typeof parsed.tokens)[number]> = [];
    for (const token of parsed.tokens) {
      if (token.kind !== 'mouse') {
        if (selection !== null && token.text.length > 0) {
          selection = null;
          selectionDrag = null;
          releaseViewportPinForSelection();
          markDirty();
          appendDebugRecord(debugPath, {
            kind: 'selection-clear-typed-input'
          });
        }
        routedTokens.push(token);
        continue;
      }

      const target = classifyPaneAt(layout, token.event.col, token.event.row);
      const isLeftTarget = target === 'left';
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (wheelDelta !== null) {
        if (target === 'left') {
          inputConversation.oracle.scrollViewport(wheelDelta);
          snapshotForInput = inputConversation.oracle.snapshot();
          markDirty();
          continue;
        }
        if (target === 'right') {
          inputConversation.events.scrollBy(wheelDelta, layout.rightCols, layout.paneRows);
          markDirty();
          continue;
        }
      }
      const point = pointFromMouseEvent(layout, snapshotForInput, token.event);
      const startSelection = isLeftTarget && isLeftButtonPress(token.event.code, token.event.final) && !hasAltModifier(token.event.code);
      const updateSelection =
        selectionDrag !== null &&
        isLeftTarget &&
        isSelectionDrag(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code);
      const releaseSelection = selectionDrag !== null && isMouseRelease(token.event.final);

      if (startSelection) {
        selection = null;
        pinViewportForSelection();
        selectionDrag = {
          anchor: point,
          focus: point,
          hasDragged: false
        };
        appendDebugRecord(debugPath, {
          kind: 'selection-start',
          rowAbs: point.rowAbs,
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
        if (finalized.hasDragged) {
          const completedSelection: PaneSelection = {
            anchor: finalized.anchor,
            focus: finalized.focus,
            text: ''
          };
          selection = {
            ...completedSelection,
            text: selectionText(snapshotForInput, completedSelection)
          };
        } else {
          selection = null;
        }
        if (!finalized.hasDragged) {
          releaseViewportPinForSelection();
        }
        appendDebugRecord(debugPath, {
          kind: 'selection-release',
          rowAbs: point.rowAbs,
          col: point.col,
          hasDragged: finalized.hasDragged
        });
        selectionDrag = null;
        markDirty();
        continue;
      }

      if (selection !== null && !isWheelMouseCode(token.event.code)) {
        selection = null;
        selectionDrag = null;
        releaseViewportPinForSelection();
        markDirty();
        appendDebugRecord(debugPath, {
          kind: 'selection-clear-mouse'
        });
      }

      routedTokens.push(token);
    }

    const routed = routeMuxInputTokens(routedTokens, layout);
    if (routed.leftPaneScrollRows !== 0) {
      inputConversation.oracle.scrollViewport(routed.leftPaneScrollRows);
      markDirty();
    }
    if (routed.rightPaneScrollRows !== 0) {
      inputConversation.events.scrollBy(routed.rightPaneScrollRows, layout.rightCols, layout.paneRows);
      markDirty();
    }

    for (const forwardChunk of routed.forwardToSession) {
      streamClient.sendInput(inputConversation.sessionId, Buffer.from(forwardChunk));
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
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

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
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    removeEnvelopeListener();
    try {
      await controlPlaneOps;
      await controlPlaneClient.close();
    } catch {
      // Best-effort shutdown only.
    }
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
