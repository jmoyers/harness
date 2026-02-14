import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, truncateSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import { openCodexControlPlaneClient } from '../src/control-plane/codex-session-stream.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import type { StreamServerEnvelope, StreamSessionEvent } from '../src/control-plane/stream-protocol.ts';
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
  classifyPaneAt,
  computeDualPaneLayout,
  diffRenderedRows,
  padOrTrimDisplay,
  parseMuxInputChunk,
  wheelDeltaRowsFromCode
} from '../src/mux/dual-pane-core.ts';
import { loadHarnessConfig } from '../src/config/config-core.ts';
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
import {
  renderWorkspaceRailAnsiRows
} from '../src/mux/workspace-rail.ts';
import {
  buildWorkspaceRailViewRows,
  conversationIdAtWorkspaceRailRow
} from '../src/mux/workspace-rail-model.ts';
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
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan
} from '../src/perf/perf-core.ts';

type ResolvedMuxShortcutBindings = ReturnType<typeof resolveMuxShortcutBindings>;

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

const DEFAULT_RESIZE_MIN_INTERVAL_MS = 33;
const DEFAULT_PTY_RESIZE_SETTLE_MS = 75;
const DEFAULT_STARTUP_SETTLE_QUIET_MS = 300;
const STARTUP_TERMINAL_MIN_COLS = 40;
const STARTUP_TERMINAL_MIN_ROWS = 10;
const STARTUP_TERMINAL_PROBE_TIMEOUT_MS = 250;
const STARTUP_TERMINAL_PROBE_INTERVAL_MS = 10;
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

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
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
  if (
    typeof directoryId !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof userId !== 'string' ||
    typeof workspaceId !== 'string' ||
    typeof path !== 'string'
  ) {
    return null;
  }
  return {
    directoryId,
    tenantId,
    userId,
    workspaceId,
    path
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

function runGitCommand(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}

function readGitSummary(cwd: string): GitSummary {
  const branch = runGitCommand(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || '(detached)';
  const statusOutput = runGitCommand(cwd, ['status', '--porcelain']);
  const changedFiles = statusOutput.length === 0 ? 0 : statusOutput.split('\n').filter((line) => line.trim().length > 0).length;

  const numstatOutputs = [
    runGitCommand(cwd, ['diff', '--numstat']),
    runGitCommand(cwd, ['diff', '--numstat', '--cached'])
  ];
  let additions = 0;
  let deletions = 0;
  for (const output of numstatOutputs) {
    if (output.length === 0) {
      continue;
    }
    const lines = output.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) {
        continue;
      }
      const added = Number.parseInt(parts[0] ?? '', 10);
      const removed = Number.parseInt(parts[1] ?? '', 10);
      if (Number.isFinite(added)) {
        additions += added;
      }
      if (Number.isFinite(removed)) {
        deletions += removed;
      }
    }
  }

  return {
    branch,
    changedFiles,
    additions,
    deletions
  };
}

function readProcessUsageSample(processId: number | null): ProcessUsageSample {
  if (processId === null) {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  const result = spawnSync('ps', ['-p', String(processId), '-o', '%cpu=,rss='], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return {
      cpuPercent: null,
      memoryMb: null
    };
  }

  const line = result.stdout
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
    foregroundHex,
    backgroundHex,
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
        foregroundHex,
        backgroundHex,
        indexedHexByCode: Object.keys(indexedHexByCode).length > 0 ? indexedHexByCode : undefined
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
    status: 'running',
    attentionReason: null,
    startedAt: new Date().toISOString(),
    lastEventAt: null,
    exitedAt: null,
    lastExit: null,
    processId: null,
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
  const next = firstShortcutText(bindings, 'mux.conversation.next') || 'ctrl+j';
  const previous = firstShortcutText(bindings, 'mux.conversation.previous') || 'ctrl+k';
  const quit = firstShortcutText(bindings, 'mux.app.quit') || 'ctrl+]';
  const switchHint = next === previous ? next : `${next}/${previous}`;
  return `${newConversation} new  ${switchHint} switch  ${quit} quit`;
}

type WorkspaceRailModel = Parameters<typeof renderWorkspaceRailAnsiRows>[0];

function buildRailModel(
  conversations: ReadonlyMap<string, ConversationState>,
  orderedIds: readonly string[],
  activeConversationId: string | null,
  gitSummary: GitSummary,
  processUsageBySessionId: ReadonlyMap<string, ProcessUsageSample>,
  shortcutBindings: ResolvedMuxShortcutBindings
): WorkspaceRailModel {
  const directoriesByKey = new Map<
    string,
    {
      workspaceId: string;
      worktreeId: string;
      active: boolean;
    }
  >();

  for (const sessionId of orderedIds) {
    const conversation = conversations.get(sessionId);
    if (conversation === undefined) {
      continue;
    }
    const key = `${conversation.scope.workspaceId}:${conversation.scope.worktreeId}`;
    const existing = directoriesByKey.get(key);
    const active = sessionId === activeConversationId;
    if (existing === undefined) {
      directoriesByKey.set(key, {
        workspaceId: conversation.scope.workspaceId,
        worktreeId: conversation.scope.worktreeId,
        active
      });
      continue;
    }
    if (active) {
      existing.active = true;
    }
  }

  return {
    directories: [...directoriesByKey.entries()].map(([key, value]) => ({
      key,
      workspaceId: value.workspaceId,
      worktreeId: value.worktreeId,
      active: value.active,
      git: gitSummary
    })),
    conversations: orderedIds
      .map((sessionId, index) => {
        const conversation = conversations.get(sessionId);
        if (conversation === undefined) {
          return null;
        }
        const directoryKey = `${conversation.scope.workspaceId}:${conversation.scope.worktreeId}`;
        return {
          ...conversationSummary(conversation),
          directoryKey,
          title: conversation.title,
          agentLabel: conversation.agentType,
          cpuPercent: processUsageBySessionId.get(conversation.sessionId)?.cpuPercent ?? null,
          memoryMb: processUsageBySessionId.get(conversation.sessionId)?.memoryMb ?? null
        };
      })
      .flatMap((conversation) => (conversation === null ? [] : [conversation])),
    activeConversationId,
    processes: [],
    shortcutHint: shortcutHintText(shortcutBindings),
    nowMs: Date.now()
  };
}

function buildRailRows(
  layout: ReturnType<typeof computeDualPaneLayout>,
  conversations: ReadonlyMap<string, ConversationState>,
  orderedIds: readonly string[],
  activeConversationId: string | null,
  gitSummary: GitSummary,
  processUsageBySessionId: ReadonlyMap<string, ProcessUsageSample>,
  shortcutBindings: ResolvedMuxShortcutBindings
): { ansiRows: readonly string[]; viewRows: ReturnType<typeof buildWorkspaceRailViewRows> } {
  const railModel = buildRailModel(
    conversations,
    orderedIds,
    activeConversationId,
    gitSummary,
    processUsageBySessionId,
    shortcutBindings
  );
  const viewRows = buildWorkspaceRailViewRows(railModel, layout.paneRows);
  return {
    ansiRows: renderWorkspaceRailAnsiRows(railModel, layout.leftCols, layout.paneRows),
    viewRows
  };
}

function buildRenderRows(
  layout: ReturnType<typeof computeDualPaneLayout>,
  railRows: readonly string[],
  rightFrame: TerminalSnapshotFrame,
  activeConversationId: string | null,
  selectionActive: boolean,
  ctrlCExits: boolean,
  shortcutBindings: ResolvedMuxShortcutBindings
): string[] {
  const rows: string[] = [];
  for (let row = 0; row < layout.paneRows; row += 1) {
    const left = railRows[row] ?? ' '.repeat(layout.leftCols);
    const right = renderSnapshotAnsiRow(rightFrame, row, layout.rightCols);
    rows.push(`${left}\u001b[0m│${right}`);
  }

  const mainMode = rightFrame.viewport.followOutput
    ? 'pty=live'
    : `pty=scroll(${String(rightFrame.viewport.top + 1)}/${String(rightFrame.viewport.totalRows)})`;
  const selection = selectionActive ? 'select=drag' : 'select=idle';
  const quitKey = firstShortcutText(shortcutBindings, 'mux.app.quit') || 'ctrl+]';
  const interruptKey = firstShortcutText(shortcutBindings, 'mux.app.interrupt-all') || 'ctrl+c';
  const newKey = firstShortcutText(shortcutBindings, 'mux.conversation.new') || 'ctrl+t';
  const nextKey = firstShortcutText(shortcutBindings, 'mux.conversation.next') || 'ctrl+j';
  const previousKey = firstShortcutText(shortcutBindings, 'mux.conversation.previous') || 'ctrl+k';
  const quitHint = ctrlCExits ? `${interruptKey}/${quitKey} quit` : `${quitKey} quit`;
  const status = padOrTrimDisplay(
    `[mux] conversation=${activeConversationId ?? '-'} ${mainMode} ${selection} ${newKey} new ${nextKey}/${previousKey} switch drag copy alt-pass ${quitHint}`,
    layout.cols
  );
  rows.push(status);

  return rows;
}

function renderCanonicalFrameAnsi(
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
    col: Math.max(0, Math.min(layout.rightCols - 1, col))
  };
}

function pointFromMouseEvent(
  layout: ReturnType<typeof computeDualPaneLayout>,
  frame: TerminalSnapshotFrame,
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
  layout: ReturnType<typeof computeDualPaneLayout>,
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

    output += `\u001b[${String(row + 1)};${String(layout.rightStartCol + rowStartCol)}H\u001b[7m`;
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
  const loadedConfig = loadHarnessConfig({
    cwd: options.invocationDirectory
  });
  const debugConfig = loadedConfig.config.debug;
  const perfEnabled = debugConfig.enabled && debugConfig.perf.enabled;
  const perfFilePath = resolve(options.invocationDirectory, debugConfig.perf.filePath);
  if (perfEnabled) {
    prepareArtifactPath(perfFilePath, debugConfig.overwriteArtifactsOnStart);
  }
  configurePerfCore({
    enabled: perfEnabled,
    filePath: perfFilePath
  });
  const startupSpan = startPerfSpan('mux.startup.total', {
    invocationDirectory: options.invocationDirectory,
    codexArgs: options.codexArgs.length
  });
  recordPerfEvent('mux.startup.begin');
  if (loadedConfig.error !== null) {
    process.stderr.write(`[config] using last-known-good due to parse error: ${loadedConfig.error}\n`);
  }
  const shortcutBindings = resolveMuxShortcutBindings(loadedConfig.config.mux.keybindings);
  const store = new SqliteEventStore(options.storePath);
  const debugPath =
    debugConfig.enabled && debugConfig.mux.debugPath !== null
      ? prepareArtifactPath(
          resolve(options.invocationDirectory, debugConfig.mux.debugPath),
          debugConfig.overwriteArtifactsOnStart
        )
      : null;

  let size = await readStartupTerminalSize();
  recordPerfEvent('mux.startup.terminal-size', {
    cols: size.cols,
    rows: size.rows
  });
  let layout = computeDualPaneLayout(size.cols, size.rows);
  const resizeMinIntervalMs = debugConfig.enabled
    ? debugConfig.mux.resizeMinIntervalMs
    : DEFAULT_RESIZE_MIN_INTERVAL_MS;
  const ptyResizeSettleMs = debugConfig.enabled
    ? debugConfig.mux.ptyResizeSettleMs
    : DEFAULT_PTY_RESIZE_SETTLE_MS;
  const startupSettleQuietMs = debugConfig.enabled
    ? debugConfig.mux.startupSettleQuietMs
    : DEFAULT_STARTUP_SETTLE_QUIET_MS;
  const ctrlCExits = parseBooleanEnv(process.env.HARNESS_MUX_CTRL_C_EXITS, true);
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
    muxRecordingWriter = createTerminalRecordingWriter({
      filePath: options.recordingPath,
      source: 'codex-live-mux',
      defaultForegroundHex: process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex ?? 'd0d7de',
      defaultBackgroundHex: process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex ?? '0f1419',
      ansiPaletteIndexedHex: probedPalette.indexedHexByCode,
      minFrameIntervalMs: recordIntervalMs
    });
    muxRecordingOracle = new TerminalSnapshotOracle(size.cols, size.rows);
  }
  const controlPlaneOpenSpan = startPerfSpan('mux.startup.control-plane-open');
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
        stateStorePath: resolve(
          options.invocationDirectory,
          process.env.HARNESS_CONTROL_PLANE_DB_PATH ?? '.harness/control-plane.sqlite'
        ),
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
  const activeDirectoryId = persistedDirectory.directoryId;

  const sessionEnv = {
    ...sanitizeProcessEnv(),
    TERM: process.env.TERM ?? 'xterm-256color'
  };
  const conversations = new Map<string, ConversationState>();
  const conversationStartInFlight = new Map<string, Promise<ConversationState>>();
  const removedConversationIds = new Set<string>();
  let activeConversationId: string | null = null;
  let startupFirstPaintTargetSessionId: string | null = null;
  let startupActiveStartCommandSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveFirstOutputSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveFirstPaintSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveSettledSpan: ReturnType<typeof startPerfSpan> | null = null;
  let startupActiveFirstOutputObserved = false;
  let startupActiveFirstPaintObserved = false;
  let startupActiveSettledObserved = false;
  let startupActiveSettledTimer: NodeJS.Timeout | null = null;

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
    if (startupActiveSettledTimer === null) {
      return;
    }
    clearTimeout(startupActiveSettledTimer);
    startupActiveSettledTimer = null;
  };

  const visibleGlyphCellCount = (conversation: ConversationState): number => {
    const frame = conversation.oracle.snapshot();
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

  const scheduleStartupSettledProbe = (sessionId: string): void => {
    if (
      startupFirstPaintTargetSessionId !== sessionId ||
      !startupActiveFirstOutputObserved ||
      startupActiveSettledObserved
    ) {
      return;
    }
    clearStartupSettledTimer();
    startupActiveSettledTimer = setTimeout(() => {
      startupActiveSettledTimer = null;
      if (startupFirstPaintTargetSessionId !== sessionId || startupActiveSettledObserved) {
        return;
      }
      const conversation = conversations.get(sessionId);
      if (conversation === undefined) {
        return;
      }
      const glyphCells = visibleGlyphCellCount(conversation);
      startupActiveSettledObserved = true;
      recordPerfEvent('mux.startup.active-settled', {
        sessionId,
        quietMs: startupSettleQuietMs,
        glyphCells
      });
      endStartupActiveSettledSpan({
        observed: true,
        quietMs: startupSettleQuietMs,
        glyphCells
      });
    }, startupSettleQuietMs);
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
    const state = createConversationState(
      sessionId,
      seed?.directoryId ?? activeDirectoryId,
      seed?.title ?? `untitled task ${String(conversations.size + 1)}`,
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
      throw new Error('active conversation is not set');
    }
    const state = conversations.get(activeConversationId);
    if (state === undefined) {
      throw new Error(`active conversation missing: ${activeConversationId}`);
    }
    return state;
  };

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
      const launchArgs = buildAgentStartArgs(
        targetConversation.agentType,
        options.codexArgs,
        targetConversation.adapterState
      );
      await streamClient.sendCommand({
        type: 'pty.start',
        sessionId,
        args: launchArgs,
        env: sessionEnv,
        initialCols: layout.rightCols,
        initialRows: layout.paneRows,
        terminalForegroundHex: process.env.HARNESS_TERM_FG ?? probedPalette.foregroundHex,
        terminalBackgroundHex: process.env.HARNESS_TERM_BG ?? probedPalette.backgroundHex,
        tenantId: options.scope.tenantId,
        userId: options.scope.userId,
        workspaceId: options.scope.workspaceId,
        worktreeId: options.scope.worktreeId
      });
      ptySizeByConversationId.set(sessionId, {
        cols: layout.rightCols,
        rows: layout.paneRows
      });
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
      await streamClient.sendCommand({
        type: 'pty.subscribe-events',
        sessionId
      });
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

  const startPersistedConversationsInBackground = async (
    activeSessionId: string | null
  ): Promise<void> => {
    const ordered = conversationOrder(conversations);
    for (const sessionId of ordered) {
      if (activeSessionId !== null && sessionId === activeSessionId) {
        continue;
      }
      const conversation = conversations.get(sessionId);
      if (conversation === undefined || conversation.live) {
        continue;
      }
      await startConversation(sessionId);
    }
    markDirty();
  };

  const hydrateConversationList = async (): Promise<void> => {
    const hydrateSpan = startPerfSpan('mux.startup.hydrate-conversations');
    const listedPersisted = await streamClient.sendCommand({
      type: 'conversation.list',
      directoryId: activeDirectoryId,
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
      await streamClient.sendCommand({
        type: 'pty.subscribe-events',
        sessionId: summary.sessionId
      });
    }
    hydrateSpan.end({
      persisted: persistedRows.length,
      live: summaries.length
    });
  };

  await hydrateConversationList();
  if (conversations.size === 0) {
    const initialTitle = `untitled task ${String(conversations.size + 1)}`;
    await streamClient.sendCommand({
      type: 'conversation.create',
      conversationId: options.initialConversationId,
      directoryId: activeDirectoryId,
      title: initialTitle,
      agentType: 'codex',
      adapterState: {}
    });
    ensureConversation(options.initialConversationId, {
      directoryId: activeDirectoryId,
      title: initialTitle,
      agentType: 'codex',
      adapterState: {}
    });
  }
  if (activeConversationId === null) {
    const ordered = conversationOrder(conversations);
    activeConversationId = ordered[0] ?? options.initialConversationId;
  }

  let gitSummary = readGitSummary(process.cwd());
  const processUsageBySessionId = new Map<string, ProcessUsageSample>();

  const refreshProcessUsage = (): void => {
    for (const [sessionId, conversation] of conversations.entries()) {
      processUsageBySessionId.set(sessionId, readProcessUsageSample(conversation.processId));
    }
  };

  refreshProcessUsage();

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
  let renderScheduled = false;
  let shuttingDown = false;
  let selection: PaneSelection | null = null;
  let selectionDrag: PaneSelectionDrag | null = null;
  let selectionPinnedFollowOutput: boolean | null = null;
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
    stop = true;
    queueControlPlaneOp(async () => {
      for (const sessionId of conversationOrder(conversations)) {
        const conversation = conversations.get(sessionId);
        if (conversation === undefined || !conversation.live) {
          continue;
        }
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
    });
    markDirty();
  };

  const scheduleRender = (): void => {
    if (shuttingDown || renderScheduled) {
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
    if (shuttingDown) {
      return;
    }
    dirty = true;
    scheduleRender();
  };

  const processUsageTimer = setInterval(() => {
    refreshProcessUsage();
    markDirty();
  }, 1000);
  const gitSummaryTimer = setInterval(() => {
    const next = readGitSummary(process.cwd());
    if (
      next.branch !== gitSummary.branch ||
      next.changedFiles !== gitSummary.changedFiles ||
      next.additions !== gitSummary.additions ||
      next.deletions !== gitSummary.deletions
    ) {
      gitSummary = next;
      markDirty();
    }
  }, 1500);

  const applyPtyResize = (ptySize: { cols: number; rows: number }): void => {
    const conversation = activeConversation();
    const currentPtySize = ptySizeByConversationId.get(conversation.sessionId);
    if (currentPtySize !== undefined && currentPtySize.cols === ptySize.cols && currentPtySize.rows === ptySize.rows) {
      return;
    }
    ptySizeByConversationId.set(conversation.sessionId, {
      cols: ptySize.cols,
      rows: ptySize.rows
    });
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
    }
    if (muxRecordingOracle !== null) {
      muxRecordingOracle.resize(nextLayout.cols, nextLayout.rows);
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

  let controlPlaneOps = Promise.resolve();
  const queueControlPlaneOp = (task: () => Promise<void>): void => {
    controlPlaneOps = controlPlaneOps
      .then(task)
      .catch((error: unknown) => {
        process.stderr.write(
          `[mux] control-plane error ${error instanceof Error ? error.message : String(error)}\n`
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
    previousRows = [];
    const targetConversation = conversations.get(sessionId);
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

  const createAndActivateConversation = async (): Promise<void> => {
    const sessionId = `conversation-${randomUUID()}`;
    const title = `untitled task ${String(conversations.size + 1)}`;
    await streamClient.sendCommand({
      type: 'conversation.create',
      conversationId: sessionId,
      directoryId: activeDirectoryId,
      title,
      agentType: 'codex',
      adapterState: {}
    });
    ensureConversation(sessionId, {
      directoryId: activeDirectoryId,
      title,
      agentType: 'codex',
      adapterState: {}
    });
    await startConversation(sessionId);
    await activateConversation(sessionId);
  };

  const archiveOrDeleteConversation = async (
    sessionId: string,
    mode: 'archive' | 'delete'
  ): Promise<void> => {
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

    if (mode === 'archive') {
      await streamClient.sendCommand({
        type: 'conversation.archive',
        conversationId: sessionId
      });
    } else {
      await streamClient.sendCommand({
        type: 'conversation.delete',
        conversationId: sessionId
      });
    }

    removedConversationIds.add(sessionId);
    conversations.delete(sessionId);
    ptySizeByConversationId.delete(sessionId);
    processUsageBySessionId.delete(sessionId);

    if (activeConversationId === sessionId) {
      const ordered = conversationOrder(conversations);
      const nextConversationId = ordered[0] ?? null;
      activeConversationId = null;
      if (nextConversationId !== null) {
        await activateConversation(nextConversationId);
      } else {
        await createAndActivateConversation();
      }
      return;
    }

    markDirty();
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
    if (shuttingDown || !dirty) {
      return;
    }
    if (activeConversationId === null) {
      dirty = false;
      return;
    }

    const active = activeConversation();
    const rightFrame = active.oracle.snapshot();
    const renderSelection =
      selectionDrag !== null && selectionDrag.hasDragged
        ? {
            anchor: selectionDrag.anchor,
            focus: selectionDrag.focus,
            text: ''
          }
        : selection;
    const selectionRows = selectionVisibleRows(rightFrame, renderSelection);
    const orderedIds = conversationOrder(conversations);
    const rail = buildRailRows(
      layout,
      conversations,
      orderedIds,
      activeConversationId,
      gitSummary,
      processUsageBySessionId,
      shortcutBindings
    );
    latestRailViewRows = rail.viewRows;
    const rows = buildRenderRows(
      layout,
      rail.ansiRows,
      rightFrame,
      activeConversationId,
      renderSelection !== null,
      ctrlCExits,
      shortcutBindings
    );
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

    const shouldShowCursor =
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

    if (output.length > 0) {
      process.stdout.write(output);
      if (
        startupFirstPaintTargetSessionId !== null &&
        activeConversationId === startupFirstPaintTargetSessionId &&
        startupActiveFirstOutputObserved &&
        !startupActiveFirstPaintObserved
      ) {
        startupActiveFirstPaintObserved = true;
        recordPerfEvent('mux.startup.active-first-visible-paint', {
          sessionId: startupFirstPaintTargetSessionId,
          changedRows: diff.changedRows.length
        });
        endStartupActiveFirstPaintSpan({
          observed: true,
          changedRows: diff.changedRows.length
        });
      }
      if (muxRecordingWriter !== null && muxRecordingOracle !== null) {
        const canonicalFrame = renderCanonicalFrameAnsi(
          rows,
          rightFrame.cursor.style,
          shouldShowCursor,
          rightFrame.cursor.row,
          layout.rightStartCol + rightFrame.cursor.col - 1
        );
        muxRecordingOracle.ingest(canonicalFrame);
        try {
          muxRecordingWriter.capture(muxRecordingOracle.snapshot());
        } catch {
          // Recording failures must never break live interaction.
        }
      }
    }
    appendDebugRecord(debugPath, {
      kind: 'render',
      changedRows: diff.changedRows,
      overlayResetRows,
      rightViewportTop: rightFrame.viewport.top,
      rightViewportFollow: rightFrame.viewport.followOutput,
      rightViewportTotalRows: rightFrame.viewport.totalRows,
      rightCursorRow: rightFrame.cursor.row,
      rightCursorCol: rightFrame.cursor.col,
      rightCursorVisible: rightFrame.cursor.visible,
      shouldShowCursor
    });

    previousRows = diff.nextRows;
    previousSelectionRows = selectionRows;
    dirty = false;
  };

  const handleEnvelope = (envelope: StreamServerEnvelope): void => {
    if (envelope.kind === 'pty.output') {
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = ensureConversation(envelope.sessionId);
      const chunk = Buffer.from(envelope.chunkBase64, 'base64');
      if (
        startupFirstPaintTargetSessionId !== null &&
        envelope.sessionId === startupFirstPaintTargetSessionId &&
        !startupActiveFirstOutputObserved
      ) {
        startupActiveFirstOutputObserved = true;
        recordPerfEvent('mux.startup.active-first-output', {
          sessionId: envelope.sessionId,
          bytes: chunk.length
        });
        endStartupActiveFirstOutputSpan({
          observed: true,
          bytes: chunk.length
        });
      }
      conversation.oracle.ingest(chunk);
      if (
        startupFirstPaintTargetSessionId !== null &&
        envelope.sessionId === startupFirstPaintTargetSessionId
      ) {
        scheduleStartupSettledProbe(envelope.sessionId);
      }

      const normalized = mapTerminalOutputToNormalizedEvent(chunk, conversation.scope, idFactory);
      store.appendEvents([normalized]);
      conversation.lastEventAt = normalized.ts;
      if (activeConversationId === envelope.sessionId) {
        markDirty();
      }
      return;
    }

    if (envelope.kind === 'pty.event') {
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = ensureConversation(envelope.sessionId);
      const observedAt =
        envelope.event.type === 'session-exit' ? new Date().toISOString() : envelope.event.record.ts;
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
        store.appendEvents([normalized]);
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
        ptySizeByConversationId.delete(envelope.sessionId);
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
      if (removedConversationIds.has(envelope.sessionId)) {
        return;
      }
      const conversation = conversations.get(envelope.sessionId);
      if (conversation !== undefined) {
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
            });
          }
        }
      }
      markDirty();
    }
  };

  const removeEnvelopeListener = streamClient.onEnvelope(handleEnvelope);

  const initialActiveId = activeConversationId;
  activeConversationId = null;
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
  queueControlPlaneOp(async () => {
    await startPersistedConversationsInBackground(initialActiveId);
  });

  const onInput = (chunk: Buffer): void => {
    if (shuttingDown) {
      return;
    }

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
      inputModeManager.enable();
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

    const globalShortcut = detectMuxGlobalShortcut(focusExtraction.sanitized, shortcutBindings);
    if (
      globalShortcut === 'mux.app.interrupt-all' &&
      ctrlCExits &&
      selection === null &&
      selectionDrag === null
    ) {
      requestStop();
      return;
    }
    if (globalShortcut === 'mux.app.quit') {
      requestStop();
      return;
    }
    if (globalShortcut === 'mux.conversation.new') {
      queueControlPlaneOp(async () => {
        await createAndActivateConversation();
      });
      return;
    }
    if (globalShortcut === 'mux.conversation.archive') {
      const targetConversationId = activeConversationId;
      if (targetConversationId !== null) {
        queueControlPlaneOp(async () => {
          await archiveOrDeleteConversation(targetConversationId, 'archive');
        });
      }
      return;
    }
    if (globalShortcut === 'mux.conversation.delete') {
      const targetConversationId = activeConversationId;
      if (targetConversationId !== null) {
        queueControlPlaneOp(async () => {
          await archiveOrDeleteConversation(targetConversationId, 'delete');
        });
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
        });
      }
      return;
    }

    if (selection !== null && isCopyShortcutInput(focusExtraction.sanitized)) {
      const selectedFrame = activeConversation().oracle.snapshot();
      const copied = writeTextToClipboard(selectionText(selectedFrame, selection));
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
      const isMainPaneTarget = target === 'right';
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (wheelDelta !== null) {
        if (target === 'right') {
          inputConversation.oracle.scrollViewport(wheelDelta);
          snapshotForInput = inputConversation.oracle.snapshot();
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
        const selectedConversationId = conversationIdAtWorkspaceRailRow(latestRailViewRows, rowIndex);
        if (selection !== null || selectionDrag !== null) {
          selection = null;
          selectionDrag = null;
          releaseViewportPinForSelection();
        }
        if (selectedConversationId !== null && selectedConversationId !== activeConversationId) {
          queueControlPlaneOp(async () => {
            await activateConversation(selectedConversationId);
          });
        }
        appendDebugRecord(debugPath, {
          kind: 'conversation-select-mouse',
          row: token.event.row,
          col: token.event.col,
          rowIndex,
          selectedConversationId
        });
        markDirty();
        continue;
      }
      const point = pointFromMouseEvent(layout, snapshotForInput, token.event);
      const startSelection = isMainPaneTarget && isLeftButtonPress(token.event.code, token.event.final) && !hasAltModifier(token.event.code);
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

    let mainPaneScrollRows = 0;
    const forwardToSession: Buffer[] = [];
    for (const token of routedTokens) {
      if (token.kind === 'passthrough') {
        if (token.text.length > 0) {
          forwardToSession.push(Buffer.from(token.text, 'utf8'));
        }
        continue;
      }
      if (classifyPaneAt(layout, token.event.col, token.event.row) !== 'right') {
        continue;
      }
      const wheelDelta = wheelDeltaRowsFromCode(token.event.code);
      if (wheelDelta !== null) {
        mainPaneScrollRows += wheelDelta;
        continue;
      }
      forwardToSession.push(Buffer.from(token.event.sequence, 'utf8'));
    }

    if (mainPaneScrollRows !== 0) {
      inputConversation.oracle.scrollViewport(mainPaneScrollRows);
      markDirty();
    }

    for (const forwardChunk of forwardToSession) {
      streamClient.sendInput(inputConversation.sessionId, forwardChunk);
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
      routedForwardCount: forwardToSession.length,
      mainPaneScrollRows
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
    clearInterval(processUsageTimer);
    clearInterval(gitSummaryTimer);
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (ptyResizeTimer !== null) {
      clearTimeout(ptyResizeTimer);
      ptyResizeTimer = null;
    }
    if (renderScheduled) {
      renderScheduled = false;
    }
    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    removeEnvelopeListener();

    let recordingCloseError: unknown = null;
    try {
      await controlPlaneOps;
      await controlPlaneClient.close();
    } catch {
      // Best-effort shutdown only.
    }
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
      process.stderr.write(
        `[mux-recording] close-failed ${
          recordingCloseError instanceof Error ? recordingCloseError.message : String(recordingCloseError)
        }\n`
      );
    }
    endStartupActiveStartCommandSpan({
      observed: false
    });
    endStartupActiveFirstOutputSpan({
      observed: startupActiveFirstOutputObserved
    });
    endStartupActiveFirstPaintSpan({
      observed: startupActiveFirstPaintObserved
    });
    clearStartupSettledTimer();
    endStartupActiveSettledSpan({
      observed: startupActiveSettledObserved
    });
    shutdownPerfCore();
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
  shutdownPerfCore();
  restoreTerminalState(true);
  process.stderr.write(
    `codex:live:mux fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
