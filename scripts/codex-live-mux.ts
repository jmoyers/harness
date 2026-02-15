import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, truncateSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import {
  openCodexControlPlaneClient,
  subscribeControlPlaneKeyEvents,
  type ControlPlaneKeyEvent
} from '../src/control-plane/codex-session-stream.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import type {
  StreamServerEnvelope,
  StreamSessionController,
  StreamSessionEvent
} from '../src/control-plane/stream-protocol.ts';
import {
  parseSessionSummaryRecord,
  parseSessionSummaryList
} from '../src/control-plane/session-summary.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';
import {
  TerminalSnapshotOracle,
  renderSnapshotAnsiRow,
  wrapTextForColumns,
  type TerminalSnapshotFrameCore
} from '../src/terminal/snapshot-oracle.ts';
import {
  createNormalizedEvent,
  type EventScope,
  type NormalizedEventEnvelope
} from '../src/events/normalized-events.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import {
  classifyPaneAt,
  computeDualPaneLayout,
  diffRenderedRows,
  padOrTrimDisplay,
  parseMuxInputChunk,
  wheelDeltaRowsFromCode
} from '../src/mux/dual-pane-core.ts';
import { loadHarnessConfig, updateHarnessMuxUiConfig } from '../src/config/config-core.ts';
import {
  detectMuxGlobalShortcut,
  firstShortcutText,
  resolveMuxShortcutBindings
} from '../src/mux/input-shortcuts.ts';
import {
  DISABLE_MUX_INPUT_MODES,
  createMuxInputModeManager
} from '../src/mux/terminal-input-modes.ts';
import {
  cycleConversationId,
  type ConversationRailSessionSummary
} from '../src/mux/conversation-rail.ts';
import { findAnsiIntegrityIssues } from '../src/mux/ansi-integrity.ts';
import { ControlPlaneOpQueue } from '../src/mux/control-plane-op-queue.ts';
import { detectConversationDoubleClick } from '../src/mux/double-click.ts';
import {
  renderWorkspaceRailAnsiRows
} from '../src/mux/workspace-rail.ts';
import {
  actionAtWorkspaceRailCell,
  buildWorkspaceRailViewRows,
  conversationIdAtWorkspaceRailRow,
  projectIdAtWorkspaceRailRow,
  kindAtWorkspaceRailRow
} from '../src/mux/workspace-rail-model.ts';
import {
  resolveWorkspacePath
} from '../src/mux/workspace-path.ts';
import {
  createNewThreadPromptState,
  newThreadPromptBodyLines,
  normalizeThreadAgentType,
  reduceNewThreadPromptInput,
  resolveNewThreadPromptAgentByRow
} from '../src/mux/new-thread-prompt.ts';
import { buildProjectTreeLines } from '../src/mux/project-tree.ts';
import {
  StartupSequencer
} from '../src/mux/startup-sequencer.ts';
import {
  applyModalOverlay,
  buildRenderRows,
  cursorStyleEqual,
  cursorStyleToDecscusr,
  renderCanonicalFrameAnsi
} from '../src/mux/render-frame.ts';
import {
  createTerminalRecordingWriter
} from '../src/recording/terminal-recording.ts';
import { renderTerminalRecordingToGif } from './terminal-recording-gif-lib.ts';
import {
  buildAgentStartArgs,
  mergeAdapterStateFromSessionEvent,
  normalizeAdapterState
} from '../src/adapters/agent-session-state.ts';
import {
  configurePerfCore,
  perfNowNs,
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan
} from '../src/perf/perf-core.ts';
import {
  buildUiModalOverlay,
  formatUiButton,
  isUiModalOverlayHit
} from '../src/ui/kit.ts';

const execFileAsync = promisify(execFile);

type ResolvedMuxShortcutBindings = ReturnType<typeof resolveMuxShortcutBindings>;
type ThreadAgentType = ReturnType<typeof normalizeThreadAgentType>;
type NewThreadPromptState = ReturnType<typeof createNewThreadPromptState>;

interface MuxOptions {
  codexArgs: string[];
  storePath: string;
  initialConversationId: string;
  invocationDirectory: string;
  controlPlaneHost: string | null;
  controlPlanePort: number | null;
  controlPlaneAuthToken: string | null;
  recordingPath: string | null;
  recordingGifOutputPath: string | null;
  recordingFps: number;
  scope: EventScope;
}

interface TerminalPaletteProbe {
  foregroundHex?: string;
  backgroundHex?: string;
  indexedHexByCode?: Record<number, string>;
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

interface MuxPerfStatusRow {
  readonly fps: number;
  readonly kbPerSecond: number;
  readonly renderAvgMs: number;
  readonly renderMaxMs: number;
  readonly outputHandleAvgMs: number;
  readonly outputHandleMaxMs: number;
  readonly eventLoopP95Ms: number;
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

interface ConversationTitleEditState {
  conversationId: string;
  value: string;
  lastSavedValue: string;
  error: string | null;
  persistInFlight: boolean;
  debounceTimer: NodeJS.Timeout | null;
}

interface ConversationState {
  readonly sessionId: string;
  directoryId: string | null;
  title: string;
  agentType: string;
  adapterState: Record<string, unknown>;
  turnId: string;
  scope: EventScope;
  oracle: TerminalSnapshotOracle;
  status: ConversationRailSessionSummary['status'];
  attentionReason: string | null;
  startedAt: string;
  lastEventAt: string | null;
  exitedAt: string | null;
  lastExit: PtyExit | null;
  processId: number | null;
  live: boolean;
  attached: boolean;
  lastOutputCursor: number;
  lastKnownWork: string | null;
  lastKnownWorkAt: string | null;
  lastTelemetrySource: string | null;
  controller: StreamSessionController | null;
}

interface ProcessUsageSample {
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
}

interface ControlPlaneDirectoryRecord {
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly createdAt: string | null;
  readonly archivedAt: string | null;
}

interface ControlPlaneConversationRecord {
  readonly conversationId: string;
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly agentType: string;
  readonly adapterState: Record<string, unknown>;
  readonly runtimeStatus: ConversationRailSessionSummary['status'];
  readonly runtimeLive: boolean;
}

interface GitSummary {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

type GitSummaryRefreshReason = 'startup' | 'interval' | 'focus' | 'trigger';

interface PendingGitSummaryRefresh {
  readonly dueAtMs: number;
  readonly reason: GitSummaryRefreshReason;
}

const DEFAULT_RESIZE_MIN_INTERVAL_MS = 33;
const DEFAULT_PTY_RESIZE_SETTLE_MS = 75;
const DEFAULT_STARTUP_SETTLE_QUIET_MS = 300;
const DEFAULT_STARTUP_SETTLE_NONEMPTY_FALLBACK_MS = 1500;
const DEFAULT_BACKGROUND_START_MAX_WAIT_MS = 5000;
const DEFAULT_BACKGROUND_RESUME_PERSISTED = false;
const DEFAULT_BACKGROUND_PROBES_ENABLED = false;
const DEFAULT_CONVERSATION_TITLE_EDIT_DEBOUNCE_MS = 250;
const CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS = 350;
const STARTUP_TERMINAL_MIN_COLS = 40;
const STARTUP_TERMINAL_MIN_ROWS = 10;
const STARTUP_TERMINAL_PROBE_TIMEOUT_MS = 250;
const STARTUP_TERMINAL_PROBE_INTERVAL_MS = 10;
const UI_STATE_PERSIST_DEBOUNCE_MS = 200;
const MIN_PANE_WIDTH_PERCENT = 1;
const MAX_PANE_WIDTH_PERCENT = 99;
const GIT_SUMMARY_LOADING: GitSummary = {
  branch: '(loading)',
  changedFiles: 0,
  additions: 0,
  deletions: 0
};
const GIT_SUMMARY_NOT_REPOSITORY: GitSummary = {
  branch: '(not git)',
  changedFiles: 0,
  additions: 0,
  deletions: 0
};

interface ProjectPaneSnapshot {
  readonly directoryId: string;
  readonly path: string;
  readonly lines: readonly string[];
  readonly actionLineIndexByKind: {
    readonly conversationNew: number;
    readonly projectClose: number;
  };
}

interface ProjectPaneWrappedLine {
  readonly text: string;
  readonly sourceLineIndex: number;
}

type ProjectPaneAction = 'conversation.new' | 'project.close';

const PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL = formatUiButton({
  label: 'new thread',
  prefixIcon: '+'
});
const PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL = formatUiButton({
  label: 'close project',
  prefixIcon: '<'
});
const CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL = formatUiButton({
  label: 'archive thread',
  prefixIcon: 'x'
});
const NEW_THREAD_MODAL_CODEX_BUTTON = formatUiButton({
  label: 'codex',
  prefixIcon: '◆'
});
const NEW_THREAD_MODAL_TERMINAL_BUTTON = formatUiButton({
  label: 'terminal',
  prefixIcon: '▣'
});

function buildProjectPaneSnapshot(directoryId: string, path: string): ProjectPaneSnapshot {
  const projectName = basename(path) || path;
  const actionLineIndexByKind = {
    conversationNew: 3,
    projectClose: 4
  } as const;
  return {
    directoryId,
    path,
    lines: [
      `project ${projectName}`,
      `path ${path}`,
      '',
      PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL,
      PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL,
      '',
      ...buildProjectTreeLines(path)
    ],
    actionLineIndexByKind
  };
}

function buildProjectPaneWrappedLines(snapshot: ProjectPaneSnapshot, cols: number): readonly ProjectPaneWrappedLine[] {
  const safeCols = Math.max(1, cols);
  const wrapped: ProjectPaneWrappedLine[] = [];
  for (let lineIndex = 0; lineIndex < snapshot.lines.length; lineIndex += 1) {
    const line = snapshot.lines[lineIndex]!;
    const segments = wrapTextForColumns(line, safeCols);
    if (segments.length === 0) {
      wrapped.push({
        text: '',
        sourceLineIndex: lineIndex
      });
      continue;
    }
    for (const segment of segments) {
      wrapped.push({
        text: segment,
        sourceLineIndex: lineIndex
      });
    }
  }
  if (wrapped.length === 0) {
    wrapped.push({
      text: '',
      sourceLineIndex: -1
    });
  }
  return wrapped;
}

function buildProjectPaneRows(
  snapshot: ProjectPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number
): { rows: readonly string[]; top: number } {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, paneRows);
  const wrappedLines = buildProjectPaneWrappedLines(snapshot, safeCols);
  const maxTop = Math.max(0, wrappedLines.length - safeRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const viewport = wrappedLines.slice(nextTop, nextTop + safeRows);
  while (viewport.length < safeRows) {
    viewport.push({
      text: '',
      sourceLineIndex: -1
    });
  }
  return {
    rows: viewport.map((row) => padOrTrimDisplay(row.text, safeCols)),
    top: nextTop
  };
}

function projectPaneActionAtRow(
  snapshot: ProjectPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number,
  rowIndex: number
): ProjectPaneAction | null {
  const safeRows = Math.max(1, paneRows);
  const wrappedLines = buildProjectPaneWrappedLines(snapshot, cols);
  const maxTop = Math.max(0, wrappedLines.length - safeRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const normalizedRow = Math.max(0, Math.min(safeRows - 1, rowIndex));
  const line = wrappedLines[nextTop + normalizedRow];
  if (line === undefined) {
    return null;
  }
  if (line.sourceLineIndex === snapshot.actionLineIndexByKind.conversationNew) {
    return 'conversation.new';
  }
  if (line.sourceLineIndex === snapshot.actionLineIndexByKind.projectClose) {
    return 'project.close';
  }
  return null;
}

function normalizePaneWidthPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 30;
  }
  if (value < MIN_PANE_WIDTH_PERCENT) {
    return MIN_PANE_WIDTH_PERCENT;
  }
  if (value > MAX_PANE_WIDTH_PERCENT) {
    return MAX_PANE_WIDTH_PERCENT;
  }
  return value;
}

function leftColsFromPaneWidthPercent(cols: number, paneWidthPercent: number): number {
  const availablePaneCols = Math.max(2, cols - 1);
  const normalizedPercent = normalizePaneWidthPercent(paneWidthPercent);
  const requestedLeftCols = Math.round((availablePaneCols * normalizedPercent) / 100);
  return Math.max(1, Math.min(availablePaneCols - 1, requestedLeftCols));
}

function paneWidthPercentFromLayout(layout: { cols: number; leftCols: number }): number {
  const availablePaneCols = Math.max(2, layout.cols - 1);
  const percent = (layout.leftCols / availablePaneCols) * 100;
  const rounded = Math.round(percent * 100) / 100;
  return normalizePaneWidthPercent(rounded);
}

function restoreTerminalState(
  newline: boolean,
  restoreInputModes: (() => void) | null = null
): void {
  try {
    if (restoreInputModes === null) {
      process.stdout.write(DISABLE_MUX_INPUT_MODES);
    } else {
      restoreInputModes();
    }
    process.stdout.write(`\u001b[?25h\u001b[0m${newline ? '\n' : ''}`);
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

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function extractFocusEvents(chunk: Buffer): FocusEventExtraction {
  const text = chunk.toString('utf8');
  const focusInCount = text.split('\u001b[I').length - 1;
  const focusOutCount = text.split('\u001b[O').length - 1;

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

function prepareArtifactPath(path: string, overwriteOnStart: boolean): string {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  if (overwriteOnStart) {
    try {
      truncateSync(resolvedPath, 0);
    } catch (error: unknown) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'ENOENT') {
        throw error;
      }
      appendFileSync(resolvedPath, '', 'utf8');
    }
  }
  return resolvedPath;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseDirectoryRecord(value: unknown): ControlPlaneDirectoryRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const directoryId = record['directoryId'];
  const tenantId = record['tenantId'];
  const userId = record['userId'];
  const workspaceId = record['workspaceId'];
  const path = record['path'];
  const createdAtRaw = record['createdAt'];
  const archivedAtRaw = record['archivedAt'];
  if (
    typeof directoryId !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof userId !== 'string' ||
    typeof workspaceId !== 'string' ||
    typeof path !== 'string' ||
    (createdAtRaw !== undefined && createdAtRaw !== null && typeof createdAtRaw !== 'string') ||
    (archivedAtRaw !== undefined && archivedAtRaw !== null && typeof archivedAtRaw !== 'string')
  ) {
    return null;
  }
  return {
    directoryId,
    tenantId,
    userId,
    workspaceId,
    path,
    createdAt: typeof createdAtRaw === 'string' ? createdAtRaw : null,
    archivedAt: typeof archivedAtRaw === 'string' ? archivedAtRaw : null
  };
}

function parseConversationRecord(value: unknown): ControlPlaneConversationRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const conversationId = record['conversationId'];
  const directoryId = record['directoryId'];
  const tenantId = record['tenantId'];
  const userId = record['userId'];
  const workspaceId = record['workspaceId'];
  const title = record['title'];
  const agentType = record['agentType'];
  const adapterStateRaw = record['adapterState'];
  const runtimeStatus = record['runtimeStatus'];
  const runtimeLive = record['runtimeLive'];
  if (
    typeof conversationId !== 'string' ||
    typeof directoryId !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof userId !== 'string' ||
    typeof workspaceId !== 'string' ||
    typeof title !== 'string' ||
    typeof agentType !== 'string' ||
    (typeof adapterStateRaw !== 'object' || adapterStateRaw === null || Array.isArray(adapterStateRaw)) ||
    typeof runtimeLive !== 'boolean'
  ) {
    return null;
  }
  if (
    runtimeStatus !== 'running' &&
    runtimeStatus !== 'needs-input' &&
    runtimeStatus !== 'completed' &&
    runtimeStatus !== 'exited'
  ) {
    return null;
  }
  return {
    conversationId,
    directoryId,
    tenantId,
    userId,
    workspaceId,
    title,
    agentType,
    adapterState: adapterStateRaw as Record<string, unknown>,
    runtimeStatus,
    runtimeLive
  };
}

function parseSessionControllerRecord(value: unknown): StreamSessionController | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const controllerId = record['controllerId'];
  const controllerType = record['controllerType'];
  const controllerLabelRaw = record['controllerLabel'];
  const claimedAt = record['claimedAt'];
  if (
    typeof controllerId !== 'string' ||
    (controllerType !== 'human' && controllerType !== 'agent' && controllerType !== 'automation') ||
    (controllerLabelRaw !== null && typeof controllerLabelRaw !== 'string') ||
    typeof claimedAt !== 'string'
  ) {
    return null;
  }
  return {
    controllerId,
    controllerType,
    controllerLabel: controllerLabelRaw,
    claimedAt
  };
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

function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /session not found/i.test(error.message);
}

function isSessionNotLiveError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /session is not live/i.test(error.message);
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

function observedAtFromSessionEvent(event: StreamSessionEvent): string {
  if (event.type === 'session-exit') {
    return new Date().toISOString();
  }
  const record = asRecord((event as { record?: unknown }).record);
  const ts = record?.['ts'];
  return typeof ts === 'string' ? ts : new Date().toISOString();
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

function terminalSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 120, rows: 40 };
}

function startupTerminalSizeLooksPlausible(size: { cols: number; rows: number }): boolean {
  return size.cols >= STARTUP_TERMINAL_MIN_COLS && size.rows >= STARTUP_TERMINAL_MIN_ROWS;
}

async function readStartupTerminalSize(): Promise<{ cols: number; rows: number }> {
  let best = terminalSize();
  if (startupTerminalSizeLooksPlausible(best)) {
    return best;
  }
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < STARTUP_TERMINAL_PROBE_TIMEOUT_MS) {
    await new Promise((resolve) => {
      setTimeout(resolve, STARTUP_TERMINAL_PROBE_INTERVAL_MS);
    });
    const next = terminalSize();
    if (next.cols * next.rows > best.cols * best.rows) {
      best = next;
    }
    if (startupTerminalSizeLooksPlausible(next)) {
      return next;
    }
  }
  if (!startupTerminalSizeLooksPlausible(best)) {
    return { cols: 120, rows: 40 };
  }
  return best;
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

function resolveWorkspacePathForMux(invocationDirectory: string, value: string): string {
  const home = typeof process.env.HOME === 'string' && process.env.HOME.length > 0
    ? process.env.HOME
    : null;
  return resolveWorkspacePath(invocationDirectory, value, home);
}

async function runGitCommand(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 1024 * 1024
    });
    return result.stdout.trim();
  } catch {
    return '';
  }
}

function parseGitBranchFromStatusHeader(header: string | null): string {
  if (header === null) {
    return '(detached)';
  }
  const raw = header.trim();
  if (raw.length === 0) {
    return '(detached)';
  }
  if (raw.startsWith('No commits yet on ')) {
    const branch = raw.slice('No commits yet on '.length).trim();
    return branch.length > 0 ? branch : '(detached)';
  }
  const head = raw.split('...')[0]?.trim() ?? '';
  if (head.length === 0 || head === 'HEAD' || head.startsWith('HEAD ')) {
    return '(detached)';
  }
  return head;
}

function parseGitShortstatCounts(output: string): { additions: number; deletions: number } {
  if (output.length === 0) {
    return {
      additions: 0,
      deletions: 0
    };
  }
  const additionsMatch = /(\d+)\s+insertion(?:s)?\(\+\)/.exec(output);
  const deletionsMatch = /(\d+)\s+deletion(?:s)?\(-\)/.exec(output);
  return {
    additions: additionsMatch === null ? 0 : Number.parseInt(additionsMatch[1] ?? '0', 10),
    deletions: deletionsMatch === null ? 0 : Number.parseInt(deletionsMatch[1] ?? '0', 10)
  };
}

async function readGitSummary(cwd: string): Promise<GitSummary> {
  const insideWorkTree = await runGitCommand(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree !== 'true') {
    return GIT_SUMMARY_NOT_REPOSITORY;
  }
  const statusOutput = await runGitCommand(cwd, ['status', '--porcelain=1', '--branch']);
  const statusLines = statusOutput.split('\n').filter((line) => line.trim().length > 0);
  const firstStatusLine = statusLines[0];
  const headerLine =
    firstStatusLine !== undefined && firstStatusLine.startsWith('## ')
      ? statusLines.shift()?.slice(3) ?? null
      : null;
  const branch = parseGitBranchFromStatusHeader(headerLine);
  const changedFiles = statusLines.length;
  const [unstagedShortstat, stagedShortstat] = await Promise.all([
    runGitCommand(cwd, ['diff', '--shortstat']),
    runGitCommand(cwd, ['diff', '--cached', '--shortstat'])
  ]);
  const unstaged = parseGitShortstatCounts(unstagedShortstat);
  const staged = parseGitShortstatCounts(stagedShortstat);

  return {
    branch,
    changedFiles,
    additions: unstaged.additions + staged.additions,
    deletions: unstaged.deletions + staged.deletions
  };
}

async function readProcessUsageSample(processId: number | null): Promise<ProcessUsageSample> {
  if (processId === null) {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  let stdout = '';
  try {
    const result = await execFileAsync('ps', ['-p', String(processId), '-o', '%cpu=,rss='], {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 8 * 1024
    });
    stdout = result.stdout;
  } catch {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  const line = stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);
  if (line === undefined) {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  const parts = line.split(/\s+/);
  const cpuPercentRaw = Number.parseFloat(parts[0] ?? '');
  const memoryKbRaw = Number.parseInt(parts[1] ?? '', 10);
  return {
    cpuPercent: Number.isFinite(cpuPercentRaw) ? cpuPercentRaw : null,
    memoryMb: Number.isFinite(memoryKbRaw) ? memoryKbRaw / 1024 : null
  };
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
  readonly indexedHexByCode: Record<number, string>;
} {
  let remainder = buffer;
  let foregroundHex: string | undefined;
  let backgroundHex: string | undefined;
  const indexedHexByCode: Record<number, string> = {};

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
    if (code === '10') {
      const hex = parseOscRgbHex(payload.slice(separator + 1));
      if (hex !== null) {
        foregroundHex = hex;
      }
      continue;
    }

    if (code === '11') {
      const hex = parseOscRgbHex(payload.slice(separator + 1));
      if (hex !== null) {
        backgroundHex = hex;
      }
      continue;
    }

    if (code === '4') {
      const value = payload.slice(separator + 1);
      const paletteSeparator = value.indexOf(';');
      if (paletteSeparator < 0) {
        continue;
      }
      const paletteIndexRaw = value.slice(0, paletteSeparator).trim();
      const paletteValueRaw = value.slice(paletteSeparator + 1);
      const parsedIndex = Number.parseInt(paletteIndexRaw, 10);
      if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex > 255) {
        continue;
      }
      const hex = parseOscRgbHex(paletteValueRaw);
      if (hex !== null) {
        indexedHexByCode[parsedIndex] = hex;
      }
    }
  }

  if (remainder.length > 512) {
    remainder = remainder.slice(-512);
  }

  return {
    remainder,
    ...(foregroundHex !== undefined
      ? {
          foregroundHex
        }
      : {}),
    ...(backgroundHex !== undefined
      ? {
          backgroundHex
        }
      : {}),
    indexedHexByCode
  };
}

async function probeTerminalPalette(timeoutMs = 80): Promise<TerminalPaletteProbe> {
  return await new Promise((resolve) => {
    let finished = false;
    let buffer = '';
    let foregroundHex: string | undefined;
    let backgroundHex: string | undefined;
    const indexedHexByCode: Record<number, string> = {};

    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      resolve({
        ...(foregroundHex !== undefined
          ? {
              foregroundHex
            }
          : {}),
        ...(backgroundHex !== undefined
          ? {
              backgroundHex
            }
          : {}),
        ...(Object.keys(indexedHexByCode).length > 0
          ? {
              indexedHexByCode
            }
          : {})
      });
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
      for (const [key, value] of Object.entries(extracted.indexedHexByCode)) {
        const index = Number.parseInt(key, 10);
        if (Number.isInteger(index)) {
          indexedHexByCode[index] = value;
        }
      }

      if (
        foregroundHex !== undefined &&
        backgroundHex !== undefined &&
        Object.keys(indexedHexByCode).length >= 16
      ) {
        finish();
      }
    };

    const timer = setTimeout(() => {
      finish();
    }, timeoutMs);

    process.stdin.on('data', onData);
    let probeSequence = '\u001b]10;?\u0007\u001b]11;?\u0007';
    for (let idx = 0; idx < 16; idx += 1) {
      probeSequence += `\u001b]4;${String(idx)};?\u0007`;
    }
    process.stdout.write(probeSequence);
  });
}

function parseArgs(argv: string[]): MuxOptions {
  const codexArgs: string[] = [];
  let controlPlaneHost = process.env.HARNESS_CONTROL_PLANE_HOST ?? null;
  let controlPlanePortRaw = process.env.HARNESS_CONTROL_PLANE_PORT ?? null;
  let controlPlaneAuthToken = process.env.HARNESS_CONTROL_PLANE_AUTH_TOKEN ?? null;
  let recordingPath = process.env.HARNESS_RECORDING_PATH ?? null;
  let recordingOutputPath = process.env.HARNESS_RECORD_OUTPUT ?? null;
  let recordingFps = parsePositiveInt(process.env.HARNESS_RECORDING_FPS, 15);
  const invocationDirectory = process.env.HARNESS_INVOKE_CWD ?? process.env.INIT_CWD ?? process.cwd();

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

    if (arg === '--record-path') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --record-path');
      }
      recordingPath = value;
      idx += 1;
      continue;
    }

    if (arg === '--record-output') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --record-output');
      }
      recordingOutputPath = value;
      idx += 1;
      continue;
    }

    if (arg === '--record-fps') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --record-fps');
      }
      recordingFps = parsePositiveInt(value, recordingFps);
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

  if (recordingPath !== null && recordingPath.length > 0) {
    recordingPath = resolve(invocationDirectory, recordingPath);
  }
  if (recordingOutputPath !== null && recordingOutputPath.length > 0) {
    recordingOutputPath = resolve(invocationDirectory, recordingOutputPath);
  }

  let recordingGifOutputPath: string | null = null;
  if (recordingOutputPath !== null && recordingOutputPath.length > 0) {
    if (extname(recordingOutputPath).toLowerCase() === '.gif') {
      recordingGifOutputPath = recordingOutputPath;
      const fileName = basename(recordingOutputPath, '.gif');
      const sidecarName = `${fileName}.jsonl`;
      recordingPath = join(dirname(recordingOutputPath), sidecarName);
    } else {
      recordingPath = recordingOutputPath;
    }
  }

  const initialConversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;

  return {
    codexArgs,
    storePath: process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite',
    initialConversationId,
    invocationDirectory,
    controlPlaneHost,
    controlPlanePort,
    controlPlaneAuthToken,
    recordingPath,
    recordingGifOutputPath,
    recordingFps: Math.max(1, recordingFps),
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
  directoryId: string | null,
  title: string,
  agentType: string,
  adapterState: Record<string, unknown>,
  turnId: string,
  baseScope: EventScope,
  cols: number,
  rows: number
): ConversationState {
  return {
    sessionId,
    directoryId,
    title,
    agentType,
    adapterState,
    turnId,
    scope: createConversationScope(baseScope, sessionId, turnId),
    oracle: new TerminalSnapshotOracle(cols, rows),
    status: 'completed',
    attentionReason: null,
    startedAt: new Date().toISOString(),
    lastEventAt: null,
    exitedAt: null,
    lastExit: null,
    processId: null,
    live: true,
    attached: false,
    lastOutputCursor: 0,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    lastTelemetrySource: null,
    controller: null
  };
}

function normalizeInlineSummaryText(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  if (compact.length <= 96) {
    return compact;
  }
  return `${compact.slice(0, 95)}…`;
}

function telemetrySummaryText(summary: {
  source: string;
  eventName: string | null;
  summary: string | null;
}): string | null {
  const eventName = summary.eventName?.trim() ?? '';
  const description = summary.summary?.trim() ?? '';
  const merged =
    description.length > 0 && eventName.length > 0 && !description.includes(eventName)
      ? `${eventName}: ${description}`
      : description.length > 0
        ? description
        : eventName.length > 0
          ? eventName
          : summary.source;
  const normalized = normalizeInlineSummaryText(merged);
  return normalized.length === 0 ? null : normalized;
}

function applyTelemetrySummaryToConversation(
  target: ConversationState,
  telemetry:
    | {
        source: string;
        eventName: string | null;
        summary: string | null;
        observedAt: string;
      }
    | null
): void {
  if (telemetry === null) {
    return;
  }
  target.lastKnownWork = telemetrySummaryText(telemetry);
  target.lastKnownWorkAt = telemetry.observedAt;
  target.lastTelemetrySource = telemetry.source;
}

function applySummaryToConversation(
  target: ConversationState,
  summary: ReturnType<typeof parseSessionSummaryRecord>
): void {
  if (summary === null) {
    return;
  }
  target.scope.tenantId = summary.tenantId;
  target.scope.userId = summary.userId;
  target.scope.workspaceId = summary.workspaceId;
  target.scope.worktreeId = summary.worktreeId;
  target.directoryId = summary.directoryId;
  target.status = summary.status;
  target.attentionReason = summary.attentionReason;
  target.startedAt = summary.startedAt;
  target.lastEventAt = summary.lastEventAt;
  target.exitedAt = summary.exitedAt;
  target.lastExit = summary.lastExit;
  target.processId = summary.processId;
  target.live = summary.live;
  target.controller = summary.controller;
  applyTelemetrySummaryToConversation(target, summary.telemetry);
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
  return [...conversations.keys()];
}

function shortcutHintText(bindings: ResolvedMuxShortcutBindings): string {
  const newConversation = firstShortcutText(bindings, 'mux.conversation.new') || 'ctrl+t';
  const deleteConversation = firstShortcutText(bindings, 'mux.conversation.delete') || 'ctrl+x';
  const takeoverConversation = firstShortcutText(bindings, 'mux.conversation.takeover') || 'ctrl+l';
  const addProject = firstShortcutText(bindings, 'mux.directory.add') || 'ctrl+o';
  const closeProject = firstShortcutText(bindings, 'mux.directory.close') || 'ctrl+w';
  const next = firstShortcutText(bindings, 'mux.conversation.next') || 'ctrl+j';
  const previous = firstShortcutText(bindings, 'mux.conversation.previous') || 'ctrl+k';
  const interrupt = firstShortcutText(bindings, 'mux.app.interrupt-all') || 'ctrl+c';
  const switchHint = next === previous ? next : `${next}/${previous}`;
  return `${newConversation} new  ${deleteConversation} archive  ${takeoverConversation} takeover  ${addProject}/${closeProject} projects  ${switchHint} switch  ${interrupt} quit`;
}

type WorkspaceRailModel = Parameters<typeof renderWorkspaceRailAnsiRows>[0];

function buildRailModel(
  directories: ReadonlyMap<string, ControlPlaneDirectoryRecord>,
  conversations: ReadonlyMap<string, ConversationState>,
  orderedIds: readonly string[],
  activeProjectId: string | null,
  activeConversationId: string | null,
  projectSelectionEnabled: boolean,
  shortcutsCollapsed: boolean,
  gitSummaryByDirectoryId: ReadonlyMap<string, GitSummary>,
  processUsageBySessionId: ReadonlyMap<string, ProcessUsageSample>,
  shortcutBindings: ResolvedMuxShortcutBindings,
  localControllerId: string
): WorkspaceRailModel {
  const directoryRows = [...directories.values()].map((directory) => ({
    key: directory.directoryId,
    workspaceId: basename(directory.path) || directory.path,
    worktreeId: directory.path,
    git: gitSummaryByDirectoryId.get(directory.directoryId) ?? GIT_SUMMARY_LOADING
  }));
  const knownDirectoryKeys = new Set(directoryRows.map((directory) => directory.key));
  for (const sessionId of orderedIds) {
    const conversation = conversations.get(sessionId);
    const directoryKey = conversation?.directoryId;
    if (directoryKey === null || directoryKey === undefined || knownDirectoryKeys.has(directoryKey)) {
      continue;
    }
    knownDirectoryKeys.add(directoryKey);
    directoryRows.push({
      key: directoryKey,
      workspaceId: '(untracked)',
      worktreeId: '(untracked)',
      git: gitSummaryByDirectoryId.get(directoryKey) ?? GIT_SUMMARY_LOADING
    });
  }

  return {
    directories: directoryRows,
    conversations: orderedIds
      .map((sessionId) => {
        const conversation = conversations.get(sessionId);
        if (conversation === undefined) {
          return null;
        }
        const directoryKey = conversation.directoryId ?? 'directory-missing';
        return {
          ...conversationSummary(conversation),
          directoryKey,
          title: conversation.title,
          agentLabel: conversation.agentType,
          cpuPercent: processUsageBySessionId.get(conversation.sessionId)?.cpuPercent ?? null,
          memoryMb: processUsageBySessionId.get(conversation.sessionId)?.memoryMb ?? null,
          lastKnownWork: conversation.lastKnownWork,
          controller: conversation.controller
        };
      })
      .flatMap((conversation) => (conversation === null ? [] : [conversation])),
    activeProjectId,
    activeConversationId,
    localControllerId,
    projectSelectionEnabled,
    processes: [],
    shortcutHint: shortcutHintText(shortcutBindings),
    shortcutsCollapsed,
    nowMs: Date.now()
  };
}

function buildRailRows(
  layout: ReturnType<typeof computeDualPaneLayout>,
  directories: ReadonlyMap<string, ControlPlaneDirectoryRecord>,
  conversations: ReadonlyMap<string, ConversationState>,
  orderedIds: readonly string[],
  activeProjectId: string | null,
  activeConversationId: string | null,
  projectSelectionEnabled: boolean,
  shortcutsCollapsed: boolean,
  gitSummaryByDirectoryId: ReadonlyMap<string, GitSummary>,
  processUsageBySessionId: ReadonlyMap<string, ProcessUsageSample>,
  shortcutBindings: ResolvedMuxShortcutBindings,
  localControllerId: string
): { ansiRows: readonly string[]; viewRows: ReturnType<typeof buildWorkspaceRailViewRows> } {
  const railModel = buildRailModel(
    directories,
    conversations,
    orderedIds,
    activeProjectId,
    activeConversationId,
    projectSelectionEnabled,
    shortcutsCollapsed,
    gitSummaryByDirectoryId,
    processUsageBySessionId,
    shortcutBindings,
    localControllerId
  );
  const viewRows = buildWorkspaceRailViewRows(railModel, layout.paneRows);
  return {
    ansiRows: renderWorkspaceRailAnsiRows(railModel, layout.leftCols, layout.paneRows),
    viewRows
  };
}

const MUX_MODAL_THEME = {
  frameStyle: {
    fg: { kind: 'indexed', index: 252 },
    bg: { kind: 'indexed', index: 236 },
    bold: true
  },
  titleStyle: {
    fg: { kind: 'indexed', index: 231 },
    bg: { kind: 'indexed', index: 236 },
    bold: true
  },
  bodyStyle: {
    fg: { kind: 'indexed', index: 253 },
    bg: { kind: 'indexed', index: 236 },
    bold: false
  },
  footerStyle: {
    fg: { kind: 'indexed', index: 247 },
    bg: { kind: 'indexed', index: 236 },
    bold: false
  }
} as const;

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
  frame: TerminalSnapshotFrameCore,
  rowAbs: number,
  col: number
): SelectionPoint {
  const maxRowAbs = Math.max(0, frame.viewport.totalRows - 1);
  return {
    rowAbs: Math.max(0, Math.min(maxRowAbs, rowAbs)),
    col: Math.max(0, Math.min(layout.rightCols - 1, col))
  };
}

function pointFromMouseEvent(
  layout: ReturnType<typeof computeDualPaneLayout>,
  frame: TerminalSnapshotFrameCore,
  event: { col: number; row: number }
): SelectionPoint {
  const rowViewport = Math.max(0, Math.min(layout.paneRows - 1, event.row - 1));
  return clampPanePoint(
    layout,
    frame,
    frame.viewport.top + rowViewport,
    event.col - layout.rightStartCol
  );
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

function cellGlyphForOverlay(frame: TerminalSnapshotFrameCore, row: number, col: number): string {
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
  layout: ReturnType<typeof computeDualPaneLayout>,
  frame: TerminalSnapshotFrameCore,
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

    output += `\u001b[${String(row + 1)};${String(layout.rightStartCol + rowStartCol)}H\u001b[7m`;
    for (let col = rowStartCol; col <= rowEndCol; col += 1) {
      output += cellGlyphForOverlay(frame, row, col);
    }
    output += '\u001b[0m';
  }

  return output;
}

function selectionVisibleRows(
  frame: TerminalSnapshotFrameCore,
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

function selectionText(frame: TerminalSnapshotFrameCore, selection: PaneSelection | null): string {
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
  const prefixes = ['\u001b[99;', '\u001b[67;'] as const;
  for (const prefix of prefixes) {
    let startIndex = text.indexOf(prefix);
    while (startIndex !== -1) {
      let index = startIndex + prefix.length;
      while (index < text.length && text.charCodeAt(index) >= 0x30 && text.charCodeAt(index) <= 0x39) {
        index += 1;
      }
      if (index > startIndex + prefix.length && text[index] === 'u') {
        return true;
      }
      startIndex = text.indexOf(prefix, startIndex + 1);
    }
  }
  return false;
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
  const loadedConfig = loadHarnessConfig({
    cwd: options.invocationDirectory
  });
  const debugConfig = loadedConfig.config.debug;
  const perfEnabled = parseBooleanEnv(
    process.env.HARNESS_PERF_ENABLED,
    debugConfig.enabled && debugConfig.perf.enabled
  );
  const perfFilePath = resolve(
    options.invocationDirectory,
    process.env.HARNESS_PERF_FILE_PATH ?? debugConfig.perf.filePath
  );
  const perfTruncateOnStart = parseBooleanEnv(
    process.env.HARNESS_PERF_TRUNCATE_ON_START,
    debugConfig.overwriteArtifactsOnStart
  );
  if (perfEnabled) {
    prepareArtifactPath(perfFilePath, perfTruncateOnStart);
  }
  configurePerfCore({
    enabled: perfEnabled,
    filePath: perfFilePath
  });
  const startupSpan = startPerfSpan('mux.startup.total', {
    invocationDirectory: options.invocationDirectory,
    codexArgs: options.codexArgs.length
  });
  recordPerfEvent('mux.startup.begin', {
    stdinTty: process.stdin.isTTY ? 1 : 0,
    stdoutTty: process.stdout.isTTY ? 1 : 0,
    perfFilePath
  });
  if (loadedConfig.error !== null) {
    process.stderr.write(`[config] using last-known-good due to parse error: ${loadedConfig.error}\n`);
  }
  const shortcutBindings = resolveMuxShortcutBindings(loadedConfig.config.mux.keybindings);
  const modalDismissShortcutBindings = resolveMuxShortcutBindings({
    'mux.app.quit': ['escape'],
    'mux.app.interrupt-all': [],
    'mux.conversation.new': [],
    'mux.conversation.next': [],
    'mux.conversation.previous': [],
    'mux.conversation.archive': [],
    'mux.conversation.takeover': [],
    'mux.conversation.delete': [],
    'mux.directory.add': [],
    'mux.directory.close': []
  });
  const store = new SqliteEventStore(options.storePath);

  let size = await readStartupTerminalSize();
  recordPerfEvent('mux.startup.terminal-size', {
    cols: size.cols,
    rows: size.rows
  });
  const configuredMuxUi = loadedConfig.config.mux.ui;
  const configuredMuxGit = loadedConfig.config.mux.git;
  let leftPaneColsOverride: number | null =
    configuredMuxUi.paneWidthPercent === null
      ? null
      : leftColsFromPaneWidthPercent(size.cols, configuredMuxUi.paneWidthPercent);
  let layout = computeDualPaneLayout(size.cols, size.rows, {
    leftCols: leftPaneColsOverride
  });
  const resizeMinIntervalMs = debugConfig.enabled
    ? debugConfig.mux.resizeMinIntervalMs
    : DEFAULT_RESIZE_MIN_INTERVAL_MS;
  const ptyResizeSettleMs = debugConfig.enabled
    ? debugConfig.mux.ptyResizeSettleMs
    : DEFAULT_PTY_RESIZE_SETTLE_MS;
  const startupSettleQuietMs = debugConfig.enabled
    ? debugConfig.mux.startupSettleQuietMs
    : DEFAULT_STARTUP_SETTLE_QUIET_MS;
  const controlPlaneConnectRetryWindowMs = parsePositiveInt(
    process.env.HARNESS_CONTROL_PLANE_CONNECT_RETRY_WINDOW_MS,
    0
  );
  const controlPlaneConnectRetryDelayMs = Math.max(
    1,
    parsePositiveInt(process.env.HARNESS_CONTROL_PLANE_CONNECT_RETRY_DELAY_MS, 50)
  );
  const backgroundResumePersisted = parseBooleanEnv(
    process.env.HARNESS_MUX_BACKGROUND_RESUME,
    DEFAULT_BACKGROUND_RESUME_PERSISTED
  );
  const backgroundProbesEnabled = parseBooleanEnv(
    process.env.HARNESS_MUX_BACKGROUND_PROBES,
    DEFAULT_BACKGROUND_PROBES_ENABLED
  );
  const validateAnsi = debugConfig.enabled ? debugConfig.mux.validateAnsi : false;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  const inputModeManager = createMuxInputModeManager((sequence) => {
    process.stdout.write(sequence);
  });

  const paletteProbeSpan = startPerfSpan('mux.startup.palette-probe');
  const probedPalette = await probeTerminalPalette();
  paletteProbeSpan.end({
    hasForeground: probedPalette.foregroundHex !== undefined,
    hasBackground: probedPalette.backgroundHex !== undefined
  });
  let muxRecordingWriter: ReturnType<typeof createTerminalRecordingWriter> | null = null;
  let muxRecordingOracle: TerminalSnapshotOracle | null = null;
  if (options.recordingPath !== null) {
    const recordIntervalMs = Math.max(1, Math.floor(1000 / options.recordingFps));
    const recordingWriterOptions: Parameters<typeof createTerminalRecordingWriter>[0] = {
      filePath: options.recordingPath,
      source: 'codex-live-mux',
      defaultForegroundHex: process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex ?? 'd0d7de',
      defaultBackgroundHex: process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex ?? '0f1419',
      minFrameIntervalMs: recordIntervalMs
    };
    if (probedPalette.indexedHexByCode !== undefined) {
      recordingWriterOptions.ansiPaletteIndexedHex = probedPalette.indexedHexByCode;
    }
    muxRecordingWriter = createTerminalRecordingWriter(recordingWriterOptions);
    muxRecordingOracle = new TerminalSnapshotOracle(size.cols, size.rows);
  }
  const controlPlaneMode =
    options.controlPlaneHost !== null && options.controlPlanePort !== null
      ? {
          mode: 'remote' as const,
          host: options.controlPlaneHost,
          port: options.controlPlanePort,
          ...(options.controlPlaneAuthToken !== null
            ? {
                authToken: options.controlPlaneAuthToken
              }
            : {}),
          connectRetryWindowMs: controlPlaneConnectRetryWindowMs,
          connectRetryDelayMs: controlPlaneConnectRetryDelayMs
        }
      : {
          mode: 'embedded' as const
        };
  const controlPlaneOpenSpan = startPerfSpan('mux.startup.control-plane-open');
  const controlPlaneClient = await openCodexControlPlaneClient(
    controlPlaneMode,
    {
    startEmbeddedServer: async () =>
      await startControlPlaneStreamServer({
        stateStorePath: resolve(
          options.invocationDirectory,
          process.env.HARNESS_CONTROL_PLANE_DB_PATH ?? '.harness/control-plane.sqlite'
        ),
        startSession: (input) => {
          const sessionOptions: Parameters<typeof startCodexLiveSession>[0] = {
            args: input.args,
            initialCols: input.initialCols,
            initialRows: input.initialRows,
            enableSnapshotModel: debugConfig.mux.serverSnapshotModelEnabled
          };
          if (input.command !== undefined) {
            sessionOptions.command = input.command;
          }
          if (input.baseArgs !== undefined) {
            sessionOptions.baseArgs = input.baseArgs;
          }
          if (input.env !== undefined) {
            sessionOptions.env = input.env;
          }
          if (input.cwd !== undefined) {
            sessionOptions.cwd = input.cwd;
          }
          if (input.terminalForegroundHex !== undefined) {
            sessionOptions.terminalForegroundHex = input.terminalForegroundHex;
          }
          if (input.terminalBackgroundHex !== undefined) {
            sessionOptions.terminalBackgroundHex = input.terminalBackgroundHex;
          }
          return startCodexLiveSession(sessionOptions);
        }
      })
  });
  controlPlaneOpenSpan.end();
  const streamClient = controlPlaneClient.client;
  const directoryUpsertSpan = startPerfSpan('mux.startup.directory-upsert');
  const directoryResult = await streamClient.sendCommand({
    type: 'directory.upsert',
    directoryId: `directory-${options.scope.workspaceId}`,
    tenantId: options.scope.tenantId,
    userId: options.scope.userId,
    workspaceId: options.scope.workspaceId,
    path: options.invocationDirectory
  });
  const persistedDirectory = parseDirectoryRecord(directoryResult['directory']);
  if (persistedDirectory === null) {
    throw new Error('control-plane directory.upsert returned malformed directory record');
  }
  directoryUpsertSpan.end();
  let activeDirectoryId: string | null = persistedDirectory.directoryId;
  let mainPaneMode: 'conversation' | 'project' = 'conversation';
  let projectPaneSnapshot: ProjectPaneSnapshot | null = null;
  let projectPaneScrollTop = 0;

  const sessionEnv = {
    ...sanitizeProcessEnv(),
    TERM: process.env.TERM ?? 'xterm-256color'
  };
  const directories = new Map<string, ControlPlaneDirectoryRecord>([
    [persistedDirectory.directoryId, persistedDirectory]
  ]);
  const muxControllerId = `human-mux-${process.pid}-${randomUUID()}`;
  const muxControllerLabel = `human mux ${process.pid}`;
  const conversations = new Map<string, ConversationState>();
  let keyEventSubscription: Awaited<ReturnType<typeof subscribeControlPlaneKeyEvents>> | null = null;
  const conversationStartInFlight = new Map<string, Promise<ConversationState>>();
  const removedConversationIds = new Set<string>();
  let activeConversationId: string | null = null;
  let startupFirstPaintTargetSessionId: string | null = null;
  let startupActiveStartCommandSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveFirstOutputSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveFirstPaintSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveSettledSpan: ReturnType<typeof startPerfSpan> | null = null;
  const startupSequencer = new StartupSequencer({
    quietMs: startupSettleQuietMs,
    nonemptyFallbackMs: DEFAULT_STARTUP_SETTLE_NONEMPTY_FALLBACK_MS
  });
  const startupSessionFirstOutputObserved = new Set<string>();

  const endStartupActiveStartCommandSpan = (attrs: Record<string, boolean | number | string>): void => {
    if (startupActiveStartCommandSpan === null) {
      return;
    }
    startupActiveStartCommandSpan.end(attrs);
    startupActiveStartCommandSpan = null;
  };

  const endStartupActiveFirstOutputSpan = (attrs: Record<string, boolean | number | string>): void => {
    if (startupActiveFirstOutputSpan === null) {
      return;
    }
    startupActiveFirstOutputSpan.end(attrs);
    startupActiveFirstOutputSpan = null;
  };

  const endStartupActiveFirstPaintSpan = (attrs: Record<string, boolean | number | string>): void => {
    if (startupActiveFirstPaintSpan === null) {
      return;
    }
    startupActiveFirstPaintSpan.end(attrs);
    startupActiveFirstPaintSpan = null;
  };

  const endStartupActiveSettledSpan = (attrs: Record<string, boolean | number | string>): void => {
    if (startupActiveSettledSpan === null) {
      return;
    }
    startupActiveSettledSpan.end(attrs);
    startupActiveSettledSpan = null;
  };

  const clearStartupSettledTimer = (): void => {
    startupSequencer.clearSettledTimer();
  };

  const signalStartupActiveSettled = (): void => {
    startupSequencer.signalSettled();
  };

  const visibleGlyphCellCount = (conversation: ConversationState): number => {
    const frame = conversation.oracle.snapshotWithoutHash();
    let count = 0;
    for (const line of frame.richLines) {
      for (const cell of line.cells) {
        if (!cell.continued && cell.glyph.trim().length > 0) {
          count += 1;
        }
      }
    }
    return count;
  };

  const visibleText = (conversation: ConversationState): string => {
    const frame = conversation.oracle.snapshotWithoutHash();
    const rows: string[] = [];
    for (const line of frame.richLines) {
      let row = '';
      for (const cell of line.cells) {
        if (cell.continued) {
          continue;
        }
        row += cell.glyph;
      }
      rows.push(row.trimEnd());
    }
    return rows.join('\n');
  };

  const codexHeaderVisible = (conversation: ConversationState): boolean => {
    const text = visibleText(conversation);
    return text.includes('OpenAI Codex') && text.includes('model:') && text.includes('directory:');
  };

  const scheduleStartupSettledProbe = (sessionId: string): void => {
    startupSequencer.scheduleSettledProbe(sessionId, (event) => {
      if (startupFirstPaintTargetSessionId !== event.sessionId) {
        return;
      }
      const conversation = conversations.get(event.sessionId);
      const glyphCells = conversation === undefined ? 0 : visibleGlyphCellCount(conversation);
      recordPerfEvent('mux.startup.active-settled', {
        sessionId: event.sessionId,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells
      });
      endStartupActiveSettledSpan({
        observed: true,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells
      });
      signalStartupActiveSettled();
    });
  };

  const firstDirectoryId = (): string | null => {
    const iterator = directories.keys().next();
    if (iterator.done === true) {
      return null;
    }
    return iterator.value;
  };

  const resolveActiveDirectoryId = (): string | null => {
    if (activeDirectoryId !== null && directories.has(activeDirectoryId)) {
      return activeDirectoryId;
    }
    const fallback = firstDirectoryId();
    activeDirectoryId = fallback;
    return fallback;
  };

  const resolveDirectoryForAction = (): string | null => {
    if (mainPaneMode === 'project') {
      if (activeDirectoryId !== null && directories.has(activeDirectoryId)) {
        return activeDirectoryId;
      }
      return null;
    }
    if (activeConversationId !== null) {
      const conversation = conversations.get(activeConversationId);
      if (conversation?.directoryId !== null && conversation?.directoryId !== undefined) {
        if (directories.has(conversation.directoryId)) {
          return conversation.directoryId;
        }
      }
    }
    if (activeDirectoryId !== null && directories.has(activeDirectoryId)) {
      return activeDirectoryId;
    }
    return null;
  };

  const ensureConversation = (
    sessionId: string,
    seed?: {
      directoryId?: string | null;
      title?: string;
      agentType?: string;
      adapterState?: Record<string, unknown>;
    }
  ): ConversationState => {
    const existing = conversations.get(sessionId);
    if (existing !== undefined) {
      if (seed?.directoryId !== undefined) {
        existing.directoryId = seed.directoryId;
      }
      if (seed?.title !== undefined) {
        existing.title = seed.title;
      }
      if (seed?.agentType !== undefined) {
        existing.agentType = seed.agentType;
      }
      if (seed?.adapterState !== undefined) {
        existing.adapterState = normalizeAdapterState(seed.adapterState);
      }
      return existing;
    }
    removedConversationIds.delete(sessionId);
    const directoryId = seed?.directoryId ?? resolveActiveDirectoryId();
    const state = createConversationState(
      sessionId,
      directoryId,
      seed?.title ?? '',
      seed?.agentType ?? 'codex',
      normalizeAdapterState(seed?.adapterState),
      `turn-${randomUUID()}`,
      options.scope,
      layout.rightCols,
      layout.paneRows
    );
    conversations.set(sessionId, state);
    return state;
  };

  const activeConversation = (): ConversationState => {
    if (activeConversationId === null) {
      throw new Error('active thread is not set');
    }
    const state = conversations.get(activeConversationId);
    if (state === undefined) {
      throw new Error(`active thread missing: ${activeConversationId}`);
    }
    return state;
  };

  const isConversationControlledByLocalHuman = (conversation: ConversationState): boolean => {
    return (
      conversation.controller !== null &&
      conversation.controller.controllerType === 'human' &&
      conversation.controller.controllerId === muxControllerId
    );
  };

  const applyControlPlaneKeyEvent = (event: ControlPlaneKeyEvent): void => {
    if (removedConversationIds.has(event.sessionId)) {
      return;
    }
    const conversation = ensureConversation(event.sessionId, {
      directoryId: event.directoryId
    });
    if (event.directoryId !== null) {
      conversation.directoryId = event.directoryId;
    }

    if (event.type === 'session-status') {
      conversation.status = event.status;
      conversation.attentionReason = event.attentionReason;
      conversation.live = event.live;
      conversation.controller = event.controller;
      conversation.lastEventAt = event.ts;
      applyTelemetrySummaryToConversation(conversation, event.telemetry);
      return;
    }

    if (event.type === 'session-control') {
      conversation.controller = event.controller;
      conversation.lastEventAt = event.ts;
      return;
    }

    applyTelemetrySummaryToConversation(conversation, {
      source: event.keyEvent.source,
      eventName: event.keyEvent.eventName,
      summary: event.keyEvent.summary,
      observedAt: event.keyEvent.observedAt
    });
    conversation.lastEventAt = event.keyEvent.observedAt;
    if (event.keyEvent.statusHint === 'needs-input') {
      conversation.status = 'needs-input';
      conversation.attentionReason = 'telemetry';
      return;
    }
    if (event.keyEvent.statusHint === 'running' && conversation.status !== 'exited') {
      conversation.status = 'running';
      conversation.attentionReason = null;
      return;
    }
    if (event.keyEvent.statusHint === 'completed' && conversation.status !== 'exited') {
      conversation.status = 'completed';
      conversation.attentionReason = null;
    }
  };

  const hydrateDirectoryList = async (): Promise<void> => {
    const listed = await streamClient.sendCommand({
      type: 'directory.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId
    });
    const rows = Array.isArray(listed['directories']) ? listed['directories'] : [];
    directories.clear();
    for (const row of rows) {
      const record = parseDirectoryRecord(row);
      if (record === null) {
        continue;
      }
      const normalizedPath = resolveWorkspacePathForMux(options.invocationDirectory, record.path);
      if (normalizedPath !== record.path) {
        const repairedResult = await streamClient.sendCommand({
          type: 'directory.upsert',
          directoryId: record.directoryId,
          tenantId: record.tenantId,
          userId: record.userId,
          workspaceId: record.workspaceId,
          path: normalizedPath
        });
        const repairedRecord = parseDirectoryRecord(repairedResult['directory']);
        directories.set(record.directoryId, repairedRecord ?? { ...record, path: normalizedPath });
        continue;
      }
      directories.set(record.directoryId, record);
    }
    if (!directories.has(persistedDirectory.directoryId)) {
      directories.set(persistedDirectory.directoryId, persistedDirectory);
    }
    if (resolveActiveDirectoryId() === null) {
      throw new Error('no active directory available after hydrate');
    }
  };

  const hydratePersistedConversationsForDirectory = async (directoryId: string): Promise<number> => {
    const listedPersisted = await streamClient.sendCommand({
      type: 'conversation.list',
      directoryId,
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId
    });
    const persistedRows = Array.isArray(listedPersisted['conversations'])
      ? listedPersisted['conversations']
      : [];
    for (const row of persistedRows) {
      const record = parseConversationRecord(row);
      if (record === null) {
        continue;
      }
      const conversation = ensureConversation(record.conversationId, {
        directoryId: record.directoryId,
        title: record.title,
        agentType: record.agentType,
        adapterState: record.adapterState
      });
      conversation.scope.tenantId = record.tenantId;
      conversation.scope.userId = record.userId;
      conversation.scope.workspaceId = record.workspaceId;
      conversation.status =
        !record.runtimeLive &&
        (record.runtimeStatus === 'running' || record.runtimeStatus === 'needs-input')
          ? 'completed'
          : record.runtimeStatus;
      // Persisted runtime flags are advisory; session.list is authoritative for live sessions.
      conversation.live = false;
    }
    return persistedRows.length;
  };

  async function subscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await streamClient.sendCommand({
        type: 'pty.subscribe-events',
        sessionId
      });
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
        throw error;
      }
    }
  }

  async function unsubscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await streamClient.sendCommand({
        type: 'pty.unsubscribe-events',
        sessionId
      });
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
        throw error;
      }
    }
  }

  const startConversation = async (sessionId: string): Promise<ConversationState> => {
    const inFlight = conversationStartInFlight.get(sessionId);
    if (inFlight !== undefined) {
      return await inFlight;
    }

    const task = (async (): Promise<ConversationState> => {
      const existing = conversations.get(sessionId);
      if (existing?.live === true) {
        if (startupFirstPaintTargetSessionId === sessionId) {
          endStartupActiveStartCommandSpan({
            alreadyLive: true
          });
        }
        return existing;
      }
      const startSpan = startPerfSpan('mux.conversation.start', {
        sessionId
      });
      const targetConversation = ensureConversation(sessionId);
      targetConversation.lastOutputCursor = 0;
      const agentType = normalizeThreadAgentType(targetConversation.agentType);
      const baseArgsForAgent = agentType === 'codex' ? options.codexArgs : [];
      const launchArgs = buildAgentStartArgs(
        agentType,
        baseArgsForAgent,
        targetConversation.adapterState
      );
      const configuredDirectoryPath =
        targetConversation.directoryId === null
          ? null
          : directories.get(targetConversation.directoryId)?.path ?? null;
      const sessionCwd = resolveWorkspacePathForMux(
        options.invocationDirectory,
        configuredDirectoryPath ?? options.invocationDirectory
      );
      const ptyStartCommand: Parameters<typeof streamClient.sendCommand>[0] = {
        type: 'pty.start',
        sessionId,
        args: launchArgs,
        env: sessionEnv,
        cwd: sessionCwd,
        initialCols: layout.rightCols,
        initialRows: layout.paneRows,
        tenantId: options.scope.tenantId,
        userId: options.scope.userId,
        workspaceId: options.scope.workspaceId,
        worktreeId: options.scope.worktreeId
      };
      const terminalForegroundHex = process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex;
      const terminalBackgroundHex = process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex;
      if (terminalForegroundHex !== undefined) {
        ptyStartCommand.terminalForegroundHex = terminalForegroundHex;
      }
      if (terminalBackgroundHex !== undefined) {
        ptyStartCommand.terminalBackgroundHex = terminalBackgroundHex;
      }
      await streamClient.sendCommand(ptyStartCommand);
      ptySizeByConversationId.set(sessionId, {
        cols: layout.rightCols,
        rows: layout.paneRows
      });
      streamClient.sendResize(sessionId, layout.rightCols, layout.paneRows);
      if (startupFirstPaintTargetSessionId === sessionId) {
        endStartupActiveStartCommandSpan({
          alreadyLive: false,
          argCount: launchArgs.length,
          resumed: launchArgs[0] === 'resume'
        });
      }
      const state = ensureConversation(sessionId);
      recordPerfEvent('mux.conversation.start.command', {
        sessionId,
        argCount: launchArgs.length,
        resumed: launchArgs[0] === 'resume'
      });
      const statusRecord = await streamClient.sendCommand({
        type: 'session.status',
        sessionId
      });
      const statusSummary = parseSessionSummaryRecord(statusRecord);
      if (statusSummary !== null) {
        applySummaryToConversation(state, statusSummary);
      }
      await subscribeConversationEvents(sessionId);
      startSpan.end({
        live: state.live
      });
      return state;
    })();

    conversationStartInFlight.set(sessionId, task);
    try {
      return await task;
    } finally {
      conversationStartInFlight.delete(sessionId);
    }
  };

  const queuePersistedConversationsInBackground = (
    activeSessionId: string | null
  ): number => {
    const ordered = conversationOrder(conversations);
    let queued = 0;
    for (const sessionId of ordered) {
      if (activeSessionId !== null && sessionId === activeSessionId) {
        continue;
      }
      const conversation = conversations.get(sessionId);
      if (conversation === undefined || conversation.live) {
        continue;
      }
      queueBackgroundControlPlaneOp(
        async () => {
          const latest = conversations.get(sessionId);
          if (latest === undefined || latest.live) {
            return;
          }
          await startConversation(sessionId);
          markDirty();
        },
        `background-start:${sessionId}`
      );
      queued += 1;
    }
    return queued;
  };

  const hydrateConversationList = async (): Promise<void> => {
    const hydrateSpan = startPerfSpan('mux.startup.hydrate-conversations');
    await hydrateDirectoryList();
    let persistedCount = 0;
    for (const directoryId of directories.keys()) {
      persistedCount += await hydratePersistedConversationsForDirectory(directoryId);
    }

    const listedLive = await streamClient.sendCommand({
      type: 'session.list',
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
      worktreeId: options.scope.worktreeId,
      sort: 'started-asc'
    });
    const summaries = parseSessionSummaryList(listedLive['sessions']);
    for (const summary of summaries) {
      const conversation = ensureConversation(summary.sessionId);
      applySummaryToConversation(conversation, summary);
      if (summary.live) {
        await subscribeConversationEvents(summary.sessionId);
      }
    }
    hydrateSpan.end({
      persisted: persistedCount,
      live: summaries.length
    });
  };

  await hydrateConversationList();
  if (conversations.size === 0) {
    const targetDirectoryId = resolveActiveDirectoryId();
    if (targetDirectoryId === null) {
      throw new Error('cannot create initial thread without an active directory');
    }
    const initialTitle = '';
    await streamClient.sendCommand({
      type: 'conversation.create',
      conversationId: options.initialConversationId,
      directoryId: targetDirectoryId,
      title: initialTitle,
      agentType: 'codex',
      adapterState: {}
    });
    ensureConversation(options.initialConversationId, {
      directoryId: targetDirectoryId,
      title: initialTitle,
      agentType: 'codex',
      adapterState: {}
    });
  }
  if (activeConversationId === null) {
    const ordered = conversationOrder(conversations);
    activeConversationId = ordered[0] ?? options.initialConversationId;
  }

  const gitSummaryByDirectoryId = new Map<string, GitSummary>();
  const gitLastRefreshAtMsByDirectoryId = new Map<string, number>();
  const gitLastActivityAtMsByDirectoryId = new Map<string, number>();
  const pendingGitSummaryRefreshByDirectoryId = new Map<string, PendingGitSummaryRefresh>();
  const gitRefreshInFlightDirectoryIds = new Set<string>();
  const processUsageBySessionId = new Map<string, ProcessUsageSample>();
  let processUsageRefreshInFlight = false;

  const processUsageEqual = (left: ProcessUsageSample, right: ProcessUsageSample): boolean =>
    left.cpuPercent === right.cpuPercent && left.memoryMb === right.memoryMb;

  const gitSummaryEqual = (left: GitSummary, right: GitSummary): boolean =>
    left.branch === right.branch &&
    left.changedFiles === right.changedFiles &&
    left.additions === right.additions &&
    left.deletions === right.deletions;

  const gitRefreshReasonPriority = (reason: GitSummaryRefreshReason): number => {
    if (reason === 'startup' || reason === 'focus') {
      return 3;
    }
    if (reason === 'trigger') {
      return 2;
    }
    return 1;
  };

  const ensureDirectoryGitState = (directoryId: string): void => {
    if (!gitSummaryByDirectoryId.has(directoryId)) {
      gitSummaryByDirectoryId.set(directoryId, GIT_SUMMARY_LOADING);
    }
    if (!gitLastActivityAtMsByDirectoryId.has(directoryId)) {
      gitLastActivityAtMsByDirectoryId.set(directoryId, Date.now());
    }
  };

  const deleteDirectoryGitState = (directoryId: string): void => {
    gitSummaryByDirectoryId.delete(directoryId);
    gitLastRefreshAtMsByDirectoryId.delete(directoryId);
    gitLastActivityAtMsByDirectoryId.delete(directoryId);
    pendingGitSummaryRefreshByDirectoryId.delete(directoryId);
    gitRefreshInFlightDirectoryIds.delete(directoryId);
  };

  const syncGitStateWithDirectories = (): void => {
    for (const directoryId of directories.keys()) {
      ensureDirectoryGitState(directoryId);
    }
    const staleDirectoryIds = [...gitSummaryByDirectoryId.keys()].filter(
      (directoryId) => !directories.has(directoryId)
    );
    for (const directoryId of staleDirectoryIds) {
      deleteDirectoryGitState(directoryId);
    }
  };

  const queueGitSummaryRefresh = (
    directoryId: string,
    reason: GitSummaryRefreshReason,
    debounceMs: number
  ): void => {
    if (!directories.has(directoryId)) {
      return;
    }
    ensureDirectoryGitState(directoryId);
    const nowMs = Date.now();
    const dueAtMs = nowMs + Math.max(0, debounceMs);
    const pending = pendingGitSummaryRefreshByDirectoryId.get(directoryId);
    if (pending === undefined) {
      pendingGitSummaryRefreshByDirectoryId.set(directoryId, {
        dueAtMs,
        reason
      });
      return;
    }
    pendingGitSummaryRefreshByDirectoryId.set(directoryId, {
      dueAtMs: Math.min(pending.dueAtMs, dueAtMs),
      reason:
        gitRefreshReasonPriority(reason) >= gitRefreshReasonPriority(pending.reason)
          ? reason
          : pending.reason
    });
  };

  const noteGitActivity = (directoryId: string | null, reason: GitSummaryRefreshReason): void => {
    if (directoryId === null || !directories.has(directoryId)) {
      return;
    }
    gitLastActivityAtMsByDirectoryId.set(directoryId, Date.now());
    queueGitSummaryRefresh(
      directoryId,
      reason,
      reason === 'focus' || reason === 'startup' ? 0 : configuredMuxGit.triggerDebounceMs
    );
    if (reason === 'focus' || reason === 'startup') {
      drainPendingGitSummaryRefreshes();
    }
  };

  const gitPollIntervalMsForDirectory = (directoryId: string, nowMs: number): number => {
    const isActiveDirectory = activeDirectoryId !== null && directoryId === activeDirectoryId;
    const basePollMs = isActiveDirectory ? configuredMuxGit.activePollMs : configuredMuxGit.idlePollMs;
    const lastActivityAtMs = gitLastActivityAtMsByDirectoryId.get(directoryId) ?? 0;
    if (nowMs - lastActivityAtMs <= configuredMuxGit.burstWindowMs) {
      return Math.min(basePollMs, configuredMuxGit.burstPollMs);
    }
    return basePollMs;
  };

  const refreshGitSummaryForDirectory = async (
    directoryId: string,
    reason: GitSummaryRefreshReason
  ): Promise<void> => {
    if (gitRefreshInFlightDirectoryIds.has(directoryId)) {
      return;
    }
    const directory = directories.get(directoryId);
    if (directory === undefined) {
      deleteDirectoryGitState(directoryId);
      return;
    }
    ensureDirectoryGitState(directoryId);
    gitRefreshInFlightDirectoryIds.add(directoryId);
    const gitSpan = startPerfSpan('mux.background.git-summary', {
      reason,
      directoryId
    });
    try {
      const next = await readGitSummary(directory.path);
      if (!directories.has(directoryId)) {
        deleteDirectoryGitState(directoryId);
        gitSpan.end({
          reason,
          directoryId,
          dropped: true
        });
        return;
      }
      const previous = gitSummaryByDirectoryId.get(directoryId) ?? GIT_SUMMARY_LOADING;
      const changed = !gitSummaryEqual(previous, next);
      gitSummaryByDirectoryId.set(directoryId, next);
      gitLastRefreshAtMsByDirectoryId.set(directoryId, Date.now());
      if (changed) {
        markDirty();
      }
      gitSpan.end({
        reason,
        directoryId,
        changed,
        branch: next.branch,
        changedFiles: next.changedFiles
      });
    } finally {
      gitRefreshInFlightDirectoryIds.delete(directoryId);
      setImmediate(() => {
        drainPendingGitSummaryRefreshes();
      });
    }
  };

  const drainPendingGitSummaryRefreshes = (): void => {
    if (shuttingDown || !configuredMuxGit.enabled) {
      return;
    }
    syncGitStateWithDirectories();
    const nowMs = Date.now();
    for (const directoryId of directories.keys()) {
      const lastRefreshAtMs = gitLastRefreshAtMsByDirectoryId.get(directoryId) ?? 0;
      const pollIntervalMs = gitPollIntervalMsForDirectory(directoryId, nowMs);
      if (nowMs - lastRefreshAtMs >= pollIntervalMs) {
        queueGitSummaryRefresh(directoryId, 'interval', 0);
      }
    }

    let availableSlots =
      Math.max(1, configuredMuxGit.maxConcurrency) - gitRefreshInFlightDirectoryIds.size;
    if (availableSlots <= 0) {
      return;
    }
    const dueEntries = [...pendingGitSummaryRefreshByDirectoryId.entries()]
      .filter((entry) => entry[1].dueAtMs <= nowMs)
      .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs);
    for (const [directoryId, pending] of dueEntries) {
      if (availableSlots <= 0) {
        break;
      }
      if (!directories.has(directoryId) || gitRefreshInFlightDirectoryIds.has(directoryId)) {
        pendingGitSummaryRefreshByDirectoryId.delete(directoryId);
        continue;
      }
      pendingGitSummaryRefreshByDirectoryId.delete(directoryId);
      void refreshGitSummaryForDirectory(directoryId, pending.reason);
      availableSlots -= 1;
    }
  };

  const refreshProcessUsage = async (reason: 'startup' | 'interval'): Promise<void> => {
    if (processUsageRefreshInFlight) {
      return;
    }
    processUsageRefreshInFlight = true;
    const usageSpan = startPerfSpan('mux.background.process-usage', {
      reason,
      conversations: conversations.size
    });
    try {
      const entries = await Promise.all(
        [...conversations.entries()].map(async ([sessionId, conversation]) => ({
          sessionId,
          sample: await readProcessUsageSample(conversation.processId)
        }))
      );

      let changed = false;
      const observedSessionIds = new Set<string>();
      for (const entry of entries) {
        observedSessionIds.add(entry.sessionId);
        const previous = processUsageBySessionId.get(entry.sessionId);
        if (previous === undefined || !processUsageEqual(previous, entry.sample)) {
          processUsageBySessionId.set(entry.sessionId, entry.sample);
          changed = true;
        }
      }
      for (const sessionId of processUsageBySessionId.keys()) {
        if (observedSessionIds.has(sessionId)) {
          continue;
        }
        processUsageBySessionId.delete(sessionId);
        changed = true;
      }

      if (changed) {
        markDirty();
      }
      usageSpan.end({
        reason,
        samples: entries.length,
        changed
      });
    } finally {
      processUsageRefreshInFlight = false;
    }
  };

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
  let latestRailViewRows: ReturnType<typeof buildWorkspaceRailViewRows> = [];
  let shortcutsCollapsed = configuredMuxUi.shortcutsCollapsed;
  let persistedMuxUiState = {
    paneWidthPercent: paneWidthPercentFromLayout(layout),
    shortcutsCollapsed: configuredMuxUi.shortcutsCollapsed
  };
  let pendingMuxUiStatePersist: {
    paneWidthPercent: number;
    shortcutsCollapsed: boolean;
  } | null = null;
  let muxUiStatePersistTimer: NodeJS.Timeout | null = null;
  let renderScheduled = false;
  let shuttingDown = false;
  let runtimeFatal: { origin: string; error: unknown } | null = null;
  let runtimeFatalExitTimer: NodeJS.Timeout | null = null;
  let selection: PaneSelection | null = null;
  let selectionDrag: PaneSelectionDrag | null = null;
  let selectionPinnedFollowOutput: boolean | null = null;
  let newThreadPrompt: NewThreadPromptState | null = null;
  let addDirectoryPrompt: { value: string; error: string | null } | null = null;
  let conversationTitleEdit: ConversationTitleEditState | null = null;
  let conversationTitleEditClickState: { conversationId: string; atMs: number } | null = null;
  let paneDividerDragActive = false;
  let ansiValidationReported = false;
  let resizeTimer: NodeJS.Timeout | null = null;
  let pendingSize: { cols: number; rows: number } | null = null;
  let lastResizeApplyAtMs = 0;
  let ptyResizeTimer: NodeJS.Timeout | null = null;
  let pendingPtySize: { cols: number; rows: number } | null = null;
  const ptySizeByConversationId = new Map<string, { cols: number; rows: number }>();

  const requestStop = (): void => {
    if (stop) {
      return;
    }
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    stop = true;
    queueControlPlaneOp(async () => {
      for (const sessionId of conversationOrder(conversations)) {
        const conversation = conversations.get(sessionId);
        if (conversation === undefined || !conversation.live) {
          continue;
        }
        streamClient.sendSignal(sessionId, 'interrupt');
        streamClient.sendSignal(sessionId, 'terminate');
        try {
          await streamClient.sendCommand({
            type: 'pty.close',
            sessionId
          });
        } catch {
          // Best-effort shutdown only.
        }
      }
    }, 'shutdown-close-live-sessions');
    markDirty();
  };

  const handleRuntimeFatal = (origin: string, error: unknown): void => {
    if (runtimeFatal !== null) {
      return;
    }
    runtimeFatal = {
      origin,
      error
    };
    shuttingDown = true;
    stop = true;
    dirty = false;
    process.stderr.write(`[mux] fatal runtime error (${origin}): ${formatErrorMessage(error)}\n`);
    restoreTerminalState(true, inputModeManager.restore);
    runtimeFatalExitTimer = setTimeout(() => {
      process.stderr.write('[mux] fatal runtime error forced exit\n');
      process.exit(1);
    }, 1200);
    runtimeFatalExitTimer.unref?.();
  };

  const scheduleRender = (): void => {
    if (shuttingDown || renderScheduled) {
      return;
    }
    renderScheduled = true;
    setImmediate(() => {
      renderScheduled = false;
      try {
        render();
        if (dirty) {
          scheduleRender();
        }
      } catch (error: unknown) {
        handleRuntimeFatal('render', error);
      }
    });
  };

  const markDirty = (): void => {
    if (shuttingDown) {
      return;
    }
    dirty = true;
    scheduleRender();
  };

  keyEventSubscription = await subscribeControlPlaneKeyEvents(streamClient, {
    tenantId: options.scope.tenantId,
    userId: options.scope.userId,
    workspaceId: options.scope.workspaceId,
    onEvent: (event) => {
      applyControlPlaneKeyEvent(event);
      markDirty();
    }
  });

  const muxUiStatePersistenceEnabled = loadedConfig.error === null;
  const persistMuxUiStateNow = (): void => {
    if (!muxUiStatePersistenceEnabled) {
      return;
    }
    if (muxUiStatePersistTimer !== null) {
      clearTimeout(muxUiStatePersistTimer);
      muxUiStatePersistTimer = null;
    }
    const pending = pendingMuxUiStatePersist;
    if (pending === null) {
      return;
    }
    pendingMuxUiStatePersist = null;
    if (
      pending.paneWidthPercent === persistedMuxUiState.paneWidthPercent &&
      pending.shortcutsCollapsed === persistedMuxUiState.shortcutsCollapsed
    ) {
      return;
    }
    try {
      const updated = updateHarnessMuxUiConfig(pending, {
        filePath: loadedConfig.filePath
      });
      persistedMuxUiState = {
        paneWidthPercent:
          updated.mux.ui.paneWidthPercent === null
            ? paneWidthPercentFromLayout(layout)
            : updated.mux.ui.paneWidthPercent,
        shortcutsCollapsed: updated.mux.ui.shortcutsCollapsed
      };
    } catch (error: unknown) {
      process.stderr.write(
        `[config] unable to persist mux ui state: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  };
  const queuePersistMuxUiState = (): void => {
    if (!muxUiStatePersistenceEnabled) {
      return;
    }
    pendingMuxUiStatePersist = {
      paneWidthPercent: paneWidthPercentFromLayout(layout),
      shortcutsCollapsed
    };
    if (muxUiStatePersistTimer !== null) {
      clearTimeout(muxUiStatePersistTimer);
    }
    muxUiStatePersistTimer = setTimeout(persistMuxUiStateNow, UI_STATE_PERSIST_DEBOUNCE_MS);
    muxUiStatePersistTimer.unref?.();
  };

  let processUsageTimer: NodeJS.Timeout | null = null;
  let gitSummaryWorkerTimer: NodeJS.Timeout | null = null;
  let backgroundProbesStarted = false;
  const startBackgroundProbes = (timedOut: boolean): void => {
    if (shuttingDown || backgroundProbesStarted || !backgroundProbesEnabled) {
      return;
    }
    backgroundProbesStarted = true;
    recordPerfEvent('mux.startup.background-probes.begin', {
      timedOut,
      settledObserved: startupSequencer.snapshot().settledObserved
    });
    void refreshProcessUsage('startup');
    processUsageTimer = setInterval(() => {
      void refreshProcessUsage('interval');
    }, 1000);
  };
  if (configuredMuxGit.enabled) {
    syncGitStateWithDirectories();
    for (const directoryId of directories.keys()) {
      queueGitSummaryRefresh(directoryId, 'startup', 0);
    }
    if (activeDirectoryId !== null) {
      noteGitActivity(activeDirectoryId, 'focus');
    }
    drainPendingGitSummaryRefreshes();
    gitSummaryWorkerTimer = setInterval(() => {
      drainPendingGitSummaryRefreshes();
    }, 120);
    gitSummaryWorkerTimer.unref?.();
  } else {
    recordPerfEvent('mux.background.git-summary.skipped', {
      reason: 'disabled'
    });
  }
  recordPerfEvent('mux.startup.background-probes.wait', {
    maxWaitMs: DEFAULT_BACKGROUND_START_MAX_WAIT_MS,
    enabled: backgroundProbesEnabled ? 1 : 0
  });
  if (!backgroundProbesEnabled) {
    recordPerfEvent('mux.startup.background-probes.skipped', {
      reason: 'disabled'
    });
  }
  void (async () => {
    if (!backgroundProbesEnabled) {
      return;
    }
    let timedOut = false;
    await Promise.race([
      startupSequencer.waitForSettled(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, DEFAULT_BACKGROUND_START_MAX_WAIT_MS);
      })
    ]);
    startBackgroundProbes(timedOut);
  })();

  const PERSISTED_EVENT_FLUSH_DELAY_MS = 12;
  const PERSISTED_EVENT_FLUSH_MAX_BATCH = 64;
  let pendingPersistedEvents: NormalizedEventEnvelope[] = [];
  let persistedEventFlushTimer: NodeJS.Timeout | null = null;

  const flushPendingPersistedEvents = (reason: 'timer' | 'immediate' | 'shutdown'): void => {
    if (persistedEventFlushTimer !== null) {
      clearTimeout(persistedEventFlushTimer);
      persistedEventFlushTimer = null;
    }
    if (pendingPersistedEvents.length === 0) {
      return;
    }
    const batch = pendingPersistedEvents;
    pendingPersistedEvents = [];
    const flushSpan = startPerfSpan('mux.events.flush', {
      reason,
      count: batch.length
    });
    try {
      store.appendEvents(batch);
      flushSpan.end({
        reason,
        status: 'ok',
        count: batch.length
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      flushSpan.end({
        reason,
        status: 'error',
        count: batch.length,
        message
      });
      process.stderr.write(`[mux] event-store error ${message}\n`);
    }
  };

  const schedulePersistedEventFlush = (): void => {
    if (persistedEventFlushTimer !== null) {
      return;
    }
    persistedEventFlushTimer = setTimeout(() => {
      persistedEventFlushTimer = null;
      flushPendingPersistedEvents('timer');
    }, PERSISTED_EVENT_FLUSH_DELAY_MS);
  };

  const enqueuePersistedEvent = (event: NormalizedEventEnvelope): void => {
    pendingPersistedEvents.push(event);
    if (pendingPersistedEvents.length >= PERSISTED_EVENT_FLUSH_MAX_BATCH) {
      flushPendingPersistedEvents('immediate');
      return;
    }
    schedulePersistedEventFlush();
  };

  const eventLoopDelayMonitor = monitorEventLoopDelay({
    resolution: 20
  });
  eventLoopDelayMonitor.enable();

  let outputSampleWindowStartedAtMs = Date.now();
  let outputSampleActiveBytes = 0;
  let outputSampleInactiveBytes = 0;
  let outputSampleActiveChunks = 0;
  let outputSampleInactiveChunks = 0;
  let outputHandleSampleCount = 0;
  let outputHandleSampleTotalMs = 0;
  let outputHandleSampleMaxMs = 0;
  let renderSampleCount = 0;
  let renderSampleTotalMs = 0;
  let renderSampleMaxMs = 0;
  let renderSampleChangedRows = 0;
  let perfStatusRow: MuxPerfStatusRow = {
    fps: 0,
    kbPerSecond: 0,
    renderAvgMs: 0,
    renderMaxMs: 0,
    outputHandleAvgMs: 0,
    outputHandleMaxMs: 0,
    eventLoopP95Ms: 0
  };
  const outputSampleSessionIds = new Set<string>();
  const outputLoadSampleTimer = setInterval(() => {
    const totalChunks = outputSampleActiveChunks + outputSampleInactiveChunks;
    const hasRenderSamples = renderSampleCount > 0;
    const nowMs = Date.now();
    const windowMs = Math.max(1, nowMs - outputSampleWindowStartedAtMs);
    const eventLoopP95Ms = Number(eventLoopDelayMonitor.percentile(95)) / 1e6;
    const eventLoopMaxMs = Number(eventLoopDelayMonitor.max) / 1e6;
    const outputHandleAvgMs =
      outputHandleSampleCount === 0 ? 0 : outputHandleSampleTotalMs / outputHandleSampleCount;
    const renderAvgMs = renderSampleCount === 0 ? 0 : renderSampleTotalMs / renderSampleCount;
    const nextPerfStatusRow: MuxPerfStatusRow = {
      fps: Number(((renderSampleCount * 1000) / windowMs).toFixed(1)),
      kbPerSecond: Number((((outputSampleActiveBytes + outputSampleInactiveBytes) * 1000) / windowMs / 1024).toFixed(1)),
      renderAvgMs: Number(renderAvgMs.toFixed(2)),
      renderMaxMs: Number(renderSampleMaxMs.toFixed(2)),
      outputHandleAvgMs: Number(outputHandleAvgMs.toFixed(2)),
      outputHandleMaxMs: Number(outputHandleSampleMaxMs.toFixed(2)),
      eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(1))
    };
    if (
      nextPerfStatusRow.fps !== perfStatusRow.fps ||
      nextPerfStatusRow.kbPerSecond !== perfStatusRow.kbPerSecond ||
      nextPerfStatusRow.renderAvgMs !== perfStatusRow.renderAvgMs ||
      nextPerfStatusRow.renderMaxMs !== perfStatusRow.renderMaxMs ||
      nextPerfStatusRow.outputHandleAvgMs !== perfStatusRow.outputHandleAvgMs ||
      nextPerfStatusRow.outputHandleMaxMs !== perfStatusRow.outputHandleMaxMs ||
      nextPerfStatusRow.eventLoopP95Ms !== perfStatusRow.eventLoopP95Ms
    ) {
      perfStatusRow = nextPerfStatusRow;
      markDirty();
    }
    if (totalChunks > 0 || hasRenderSamples) {
      const controlPlaneQueueMetrics = controlPlaneQueue.metrics();
      recordPerfEvent('mux.output-load.sample', {
        windowMs,
        activeChunks: outputSampleActiveChunks,
        inactiveChunks: outputSampleInactiveChunks,
        activeBytes: outputSampleActiveBytes,
        inactiveBytes: outputSampleInactiveBytes,
        outputHandleCount: outputHandleSampleCount,
        outputHandleAvgMs: Number(outputHandleAvgMs.toFixed(3)),
        outputHandleMaxMs: Number(outputHandleSampleMaxMs.toFixed(3)),
        renderCount: renderSampleCount,
        renderAvgMs: Number(renderAvgMs.toFixed(3)),
        renderMaxMs: Number(renderSampleMaxMs.toFixed(3)),
        renderChangedRows: renderSampleChangedRows,
        eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(3)),
        eventLoopMaxMs: Number(eventLoopMaxMs.toFixed(3)),
        activeConversationId: activeConversationId ?? 'none',
        sessionsWithOutput: outputSampleSessionIds.size,
        pendingPersistedEvents: pendingPersistedEvents.length,
        interactiveQueued: controlPlaneQueueMetrics.interactiveQueued,
        backgroundQueued: controlPlaneQueueMetrics.backgroundQueued,
        controlPlaneOpRunning: controlPlaneQueueMetrics.running ? 1 : 0
      });
    }
    outputSampleWindowStartedAtMs = nowMs;
    outputSampleActiveBytes = 0;
    outputSampleInactiveBytes = 0;
    outputSampleActiveChunks = 0;
    outputSampleInactiveChunks = 0;
    outputHandleSampleCount = 0;
    outputHandleSampleTotalMs = 0;
    outputHandleSampleMaxMs = 0;
    renderSampleCount = 0;
    renderSampleTotalMs = 0;
    renderSampleMaxMs = 0;
    renderSampleChangedRows = 0;
    outputSampleSessionIds.clear();
    eventLoopDelayMonitor.reset();
  }, 1000);

  const applyPtyResizeToSession = (
    sessionId: string,
    ptySize: { cols: number; rows: number },
    force = false
  ): void => {
    const conversation = conversations.get(sessionId);
    if (conversation === undefined || !conversation.live) {
      return;
    }
    const currentPtySize = ptySizeByConversationId.get(sessionId);
    if (
      !force &&
      currentPtySize !== undefined &&
      currentPtySize.cols === ptySize.cols &&
      currentPtySize.rows === ptySize.rows
    ) {
      return;
    }
    ptySizeByConversationId.set(sessionId, {
      cols: ptySize.cols,
      rows: ptySize.rows
    });
    conversation.oracle.resize(ptySize.cols, ptySize.rows);
    streamClient.sendResize(sessionId, ptySize.cols, ptySize.rows);
    markDirty();
  };

  const applyPtyResize = (ptySize: { cols: number; rows: number }): void => {
    if (activeConversationId === null) {
      return;
    }
    applyPtyResizeToSession(activeConversationId, ptySize, false);
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
    const nextLayout = computeDualPaneLayout(nextSize.cols, nextSize.rows, {
      leftCols: leftPaneColsOverride
    });
    schedulePtyResize(
      {
        cols: nextLayout.rightCols,
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
      conversation.oracle.resize(nextLayout.rightCols, nextLayout.paneRows);
      if (conversation.live) {
        applyPtyResizeToSession(
          conversation.sessionId,
          {
            cols: nextLayout.rightCols,
            rows: nextLayout.paneRows
          },
          true
        );
      }
    }
    if (muxRecordingOracle !== null) {
      muxRecordingOracle.resize(nextLayout.cols, nextLayout.rows);
    }
    // Force a full clear on actual layout changes to avoid stale diagonal artifacts during drag.
    previousRows = [];
    forceFullClear = true;
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

  const applyPaneDividerAtCol = (col: number): void => {
    const normalizedCol = Math.max(1, Math.min(size.cols, col));
    leftPaneColsOverride = Math.max(1, normalizedCol - 1);
    applyLayout(size);
    queuePersistMuxUiState();
  };

  const controlPlaneOpSpans = new Map<number, ReturnType<typeof startPerfSpan>>();
  const controlPlaneQueue = new ControlPlaneOpQueue({
    onFatal: (error: unknown) => {
      handleRuntimeFatal('control-plane-pump', error);
    },
    onEnqueued: (event, metrics) => {
      recordPerfEvent('mux.control-plane.op.enqueued', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        interactiveQueued: metrics.interactiveQueued,
        backgroundQueued: metrics.backgroundQueued
      });
    },
    onStart: (event, metrics) => {
      const opSpan = startPerfSpan('mux.control-plane.op', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        waitMs: event.waitMs
      });
      controlPlaneOpSpans.set(event.id, opSpan);
      recordPerfEvent('mux.control-plane.op.start', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        waitMs: event.waitMs,
        interactiveQueued: metrics.interactiveQueued,
        backgroundQueued: metrics.backgroundQueued
      });
    },
    onSuccess: (event) => {
      const opSpan = controlPlaneOpSpans.get(event.id);
      if (opSpan !== undefined) {
        opSpan.end({
          id: event.id,
          label: event.label,
          priority: event.priority,
          status: 'ok',
          waitMs: event.waitMs
        });
        controlPlaneOpSpans.delete(event.id);
      }
    },
    onError: (event, _metrics, error) => {
      const message = error instanceof Error ? error.message : String(error);
      const opSpan = controlPlaneOpSpans.get(event.id);
      if (opSpan !== undefined) {
        opSpan.end({
          id: event.id,
          label: event.label,
          priority: event.priority,
          status: 'error',
          waitMs: event.waitMs,
          message
        });
        controlPlaneOpSpans.delete(event.id);
      }
      process.stderr.write(`[mux] control-plane error ${message}\n`);
    }
  });

  const waitForControlPlaneDrain = async (): Promise<void> => {
    await controlPlaneQueue.waitForDrain();
  };

  const queueControlPlaneOp = (task: () => Promise<void>, label = 'interactive-op'): void => {
    controlPlaneQueue.enqueueInteractive(task, label);
  };

  const queueBackgroundControlPlaneOp = (task: () => Promise<void>, label = 'background-op'): void => {
    controlPlaneQueue.enqueueBackground(task, label);
  };

  const clearConversationTitleEditTimer = (edit: ConversationTitleEditState): void => {
    if (edit.debounceTimer !== null) {
      clearTimeout(edit.debounceTimer);
      edit.debounceTimer = null;
    }
  };

  const queueConversationTitlePersist = (
    edit: ConversationTitleEditState,
    reason: 'debounced' | 'flush'
  ): void => {
    const titleToPersist = edit.value;
    if (titleToPersist === edit.lastSavedValue) {
      return;
    }
    edit.persistInFlight = true;
    markDirty();
    queueControlPlaneOp(async () => {
      try {
        const result = await streamClient.sendCommand({
          type: 'conversation.update',
          conversationId: edit.conversationId,
          title: titleToPersist
        });
        const parsed = parseConversationRecord(result['conversation']);
        const persistedTitle = parsed?.title ?? titleToPersist;
        const latestConversation = conversations.get(edit.conversationId);
        const latestEdit = conversationTitleEdit;
        const shouldApplyToConversation =
          latestEdit === null ||
          latestEdit.conversationId !== edit.conversationId ||
          latestEdit.value === titleToPersist;
        if (latestConversation !== undefined && shouldApplyToConversation) {
          latestConversation.title = persistedTitle;
        }
        if (latestEdit !== null && latestEdit.conversationId === edit.conversationId) {
          latestEdit.lastSavedValue = persistedTitle;
          if (latestEdit.value === titleToPersist) {
            latestEdit.error = null;
          }
        }
      } catch (error: unknown) {
        const latestEdit = conversationTitleEdit;
        if (
          latestEdit !== null &&
          latestEdit.conversationId === edit.conversationId &&
          latestEdit.value === titleToPersist
        ) {
          latestEdit.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      } finally {
        const latestEdit = conversationTitleEdit;
        if (latestEdit !== null && latestEdit.conversationId === edit.conversationId) {
          latestEdit.persistInFlight = false;
        }
        markDirty();
      }
    }, `title-edit-${reason}:${edit.conversationId}`);
  };

  const scheduleConversationTitlePersist = (): void => {
    const edit = conversationTitleEdit;
    if (edit === null) {
      return;
    }
    clearConversationTitleEditTimer(edit);
    edit.debounceTimer = setTimeout(() => {
      const latestEdit = conversationTitleEdit;
      if (latestEdit === null || latestEdit.conversationId !== edit.conversationId) {
        return;
      }
      latestEdit.debounceTimer = null;
      queueConversationTitlePersist(latestEdit, 'debounced');
    }, DEFAULT_CONVERSATION_TITLE_EDIT_DEBOUNCE_MS);
    edit.debounceTimer.unref?.();
  };

  const stopConversationTitleEdit = (persistPending: boolean): void => {
    const edit = conversationTitleEdit;
    if (edit === null) {
      return;
    }
    clearConversationTitleEditTimer(edit);
    if (persistPending) {
      queueConversationTitlePersist(edit, 'flush');
    }
    conversationTitleEdit = null;
    markDirty();
  };

  const beginConversationTitleEdit = (conversationId: string): void => {
    const target = conversations.get(conversationId);
    if (target === undefined) {
      return;
    }
    if (conversationTitleEdit?.conversationId === conversationId) {
      return;
    }
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    conversationTitleEdit = {
      conversationId,
      value: target.title,
      lastSavedValue: target.title,
      error: null,
      persistInFlight: false,
      debounceTimer: null
    };
    markDirty();
  };

  const buildNewThreadModalOverlay = (viewportRows: number): ReturnType<typeof buildUiModalOverlay> | null => {
    if (newThreadPrompt === null) {
      return null;
    }
    return buildUiModalOverlay({
      viewportCols: layout.cols,
      viewportRows,
      width: Math.min(Math.max(24, layout.cols - 2), 52),
      height: 10,
      anchor: 'center',
      marginRows: 1,
      title: 'New Thread',
      bodyLines: newThreadPromptBodyLines(newThreadPrompt, {
        codexButtonLabel: NEW_THREAD_MODAL_CODEX_BUTTON,
        terminalButtonLabel: NEW_THREAD_MODAL_TERMINAL_BUTTON
      }),
      footer: 'enter create   esc cancel',
      theme: MUX_MODAL_THEME
    });
  };

  const buildAddDirectoryModalOverlay = (viewportRows: number): ReturnType<typeof buildUiModalOverlay> | null => {
    if (addDirectoryPrompt === null) {
      return null;
    }
    const modalMaxWidth = Math.max(16, layout.cols - 2);
    const promptValue = addDirectoryPrompt.value.length > 0 ? addDirectoryPrompt.value : '.';
    const addDirectoryBody = [`path: ${promptValue}_`];
    if (addDirectoryPrompt.error !== null && addDirectoryPrompt.error.length > 0) {
      addDirectoryBody.push(`error: ${addDirectoryPrompt.error}`);
    } else {
      addDirectoryBody.push('add a workspace project for new threads');
    }
    return buildUiModalOverlay({
      viewportCols: layout.cols,
      viewportRows,
      width: Math.min(modalMaxWidth, 96),
      height: 6,
      anchor: 'center',
      marginRows: 1,
      title: 'Add Project',
      bodyLines: addDirectoryBody,
      footer: 'enter save   esc cancel',
      theme: MUX_MODAL_THEME
    });
  };

  const buildConversationTitleModalOverlay = (viewportRows: number): ReturnType<typeof buildUiModalOverlay> | null => {
    if (conversationTitleEdit === null) {
      return null;
    }
    const modalMaxWidth = Math.max(16, layout.cols - 2);
    const editState =
      conversationTitleEdit.persistInFlight
        ? 'saving'
        : conversationTitleEdit.value === conversationTitleEdit.lastSavedValue
          ? 'saved'
          : 'pending';
    const editBody = [
      `title: ${conversationTitleEdit.value}_`,
      `state: ${editState}`,
      '',
      CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL
    ];
    if (conversationTitleEdit.error !== null && conversationTitleEdit.error.length > 0) {
      editBody.push(`error: ${conversationTitleEdit.error}`);
    }
    return buildUiModalOverlay({
      viewportCols: layout.cols,
      viewportRows,
      width: Math.min(modalMaxWidth, 96),
      height: 9,
      anchor: 'center',
      marginRows: 1,
      title: 'Edit Thread Title',
      bodyLines: editBody,
      footer: 'typing autosaves   enter done   ctrl+x archive   esc done',
      theme: MUX_MODAL_THEME
    });
  };

  const buildCurrentModalOverlay = (): ReturnType<typeof buildUiModalOverlay> | null => {
    const newThreadOverlay = buildNewThreadModalOverlay(layout.rows);
    if (newThreadOverlay !== null) {
      return newThreadOverlay;
    }
    const addDirectoryOverlay = buildAddDirectoryModalOverlay(layout.rows);
    if (addDirectoryOverlay !== null) {
      return addDirectoryOverlay;
    }
    return buildConversationTitleModalOverlay(layout.rows);
  };

  const dismissModalOnOutsideClick = (
    input: Buffer,
    dismiss: () => void,
    onInsidePointerPress?: (col: number, row: number) => boolean
  ): boolean => {
    if (!input.includes(0x1b)) {
      return false;
    }
    const parsed = parseMuxInputChunk(inputRemainder, input);
    inputRemainder = parsed.remainder;
    const modalOverlay = buildCurrentModalOverlay();
    if (modalOverlay === null) {
      return true;
    }
    for (const token of parsed.tokens) {
      if (token.kind !== 'mouse') {
        continue;
      }
      const pointerPress =
        token.event.final === 'M' &&
        !isWheelMouseCode(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (!pointerPress) {
        continue;
      }
      if (!isUiModalOverlayHit(modalOverlay, token.event.col, token.event.row)) {
        dismiss();
        return true;
      }
      if (onInsidePointerPress?.(token.event.col, token.event.row) === true) {
        return true;
      }
    }
    return true;
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
      const sinceCursor = Math.max(0, conversation.lastOutputCursor);
      await streamClient.sendCommand({
        type: 'pty.attach',
        sessionId,
        sinceCursor
      });
      conversation.attached = true;
      recordPerfEvent('mux.conversation.attach', {
        sessionId,
        sinceCursor
      });
    }
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
    recordPerfEvent('mux.conversation.detach', {
      sessionId,
      lastOutputCursor: conversation.lastOutputCursor
    });
  };

  const refreshProjectPaneSnapshot = (directoryId: string): void => {
    const directory = directories.get(directoryId);
    if (directory === undefined) {
      projectPaneSnapshot = null;
      return;
    }
    projectPaneSnapshot = buildProjectPaneSnapshot(directory.directoryId, directory.path);
  };

  const enterProjectPane = (directoryId: string): void => {
    if (!directories.has(directoryId)) {
      return;
    }
    activeDirectoryId = directoryId;
    noteGitActivity(directoryId, 'focus');
    mainPaneMode = 'project';
    projectPaneScrollTop = 0;
    refreshProjectPaneSnapshot(directoryId);
    forceFullClear = true;
    previousRows = [];
  };

  const activateConversation = async (sessionId: string): Promise<void> => {
    if (activeConversationId === sessionId) {
      if (mainPaneMode !== 'conversation') {
        mainPaneMode = 'conversation';
        forceFullClear = true;
        previousRows = [];
        markDirty();
      }
      return;
    }
    if (conversationTitleEdit !== null && conversationTitleEdit.conversationId !== sessionId) {
      stopConversationTitleEdit(true);
    }
    const previousActiveId = activeConversationId;
    selection = null;
    selectionDrag = null;
    releaseViewportPinForSelection();
    if (previousActiveId !== null) {
      await detachConversation(previousActiveId);
    }
    activeConversationId = sessionId;
    mainPaneMode = 'conversation';
    projectPaneSnapshot = null;
    projectPaneScrollTop = 0;
    forceFullClear = true;
    previousRows = [];
    const targetConversation = conversations.get(sessionId);
    if (targetConversation?.directoryId !== undefined) {
      noteGitActivity(targetConversation.directoryId, 'focus');
    }
    if (targetConversation !== undefined && !targetConversation.live) {
      await startConversation(sessionId);
    }
    try {
      await attachConversation(sessionId);
    } catch (error: unknown) {
      if (!isSessionNotFoundError(error) && !isSessionNotLiveError(error)) {
        throw error;
      }
      if (targetConversation !== undefined) {
        targetConversation.live = false;
        targetConversation.attached = false;
        if (targetConversation.status === 'running' || targetConversation.status === 'needs-input') {
          targetConversation.status = 'completed';
          targetConversation.attentionReason = null;
        }
      }
      await startConversation(sessionId);
      await attachConversation(sessionId);
    }
    schedulePtyResize(
      {
        cols: layout.rightCols,
        rows: layout.paneRows
      },
      true
    );
    markDirty();
  };

  const removeConversationState = (sessionId: string): void => {
    if (conversationTitleEdit?.conversationId === sessionId) {
      stopConversationTitleEdit(false);
    }
    removedConversationIds.add(sessionId);
    conversations.delete(sessionId);
    conversationStartInFlight.delete(sessionId);
    ptySizeByConversationId.delete(sessionId);
    processUsageBySessionId.delete(sessionId);
  };

  const openNewThreadPrompt = (directoryId: string): void => {
    if (!directories.has(directoryId)) {
      return;
    }
    addDirectoryPrompt = null;
    if (conversationTitleEdit !== null) {
      stopConversationTitleEdit(true);
    }
    conversationTitleEditClickState = null;
    newThreadPrompt = createNewThreadPromptState(directoryId);
    markDirty();
  };

  const createAndActivateConversationInDirectory = async (
    directoryId: string,
    agentType: ThreadAgentType
  ): Promise<void> => {
    const sessionId = `conversation-${randomUUID()}`;
    const title = '';
    await streamClient.sendCommand({
      type: 'conversation.create',
      conversationId: sessionId,
      directoryId,
      title,
      agentType,
      adapterState: {}
    });
    ensureConversation(sessionId, {
      directoryId,
      title,
      agentType,
      adapterState: {}
    });
    noteGitActivity(directoryId, 'trigger');
    await startConversation(sessionId);
    await activateConversation(sessionId);
  };

  const archiveConversation = async (sessionId: string): Promise<void> => {
    const target = conversations.get(sessionId);
    if (target === undefined) {
      return;
    }
    if (target.live) {
      try {
        await streamClient.sendCommand({
          type: 'pty.close',
          sessionId
        });
      } catch {
        // Best-effort close only.
      }
    }

    await streamClient.sendCommand({
      type: 'conversation.archive',
      conversationId: sessionId
    });
    await unsubscribeConversationEvents(sessionId);

    removeConversationState(sessionId);

    if (activeConversationId === sessionId) {
      const archivedDirectoryId = target.directoryId;
      const ordered = conversationOrder(conversations);
      const nextConversationId =
        ordered.find((candidateId) => {
          const candidate = conversations.get(candidateId);
          return candidate?.directoryId === archivedDirectoryId;
        }) ??
        ordered[0] ??
        null;
      activeConversationId = null;
      if (nextConversationId !== null) {
        await activateConversation(nextConversationId);
        return;
      }
      const fallbackDirectoryId = resolveActiveDirectoryId();
      if (fallbackDirectoryId !== null) {
        await createAndActivateConversationInDirectory(fallbackDirectoryId, 'codex');
      }
      return;
    }

    markDirty();
  };

  const takeoverConversation = async (sessionId: string): Promise<void> => {
    const target = conversations.get(sessionId);
    if (target === undefined) {
      return;
    }
    const result = await streamClient.sendCommand({
      type: 'session.claim',
      sessionId,
      controllerId: muxControllerId,
      controllerType: 'human',
      controllerLabel: muxControllerLabel,
      reason: 'human takeover',
      takeover: true
    });
    const controller = parseSessionControllerRecord(result['controller']);
    if (controller !== null) {
      target.controller = controller;
    }
    target.lastEventAt = new Date().toISOString();
    markDirty();
  };

  const addDirectoryByPath = async (rawPath: string): Promise<void> => {
    const normalizedPath = resolveWorkspacePathForMux(options.invocationDirectory, rawPath);
    const directoryResult = await streamClient.sendCommand({
      type: 'directory.upsert',
      directoryId: `directory-${randomUUID()}`,
      tenantId: options.scope.tenantId,
      userId: options.scope.userId,
      workspaceId: options.scope.workspaceId,
      path: normalizedPath
    });
    const directory = parseDirectoryRecord(directoryResult['directory']);
    if (directory === null) {
      throw new Error('control-plane directory.upsert returned malformed directory record');
    }
    directories.set(directory.directoryId, directory);
    activeDirectoryId = directory.directoryId;
    syncGitStateWithDirectories();
    noteGitActivity(directory.directoryId, 'startup');

    await hydratePersistedConversationsForDirectory(directory.directoryId);
    const targetConversationId = conversationOrder(conversations).find((sessionId) => {
      const conversation = conversations.get(sessionId);
      return conversation?.directoryId === directory.directoryId;
    });
    if (targetConversationId !== undefined) {
      await activateConversation(targetConversationId);
      return;
    }
    await createAndActivateConversationInDirectory(directory.directoryId, 'codex');
  };

  const closeDirectory = async (directoryId: string): Promise<void> => {
    if (!directories.has(directoryId)) {
      return;
    }
    const sessionIds = conversationOrder(conversations).filter((sessionId) => {
      const conversation = conversations.get(sessionId);
      return conversation?.directoryId === directoryId;
    });

    for (const sessionId of sessionIds) {
      const target = conversations.get(sessionId);
      if (target?.live === true) {
        try {
          await streamClient.sendCommand({
            type: 'pty.close',
            sessionId
          });
        } catch {
          // Best-effort close only.
        }
      }
      await streamClient.sendCommand({
        type: 'conversation.archive',
        conversationId: sessionId
      });
      await unsubscribeConversationEvents(sessionId);
      removeConversationState(sessionId);
      if (activeConversationId === sessionId) {
        activeConversationId = null;
      }
    }

    await streamClient.sendCommand({
      type: 'directory.archive',
      directoryId
    });
    directories.delete(directoryId);
    deleteDirectoryGitState(directoryId);
    if (projectPaneSnapshot?.directoryId === directoryId) {
      projectPaneSnapshot = null;
      projectPaneScrollTop = 0;
    }

    if (directories.size === 0) {
      await addDirectoryByPath(options.invocationDirectory);
      return;
    }

    if (activeDirectoryId === directoryId || activeDirectoryId === null || !directories.has(activeDirectoryId)) {
      activeDirectoryId = firstDirectoryId();
    }
    if (activeDirectoryId !== null) {
      noteGitActivity(activeDirectoryId, 'focus');
    }

    const fallbackDirectoryId = resolveActiveDirectoryId();
    const fallbackConversationId =
      conversationOrder(conversations).find((sessionId) => {
        const conversation = conversations.get(sessionId);
        return conversation?.directoryId === fallbackDirectoryId;
      }) ??
      conversationOrder(conversations)[0] ??
      null;
    if (fallbackConversationId !== null) {
      await activateConversation(fallbackConversationId);
      return;
    }
    if (fallbackDirectoryId !== null) {
      await createAndActivateConversationInDirectory(fallbackDirectoryId, 'codex');
      return;
    }

    markDirty();
  };

  const pinViewportForSelection = (): void => {
    if (selectionPinnedFollowOutput !== null) {
      return;
    }
    if (activeConversationId === null) {
      return;
    }
    const follow = activeConversation().oracle.snapshotWithoutHash().viewport.followOutput;
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
      if (activeConversationId === null) {
        return;
      }
      activeConversation().oracle.setFollowOutput(true);
    }
  };

  const render = (): void => {
    if (shuttingDown || !dirty) {
      return;
    }
    const projectPaneActive =
      mainPaneMode === 'project' &&
      activeDirectoryId !== null &&
      directories.has(activeDirectoryId);
    if (!projectPaneActive && activeConversationId === null) {
      dirty = false;
      return;
    }
    const renderStartedAtNs = perfNowNs();

    const active =
      activeConversationId === null ? null : conversations.get(activeConversationId) ?? null;
    if (!projectPaneActive && active === null) {
      dirty = false;
      return;
    }
    const rightFrame =
      !projectPaneActive && active !== null ? active.oracle.snapshotWithoutHash() : null;
    const renderSelection =
      rightFrame !== null && selectionDrag !== null && selectionDrag.hasDragged
        ? {
            anchor: selectionDrag.anchor,
            focus: selectionDrag.focus,
            text: ''
          }
        : rightFrame !== null
          ? selection
          : null;
    const selectionRows =
      rightFrame === null ? [] : selectionVisibleRows(rightFrame, renderSelection);
    const orderedIds = conversationOrder(conversations);
    const rail = buildRailRows(
      layout,
      directories,
      conversations,
      orderedIds,
      activeDirectoryId,
      activeConversationId,
      mainPaneMode === 'project',
      shortcutsCollapsed,
      gitSummaryByDirectoryId,
      processUsageBySessionId,
      shortcutBindings,
      muxControllerId
    );
    latestRailViewRows = rail.viewRows;
    let rightRows: readonly string[] = [];
    if (rightFrame !== null) {
      rightRows = Array.from({ length: layout.paneRows }, (_value, row) =>
        renderSnapshotAnsiRow(rightFrame, row, layout.rightCols)
      );
    } else if (projectPaneActive && activeDirectoryId !== null) {
      if (
        projectPaneSnapshot === null ||
        projectPaneSnapshot.directoryId !== activeDirectoryId
      ) {
        refreshProjectPaneSnapshot(activeDirectoryId);
      }
      if (projectPaneSnapshot === null) {
        rightRows = Array.from({ length: layout.paneRows }, () => ' '.repeat(layout.rightCols));
      } else {
        const view = buildProjectPaneRows(
          projectPaneSnapshot,
          layout.rightCols,
          layout.paneRows,
          projectPaneScrollTop
        );
        projectPaneScrollTop = view.top;
        rightRows = view.rows;
      }
    } else {
      rightRows = Array.from({ length: layout.paneRows }, () => ' '.repeat(layout.rightCols));
    }
    const rows = buildRenderRows(
      layout,
      rail.ansiRows,
      rightRows,
      perfStatusRow
    );
    const modalOverlay = buildCurrentModalOverlay();
    if (modalOverlay !== null) {
      applyModalOverlay(rows, modalOverlay);
    }
    if (validateAnsi) {
      const issues = findAnsiIntegrityIssues(rows);
      if (issues.length > 0 && !ansiValidationReported) {
        ansiValidationReported = true;
        process.stderr.write(`[mux] ansi-integrity-failed ${issues.join(' | ')}\n`);
      }
    }
    const diff = forceFullClear
      ? diffRenderedRows(rows, [])
      : diffRenderedRows(rows, previousRows);
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

    let shouldShowCursor = false;
    if (rightFrame !== null) {
      const shouldEnableBracketedPaste = rightFrame.modes.bracketedPaste;
      if (renderedBracketedPaste !== shouldEnableBracketedPaste) {
        output += shouldEnableBracketedPaste ? '\u001b[?2004h' : '\u001b[?2004l';
        renderedBracketedPaste = shouldEnableBracketedPaste;
      }

      if (!cursorStyleEqual(renderedCursorStyle, rightFrame.cursor.style)) {
        output += cursorStyleToDecscusr(rightFrame.cursor.style);
        renderedCursorStyle = rightFrame.cursor.style;
      }

      output += renderSelectionOverlay(layout, rightFrame, renderSelection);

      shouldShowCursor =
        rightFrame.viewport.followOutput &&
        rightFrame.cursor.visible &&
        rightFrame.cursor.row >= 0 &&
        rightFrame.cursor.row < layout.paneRows &&
        rightFrame.cursor.col >= 0 &&
        rightFrame.cursor.col < layout.rightCols;

      if (shouldShowCursor) {
        if (renderedCursorVisible !== true) {
          output += '\u001b[?25h';
          renderedCursorVisible = true;
        }
        output += `\u001b[${String(rightFrame.cursor.row + 1)};${String(layout.rightStartCol + rightFrame.cursor.col)}H`;
      } else {
        if (renderedCursorVisible !== false) {
          output += '\u001b[?25l';
          renderedCursorVisible = false;
        }
      }
    } else {
      if (renderedBracketedPaste !== false) {
        output += '\u001b[?2004l';
        renderedBracketedPaste = false;
      }
      if (renderedCursorVisible !== false) {
        output += '\u001b[?25l';
        renderedCursorVisible = false;
      }
    }

    if (output.length > 0) {
      process.stdout.write(output);
      if (
        active !== null &&
        rightFrame !== null &&
        startupFirstPaintTargetSessionId !== null &&
        activeConversationId === startupFirstPaintTargetSessionId &&
        startupSequencer.snapshot().firstOutputObserved &&
        !startupSequencer.snapshot().firstPaintObserved
      ) {
        const glyphCells = visibleGlyphCellCount(active);
        if (startupSequencer.markFirstPaintVisible(startupFirstPaintTargetSessionId, glyphCells)) {
          recordPerfEvent('mux.startup.active-first-visible-paint', {
            sessionId: startupFirstPaintTargetSessionId,
            changedRows: diff.changedRows.length,
            glyphCells
          });
          endStartupActiveFirstPaintSpan({
            observed: true,
            changedRows: diff.changedRows.length,
            glyphCells
          });
        }
      }
      if (
        active !== null &&
        rightFrame !== null &&
        startupFirstPaintTargetSessionId !== null &&
        activeConversationId === startupFirstPaintTargetSessionId &&
        startupSequencer.snapshot().firstOutputObserved
      ) {
        const glyphCells = visibleGlyphCellCount(active);
        if (startupSequencer.markHeaderVisible(startupFirstPaintTargetSessionId, codexHeaderVisible(active))) {
          recordPerfEvent('mux.startup.active-header-visible', {
            sessionId: startupFirstPaintTargetSessionId,
            glyphCells
          });
        }
        const selectedGate = startupSequencer.maybeSelectSettleGate(
          startupFirstPaintTargetSessionId,
          glyphCells
        );
        if (selectedGate !== null) {
          recordPerfEvent('mux.startup.active-settle-gate', {
            sessionId: startupFirstPaintTargetSessionId,
            gate: selectedGate,
            glyphCells
          });
        }
        scheduleStartupSettledProbe(startupFirstPaintTargetSessionId);
      }
      if (muxRecordingWriter !== null && muxRecordingOracle !== null) {
        const recordingCursorStyle: RenderCursorStyle =
          rightFrame === null ? { shape: 'block', blinking: false } : rightFrame.cursor.style;
        const recordingCursorRow = rightFrame === null ? 0 : rightFrame.cursor.row;
        const recordingCursorCol =
          rightFrame === null
            ? layout.rightStartCol - 1
            : layout.rightStartCol + rightFrame.cursor.col - 1;
        const canonicalFrame = renderCanonicalFrameAnsi(
          rows,
          recordingCursorStyle,
          shouldShowCursor,
          recordingCursorRow,
          recordingCursorCol
        );
        muxRecordingOracle.ingest(canonicalFrame);
        try {
          muxRecordingWriter.capture(muxRecordingOracle.snapshot());
        } catch {
          // Recording failures must never break live interaction.
        }
      }
    }
    previousRows = diff.nextRows;
    previousSelectionRows = selectionRows;
    dirty = false;
    const renderDurationMs = Number(perfNowNs() - renderStartedAtNs) / 1e6;
    renderSampleCount += 1;
    renderSampleTotalMs += renderDurationMs;
    if (renderDurationMs > renderSampleMaxMs) {
      renderSampleMaxMs = renderDurationMs;
    }
    renderSampleChangedRows += diff.changedRows.length;
  };

  const handleEnvelope = (envelope: StreamServerEnvelope): void => {
    if (envelope.kind === 'pty.output') {
      const outputHandledStartedAtNs = perfNowNs();
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = ensureConversation(envelope.sessionId);
      noteGitActivity(conversation.directoryId, 'trigger');
      const chunk = Buffer.from(envelope.chunkBase64, 'base64');
      outputSampleSessionIds.add(envelope.sessionId);
      if (activeConversationId === envelope.sessionId) {
        outputSampleActiveBytes += chunk.length;
        outputSampleActiveChunks += 1;
      } else {
        outputSampleInactiveBytes += chunk.length;
        outputSampleInactiveChunks += 1;
      }
      if (!startupSessionFirstOutputObserved.has(envelope.sessionId)) {
        startupSessionFirstOutputObserved.add(envelope.sessionId);
        recordPerfEvent('mux.session.first-output', {
          sessionId: envelope.sessionId,
          bytes: chunk.length
        });
      }
      if (
        startupFirstPaintTargetSessionId !== null &&
        envelope.sessionId === startupFirstPaintTargetSessionId &&
        !startupSequencer.snapshot().firstOutputObserved
      ) {
        if (startupSequencer.markFirstOutput(envelope.sessionId)) {
          recordPerfEvent('mux.startup.active-first-output', {
            sessionId: envelope.sessionId,
            bytes: chunk.length
          });
          endStartupActiveFirstOutputSpan({
            observed: true,
            bytes: chunk.length
          });
        }
      }
      if (envelope.cursor < conversation.lastOutputCursor) {
        recordPerfEvent('mux.output.cursor-regression', {
          sessionId: envelope.sessionId,
          previousCursor: conversation.lastOutputCursor,
          cursor: envelope.cursor
        });
        conversation.lastOutputCursor = 0;
      }
      conversation.oracle.ingest(chunk);
      conversation.lastOutputCursor = envelope.cursor;
      if (
        startupFirstPaintTargetSessionId !== null &&
        envelope.sessionId === startupFirstPaintTargetSessionId
      ) {
        scheduleStartupSettledProbe(envelope.sessionId);
      }

      const normalized = mapTerminalOutputToNormalizedEvent(chunk, conversation.scope, idFactory);
      enqueuePersistedEvent(normalized);
      conversation.lastEventAt = normalized.ts;
      if (activeConversationId === envelope.sessionId) {
        markDirty();
      }
      const outputHandledDurationMs = Number(perfNowNs() - outputHandledStartedAtNs) / 1e6;
      outputHandleSampleCount += 1;
      outputHandleSampleTotalMs += outputHandledDurationMs;
      if (outputHandledDurationMs > outputHandleSampleMaxMs) {
        outputHandleSampleMaxMs = outputHandledDurationMs;
      }
      return;
    }

    if (envelope.kind === 'pty.event') {
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = ensureConversation(envelope.sessionId);
      noteGitActivity(conversation.directoryId, 'trigger');
      const observedAt = observedAtFromSessionEvent(envelope.event);
      const updatedAdapterState = mergeAdapterStateFromSessionEvent(
        conversation.agentType,
        conversation.adapterState,
        envelope.event,
        observedAt
      );
      if (updatedAdapterState !== null) {
        conversation.adapterState = updatedAdapterState;
      }
      const normalized = mapSessionEventToNormalizedEvent(envelope.event, conversation.scope, idFactory);
      if (normalized !== null) {
        enqueuePersistedEvent(normalized);
      }
      if (envelope.event.type === 'session-exit') {
        exit = envelope.event.exit;
        conversation.status = 'exited';
        conversation.live = false;
        conversation.attentionReason = null;
        conversation.lastExit = envelope.event.exit;
        conversation.exitedAt = new Date().toISOString();
        conversation.attached = false;
        ptySizeByConversationId.delete(envelope.sessionId);
        if (activeConversationId === envelope.sessionId) {
          const fallback = conversationOrder(conversations).find((sessionId) => {
            const candidate = conversations.get(sessionId);
            return candidate !== undefined && candidate.live;
          });
          if (fallback !== undefined) {
            queueControlPlaneOp(async () => {
              await activateConversation(fallback);
            }, 'fallback-activate-from-session-event');
          }
        }
      }
      markDirty();
      return;
    }

    if (envelope.kind === 'pty.exit') {
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = conversations.get(envelope.sessionId);
      if (conversation !== undefined) {
        noteGitActivity(conversation.directoryId, 'trigger');
        exit = envelope.exit;
        conversation.status = 'exited';
        conversation.live = false;
        conversation.attentionReason = null;
        conversation.lastExit = envelope.exit;
        conversation.exitedAt = new Date().toISOString();
        conversation.attached = false;
        ptySizeByConversationId.delete(envelope.sessionId);
        if (activeConversationId === envelope.sessionId) {
          const fallback = conversationOrder(conversations).find((sessionId) => {
            const candidate = conversations.get(sessionId);
            return candidate !== undefined && candidate.live;
          });
          if (fallback !== undefined) {
            queueControlPlaneOp(async () => {
              await activateConversation(fallback);
            }, 'fallback-activate-from-pty-exit');
          }
        }
      }
      markDirty();
    }
  };

  const removeEnvelopeListener = streamClient.onEnvelope((envelope) => {
    try {
      handleEnvelope(envelope);
    } catch (error: unknown) {
      handleRuntimeFatal('stream-envelope', error);
    }
  });

  const initialActiveId = activeConversationId;
  activeConversationId = null;
  startupSequencer.setTargetSession(initialActiveId);
  if (initialActiveId !== null) {
    startupFirstPaintTargetSessionId = initialActiveId;
    startupActiveStartCommandSpan = startPerfSpan('mux.startup.active-start-command', {
      sessionId: initialActiveId
    });
    startupActiveFirstOutputSpan = startPerfSpan('mux.startup.active-first-output', {
      sessionId: initialActiveId
    });
    startupActiveFirstPaintSpan = startPerfSpan('mux.startup.active-first-visible-paint', {
      sessionId: initialActiveId
    });
    startupActiveSettledSpan = startPerfSpan('mux.startup.active-settled', {
      sessionId: initialActiveId,
      quietMs: startupSettleQuietMs
    });
    const initialActivateSpan = startPerfSpan('mux.startup.activate-initial', {
      initialActiveId
    });
    await activateConversation(initialActiveId);
    initialActivateSpan.end();
  }
  startupSpan.end({
    conversations: conversations.size
  });
  recordPerfEvent('mux.startup.ready', {
    conversations: conversations.size
  });
  void (async () => {
    let timedOut = false;
    recordPerfEvent('mux.startup.background-start.wait', {
      sessionId: initialActiveId ?? 'none',
      maxWaitMs: DEFAULT_BACKGROUND_START_MAX_WAIT_MS,
      enabled: backgroundResumePersisted ? 1 : 0
    });
    if (!backgroundResumePersisted) {
      recordPerfEvent('mux.startup.background-start.skipped', {
        sessionId: initialActiveId ?? 'none',
        reason: 'disabled'
      });
      return;
    }
    await Promise.race([
      startupSequencer.waitForSettled(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, DEFAULT_BACKGROUND_START_MAX_WAIT_MS);
      })
    ]);
    recordPerfEvent('mux.startup.background-start.begin', {
      sessionId: initialActiveId ?? 'none',
      timedOut,
      settledObserved: startupSequencer.snapshot().settledObserved
    });
    const queued = queuePersistedConversationsInBackground(initialActiveId);
    recordPerfEvent('mux.startup.background-start.queued', {
      sessionId: initialActiveId ?? 'none',
      queued
    });
  })();

  const handleConversationTitleEditInput = (input: Buffer): boolean => {
    if (conversationTitleEdit === null) {
      return false;
    }
    const edit = conversationTitleEdit;
    if (input.length === 1 && input[0] === 0x03) {
      return false;
    }
    const dismissAction = detectMuxGlobalShortcut(input, modalDismissShortcutBindings);
    if (dismissAction === 'mux.app.quit') {
      stopConversationTitleEdit(true);
      return true;
    }
    const modalAction = detectMuxGlobalShortcut(input, shortcutBindings);
    if (modalAction === 'mux.conversation.archive' || modalAction === 'mux.conversation.delete') {
      const targetConversationId = edit.conversationId;
      stopConversationTitleEdit(true);
      queueControlPlaneOp(async () => {
        await archiveConversation(targetConversationId);
      }, 'modal-archive-conversation');
      markDirty();
      return true;
    }
    if (
      dismissModalOnOutsideClick(input, () => {
        stopConversationTitleEdit(true);
      }, (_col, row) => {
        const overlay = buildConversationTitleModalOverlay(layout.rows);
        if (overlay === null) {
          return false;
        }
        const archiveButtonRow = overlay.top + 5;
        if (row - 1 !== archiveButtonRow) {
          return false;
        }
        const targetConversationId = edit.conversationId;
        stopConversationTitleEdit(true);
        queueControlPlaneOp(async () => {
          await archiveConversation(targetConversationId);
        }, 'modal-archive-conversation-click');
        markDirty();
        return true;
      })
    ) {
      return true;
    }

    let nextValue = edit.value;
    let done = false;
    for (const byte of input) {
      if (byte === 0x0d || byte === 0x0a) {
        done = true;
        break;
      }
      if (byte === 0x7f || byte === 0x08) {
        nextValue = nextValue.slice(0, -1);
        continue;
      }
      if (byte >= 32 && byte <= 126) {
        nextValue += String.fromCharCode(byte);
      }
    }

    if (nextValue !== edit.value) {
      edit.value = nextValue;
      edit.error = null;
      const conversation = conversations.get(edit.conversationId);
      if (conversation !== undefined) {
        conversation.title = nextValue;
      }
      scheduleConversationTitlePersist();
      markDirty();
    }

    if (done) {
      stopConversationTitleEdit(true);
    }
    return true;
  };

  const handleNewThreadPromptInput = (input: Buffer): boolean => {
    if (newThreadPrompt === null) {
      return false;
    }
    if (input.length === 1 && input[0] === 0x03) {
      return false;
    }
    const dismissAction = detectMuxGlobalShortcut(input, modalDismissShortcutBindings);
    if (dismissAction === 'mux.app.quit') {
      newThreadPrompt = null;
      markDirty();
      return true;
    }
    if (
      dismissModalOnOutsideClick(input, () => {
        newThreadPrompt = null;
        markDirty();
      }, (_col, row) => {
        const overlay = buildNewThreadModalOverlay(layout.rows);
        if (overlay === null) {
          return false;
        }
        const selectedAgentType = resolveNewThreadPromptAgentByRow(overlay.top, row);
        if (selectedAgentType === null) {
          return false;
        }
        const targetDirectoryId = newThreadPrompt?.directoryId;
        newThreadPrompt = null;
        if (targetDirectoryId !== undefined) {
          queueControlPlaneOp(async () => {
            await createAndActivateConversationInDirectory(targetDirectoryId, selectedAgentType);
          }, `modal-new-thread-click:${selectedAgentType}`);
        }
        markDirty();
        return true;
      })
    ) {
      return true;
    }

    const reduction = reduceNewThreadPromptInput(newThreadPrompt, input);
    const changed = reduction.nextState.selectedAgentType !== newThreadPrompt.selectedAgentType;

    if (changed) {
      newThreadPrompt = reduction.nextState;
      markDirty();
    }
    if (reduction.submit) {
      const targetDirectoryId = newThreadPrompt?.directoryId;
      const selectedAgentType = reduction.nextState.selectedAgentType;
      newThreadPrompt = null;
      if (targetDirectoryId !== undefined) {
        queueControlPlaneOp(async () => {
          await createAndActivateConversationInDirectory(targetDirectoryId, selectedAgentType);
        }, `modal-new-thread:${selectedAgentType}`);
      }
      markDirty();
      return true;
    }
    return true;
  };

  const handleAddDirectoryPromptInput = (input: Buffer): boolean => {
    if (addDirectoryPrompt === null) {
      return false;
    }
    if (input.length === 1 && input[0] === 0x03) {
      return false;
    }
    const dismissAction = detectMuxGlobalShortcut(input, modalDismissShortcutBindings);
    if (dismissAction === 'mux.app.quit') {
      addDirectoryPrompt = null;
      markDirty();
      return true;
    }
    if (
      dismissModalOnOutsideClick(input, () => {
        addDirectoryPrompt = null;
        markDirty();
      })
    ) {
      return true;
    }

    let value = addDirectoryPrompt.value;
    let submit = false;
    for (const byte of input) {
      if (byte === 0x0d || byte === 0x0a) {
        submit = true;
        break;
      }
      if (byte === 0x7f || byte === 0x08) {
        value = value.slice(0, -1);
        continue;
      }
      if (byte >= 32 && byte <= 126) {
        value += String.fromCharCode(byte);
      }
    }

    if (!submit) {
      addDirectoryPrompt = {
        value,
        error: null
      };
      markDirty();
      return true;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      addDirectoryPrompt = {
        value,
        error: 'path required'
      };
      markDirty();
      return true;
    }
    addDirectoryPrompt = null;
    queueControlPlaneOp(async () => {
      await addDirectoryByPath(trimmed);
    }, 'prompt-add-directory');
    markDirty();
    return true;
  };

  const onInput = (chunk: Buffer): void => {
    if (shuttingDown) {
      return;
    }
    if (handleNewThreadPromptInput(chunk)) {
      return;
    }
    if (handleConversationTitleEditInput(chunk)) {
      return;
    }
    if (handleAddDirectoryPromptInput(chunk)) {
      return;
    }

    if (chunk.length === 1 && chunk[0] === 0x1b) {
      if (selection !== null || selectionDrag !== null) {
        selection = null;
        selectionDrag = null;
        releaseViewportPinForSelection();
        markDirty();
      }
      if (mainPaneMode === 'conversation' && activeConversationId !== null) {
        const escapeTarget = conversations.get(activeConversationId);
        if (escapeTarget !== undefined) {
          streamClient.sendInput(escapeTarget.sessionId, chunk);
        }
      }
      return;
    }

    const focusExtraction = extractFocusEvents(chunk);
    if (focusExtraction.focusInCount > 0) {
      inputModeManager.enable();
      markDirty();
    }
    if (focusExtraction.focusOutCount > 0) {
      markDirty();
    }

    if (focusExtraction.sanitized.length === 0) {
      return;
    }

    const globalShortcut = detectMuxGlobalShortcut(focusExtraction.sanitized, shortcutBindings);
    if (globalShortcut === 'mux.app.interrupt-all') {
      requestStop();
      return;
    }
    if (globalShortcut === 'mux.app.quit') {
      requestStop();
      return;
    }
    if (globalShortcut === 'mux.conversation.new') {
      const targetDirectoryId = resolveDirectoryForAction();
      if (targetDirectoryId !== null) {
        openNewThreadPrompt(targetDirectoryId);
      }
      return;
    }
    if (globalShortcut === 'mux.conversation.archive') {
      const targetConversationId =
        mainPaneMode === 'conversation' ? activeConversationId : null;
      if (targetConversationId !== null && conversations.has(targetConversationId)) {
        queueControlPlaneOp(async () => {
          await archiveConversation(targetConversationId);
        }, 'shortcut-archive-conversation');
      }
      return;
    }
    if (globalShortcut === 'mux.conversation.delete') {
      const targetConversationId =
        mainPaneMode === 'conversation' ? activeConversationId : null;
      if (targetConversationId !== null && conversations.has(targetConversationId)) {
        queueControlPlaneOp(async () => {
          await archiveConversation(targetConversationId);
        }, 'shortcut-delete-conversation');
      }
      return;
    }
    if (globalShortcut === 'mux.conversation.takeover') {
      const targetConversationId =
        mainPaneMode === 'conversation' ? activeConversationId : null;
      if (targetConversationId !== null && conversations.has(targetConversationId)) {
        queueControlPlaneOp(async () => {
          await takeoverConversation(targetConversationId);
        }, 'shortcut-takeover-conversation');
      }
      return;
    }
    if (globalShortcut === 'mux.directory.add') {
      addDirectoryPrompt = {
        value: '',
        error: null
      };
      markDirty();
      return;
    }
    if (globalShortcut === 'mux.directory.close') {
      const targetDirectoryId =
        mainPaneMode === 'project' &&
        activeDirectoryId !== null &&
        directories.has(activeDirectoryId)
          ? activeDirectoryId
          : null;
      if (targetDirectoryId !== null) {
        queueControlPlaneOp(async () => {
          await closeDirectory(targetDirectoryId);
        }, 'shortcut-close-directory');
      }
      return;
    }
    if (
      globalShortcut === 'mux.conversation.next' ||
      globalShortcut === 'mux.conversation.previous'
    ) {
      const orderedIds = conversationOrder(conversations);
      const direction = globalShortcut === 'mux.conversation.next' ? 'next' : 'previous';
      const targetId = cycleConversationId(orderedIds, activeConversationId, direction);
      if (targetId !== null) {
        queueControlPlaneOp(async () => {
          await activateConversation(targetId);
        }, `shortcut-activate-${direction}`);
      }
      return;
    }

    if (
      mainPaneMode === 'conversation' &&
      selection !== null &&
      isCopyShortcutInput(focusExtraction.sanitized)
    ) {
      if (activeConversationId === null) {
        return;
      }
      const selectedFrame = activeConversation().oracle.snapshotWithoutHash();
      const copied = writeTextToClipboard(selectionText(selectedFrame, selection));
      if (copied) {
        markDirty();
      }
      return;
    }

    const parsed = parseMuxInputChunk(inputRemainder, focusExtraction.sanitized);
    inputRemainder = parsed.remainder;

    const inputConversation =
      activeConversationId === null ? null : conversations.get(activeConversationId) ?? null;
    let snapshotForInput =
      inputConversation === null ? null : inputConversation.oracle.snapshotWithoutHash();
    const routedTokens: Array<(typeof parsed.tokens)[number]> = [];
    for (const token of parsed.tokens) {
      if (token.kind !== 'mouse') {
        if (selection !== null && token.text.length > 0) {
          selection = null;
          selectionDrag = null;
          releaseViewportPinForSelection();
          markDirty();
        }
        routedTokens.push(token);
        continue;
      }

      if (paneDividerDragActive) {
        if (isMouseRelease(token.event.final)) {
          paneDividerDragActive = false;
          markDirty();
          continue;
        }
        if (!isWheelMouseCode(token.event.code)) {
          applyPaneDividerAtCol(token.event.col);
          continue;
        }
      }

      const target = classifyPaneAt(layout, token.event.col, token.event.row);
      if (
        target === 'separator' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code)
      ) {
        paneDividerDragActive = true;
        applyPaneDividerAtCol(token.event.col);
        continue;
      }
      const isMainPaneTarget = target === 'right';
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (wheelDelta !== null) {
        if (target === 'right') {
          if (mainPaneMode === 'project') {
            projectPaneScrollTop = Math.max(0, projectPaneScrollTop + wheelDelta);
          } else if (inputConversation !== null) {
            inputConversation.oracle.scrollViewport(wheelDelta);
            snapshotForInput = inputConversation.oracle.snapshotWithoutHash();
          }
          markDirty();
          continue;
        }
      }
      const projectPaneActionClick =
        target === 'right' &&
        mainPaneMode === 'project' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (projectPaneActionClick && projectPaneSnapshot !== null) {
        const snapshot = projectPaneSnapshot;
        const rowIndex = Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1));
        const action = projectPaneActionAtRow(
          snapshot,
          layout.rightCols,
          layout.paneRows,
          projectPaneScrollTop,
          rowIndex
        );
        if (action === 'conversation.new') {
          openNewThreadPrompt(snapshot.directoryId);
          markDirty();
          continue;
        }
        if (action === 'project.close') {
          queueControlPlaneOp(async () => {
            await closeDirectory(snapshot.directoryId);
          }, 'project-pane-close-project');
          markDirty();
          continue;
        }
      }
      const leftPaneConversationSelect =
        target === 'left' &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code) &&
        !isMotionMouseCode(token.event.code);
      if (leftPaneConversationSelect) {
        const rowIndex = Math.max(0, Math.min(layout.paneRows - 1, token.event.row - 1));
        const colIndex = Math.max(0, Math.min(layout.leftCols - 1, token.event.col - 1));
        const selectedConversationId = conversationIdAtWorkspaceRailRow(latestRailViewRows, rowIndex);
        const selectedProjectId = projectIdAtWorkspaceRailRow(latestRailViewRows, rowIndex);
        const selectedAction = actionAtWorkspaceRailCell(
          latestRailViewRows,
          rowIndex,
          colIndex,
          layout.leftCols
        );
        const selectedRowKind = kindAtWorkspaceRailRow(latestRailViewRows, rowIndex);
        const supportsConversationTitleEditClick =
          selectedRowKind === 'conversation-title' || selectedRowKind === 'conversation-body';
        const keepTitleEditActive =
          conversationTitleEdit !== null &&
          selectedConversationId === conversationTitleEdit.conversationId &&
          supportsConversationTitleEditClick;
        if (!keepTitleEditActive && conversationTitleEdit !== null) {
          stopConversationTitleEdit(true);
        }
        if (selection !== null || selectionDrag !== null) {
          selection = null;
          selectionDrag = null;
          releaseViewportPinForSelection();
        }
        if (selectedAction === 'conversation.new') {
          conversationTitleEditClickState = null;
          const targetDirectoryId = selectedProjectId ?? resolveDirectoryForAction();
          if (targetDirectoryId !== null) {
            openNewThreadPrompt(targetDirectoryId);
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'conversation.delete') {
          conversationTitleEditClickState = null;
          if (activeConversationId !== null) {
            const targetConversationId = activeConversationId;
            queueControlPlaneOp(async () => {
              await archiveConversation(targetConversationId);
            }, 'mouse-archive-conversation');
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'project.add') {
          conversationTitleEditClickState = null;
          addDirectoryPrompt = {
            value: '',
            error: null
          };
          markDirty();
          continue;
        }
        if (selectedAction === 'project.close') {
          conversationTitleEditClickState = null;
          const targetDirectoryId = selectedProjectId ?? resolveDirectoryForAction();
          if (targetDirectoryId !== null) {
            queueControlPlaneOp(async () => {
              await closeDirectory(targetDirectoryId);
            }, 'mouse-close-directory');
          }
          markDirty();
          continue;
        }
        if (selectedAction === 'shortcuts.toggle') {
          conversationTitleEditClickState = null;
          shortcutsCollapsed = !shortcutsCollapsed;
          queuePersistMuxUiState();
          markDirty();
          continue;
        }
        const clickNowMs = Date.now();
        const conversationClick = selectedConversationId !== null && supportsConversationTitleEditClick
          ? detectConversationDoubleClick(
              conversationTitleEditClickState,
              selectedConversationId,
              clickNowMs,
              CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS
            )
          : {
              doubleClick: false,
              nextState: null
            };
        conversationTitleEditClickState = conversationClick.nextState;
        if (selectedConversationId !== null && selectedConversationId === activeConversationId) {
          if (mainPaneMode !== 'conversation') {
            mainPaneMode = 'conversation';
            projectPaneSnapshot = null;
            projectPaneScrollTop = 0;
            forceFullClear = true;
            previousRows = [];
          }
          if (conversationClick.doubleClick) {
            beginConversationTitleEdit(selectedConversationId);
          }
          markDirty();
          continue;
        }
        if (selectedConversationId !== null) {
          if (conversationClick.doubleClick) {
            queueControlPlaneOp(async () => {
              await activateConversation(selectedConversationId);
              beginConversationTitleEdit(selectedConversationId);
            }, 'mouse-activate-edit-conversation');
            markDirty();
            continue;
          }
          queueControlPlaneOp(async () => {
            await activateConversation(selectedConversationId);
          }, 'mouse-activate-conversation');
          markDirty();
          continue;
        }
        if (
          selectedConversationId === null &&
          selectedProjectId !== null &&
          directories.has(selectedProjectId)
        ) {
          conversationTitleEditClickState = null;
          enterProjectPane(selectedProjectId);
          markDirty();
          continue;
        }
        conversationTitleEditClickState = null;
        markDirty();
        continue;
      }
      if (snapshotForInput === null || mainPaneMode !== 'conversation') {
        routedTokens.push(token);
        continue;
      }
      const point = pointFromMouseEvent(layout, snapshotForInput, token.event);
      const startSelection =
        isMainPaneTarget &&
        isLeftButtonPress(token.event.code, token.event.final) &&
        !hasAltModifier(token.event.code);
      const updateSelection =
        selectionDrag !== null &&
        isMainPaneTarget &&
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
        selectionDrag = null;
        markDirty();
        continue;
      }

      if (selection !== null && !isWheelMouseCode(token.event.code)) {
        selection = null;
        selectionDrag = null;
        releaseViewportPinForSelection();
        markDirty();
      }

      routedTokens.push(token);
    }

    let mainPaneScrollRows = 0;
    const forwardToSession: Buffer[] = [];
    for (const token of routedTokens) {
      if (token.kind === 'passthrough') {
        if (mainPaneMode === 'conversation' && token.text.length > 0) {
          forwardToSession.push(Buffer.from(token.text, 'utf8'));
        }
        continue;
      }
      if (classifyPaneAt(layout, token.event.col, token.event.row) !== 'right') {
        continue;
      }
      if (mainPaneMode !== 'conversation') {
        continue;
      }
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (wheelDelta !== null) {
        mainPaneScrollRows += wheelDelta;
        continue;
      }
      forwardToSession.push(Buffer.from(token.event.sequence, 'utf8'));
    }

    if (mainPaneScrollRows !== 0 && inputConversation !== null) {
      inputConversation.oracle.scrollViewport(mainPaneScrollRows);
      markDirty();
    }

    if (inputConversation === null) {
      return;
    }
    if (
      inputConversation.controller !== null &&
      !isConversationControlledByLocalHuman(inputConversation)
    ) {
      return;
    }

    for (const forwardChunk of forwardToSession) {
      streamClient.sendInput(inputConversation.sessionId, forwardChunk);
    }
    if (forwardToSession.length > 0) {
      noteGitActivity(inputConversation.directoryId, 'trigger');
    }

  };

  const onResize = (): void => {
    const nextSize = terminalSize();
    queueResize(nextSize);
  };
  const onInputSafe = (chunk: Buffer): void => {
    try {
      onInput(chunk);
    } catch (error: unknown) {
      handleRuntimeFatal('stdin-data', error);
    }
  };
  const onResizeSafe = (): void => {
    try {
      onResize();
    } catch (error: unknown) {
      handleRuntimeFatal('stdout-resize', error);
    }
  };
  const onUncaughtException = (error: Error): void => {
    handleRuntimeFatal('uncaught-exception', error);
  };
  const onUnhandledRejection = (reason: unknown): void => {
    handleRuntimeFatal('unhandled-rejection', reason);
  };

  process.stdin.on('data', onInputSafe);
  process.stdout.on('resize', onResizeSafe);
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  process.once('uncaughtException', onUncaughtException);
  process.once('unhandledRejection', onUnhandledRejection);

  inputModeManager.enable();
  applyLayout(size, true);
  scheduleRender();

  try {
    while (!stop) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  } finally {
    shuttingDown = true;
    dirty = false;
    clearInterval(outputLoadSampleTimer);
    eventLoopDelayMonitor.disable();
    if (processUsageTimer !== null) {
      clearInterval(processUsageTimer);
      processUsageTimer = null;
    }
    if (gitSummaryWorkerTimer !== null) {
      clearInterval(gitSummaryWorkerTimer);
      gitSummaryWorkerTimer = null;
    }
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (ptyResizeTimer !== null) {
      clearTimeout(ptyResizeTimer);
      ptyResizeTimer = null;
    }
    persistMuxUiStateNow();
    if (conversationTitleEdit !== null) {
      clearConversationTitleEditTimer(conversationTitleEdit);
    }
    if (renderScheduled) {
      renderScheduled = false;
    }
    process.stdin.off('data', onInputSafe);
    process.stdout.off('resize', onResizeSafe);
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
    removeEnvelopeListener();
    if (keyEventSubscription !== null) {
      await keyEventSubscription.close();
      keyEventSubscription = null;
    }
    if (runtimeFatalExitTimer !== null) {
      clearTimeout(runtimeFatalExitTimer);
      runtimeFatalExitTimer = null;
    }

    let recordingCloseError: unknown = null;
    try {
      await waitForControlPlaneDrain();
      await controlPlaneClient.close();
    } catch {
      // Best-effort shutdown only.
    }
    flushPendingPersistedEvents('shutdown');
    if (muxRecordingWriter !== null) {
      try {
        await muxRecordingWriter.close();
      } catch (error: unknown) {
        recordingCloseError = error;
      }
    }
    store.close();
    restoreTerminalState(true, inputModeManager.restore);
    if (
      options.recordingGifOutputPath !== null &&
      options.recordingPath !== null &&
      recordingCloseError === null
    ) {
      try {
        await renderTerminalRecordingToGif({
          recordingPath: options.recordingPath,
          outputPath: options.recordingGifOutputPath
        });
        process.stderr.write(
          `[mux-recording] jsonl=${options.recordingPath} gif=${options.recordingGifOutputPath}\n`
        );
      } catch (error: unknown) {
        process.stderr.write(
          `[mux-recording] gif-export-failed ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      }
    } else if (recordingCloseError !== null) {
      const recordingCloseErrorMessage =
        recordingCloseError instanceof Error
          ? recordingCloseError.message
          : typeof recordingCloseError === 'string'
            ? recordingCloseError
            : 'unknown error';
      process.stderr.write(
        `[mux-recording] close-failed ${recordingCloseErrorMessage}\n`
      );
    }
    endStartupActiveStartCommandSpan({
      observed: false
    });
    const startupSnapshot = startupSequencer.snapshot();
    endStartupActiveFirstOutputSpan({
      observed: startupSnapshot.firstOutputObserved
    });
    endStartupActiveFirstPaintSpan({
      observed: startupSnapshot.firstPaintObserved
    });
    clearStartupSettledTimer();
    endStartupActiveSettledSpan({
      observed: startupSnapshot.settledObserved,
      gate: startupSnapshot.settleGate ?? 'none'
    });
    signalStartupActiveSettled();
    shutdownPerfCore();
  }

  if (exit === null) {
    if (runtimeFatal !== null) {
      return 1;
    }
    return 0;
  }
  return normalizeExitCode(exit);
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error: unknown) {
  shutdownPerfCore();
  restoreTerminalState(true);
  process.stderr.write(`codex:live:mux fatal error: ${formatErrorMessage(error)}\n`);
  process.exitCode = 1;
}
