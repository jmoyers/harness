import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CodexLiveEvent, type LiveSessionNotifyMode } from '../codex/live-session.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import type { TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  type StreamObservedEvent,
  type StreamSessionKeyEventRecord,
  type StreamSessionController,
  type StreamSessionListSort,
  type StreamSessionRuntimeStatus,
  type StreamClientEnvelope,
  type StreamCommand,
  type StreamServerEnvelope,
  type StreamSessionEvent,
  type StreamSignal,
} from './stream-protocol.ts';
import {
  SqliteControlPlaneStore,
  type ControlPlaneConversationRecord,
  type ControlPlaneDirectoryRecord,
  type ControlPlaneRepositoryRecord,
  type ControlPlaneTaskRecord,
  type ControlPlaneTelemetrySummary,
} from '../store/control-plane-store.ts';
import {
  buildAgentSessionStartArgs,
  codexResumeSessionIdFromAdapterState,
  mergeAdapterStateFromSessionEvent,
  normalizeAdapterState,
} from '../adapters/agent-session-state.ts';
import { recordPerfEvent, startPerfSpan } from '../perf/perf-core.ts';
import {
  buildCodexTelemetryConfigArgs,
  parseCodexHistoryLine,
  parseOtlpLifecycleLogEvents,
  parseOtlpLifecycleMetricEvents,
  parseOtlpLifecycleTraceEvents,
  parseOtlpLogEvents,
  parseOtlpMetricEvents,
  parseOtlpTraceEvents,
  telemetryFingerprint,
  type ParsedCodexTelemetryEvent,
} from './codex-telemetry.ts';
import type { HarnessLifecycleHooksConfig } from '../config/config-core.ts';
import { LifecycleHooksRuntime } from './lifecycle-hooks.ts';
import { readGitDirectorySnapshot } from '../mux/live-mux/git-snapshot.ts';

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

interface LiveSessionLike {
  attach(handlers: SessionAttachHandlers, sinceCursor?: number): string;
  detach(attachmentId: string): void;
  latestCursorValue(): number;
  processId(): number | null;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  snapshot(): TerminalSnapshotFrame;
  close(): void;
  onEvent(listener: (event: CodexLiveEvent) => void): () => void;
}

export interface StartControlPlaneSessionInput {
  command?: string;
  baseArgs?: string[];
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  useNotifyHook?: boolean;
  notifyMode?: LiveSessionNotifyMode;
  notifyFilePath?: string;
  initialCols: number;
  initialRows: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
}

interface StartSessionRuntimeInput {
  readonly sessionId: string;
  readonly args: readonly string[];
  readonly initialCols: number;
  readonly initialRows: number;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly worktreeId?: string;
  readonly terminalForegroundHex?: string;
  readonly terminalBackgroundHex?: string;
}

type StartControlPlaneSession = (input: StartControlPlaneSessionInput) => LiveSessionLike;

interface CodexTelemetryServerConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly logUserPrompt: boolean;
  readonly captureLogs: boolean;
  readonly captureMetrics: boolean;
  readonly captureTraces: boolean;
  readonly captureVerboseEvents?: boolean;
  readonly ingestMode?: 'lifecycle-fast' | 'full';
}

interface CodexHistoryIngestConfig {
  readonly enabled: boolean;
  readonly filePath: string;
  readonly pollMs: number;
}

interface CodexLaunchConfig {
  readonly defaultMode: 'yolo' | 'standard';
  readonly directoryModes: Readonly<Record<string, 'yolo' | 'standard'>>;
}

interface GitStatusMonitorConfig {
  readonly enabled: boolean;
  readonly pollMs: number;
  readonly maxConcurrency: number;
  readonly minDirectoryRefreshMs: number;
}

type GitDirectorySnapshot = Awaited<ReturnType<typeof readGitDirectorySnapshot>>;
type GitDirectorySnapshotReader = (cwd: string) => Promise<GitDirectorySnapshot>;

interface StartControlPlaneStreamServerOptions {
  host?: string;
  port?: number;
  startSession?: StartControlPlaneSession;
  authToken?: string;
  maxConnectionBufferedBytes?: number;
  sessionExitTombstoneTtlMs?: number;
  maxStreamJournalEntries?: number;
  stateStorePath?: string;
  stateStore?: SqliteControlPlaneStore;
  codexTelemetry?: CodexTelemetryServerConfig;
  codexHistory?: CodexHistoryIngestConfig;
  codexLaunch?: CodexLaunchConfig;
  gitStatus?: GitStatusMonitorConfig;
  readGitDirectorySnapshot?: GitDirectorySnapshotReader;
  lifecycleHooks?: HarnessLifecycleHooksConfig;
}

interface ConnectionState {
  id: string;
  socket: Socket;
  remainder: string;
  authenticated: boolean;
  attachedSessionIds: Set<string>;
  eventSessionIds: Set<string>;
  streamSubscriptionIds: Set<string>;
  queuedPayloads: QueuedPayload[];
  queuedPayloadBytes: number;
  writeBlocked: boolean;
}

interface QueuedPayload {
  payload: string;
  bytes: number;
  diagnosticSessionId: string | null;
}

interface SessionRollingCounter {
  buckets: [number, number, number, number, number, number];
  currentBucketStartMs: number;
}

interface SessionDiagnostics {
  telemetryIngestedTotal: number;
  telemetryRetainedTotal: number;
  telemetryDroppedTotal: number;
  telemetryIngestRate: SessionRollingCounter;
  fanoutEventsEnqueuedTotal: number;
  fanoutBytesEnqueuedTotal: number;
  fanoutBackpressureSignalsTotal: number;
  fanoutBackpressureDisconnectsTotal: number;
}

interface SessionState {
  id: string;
  directoryId: string | null;
  agentType: string;
  adapterState: Record<string, unknown>;
  tenantId: string;
  userId: string;
  workspaceId: string;
  worktreeId: string;
  session: LiveSessionLike | null;
  eventSubscriberConnectionIds: Set<string>;
  attachmentByConnectionId: Map<string, string>;
  unsubscribe: (() => void) | null;
  status: StreamSessionRuntimeStatus;
  attentionReason: string | null;
  lastEventAt: string | null;
  lastExit: PtyExit | null;
  lastSnapshot: Record<string, unknown> | null;
  startedAt: string;
  exitedAt: string | null;
  tombstoneTimer: NodeJS.Timeout | null;
  lastObservedOutputCursor: number;
  latestTelemetry: ControlPlaneTelemetrySummary | null;
  controller: SessionControllerState | null;
  diagnostics: SessionDiagnostics;
}

interface SessionControllerState extends StreamSessionController {
  connectionId: string;
}

interface StreamSubscriptionFilter {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  taskId?: string;
  directoryId?: string;
  conversationId?: string;
  includeOutput: boolean;
}

interface StreamSubscriptionState {
  id: string;
  connectionId: string;
  filter: StreamSubscriptionFilter;
}

interface StreamObservedScope {
  tenantId: string;
  userId: string;
  workspaceId: string;
  directoryId: string | null;
  conversationId: string | null;
}

interface StreamJournalEntry {
  cursor: number;
  scope: StreamObservedScope;
  event: StreamObservedEvent;
}

interface DirectoryGitStatusCacheEntry {
  readonly summary: GitDirectorySnapshot['summary'];
  readonly repositorySnapshot: GitDirectorySnapshot['repository'];
  readonly repositoryId: string | null;
  readonly lastRefreshedAtMs: number;
  readonly lastRefreshDurationMs: number;
}

interface OtlpEndpointTarget {
  readonly kind: 'logs' | 'metrics' | 'traces';
  readonly token: string;
}

function isTelemetryRequestAbortError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('aborted');
}

const DEFAULT_MAX_CONNECTION_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_SESSION_EXIT_TOMBSTONE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_STREAM_JOURNAL_ENTRIES = 10000;
const DEFAULT_GIT_STATUS_POLL_MS = 1200;
const HISTORY_POLL_JITTER_RATIO = 0.35;
const HISTORY_POLL_MAX_DELAY_MS = 60_000;
const SESSION_DIAGNOSTICS_BUCKET_MS = 10_000;
const SESSION_DIAGNOSTICS_BUCKET_COUNT = 6;
const DEFAULT_BOOTSTRAP_SESSION_COLS = 80;
const DEFAULT_BOOTSTRAP_SESSION_ROWS = 24;
const DEFAULT_TENANT_ID = 'tenant-local';
const DEFAULT_USER_ID = 'user-local';
const DEFAULT_WORKSPACE_ID = 'workspace-local';
const DEFAULT_WORKTREE_ID = 'worktree-local';
const LINE_FEED_BYTE = '\n'.charCodeAt(0);
const DEFAULT_CLAUDE_HOOK_RELAY_SCRIPT_PATH = fileURLToPath(
  new URL('../../scripts/codex-notify-relay.ts', import.meta.url)
);
const LIFECYCLE_TELEMETRY_EVENT_NAMES = new Set([
  'codex.user_prompt',
  'codex.turn.e2e_duration_ms',
  'codex.conversation_starts',
]);
const CLAUDE_NEEDS_INPUT_NOTIFICATION_TYPES = new Set([
  'permissionrequest',
  'approvalrequest',
  'approvalrequired',
  'inputrequired',
]);
const CLAUDE_RUNNING_NOTIFICATION_TYPES = new Set([
  'permissionapproved',
  'permissiongranted',
  'approvalapproved',
  'approvalgranted',
]);

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEventToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function claudeStatusHintFromNotificationType(
  notificationType: string,
): 'running' | 'needs-input' | null {
  const token = normalizeEventToken(notificationType);
  if (token.length === 0) {
    return null;
  }
  if (CLAUDE_NEEDS_INPUT_NOTIFICATION_TYPES.has(token)) {
    return 'needs-input';
  }
  if (CLAUDE_RUNNING_NOTIFICATION_TYPES.has(token)) {
    return 'running';
  }
  return null;
}

function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function compareIsoDesc(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right.localeCompare(left);
}

function createSessionRollingCounter(nowMs = Date.now()): SessionRollingCounter {
  const roundedStartMs = Math.floor(nowMs / SESSION_DIAGNOSTICS_BUCKET_MS) * SESSION_DIAGNOSTICS_BUCKET_MS;
  return {
    buckets: [0, 0, 0, 0, 0, 0],
    currentBucketStartMs: roundedStartMs,
  };
}

function advanceSessionRollingCounter(counter: SessionRollingCounter, nowMs: number): void {
  const roundedNowMs = Math.floor(nowMs / SESSION_DIAGNOSTICS_BUCKET_MS) * SESSION_DIAGNOSTICS_BUCKET_MS;
  const elapsedBuckets = Math.floor((roundedNowMs - counter.currentBucketStartMs) / SESSION_DIAGNOSTICS_BUCKET_MS);
  if (elapsedBuckets <= 0) {
    return;
  }
  if (elapsedBuckets >= SESSION_DIAGNOSTICS_BUCKET_COUNT) {
    counter.buckets = [0, 0, 0, 0, 0, 0];
    counter.currentBucketStartMs = roundedNowMs;
    return;
  }
  for (let idx = SESSION_DIAGNOSTICS_BUCKET_COUNT - 1; idx >= 0; idx -= 1) {
    const fromIndex = idx - elapsedBuckets;
    counter.buckets[idx] = fromIndex >= 0 ? (counter.buckets[fromIndex] ?? 0) : 0;
  }
  counter.currentBucketStartMs = roundedNowMs;
}

function incrementSessionRollingCounter(counter: SessionRollingCounter, nowMs: number): void {
  advanceSessionRollingCounter(counter, nowMs);
  counter.buckets[0] += 1;
}

function sessionRollingCounterTotal(counter: SessionRollingCounter, nowMs: number): number {
  advanceSessionRollingCounter(counter, nowMs);
  return counter.buckets.reduce((total, value) => total + value, 0);
}

function createSessionDiagnostics(nowMs = Date.now()): SessionDiagnostics {
  return {
    telemetryIngestedTotal: 0,
    telemetryRetainedTotal: 0,
    telemetryDroppedTotal: 0,
    telemetryIngestRate: createSessionRollingCounter(nowMs),
    fanoutEventsEnqueuedTotal: 0,
    fanoutBytesEnqueuedTotal: 0,
    fanoutBackpressureSignalsTotal: 0,
    fanoutBackpressureDisconnectsTotal: 0,
  };
}

function sessionPriority(status: StreamSessionRuntimeStatus): number {
  if (status === 'needs-input') {
    return 0;
  }
  if (status === 'running') {
    return 1;
  }
  if (status === 'completed') {
    return 2;
  }
  return 3;
}

function normalizeCodexTelemetryConfig(
  input: CodexTelemetryServerConfig | undefined,
): CodexTelemetryServerConfig {
  return {
    enabled: input?.enabled ?? false,
    host: input?.host ?? '127.0.0.1',
    port: input?.port ?? 0,
    logUserPrompt: input?.logUserPrompt ?? true,
    captureLogs: input?.captureLogs ?? true,
    captureMetrics: input?.captureMetrics ?? true,
    captureTraces: input?.captureTraces ?? true,
    captureVerboseEvents: input?.captureVerboseEvents ?? false,
    ingestMode: input?.ingestMode ?? 'lifecycle-fast',
  };
}

function isLifecycleTelemetryEventName(eventName: string | null): boolean {
  const normalized = eventName?.trim().toLowerCase() ?? '';
  if (normalized.length === 0) {
    return false;
  }
  return LIFECYCLE_TELEMETRY_EVENT_NAMES.has(normalized);
}

function normalizeCodexHistoryConfig(
  input: CodexHistoryIngestConfig | undefined,
): CodexHistoryIngestConfig {
  return {
    enabled: input?.enabled ?? false,
    filePath: input?.filePath ?? '~/.codex/history.jsonl',
    pollMs: Math.max(25, input?.pollMs ?? 500),
  };
}

function normalizeCodexLaunchConfig(input: CodexLaunchConfig | undefined): CodexLaunchConfig {
  return {
    defaultMode: input?.defaultMode ?? 'standard',
    directoryModes: input?.directoryModes ?? {},
  };
}

function jitterDelayMs(baseMs: number): number {
  const clampedBaseMs = Math.max(25, Math.floor(baseMs));
  const jitterWindowMs = Math.max(1, Math.floor(clampedBaseMs * HISTORY_POLL_JITTER_RATIO));
  const jitterOffsetMs = Math.floor(
    Math.random() * (2 * jitterWindowMs + 1) - jitterWindowMs,
  );
  return Math.max(25, clampedBaseMs + jitterOffsetMs);
}

function normalizeGitStatusMonitorConfig(
  input: GitStatusMonitorConfig | undefined,
): GitStatusMonitorConfig {
  const pollMs = Math.max(100, input?.pollMs ?? DEFAULT_GIT_STATUS_POLL_MS);
  const rawMaxConcurrency = input?.maxConcurrency;
  const maxConcurrency =
    typeof rawMaxConcurrency === 'number' && Number.isFinite(rawMaxConcurrency)
      ? Math.max(1, Math.floor(rawMaxConcurrency))
      : 1;
  const rawMinDirectoryRefreshMs = input?.minDirectoryRefreshMs;
  const minDirectoryRefreshMs =
    typeof rawMinDirectoryRefreshMs === 'number' && Number.isFinite(rawMinDirectoryRefreshMs)
      ? Math.max(pollMs, Math.floor(rawMinDirectoryRefreshMs))
      : Math.max(pollMs, 30_000);
  return {
    enabled: input?.enabled ?? false,
    pollMs,
    maxConcurrency,
    minDirectoryRefreshMs,
  };
}

async function runWithConcurrencyLimit<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  if (values.length === 0) {
    return;
  }
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)));
  let index = 0;
  const runners: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    runners.push(
      (async () => {
        while (true) {
          const nextIndex = index;
          index += 1;
          if (nextIndex >= values.length) {
            return;
          }
          const value = values[nextIndex];
          if (value === undefined) {
            continue;
          }
          await worker(value);
        }
      })()
    );
  }
  await Promise.all(runners);
}

function parseOtlpEndpoint(urlPath: string): OtlpEndpointTarget | null {
  const [pathPart = ''] = urlPath.trim().split('?');
  const match = /^\/v1\/(logs|metrics|traces)\/([^/]+)$/u.exec(pathPart);
  if (match === null) {
    return null;
  }
  let decodedToken = '';
  try {
    decodedToken = decodeURIComponent(match[2] as string);
  } catch {
    return null;
  }
  return {
    kind: match[1] as 'logs' | 'metrics' | 'traces',
    token: decodedToken,
  };
}

function expandTildePath(pathValue: string): string {
  if (pathValue === '~') {
    return homedir();
  }
  if (pathValue.startsWith('~/')) {
    return resolve(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

function mapSessionEvent(event: CodexLiveEvent): StreamSessionEvent | null {
  if (event.type === 'notify') {
    return {
      type: 'notify',
      record: {
        ts: event.record.ts,
        payload: event.record.payload,
      },
    };
  }

  if (event.type === 'session-exit') {
    return {
      type: 'session-exit',
      exit: event.exit,
    };
  }

  return null;
}

function gitSummaryEqual(
  left: GitDirectorySnapshot['summary'],
  right: GitDirectorySnapshot['summary'],
): boolean {
  return (
    left.branch === right.branch &&
    left.changedFiles === right.changedFiles &&
    left.additions === right.additions &&
    left.deletions === right.deletions
  );
}

function gitRepositorySnapshotEqual(
  left: GitDirectorySnapshot['repository'],
  right: GitDirectorySnapshot['repository'],
): boolean {
  return (
    left.normalizedRemoteUrl === right.normalizedRemoteUrl &&
    left.commitCount === right.commitCount &&
    left.lastCommitAt === right.lastCommitAt &&
    left.shortCommitHash === right.shortCommitHash &&
    left.inferredName === right.inferredName &&
    left.defaultBranch === right.defaultBranch
  );
}

const streamServerInternals = {
  runWithConcurrencyLimit,
  gitSummaryEqual,
  gitRepositorySnapshotEqual,
};
export const streamServerTestInternals = streamServerInternals;

function toPublicSessionController(
  controller: SessionControllerState | null | undefined,
): StreamSessionController | null {
  if (controller === null || controller === undefined) {
    return null;
  }
  return {
    controllerId: controller.controllerId,
    controllerType: controller.controllerType,
    controllerLabel: controller.controllerLabel,
    claimedAt: controller.claimedAt,
  };
}

function controllerDisplayName(controller: SessionControllerState): string {
  const label = controller.controllerLabel?.trim() ?? '';
  if (label.length > 0) {
    return label;
  }
  return `${controller.controllerType}:${controller.controllerId}`;
}

function shellQuoteToken(token: string): string {
  if (token.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(token)) {
    return token;
  }
  return `'${token.replaceAll("'", "'\"'\"'")}'`;
}

function formatLaunchCommand(command: string, args: readonly string[]): string {
  const tokens = [command, ...args].map(shellQuoteToken);
  return tokens.join(' ');
}

export function resolveTerminalCommandForEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  const shellCommand = env.SHELL?.trim();
  if (shellCommand !== undefined && shellCommand.length > 0) {
    return shellCommand;
  }
  const windowsCommand = env.ComSpec?.trim();
  if (windowsCommand !== undefined && windowsCommand.length > 0) {
    return windowsCommand;
  }
  return platform === 'win32' ? 'cmd.exe' : 'sh';
}

export class ControlPlaneStreamServer {
  private readonly host: string;
  private readonly port: number;
  private readonly authToken: string | null;
  private readonly maxConnectionBufferedBytes: number;
  private readonly sessionExitTombstoneTtlMs: number;
  private readonly maxStreamJournalEntries: number;
  private readonly startSession: StartControlPlaneSession;
  private readonly stateStore: SqliteControlPlaneStore;
  private readonly ownsStateStore: boolean;
  private readonly codexTelemetry: CodexTelemetryServerConfig;
  private readonly codexHistory: CodexHistoryIngestConfig;
  private readonly codexLaunch: CodexLaunchConfig;
  private readonly gitStatusMonitor: GitStatusMonitorConfig;
  private readonly readGitDirectorySnapshot: GitDirectorySnapshotReader;
  private readonly server: Server;
  private readonly telemetryServer: HttpServer | null;
  private telemetryAddress: AddressInfo | null = null;
  private readonly telemetryTokenToSessionId = new Map<string, string>();
  private readonly lifecycleHooks: LifecycleHooksRuntime;
  private historyPollTimer: NodeJS.Timeout | null = null;
  private historyPollInFlight = false;
  private historyIdleStreak = 0;
  private historyNextAllowedPollAtMs = 0;
  private historyOffset = 0;
  private historyRemainder = '';
  private gitStatusPollTimer: NodeJS.Timeout | null = null;
  private gitStatusPollInFlight = false;
  private readonly gitStatusRefreshInFlightDirectoryIds = new Set<string>();
  private readonly gitStatusByDirectoryId = new Map<string, DirectoryGitStatusCacheEntry>();
  private readonly gitStatusDirectoriesById = new Map<string, ControlPlaneDirectoryRecord>();
  private readonly connections = new Map<string, ConnectionState>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly launchCommandBySessionId = new Map<string, string>();
  private readonly streamSubscriptions = new Map<string, StreamSubscriptionState>();
  private readonly streamJournal: StreamJournalEntry[] = [];
  private streamCursor = 0;
  private listening = false;
  private stateStoreClosed = false;

  constructor(options: StartControlPlaneStreamServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.authToken = options.authToken ?? null;
    this.maxConnectionBufferedBytes =
      options.maxConnectionBufferedBytes ?? DEFAULT_MAX_CONNECTION_BUFFERED_BYTES;
    this.sessionExitTombstoneTtlMs =
      options.sessionExitTombstoneTtlMs ?? DEFAULT_SESSION_EXIT_TOMBSTONE_TTL_MS;
    this.maxStreamJournalEntries =
      options.maxStreamJournalEntries ?? DEFAULT_MAX_STREAM_JOURNAL_ENTRIES;
    if (options.startSession === undefined) {
      throw new Error('startSession is required');
    }
    this.startSession = options.startSession;
    if (options.stateStore !== undefined) {
      this.stateStore = options.stateStore;
      this.ownsStateStore = false;
    } else {
      this.stateStore = new SqliteControlPlaneStore(options.stateStorePath ?? ':memory:');
      this.ownsStateStore = true;
    }
    this.codexTelemetry = normalizeCodexTelemetryConfig(options.codexTelemetry);
    this.codexHistory = normalizeCodexHistoryConfig(options.codexHistory);
    this.codexLaunch = normalizeCodexLaunchConfig(options.codexLaunch);
    this.gitStatusMonitor = normalizeGitStatusMonitorConfig(options.gitStatus);
    this.readGitDirectorySnapshot =
      options.readGitDirectorySnapshot ??
      (async (cwd: string) =>
        await readGitDirectorySnapshot(cwd, undefined, {
          includeCommitCount: false
        }));
    this.lifecycleHooks = new LifecycleHooksRuntime(
      options.lifecycleHooks ?? {
        enabled: false,
        providers: {
          codex: true,
          claude: true,
          controlPlane: true,
        },
        peonPing: {
          enabled: false,
          baseUrl: 'http://127.0.0.1:19998',
          timeoutMs: 1200,
          eventCategoryMap: {},
        },
        webhooks: [],
      },
    );
    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });
    this.telemetryServer = this.codexTelemetry.enabled
      ? createHttpServer((request, response) => {
          this.handleTelemetryHttpRequest(request, response);
        })
      : null;
  }

  async start(): Promise<void> {
    if (this.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off('error', onError);
        this.listening = true;
        resolve();
      };

      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.port, this.host);
    });

    if (this.telemetryServer !== null) {
      await this.startTelemetryServer();
    }
    this.autoStartPersistedConversationsOnStartup();
    this.startHistoryPollingIfEnabled();
    this.startGitStatusPollingIfEnabled();
  }

  address(): AddressInfo {
    const value = this.server.address();
    if (value === null || typeof value === 'string') {
      throw new Error('control-plane server is not listening on tcp');
    }
    return value;
  }

  telemetryAddressInfo(): AddressInfo | null {
    if (this.telemetryAddress === null) {
      return null;
    }
    return {
      address: this.telemetryAddress.address,
      family: this.telemetryAddress.family,
      port: this.telemetryAddress.port,
    };
  }

  async close(): Promise<void> {
    this.stopHistoryPolling();
    this.stopGitStatusPolling();

    for (const sessionId of [...this.sessions.keys()]) {
      this.destroySession(sessionId, true);
    }

    for (const connection of this.connections.values()) {
      connection.socket.destroy();
    }
    this.connections.clear();
    this.streamSubscriptions.clear();
    this.streamJournal.length = 0;

    if (!this.listening) {
      await this.closeTelemetryServerIfOpen();
      this.closeOwnedStateStore();
      return;
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => {
        this.listening = false;
        resolve();
      });
    });
    await this.closeTelemetryServerIfOpen();
    await this.lifecycleHooks.close();
    this.closeOwnedStateStore();
  }

  private closeOwnedStateStore(): void {
    if (!this.ownsStateStore || this.stateStoreClosed) {
      return;
    }
    this.stateStore.close();
    this.stateStoreClosed = true;
  }

  private async startTelemetryServer(): Promise<void> {
    if (this.telemetryServer === null || this.telemetryAddress !== null) {
      return;
    }
    await new Promise<void>((resolveStart, rejectStart) => {
      const onError = (error: Error): void => {
        this.telemetryServer?.off('listening', onListening);
        rejectStart(error);
      };
      const onListening = (): void => {
        this.telemetryServer?.off('error', onError);
        const telemetryServer = this.telemetryServer;
        this.telemetryAddress = telemetryServer!.address() as AddressInfo;
        resolveStart();
      };
      this.telemetryServer?.once('error', onError);
      this.telemetryServer?.once('listening', onListening);
      this.telemetryServer?.listen(this.codexTelemetry.port, this.codexTelemetry.host);
    });
  }

  private async closeTelemetryServerIfOpen(): Promise<void> {
    if (this.telemetryServer === null) {
      return;
    }
    const telemetryServer = this.telemetryServer;
    await new Promise<void>((resolveClose) => {
      if (!telemetryServer.listening) {
        this.telemetryAddress = null;
        resolveClose();
        return;
      }
      telemetryServer.close(() => {
        this.telemetryAddress = null;
        resolveClose();
      });
    });
  }

  private startHistoryPollingIfEnabled(): void {
    if (!this.codexHistory.enabled || this.historyPollTimer !== null) {
      return;
    }
    this.historyIdleStreak = 0;
    this.historyNextAllowedPollAtMs = Date.now() + jitterDelayMs(this.codexHistory.pollMs);
    const pollTickMs = Math.max(250, Math.floor(this.codexHistory.pollMs / 4));
    this.historyPollTimer = setInterval(this.pollHistoryTimerTick.bind(this), pollTickMs);
    this.historyPollTimer.unref();
  }

  private pollHistoryTimerTick(): void {
    void this.pollHistoryFile();
  }

  private stopHistoryPolling(): void {
    if (this.historyPollTimer === null) {
      return;
    }
    clearInterval(this.historyPollTimer);
    this.historyPollTimer = null;
    this.historyIdleStreak = 0;
    this.historyNextAllowedPollAtMs = 0;
  }

  private startGitStatusPollingIfEnabled(): void {
    if (!this.gitStatusMonitor.enabled || this.gitStatusPollTimer !== null) {
      return;
    }
    this.reloadGitStatusDirectoriesFromStore();
    void this.pollGitStatus();
    this.gitStatusPollTimer = setInterval(() => {
      void this.pollGitStatus();
    }, this.gitStatusMonitor.pollMs);
    this.gitStatusPollTimer.unref();
  }

  private stopGitStatusPolling(): void {
    if (this.gitStatusPollTimer === null) {
      return;
    }
    clearInterval(this.gitStatusPollTimer);
    this.gitStatusPollTimer = null;
  }

  private reloadGitStatusDirectoriesFromStore(): void {
    const directories = this.stateStore.listDirectories({
      includeArchived: false,
      limit: 1000,
    });
    this.gitStatusDirectoriesById.clear();
    for (const directory of directories) {
      this.gitStatusDirectoriesById.set(directory.directoryId, directory);
    }
    for (const directoryId of this.gitStatusByDirectoryId.keys()) {
      if (!this.gitStatusDirectoriesById.has(directoryId)) {
        this.gitStatusByDirectoryId.delete(directoryId);
      }
    }
  }

  private codexLaunchArgsForSession(sessionId: string, agentType: string): readonly string[] {
    if (agentType !== 'codex') {
      return [];
    }
    const endpointBaseUrl = this.telemetryEndpointBaseUrl();
    if (endpointBaseUrl === null) {
      if (!this.codexHistory.enabled) {
        return [];
      }
      return ['-c', 'history.persistence="save-all"'];
    }
    const token = randomUUID();
    this.telemetryTokenToSessionId.set(token, sessionId);
    return buildCodexTelemetryConfigArgs({
      endpointBaseUrl,
      token,
      logUserPrompt: this.codexTelemetry.logUserPrompt,
      captureLogs: this.codexTelemetry.captureLogs,
      captureMetrics: this.codexTelemetry.captureMetrics,
      captureTraces: this.codexTelemetry.captureTraces,
      historyPersistence: this.codexHistory.enabled ? 'save-all' : 'none',
    });
  }

  private claudeHookLaunchConfigForSession(
    sessionId: string,
    agentType: string
  ): {
    readonly args: readonly string[];
    readonly notifyFilePath: string;
  } | null {
    if (agentType !== 'claude') {
      return null;
    }
    const notifyFilePath = join(tmpdir(), `harness-claude-hook-${process.pid}-${sessionId}-${randomUUID()}.jsonl`);
    const relayScriptPath = resolve(DEFAULT_CLAUDE_HOOK_RELAY_SCRIPT_PATH);
    const hookCommand = `/usr/bin/env ${shellEscape(process.execPath)} ${shellEscape(relayScriptPath)} ${shellEscape(notifyFilePath)}`;
    const hook = {
      type: 'command',
      command: hookCommand
    };
    const settings = {
      hooks: {
        UserPromptSubmit: [{ hooks: [hook] }],
        PreToolUse: [{ hooks: [hook] }],
        Stop: [{ hooks: [hook] }],
        Notification: [{ hooks: [hook] }]
      }
    };
    return {
      args: ['--settings', JSON.stringify(settings)],
      notifyFilePath
    };
  }

  private resolveTerminalCommand(): string {
    return resolveTerminalCommandForEnvironment(process.env, process.platform);
  }

  private launchProfileForAgent(agentType: string): {
    readonly command?: string;
    readonly baseArgs?: readonly string[];
  } {
    if (agentType === 'claude') {
      return {
        command: 'claude',
        baseArgs: []
      };
    }
    if (agentType !== 'terminal') {
      return {};
    }
    return {
      command: this.resolveTerminalCommand(),
      baseArgs: [],
    };
  }

  private autoStartPersistedConversationsOnStartup(): void {
    const conversations = this.stateStore.listConversations();
    let started = 0;
    let failed = 0;
    for (const conversation of conversations) {
      const adapterState = normalizeAdapterState(conversation.adapterState);
      const directory = this.stateStore.getDirectory(conversation.directoryId);
      const startArgs = buildAgentSessionStartArgs(conversation.agentType, [], adapterState, {
        directoryPath: directory?.path ?? null,
        codexLaunchDefaultMode: this.codexLaunch.defaultMode,
        codexLaunchModeByDirectoryPath: this.codexLaunch.directoryModes,
      });
      try {
        const bootstrapInput: StartSessionRuntimeInput = {
          sessionId: conversation.conversationId,
          args: startArgs,
          initialCols: DEFAULT_BOOTSTRAP_SESSION_COLS,
          initialRows: DEFAULT_BOOTSTRAP_SESSION_ROWS,
          tenantId: conversation.tenantId,
          userId: conversation.userId,
          workspaceId: conversation.workspaceId,
          worktreeId: DEFAULT_WORKTREE_ID,
          ...(directory?.path !== undefined ? { cwd: directory.path } : {}),
        };
        this.startSessionRuntime(bootstrapInput);
        started += 1;
      } catch {
        failed += 1;
      }
    }
    recordPerfEvent('control-plane.startup.sessions-auto-start', {
      conversations: conversations.length,
      started,
      failed,
    });
  }

  private startSessionRuntime(command: StartSessionRuntimeInput): void {
    const existing = this.sessions.get(command.sessionId);
    if (existing !== undefined) {
      if (existing.status === 'exited' && existing.session === null) {
        this.destroySession(command.sessionId, false);
      } else {
        throw new Error(`session already exists: ${command.sessionId}`);
      }
    }

    const persistedConversation = this.stateStore.getConversation(command.sessionId);
    const agentType = persistedConversation?.agentType ?? 'codex';
    const codexLaunchArgs = this.codexLaunchArgsForSession(command.sessionId, agentType);
    const claudeHookLaunchConfig = this.claudeHookLaunchConfigForSession(command.sessionId, agentType);
    const launchProfile = this.launchProfileForAgent(agentType);
    const launchCommand = formatLaunchCommand(
      launchProfile.command ?? 'codex',
      command.args,
    );
    const startInput: StartControlPlaneSessionInput = {
      args: [...codexLaunchArgs, ...(claudeHookLaunchConfig?.args ?? []), ...command.args],
      initialCols: command.initialCols,
      initialRows: command.initialRows,
    };
    if (agentType === 'codex' || agentType === 'claude') {
      startInput.useNotifyHook = true;
      startInput.notifyMode = (agentType === 'claude' ? 'external' : 'codex') as LiveSessionNotifyMode;
    }
    if (claudeHookLaunchConfig !== null) {
      startInput.notifyFilePath = claudeHookLaunchConfig.notifyFilePath;
    }
    if (launchProfile.command !== undefined) {
      startInput.command = launchProfile.command;
    }
    if (launchProfile.baseArgs !== undefined) {
      startInput.baseArgs = [...launchProfile.baseArgs];
    }
    if (command.env !== undefined) {
      startInput.env = command.env;
    }
    if (command.cwd !== undefined) {
      startInput.cwd = command.cwd;
    }
    if (command.terminalForegroundHex !== undefined) {
      startInput.terminalForegroundHex = command.terminalForegroundHex;
    }
    if (command.terminalBackgroundHex !== undefined) {
      startInput.terminalBackgroundHex = command.terminalBackgroundHex;
    }

    const session = this.startSession(startInput);
    this.launchCommandBySessionId.set(command.sessionId, launchCommand);

    const unsubscribe = session.onEvent((event) => {
      this.handleSessionEvent(command.sessionId, event);
    });

    const persistedRuntimeStatus = persistedConversation?.runtimeStatus;
    const persistedRuntimeLastEventAt = persistedConversation?.runtimeLastEventAt ?? null;
    const initialStatus: StreamSessionRuntimeStatus =
      persistedRuntimeStatus === undefined ||
      persistedRuntimeStatus === 'running' ||
      persistedRuntimeStatus === 'exited' ||
      (persistedRuntimeStatus === 'completed' && persistedRuntimeLastEventAt === null)
        ? 'running'
        : persistedRuntimeStatus;
    const initialAttentionReason =
      initialStatus === 'needs-input'
        ? (persistedConversation?.runtimeAttentionReason ?? null)
        : null;
    this.sessions.set(command.sessionId, {
      id: command.sessionId,
      directoryId: persistedConversation?.directoryId ?? null,
      agentType,
      adapterState: normalizeAdapterState(persistedConversation?.adapterState ?? {}),
      tenantId: persistedConversation?.tenantId ?? command.tenantId ?? DEFAULT_TENANT_ID,
      userId: persistedConversation?.userId ?? command.userId ?? DEFAULT_USER_ID,
      workspaceId:
        persistedConversation?.workspaceId ?? command.workspaceId ?? DEFAULT_WORKSPACE_ID,
      worktreeId: command.worktreeId ?? DEFAULT_WORKTREE_ID,
      session,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe,
      status: initialStatus,
      attentionReason: initialAttentionReason,
      lastEventAt: persistedConversation?.runtimeLastEventAt ?? null,
      lastExit: persistedConversation?.runtimeLastExit ?? null,
      lastSnapshot: null,
      startedAt: new Date().toISOString(),
      exitedAt: null,
      tombstoneTimer: null,
      lastObservedOutputCursor: session.latestCursorValue(),
      latestTelemetry: this.stateStore.latestTelemetrySummary(command.sessionId),
      controller: null,
      diagnostics: createSessionDiagnostics(),
    });

    const state = this.sessions.get(command.sessionId);
    if (state !== undefined) {
      this.persistConversationRuntime(state);
      this.publishStatusObservedEvent(state);
    }
  }

  private telemetryEndpointBaseUrl(): string | null {
    if (this.telemetryAddress === null) {
      return null;
    }
    const host =
      this.telemetryAddress.family === 'IPv6'
        ? `[${this.telemetryAddress.address}]`
        : this.telemetryAddress.address;
    return `http://${host}:${String(this.telemetryAddress.port)}`;
  }

  private handleTelemetryHttpRequest(request: IncomingMessage, response: ServerResponse): void {
    void this.handleTelemetryHttpRequestAsync(request, response).catch((error: unknown) => {
      if (isTelemetryRequestAbortError(error)) {
        return;
      }
      if (response.writableEnded) {
        return;
      }
      response.statusCode = 500;
      response.end();
    });
  }

  private async handleTelemetryHttpRequestAsync(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.end();
      return;
    }
    const target = parseOtlpEndpoint(request.url ?? '');
    if (target === null) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const sessionId = this.telemetryTokenToSessionId.get(target.token);
    if (sessionId === undefined) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const bodyText = await this.readHttpBody(request);

    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }

    this.ingestOtlpPayload(target.kind, sessionId, payload);
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end('{"partialSuccess":{}}');
  }

  private async readHttpBody(request: IncomingMessage): Promise<string> {
    const chunks: Uint8Array[] = [];
    for await (const rawChunk of request) {
      const chunk = rawChunk as Uint8Array;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private ingestOtlpPayload(
    kind: 'logs' | 'metrics' | 'traces',
    sessionId: string,
    payload: unknown,
  ): void {
    const now = new Date().toISOString();
    const useLifecycleFastPath =
      this.codexTelemetry.captureVerboseEvents !== true &&
      this.codexTelemetry.ingestMode === 'lifecycle-fast';
    const parsed =
      kind === 'logs'
        ? useLifecycleFastPath
          ? parseOtlpLifecycleLogEvents(payload, now)
          : parseOtlpLogEvents(payload, now)
        : kind === 'metrics'
          ? useLifecycleFastPath
            ? parseOtlpLifecycleMetricEvents(payload, now)
            : parseOtlpMetricEvents(payload, now)
          : useLifecycleFastPath
            ? parseOtlpLifecycleTraceEvents(payload, now)
            : parseOtlpTraceEvents(payload, now);
    if (parsed.length === 0) {
      const sourceByKind: Record<
        'logs' | 'metrics' | 'traces',
        'otlp-log' | 'otlp-metric' | 'otlp-trace'
      > = {
        logs: 'otlp-log',
        metrics: 'otlp-metric',
        traces: 'otlp-trace',
      };
      const source = sourceByKind[kind];
      this.ingestParsedTelemetryEvent(sessionId, {
        source,
        observedAt: now,
        eventName: null,
        severity: null,
        summary: `${source} batch`,
        providerThreadId: null,
        statusHint: null,
        payload: {
          batch: payload,
        },
      });
      return;
    }
    for (const entry of parsed) {
      this.ingestParsedTelemetryEvent(sessionId, entry);
    }
  }

  private ingestParsedTelemetryEvent(
    fallbackSessionId: string | null,
    event: ParsedCodexTelemetryEvent,
  ): void {
    const resolvedSessionId =
      fallbackSessionId ??
      (event.providerThreadId === null
        ? null
        : this.resolveSessionIdByThreadId(event.providerThreadId));
    const captureVerboseEvents = this.codexTelemetry.captureVerboseEvents === true;
    const shouldRetainHighSignalEvent =
      isLifecycleTelemetryEventName(event.eventName) || event.statusHint !== null;
    if (!captureVerboseEvents && !shouldRetainHighSignalEvent) {
      if (resolvedSessionId !== null) {
        this.noteTelemetryIngest(resolvedSessionId, 'dropped', event.observedAt);
      }
      if (resolvedSessionId !== null && event.providerThreadId !== null) {
        const sessionState = this.sessions.get(resolvedSessionId);
        if (sessionState !== undefined) {
          this.updateSessionThreadId(sessionState, event.providerThreadId, event.observedAt);
        }
      }
      return;
    }
    const fingerprint = telemetryFingerprint({
      source: event.source,
      sessionId: resolvedSessionId,
      providerThreadId: event.providerThreadId,
      eventName: event.eventName,
      observedAt: event.observedAt,
      payload: event.payload,
    });

    const inserted = this.stateStore.appendTelemetry({
      source: event.source,
      sessionId: resolvedSessionId,
      providerThreadId: event.providerThreadId,
      eventName: event.eventName,
      severity: event.severity,
      summary: event.summary,
      observedAt: event.observedAt,
      payload: event.payload,
      fingerprint,
    });
    if (resolvedSessionId !== null) {
      this.noteTelemetryIngest(
        resolvedSessionId,
        inserted ? 'retained' : 'dropped',
        event.observedAt,
      );
    }
    if (!inserted || resolvedSessionId === null) {
      return;
    }

    const sessionState = this.sessions.get(resolvedSessionId);
    if (sessionState !== undefined) {
      sessionState.latestTelemetry = this.stateStore.latestTelemetrySummary(resolvedSessionId);
      if (event.providerThreadId !== null) {
        this.updateSessionThreadId(sessionState, event.providerThreadId, event.observedAt);
      }
      let statusPublished = false;
      const shouldApplyStatusHint =
        event.statusHint !== null &&
        event.source !== 'history' &&
        sessionState.status !== 'exited' &&
        sessionState.session !== null;
      if (shouldApplyStatusHint) {
        if (event.statusHint === 'needs-input') {
          this.setSessionStatus(sessionState, 'needs-input', null, event.observedAt);
        } else {
          this.setSessionStatus(sessionState, event.statusHint, null, event.observedAt);
        }
        statusPublished = true;
      }
      if (!statusPublished) {
        this.publishStatusObservedEvent(sessionState);
      }
    }

    const observedScope = this.observedScopeForSessionId(resolvedSessionId);
    if (observedScope !== null) {
      this.publishObservedEvent(observedScope, {
        type: 'session-key-event',
        sessionId: resolvedSessionId,
        keyEvent: {
          source: event.source,
          eventName: event.eventName,
          severity: event.severity,
          summary: event.summary,
          observedAt: event.observedAt,
          statusHint: event.statusHint,
        },
        ts: new Date().toISOString(),
        directoryId: observedScope.directoryId,
        conversationId: observedScope.conversationId,
      });
    }
  }

  private observedScopeForSessionId(sessionId: string): StreamObservedScope | null {
    const liveState = this.sessions.get(sessionId);
    if (liveState !== undefined) {
      return this.sessionScope(liveState);
    }
    const persisted = this.stateStore.getConversation(sessionId);
    if (persisted === null || persisted.archivedAt !== null) {
      return null;
    }
    return {
      tenantId: persisted.tenantId,
      userId: persisted.userId,
      workspaceId: persisted.workspaceId,
      directoryId: persisted.directoryId,
      conversationId: persisted.conversationId,
    };
  }

  private updateSessionThreadId(state: SessionState, threadId: string, observedAt: string): void {
    if (state.agentType !== 'codex') {
      return;
    }
    const currentThreadId = codexResumeSessionIdFromAdapterState(state.adapterState);
    if (currentThreadId === threadId) {
      return;
    }
    const currentCodex =
      typeof state.adapterState['codex'] === 'object' &&
      state.adapterState['codex'] !== null &&
      !Array.isArray(state.adapterState['codex'])
        ? (state.adapterState['codex'] as Record<string, unknown>)
        : {};
    state.adapterState = {
      ...state.adapterState,
      codex: {
        ...currentCodex,
        resumeSessionId: threadId,
        lastObservedAt: observedAt,
      },
    };
    this.stateStore.updateConversationAdapterState(state.id, state.adapterState);
  }

  private resolveSessionIdByThreadId(threadId: string): string | null {
    const normalized = threadId.trim();
    if (normalized.length === 0) {
      return null;
    }
    for (const state of this.sessions.values()) {
      const stateThreadId = codexResumeSessionIdFromAdapterState(state.adapterState);
      if (stateThreadId === normalized) {
        return state.id;
      }
    }
    return this.stateStore.findConversationIdByCodexThreadId(normalized);
  }

  private async pollHistoryFile(): Promise<void> {
    const nowMs = Date.now();
    if (nowMs < this.historyNextAllowedPollAtMs) {
      return;
    }
    if (this.historyPollInFlight) {
      return;
    }
    this.historyPollInFlight = true;
    try {
      const consumedNewBytes = await this.pollHistoryFileUnsafe();
      if (consumedNewBytes) {
        this.historyIdleStreak = 0;
        this.historyNextAllowedPollAtMs = Date.now() + jitterDelayMs(this.codexHistory.pollMs);
      } else {
        this.historyIdleStreak = Math.min(this.historyIdleStreak + 1, 4);
        const backoffMs = Math.min(HISTORY_POLL_MAX_DELAY_MS, this.codexHistory.pollMs * (1 << this.historyIdleStreak));
        this.historyNextAllowedPollAtMs = Date.now() + jitterDelayMs(backoffMs);
      }
    } catch {
      // History ingestion is best-effort and should never crash the control-plane runtime.
      this.historyIdleStreak = Math.min(this.historyIdleStreak + 1, 4);
      const backoffMs = Math.min(HISTORY_POLL_MAX_DELAY_MS, this.codexHistory.pollMs * (1 << this.historyIdleStreak));
      this.historyNextAllowedPollAtMs = Date.now() + jitterDelayMs(backoffMs);
    } finally {
      this.historyPollInFlight = false;
    }
  }

  private async pollHistoryFileUnsafe(): Promise<boolean> {
    if (!this.codexHistory.enabled) {
      return false;
    }
    const resolvedHistoryPath = expandTildePath(this.codexHistory.filePath);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(resolvedHistoryPath, 'r');
    } catch (error) {
      const errorWithCode = error as { code?: unknown };
      if (errorWithCode.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
    let delta = '';
    let fileTruncated = false;
    try {
      const stats = await handle.stat();
      const fileSize = Number(stats.size);
      if (!Number.isFinite(fileSize)) {
        return false;
      }
      if (fileSize < this.historyOffset) {
        fileTruncated = true;
        this.historyOffset = 0;
        this.historyRemainder = '';
      }
      if (
        !fileTruncated &&
        this.historyOffset > 0 &&
        this.historyRemainder.length === 0 &&
        fileSize >= this.historyOffset
      ) {
        // Detect in-place rewrites where truncation and rewrite both happen between polls.
        const probe = Buffer.allocUnsafe(1);
        const { bytesRead: probeBytesRead } = await handle.read(probe, 0, 1, this.historyOffset - 1);
        const historyBoundaryMatches = probeBytesRead === 1 && probe[0] === LINE_FEED_BYTE;
        if (!historyBoundaryMatches) {
          fileTruncated = true;
          this.historyOffset = 0;
          this.historyRemainder = '';
        }
      }
      const remainingBytes = fileSize - this.historyOffset;
      if (remainingBytes <= 0) {
        return fileTruncated;
      }
      const buffer = Buffer.allocUnsafe(remainingBytes);
      let bytesReadTotal = 0;
      while (bytesReadTotal < remainingBytes) {
        const { bytesRead } = await handle.read(
          buffer,
          bytesReadTotal,
          remainingBytes - bytesReadTotal,
          this.historyOffset + bytesReadTotal,
        );
        if (bytesRead <= 0) {
          break;
        }
        bytesReadTotal += bytesRead;
      }
      if (bytesReadTotal <= 0) {
        return fileTruncated;
      }
      this.historyOffset += bytesReadTotal;
      delta = buffer.toString('utf8', 0, bytesReadTotal);
    } finally {
      await handle.close();
    }

    if (delta.length === 0) {
      return fileTruncated;
    }

    const buffered = `${this.historyRemainder}${delta}`;
    const lines = buffered.split('\n');
    this.historyRemainder = lines.pop() as string;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const parsed = parseCodexHistoryLine(trimmed, new Date().toISOString());
      if (parsed === null) {
        continue;
      }
      const sessionId =
        parsed.providerThreadId === null
          ? null
          : this.resolveSessionIdByThreadId(parsed.providerThreadId);
      this.ingestParsedTelemetryEvent(sessionId, parsed);
    }
    return true;
  }

  private async pollGitStatus(): Promise<void> {
    if (this.gitStatusPollInFlight) {
      return;
    }
    this.gitStatusPollInFlight = true;
    try {
      const directories = [...this.gitStatusDirectoriesById.values()];
      if (directories.length === 0) {
        return;
      }
      const nowMs = Date.now();
      const dueDirectories = directories.filter((directory) => {
        const previous = this.gitStatusByDirectoryId.get(directory.directoryId);
        if (previous === undefined) {
          return true;
        }
        const minRefreshWindowMs = Math.max(
          this.gitStatusMonitor.minDirectoryRefreshMs,
          Math.min(10 * 60 * 1000, Math.max(1000, previous.lastRefreshDurationMs * 4))
        );
        return nowMs - previous.lastRefreshedAtMs >= minRefreshWindowMs;
      });
      await runWithConcurrencyLimit(
        dueDirectories,
        this.gitStatusMonitor.maxConcurrency,
        async (directory) => await this.refreshGitStatusForDirectory(directory),
      );
    } finally {
      this.gitStatusPollInFlight = false;
    }
  }

  private async refreshGitStatusForDirectory(
    directory: ControlPlaneDirectoryRecord,
    options: {
      readonly forcePublish?: boolean;
    } = {}
  ): Promise<void> {
    if (this.gitStatusRefreshInFlightDirectoryIds.has(directory.directoryId)) {
      return;
    }
    this.gitStatusRefreshInFlightDirectoryIds.add(directory.directoryId);
    const gitSpan = startPerfSpan('control-plane.background.git-status', {
      directoryId: directory.directoryId,
    });
    const startedAtMs = Date.now();
    const previous = this.gitStatusByDirectoryId.get(directory.directoryId) ?? null;
    try {
      const snapshot = await this.readGitDirectorySnapshot(directory.path);
      let repositorySnapshot: GitDirectorySnapshot['repository'] = snapshot.repository;
      if (
        repositorySnapshot.commitCount === null &&
        previous !== null &&
        previous.repositorySnapshot.normalizedRemoteUrl === repositorySnapshot.normalizedRemoteUrl &&
        previous.repositorySnapshot.shortCommitHash === repositorySnapshot.shortCommitHash
      ) {
        repositorySnapshot = {
          ...repositorySnapshot,
          commitCount: previous.repositorySnapshot.commitCount
        };
      }
      let repositoryId: string | null = null;
      let repositoryRecord: Record<string, unknown> | null = null;
      if (repositorySnapshot.normalizedRemoteUrl !== null) {
        if (
          previous !== null &&
          previous.repositoryId !== null &&
          previous.repositorySnapshot.normalizedRemoteUrl === repositorySnapshot.normalizedRemoteUrl
        ) {
          repositoryId = previous.repositoryId;
        } else {
          const upserted = this.stateStore.upsertRepository({
            repositoryId: `repository-${randomUUID()}`,
            tenantId: directory.tenantId,
            userId: directory.userId,
            workspaceId: directory.workspaceId,
            name: repositorySnapshot.inferredName ?? 'repository',
            remoteUrl: repositorySnapshot.normalizedRemoteUrl,
            defaultBranch: repositorySnapshot.defaultBranch ?? 'main',
            metadata: {
              source: 'control-plane-git-status',
            },
          });
          repositoryId = upserted.repositoryId;
          repositoryRecord = this.repositoryRecord(upserted);
        }
      }
      const next: DirectoryGitStatusCacheEntry = {
        summary: snapshot.summary,
        repositorySnapshot,
        repositoryId,
        lastRefreshedAtMs: Date.now(),
        lastRefreshDurationMs: Math.max(1, Date.now() - startedAtMs),
      };
      this.gitStatusByDirectoryId.set(directory.directoryId, next);
      const changed =
        previous === null ||
        !gitSummaryEqual(previous.summary, next.summary) ||
        !gitRepositorySnapshotEqual(previous.repositorySnapshot, next.repositorySnapshot) ||
        previous.repositoryId !== next.repositoryId;
      const shouldPublish = changed || options.forcePublish === true;
      if (shouldPublish) {
        if (repositoryRecord === null && repositoryId !== null) {
          const existingRepository = this.stateStore.getRepository(repositoryId);
          if (existingRepository !== null) {
            repositoryRecord = this.repositoryRecord(existingRepository);
          }
        }
        this.publishObservedEvent(
          {
            tenantId: directory.tenantId,
            userId: directory.userId,
            workspaceId: directory.workspaceId,
            directoryId: directory.directoryId,
            conversationId: null,
          },
          {
            type: 'directory-git-updated',
            directoryId: directory.directoryId,
            summary: {
              branch: snapshot.summary.branch,
              changedFiles: snapshot.summary.changedFiles,
              additions: snapshot.summary.additions,
              deletions: snapshot.summary.deletions,
            },
            repositorySnapshot: {
              normalizedRemoteUrl: repositorySnapshot.normalizedRemoteUrl,
              commitCount: repositorySnapshot.commitCount,
              lastCommitAt: repositorySnapshot.lastCommitAt,
              shortCommitHash: repositorySnapshot.shortCommitHash,
              inferredName: repositorySnapshot.inferredName,
              defaultBranch: repositorySnapshot.defaultBranch,
            },
            repositoryId,
            repository: repositoryRecord,
            observedAt: new Date().toISOString(),
          },
        );
      }
      gitSpan.end({
        directoryId: directory.directoryId,
        changed,
        published: shouldPublish ? 1 : 0,
        forcePublished: options.forcePublish ? 1 : 0,
        repositoryLinked: repositoryId === null ? 0 : 1,
      });
    } catch {
      // Git status polling is best-effort and should not interrupt control-plane operations.
      if (previous !== null) {
        this.gitStatusByDirectoryId.set(directory.directoryId, {
          ...previous,
          lastRefreshedAtMs: Date.now(),
          lastRefreshDurationMs: Math.max(1, Date.now() - startedAtMs)
        });
      }
      gitSpan.end({
        directoryId: directory.directoryId,
        changed: false,
        failed: true,
      });
    } finally {
      this.gitStatusRefreshInFlightDirectoryIds.delete(directory.directoryId);
    }
  }

  private handleConnection(socket: Socket): void {
    const connectionId = `connection-${randomUUID()}`;
    const state: ConnectionState = {
      id: connectionId,
      socket,
      remainder: '',
      authenticated: this.authToken === null,
      attachedSessionIds: new Set<string>(),
      eventSessionIds: new Set<string>(),
      streamSubscriptionIds: new Set<string>(),
      queuedPayloads: [],
      queuedPayloadBytes: 0,
      writeBlocked: false,
    };

    this.connections.set(connectionId, state);
    recordPerfEvent('control-plane.server.connection.open', {
      role: 'server',
      connectionId,
      authRequired: this.authToken !== null,
    });

    socket.on('data', (chunk: Buffer) => {
      this.handleSocketData(state, chunk);
    });

    socket.on('drain', () => {
      state.writeBlocked = false;
      this.flushConnectionWrites(connectionId);
    });

    socket.on('error', () => {
      this.cleanupConnection(connectionId);
    });

    socket.on('close', () => {
      this.cleanupConnection(connectionId);
    });
  }

  private handleSocketData(connection: ConnectionState, chunk: Buffer): void {
    const combined = `${connection.remainder}${chunk.toString('utf8')}`;
    const consumed = consumeJsonLines(combined);
    connection.remainder = consumed.remainder;

    for (const message of consumed.messages) {
      const parsed = parseClientEnvelope(message);
      if (parsed === null) {
        continue;
      }
      this.handleClientEnvelope(connection, parsed);
    }
  }

  private handleClientEnvelope(connection: ConnectionState, envelope: StreamClientEnvelope): void {
    if (envelope.kind === 'auth') {
      this.handleAuth(connection, envelope.token);
      return;
    }

    if (!connection.authenticated) {
      this.sendToConnection(connection.id, {
        kind: 'auth.error',
        error: 'authentication required',
      });
      recordPerfEvent('control-plane.server.auth.required', {
        role: 'server',
        connectionId: connection.id,
      });
      connection.socket.destroy();
      return;
    }

    if (envelope.kind === 'command') {
      this.handleCommand(connection, envelope.commandId, envelope.command);
      return;
    }

    if (envelope.kind === 'pty.input') {
      this.handleInput(connection.id, envelope.sessionId, envelope.dataBase64);
      return;
    }

    if (envelope.kind === 'pty.resize') {
      this.handleResize(connection.id, envelope.sessionId, envelope.cols, envelope.rows);
      return;
    }

    this.handleSignal(connection.id, envelope.sessionId, envelope.signal);
  }

  private handleAuth(connection: ConnectionState, token: string): void {
    if (this.authToken === null) {
      connection.authenticated = true;
      this.sendToConnection(connection.id, {
        kind: 'auth.ok',
      });
      recordPerfEvent('control-plane.server.auth.ok', {
        role: 'server',
        connectionId: connection.id,
        authRequired: false,
      });
      return;
    }

    if (token !== this.authToken) {
      this.sendToConnection(connection.id, {
        kind: 'auth.error',
        error: 'invalid auth token',
      });
      recordPerfEvent('control-plane.server.auth.failed', {
        role: 'server',
        connectionId: connection.id,
      });
      connection.socket.destroy();
      return;
    }

    connection.authenticated = true;
    this.sendToConnection(connection.id, {
      kind: 'auth.ok',
    });
    recordPerfEvent('control-plane.server.auth.ok', {
      role: 'server',
      connectionId: connection.id,
      authRequired: true,
    });
  }

  private handleCommand(
    connection: ConnectionState,
    commandId: string,
    command: StreamCommand,
  ): void {
    this.sendToConnection(connection.id, {
      kind: 'command.accepted',
      commandId,
    });

    const commandSpan = startPerfSpan('control-plane.server.command', {
      role: 'server',
      type: command.type,
    });
    try {
      const result = this.executeCommand(connection, command);
      commandSpan.end({
        type: command.type,
        status: 'completed',
      });
      this.sendToConnection(connection.id, {
        kind: 'command.completed',
        commandId,
        result,
      });
    } catch (error) {
      commandSpan.end({
        type: command.type,
        status: 'failed',
        message: String(error),
      });
      this.sendToConnection(connection.id, {
        kind: 'command.failed',
        commandId,
        error: String(error),
      });
    }
  }

  private executeCommand(
    connection: ConnectionState,
    command: StreamCommand,
  ): Record<string, unknown> {
    if (command.type === 'directory.upsert') {
      const directory = this.stateStore.upsertDirectory({
        directoryId: command.directoryId ?? `directory-${randomUUID()}`,
        tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
        userId: command.userId ?? DEFAULT_USER_ID,
        workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
        path: command.path,
      });
      const record = this.directoryRecord(directory);
      this.gitStatusDirectoriesById.set(directory.directoryId, directory);
      this.publishObservedEvent(
        {
          tenantId: directory.tenantId,
          userId: directory.userId,
          workspaceId: directory.workspaceId,
          directoryId: directory.directoryId,
          conversationId: null,
        },
        {
          type: 'directory-upserted',
          directory: record,
        },
      );
      if (this.gitStatusMonitor.enabled) {
        void this.refreshGitStatusForDirectory(directory, {
          forcePublish: true
        });
      }
      return {
        directory: record,
      };
    }

    if (command.type === 'directory.list') {
      const query: {
        tenantId?: string;
        userId?: string;
        workspaceId?: string;
        includeArchived?: boolean;
        limit?: number;
      } = {};
      if (command.tenantId !== undefined) {
        query.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        query.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        query.workspaceId = command.workspaceId;
      }
      if (command.includeArchived !== undefined) {
        query.includeArchived = command.includeArchived;
      }
      if (command.limit !== undefined) {
        query.limit = command.limit;
      }
      const directories = this.stateStore
        .listDirectories(query)
        .map((directory) => this.directoryRecord(directory));
      return {
        directories,
      };
    }

    if (command.type === 'directory.archive') {
      const archived = this.stateStore.archiveDirectory(command.directoryId);
      const record = this.directoryRecord(archived);
      this.publishObservedEvent(
        {
          tenantId: archived.tenantId,
          userId: archived.userId,
          workspaceId: archived.workspaceId,
          directoryId: archived.directoryId,
          conversationId: null,
        },
        {
          type: 'directory-archived',
          directoryId: archived.directoryId,
          ts: archived.archivedAt as string,
        },
      );
      this.gitStatusByDirectoryId.delete(archived.directoryId);
      this.gitStatusDirectoriesById.delete(archived.directoryId);
      return {
        directory: record,
      };
    }

    if (command.type === 'directory.git-status') {
      const query: {
        tenantId?: string;
        userId?: string;
        workspaceId?: string;
        includeArchived: boolean;
        limit: number;
      } = {
        includeArchived: false,
        limit: 1000,
      };
      if (command.tenantId !== undefined) {
        query.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        query.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        query.workspaceId = command.workspaceId;
      }
      const listedDirectories = this.stateStore
        .listDirectories(query)
        .filter((directory) =>
          command.directoryId === undefined ? true : directory.directoryId === command.directoryId,
        );
      for (const directory of listedDirectories) {
        this.gitStatusDirectoriesById.set(directory.directoryId, directory);
      }
      const gitStatuses = listedDirectories.flatMap((directory) => {
        const cached = this.gitStatusByDirectoryId.get(directory.directoryId);
        if (cached === undefined) {
          return [];
        }
        const repositoryRecord =
          cached.repositoryId === null
            ? null
            : (() => {
                const repository = this.stateStore.getRepository(cached.repositoryId);
                if (repository === null || repository.archivedAt !== null) {
                  return null;
                }
                return this.repositoryRecord(repository);
              })();
        return [
          {
            directoryId: directory.directoryId,
            summary: {
              branch: cached.summary.branch,
              changedFiles: cached.summary.changedFiles,
              additions: cached.summary.additions,
              deletions: cached.summary.deletions,
            },
            repositorySnapshot: {
              normalizedRemoteUrl: cached.repositorySnapshot.normalizedRemoteUrl,
              commitCount: cached.repositorySnapshot.commitCount,
              lastCommitAt: cached.repositorySnapshot.lastCommitAt,
              shortCommitHash: cached.repositorySnapshot.shortCommitHash,
              inferredName: cached.repositorySnapshot.inferredName,
              defaultBranch: cached.repositorySnapshot.defaultBranch,
            },
            repositoryId: cached.repositoryId,
            repository: repositoryRecord,
            observedAt: new Date(cached.lastRefreshedAtMs).toISOString(),
          },
        ];
      });
      return {
        gitStatuses,
      };
    }

    if (command.type === 'conversation.create') {
      const conversation = this.stateStore.createConversation({
        conversationId: command.conversationId ?? `conversation-${randomUUID()}`,
        directoryId: command.directoryId,
        title: command.title,
        agentType: command.agentType,
        adapterState: normalizeAdapterState(command.adapterState),
      });
      const record = this.conversationRecord(conversation);
      this.publishObservedEvent(
        {
          tenantId: conversation.tenantId,
          userId: conversation.userId,
          workspaceId: conversation.workspaceId,
          directoryId: conversation.directoryId,
          conversationId: conversation.conversationId,
        },
        {
          type: 'conversation-created',
          conversation: record,
        },
      );
      return {
        conversation: record,
      };
    }

    if (command.type === 'conversation.list') {
      const query: {
        directoryId?: string;
        tenantId?: string;
        userId?: string;
        workspaceId?: string;
        includeArchived?: boolean;
        limit?: number;
      } = {};
      if (command.directoryId !== undefined) {
        query.directoryId = command.directoryId;
      }
      if (command.tenantId !== undefined) {
        query.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        query.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        query.workspaceId = command.workspaceId;
      }
      if (command.includeArchived !== undefined) {
        query.includeArchived = command.includeArchived;
      }
      if (command.limit !== undefined) {
        query.limit = command.limit;
      }
      const conversations = this.stateStore
        .listConversations(query)
        .map((conversation) => this.conversationRecord(conversation));
      return {
        conversations,
      };
    }

    if (command.type === 'conversation.archive') {
      const archived = this.stateStore.archiveConversation(command.conversationId);
      this.publishObservedEvent(
        {
          tenantId: archived.tenantId,
          userId: archived.userId,
          workspaceId: archived.workspaceId,
          directoryId: archived.directoryId,
          conversationId: archived.conversationId,
        },
        {
          type: 'conversation-archived',
          conversationId: archived.conversationId,
          ts: archived.archivedAt as string,
        },
      );
      return {
        conversation: this.conversationRecord(archived),
      };
    }

    if (command.type === 'conversation.update') {
      const updated = this.stateStore.updateConversationTitle(
        command.conversationId,
        command.title,
      );
      if (updated === null) {
        throw new Error(`conversation not found: ${command.conversationId}`);
      }
      const record = this.conversationRecord(updated);
      this.publishObservedEvent(
        {
          tenantId: updated.tenantId,
          userId: updated.userId,
          workspaceId: updated.workspaceId,
          directoryId: updated.directoryId,
          conversationId: updated.conversationId,
        },
        {
          type: 'conversation-updated',
          conversation: record,
        },
      );
      return {
        conversation: record,
      };
    }

    if (command.type === 'conversation.delete') {
      const existing = this.stateStore.getConversation(command.conversationId);
      if (existing === null) {
        throw new Error(`conversation not found: ${command.conversationId}`);
      }
      this.destroySession(command.conversationId, true);
      this.stateStore.deleteConversation(command.conversationId);
      this.publishObservedEvent(
        {
          tenantId: existing.tenantId,
          userId: existing.userId,
          workspaceId: existing.workspaceId,
          directoryId: existing.directoryId,
          conversationId: existing.conversationId,
        },
        {
          type: 'conversation-deleted',
          conversationId: existing.conversationId,
          ts: new Date().toISOString(),
        },
      );
      return {
        deleted: true,
      };
    }

    if (command.type === 'repository.upsert') {
      const input: {
        repositoryId: string;
        tenantId: string;
        userId: string;
        workspaceId: string;
        name: string;
        remoteUrl: string;
        defaultBranch?: string;
        metadata?: Record<string, unknown>;
      } = {
        repositoryId: command.repositoryId ?? `repository-${randomUUID()}`,
        tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
        userId: command.userId ?? DEFAULT_USER_ID,
        workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
        name: command.name,
        remoteUrl: command.remoteUrl,
      };
      if (command.defaultBranch !== undefined) {
        input.defaultBranch = command.defaultBranch;
      }
      if (command.metadata !== undefined) {
        input.metadata = command.metadata;
      }
      const repository = this.stateStore.upsertRepository(input);
      this.publishObservedEvent(
        {
          tenantId: repository.tenantId,
          userId: repository.userId,
          workspaceId: repository.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'repository-upserted',
          repository: this.repositoryRecord(repository),
        },
      );
      return {
        repository: this.repositoryRecord(repository),
      };
    }

    if (command.type === 'repository.get') {
      const repository = this.stateStore.getRepository(command.repositoryId);
      if (repository === null) {
        throw new Error(`repository not found: ${command.repositoryId}`);
      }
      return {
        repository: this.repositoryRecord(repository),
      };
    }

    if (command.type === 'repository.list') {
      const query: {
        tenantId?: string;
        userId?: string;
        workspaceId?: string;
        includeArchived?: boolean;
        limit?: number;
      } = {};
      if (command.tenantId !== undefined) {
        query.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        query.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        query.workspaceId = command.workspaceId;
      }
      if (command.includeArchived !== undefined) {
        query.includeArchived = command.includeArchived;
      }
      if (command.limit !== undefined) {
        query.limit = command.limit;
      }
      const repositories = this.stateStore
        .listRepositories(query)
        .map((repository) => this.repositoryRecord(repository));
      return {
        repositories,
      };
    }

    if (command.type === 'repository.update') {
      const update: {
        name?: string;
        remoteUrl?: string;
        defaultBranch?: string;
        metadata?: Record<string, unknown>;
      } = {};
      if (command.name !== undefined) {
        update.name = command.name;
      }
      if (command.remoteUrl !== undefined) {
        update.remoteUrl = command.remoteUrl;
      }
      if (command.defaultBranch !== undefined) {
        update.defaultBranch = command.defaultBranch;
      }
      if (command.metadata !== undefined) {
        update.metadata = command.metadata;
      }
      const updated = this.stateStore.updateRepository(command.repositoryId, update);
      if (updated === null) {
        throw new Error(`repository not found: ${command.repositoryId}`);
      }
      this.publishObservedEvent(
        {
          tenantId: updated.tenantId,
          userId: updated.userId,
          workspaceId: updated.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'repository-updated',
          repository: this.repositoryRecord(updated),
        },
      );
      return {
        repository: this.repositoryRecord(updated),
      };
    }

    if (command.type === 'repository.archive') {
      const archived = this.stateStore.archiveRepository(command.repositoryId);
      this.publishObservedEvent(
        {
          tenantId: archived.tenantId,
          userId: archived.userId,
          workspaceId: archived.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'repository-archived',
          repositoryId: archived.repositoryId,
          ts: archived.archivedAt as string,
        },
      );
      return {
        repository: this.repositoryRecord(archived),
      };
    }

    if (command.type === 'task.create') {
      const input: {
        taskId: string;
        tenantId: string;
        userId: string;
        workspaceId: string;
        repositoryId?: string;
        title: string;
        description?: string;
        linear?: {
          issueId?: string | null;
          identifier?: string | null;
          url?: string | null;
          teamId?: string | null;
          projectId?: string | null;
          projectMilestoneId?: string | null;
          cycleId?: string | null;
          stateId?: string | null;
          assigneeId?: string | null;
          priority?: number | null;
          estimate?: number | null;
          dueDate?: string | null;
          labelIds?: readonly string[] | null;
        };
      } = {
        taskId: command.taskId ?? `task-${randomUUID()}`,
        tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
        userId: command.userId ?? DEFAULT_USER_ID,
        workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
        title: command.title,
      };
      if (command.repositoryId !== undefined) {
        input.repositoryId = command.repositoryId;
      }
      if (command.description !== undefined) {
        input.description = command.description;
      }
      if (command.linear !== undefined) {
        input.linear = command.linear;
      }
      const task = this.stateStore.createTask(input);
      this.publishObservedEvent(
        {
          tenantId: task.tenantId,
          userId: task.userId,
          workspaceId: task.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-created',
          task: this.taskRecord(task),
        },
      );
      return {
        task: this.taskRecord(task),
      };
    }

    if (command.type === 'task.get') {
      const task = this.stateStore.getTask(command.taskId);
      if (task === null) {
        throw new Error(`task not found: ${command.taskId}`);
      }
      return {
        task: this.taskRecord(task),
      };
    }

    if (command.type === 'task.list') {
      const query: {
        tenantId?: string;
        userId?: string;
        workspaceId?: string;
        repositoryId?: string;
        status?: 'draft' | 'ready' | 'in-progress' | 'completed';
        limit?: number;
      } = {};
      if (command.tenantId !== undefined) {
        query.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        query.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        query.workspaceId = command.workspaceId;
      }
      if (command.repositoryId !== undefined) {
        query.repositoryId = command.repositoryId;
      }
      if (command.status !== undefined) {
        query.status = command.status;
      }
      if (command.limit !== undefined) {
        query.limit = command.limit;
      }
      const tasks = this.stateStore.listTasks(query).map((task) => this.taskRecord(task));
      return {
        tasks,
      };
    }

    if (command.type === 'task.update') {
      const update: {
        title?: string;
        description?: string;
        repositoryId?: string | null;
        linear?: {
          issueId?: string | null;
          identifier?: string | null;
          url?: string | null;
          teamId?: string | null;
          projectId?: string | null;
          projectMilestoneId?: string | null;
          cycleId?: string | null;
          stateId?: string | null;
          assigneeId?: string | null;
          priority?: number | null;
          estimate?: number | null;
          dueDate?: string | null;
          labelIds?: readonly string[] | null;
        } | null;
      } = {};
      if (command.title !== undefined) {
        update.title = command.title;
      }
      if (command.description !== undefined) {
        update.description = command.description;
      }
      if (command.repositoryId !== undefined) {
        update.repositoryId = command.repositoryId;
      }
      if (command.linear !== undefined) {
        update.linear = command.linear;
      }
      const updated = this.stateStore.updateTask(command.taskId, update);
      if (updated === null) {
        throw new Error(`task not found: ${command.taskId}`);
      }
      this.publishObservedEvent(
        {
          tenantId: updated.tenantId,
          userId: updated.userId,
          workspaceId: updated.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-updated',
          task: this.taskRecord(updated),
        },
      );
      return {
        task: this.taskRecord(updated),
      };
    }

    if (command.type === 'task.delete') {
      const existing = this.stateStore.getTask(command.taskId);
      if (existing === null) {
        throw new Error(`task not found: ${command.taskId}`);
      }
      this.stateStore.deleteTask(command.taskId);
      this.publishObservedEvent(
        {
          tenantId: existing.tenantId,
          userId: existing.userId,
          workspaceId: existing.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-deleted',
          taskId: existing.taskId,
          ts: new Date().toISOString(),
        },
      );
      return {
        deleted: true,
      };
    }

    if (command.type === 'task.claim') {
      const input: {
        taskId: string;
        controllerId: string;
        directoryId?: string;
        branchName?: string;
        baseBranch?: string;
      } = {
        taskId: command.taskId,
        controllerId: command.controllerId,
      };
      if (command.directoryId !== undefined) {
        input.directoryId = command.directoryId;
      }
      if (command.branchName !== undefined) {
        input.branchName = command.branchName;
      }
      if (command.baseBranch !== undefined) {
        input.baseBranch = command.baseBranch;
      }
      const task = this.stateStore.claimTask(input);
      this.publishObservedEvent(
        {
          tenantId: task.tenantId,
          userId: task.userId,
          workspaceId: task.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-updated',
          task: this.taskRecord(task),
        },
      );
      return {
        task: this.taskRecord(task),
      };
    }

    if (command.type === 'task.complete') {
      const task = this.stateStore.completeTask(command.taskId);
      this.publishObservedEvent(
        {
          tenantId: task.tenantId,
          userId: task.userId,
          workspaceId: task.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-updated',
          task: this.taskRecord(task),
        },
      );
      return {
        task: this.taskRecord(task),
      };
    }

    if (command.type === 'task.queue') {
      const task = this.stateStore.readyTask(command.taskId);
      this.publishObservedEvent(
        {
          tenantId: task.tenantId,
          userId: task.userId,
          workspaceId: task.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-updated',
          task: this.taskRecord(task),
        },
      );
      return {
        task: this.taskRecord(task),
      };
    }

    if (command.type === 'task.ready') {
      const task = this.stateStore.readyTask(command.taskId);
      this.publishObservedEvent(
        {
          tenantId: task.tenantId,
          userId: task.userId,
          workspaceId: task.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-updated',
          task: this.taskRecord(task),
        },
      );
      return {
        task: this.taskRecord(task),
      };
    }

    if (command.type === 'task.draft') {
      const task = this.stateStore.draftTask(command.taskId);
      this.publishObservedEvent(
        {
          tenantId: task.tenantId,
          userId: task.userId,
          workspaceId: task.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-updated',
          task: this.taskRecord(task),
        },
      );
      return {
        task: this.taskRecord(task),
      };
    }

    if (command.type === 'task.reorder') {
      const tasks = this.stateStore
        .reorderTasks({
          tenantId: command.tenantId,
          userId: command.userId,
          workspaceId: command.workspaceId,
          orderedTaskIds: command.orderedTaskIds,
        })
        .map((task) => this.taskRecord(task));
      this.publishObservedEvent(
        {
          tenantId: command.tenantId,
          userId: command.userId,
          workspaceId: command.workspaceId,
          directoryId: null,
          conversationId: null,
        },
        {
          type: 'task-reordered',
          tasks,
          ts: new Date().toISOString(),
        },
      );
      return {
        tasks,
      };
    }

    if (command.type === 'stream.subscribe') {
      const subscriptionId = `subscription-${randomUUID()}`;
      const filter: StreamSubscriptionFilter = {
        includeOutput: command.includeOutput ?? false,
      };
      if (command.tenantId !== undefined) {
        filter.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        filter.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        filter.workspaceId = command.workspaceId;
      }
      if (command.repositoryId !== undefined) {
        filter.repositoryId = command.repositoryId;
      }
      if (command.taskId !== undefined) {
        filter.taskId = command.taskId;
      }
      if (command.directoryId !== undefined) {
        filter.directoryId = command.directoryId;
      }
      if (command.conversationId !== undefined) {
        filter.conversationId = command.conversationId;
      }

      this.streamSubscriptions.set(subscriptionId, {
        id: subscriptionId,
        connectionId: connection.id,
        filter,
      });
      connection.streamSubscriptionIds.add(subscriptionId);

      const afterCursor = command.afterCursor ?? 0;
      for (const entry of this.streamJournal) {
        if (entry.cursor <= afterCursor) {
          continue;
        }
        if (!this.matchesObservedFilter(entry.scope, entry.event, filter)) {
          continue;
        }
        const diagnosticSessionId = this.diagnosticSessionIdForObservedEvent(
          entry.scope,
          entry.event,
        );
        this.sendToConnection(connection.id, {
          kind: 'stream.event',
          subscriptionId,
          cursor: entry.cursor,
          event: entry.event,
        }, diagnosticSessionId);
      }

      return {
        subscriptionId,
        cursor: this.streamCursor,
      };
    }

    if (command.type === 'stream.unsubscribe') {
      const subscription = this.streamSubscriptions.get(command.subscriptionId);
      if (subscription !== undefined) {
        const subscriptionConnection = this.connections.get(subscription.connectionId);
        subscriptionConnection?.streamSubscriptionIds.delete(command.subscriptionId);
        this.streamSubscriptions.delete(command.subscriptionId);
      }
      return {
        unsubscribed: true,
      };
    }

    if (command.type === 'session.list') {
      const sort = command.sort ?? 'attention-first';
      const filtered = [...this.sessions.values()].filter((state) => {
        if (command.tenantId !== undefined && state.tenantId !== command.tenantId) {
          return false;
        }
        if (command.userId !== undefined && state.userId !== command.userId) {
          return false;
        }
        if (command.workspaceId !== undefined && state.workspaceId !== command.workspaceId) {
          return false;
        }
        if (command.worktreeId !== undefined && state.worktreeId !== command.worktreeId) {
          return false;
        }
        if (command.status !== undefined && state.status !== command.status) {
          return false;
        }
        if (command.live !== undefined && (state.session !== null) !== command.live) {
          return false;
        }
        return true;
      });
      const sessions = this.sortSessionSummaries(filtered, sort);
      const limited = command.limit === undefined ? sessions : sessions.slice(0, command.limit);
      return {
        sessions: limited,
      };
    }

    if (command.type === 'attention.list') {
      return {
        sessions: this.sortSessionSummaries(
          [...this.sessions.values()].filter((state) => state.status === 'needs-input'),
          'attention-first',
        ),
      };
    }

    if (command.type === 'session.status') {
      const state = this.requireSession(command.sessionId);
      return this.sessionSummaryRecord(state);
    }

    if (command.type === 'session.snapshot') {
      const state = this.requireSession(command.sessionId);
      if (state.session === null) {
        if (state.lastSnapshot === null) {
          throw new Error(`session snapshot unavailable: ${command.sessionId}`);
        }
        return {
          sessionId: command.sessionId,
          snapshot: state.lastSnapshot,
          stale: true,
        };
      }
      const snapshot = this.snapshotRecordFromFrame(state.session.snapshot());
      state.lastSnapshot = snapshot;
      return {
        sessionId: command.sessionId,
        snapshot,
        stale: false,
      };
    }

    if (command.type === 'session.claim') {
      const state = this.requireSession(command.sessionId);
      const claimedAt = new Date().toISOString();
      const previousController = state.controller;
      const nextController: SessionControllerState = {
        controllerId: command.controllerId,
        controllerType: command.controllerType,
        controllerLabel: command.controllerLabel ?? null,
        claimedAt,
        connectionId: connection.id,
      };
      if (previousController === null) {
        state.controller = nextController;
        this.publishSessionControlObservedEvent(
          state,
          'claimed',
          toPublicSessionController(nextController),
          null,
          command.reason ?? null,
        );
        this.publishStatusObservedEvent(state);
        return {
          sessionId: command.sessionId,
          action: 'claimed',
          controller: toPublicSessionController(nextController),
        };
      }
      if (previousController.connectionId !== connection.id && command.takeover !== true) {
        throw new Error(
          `session is already claimed by ${controllerDisplayName(previousController)}`,
        );
      }
      state.controller = nextController;
      const action = previousController.connectionId === connection.id ? 'claimed' : 'taken-over';
      this.publishSessionControlObservedEvent(
        state,
        action,
        toPublicSessionController(nextController),
        toPublicSessionController(previousController),
        command.reason ?? null,
      );
      this.publishStatusObservedEvent(state);
      return {
        sessionId: command.sessionId,
        action,
        controller: toPublicSessionController(nextController),
      };
    }

    if (command.type === 'session.release') {
      const state = this.requireSession(command.sessionId);
      if (state.controller === null) {
        return {
          sessionId: command.sessionId,
          released: false,
          controller: null,
        };
      }
      if (state.controller.connectionId !== connection.id) {
        throw new Error(`session is claimed by ${controllerDisplayName(state.controller)}`);
      }
      const previousController = state.controller;
      state.controller = null;
      this.publishSessionControlObservedEvent(
        state,
        'released',
        null,
        toPublicSessionController(previousController),
        command.reason ?? null,
      );
      this.publishStatusObservedEvent(state);
      return {
        sessionId: command.sessionId,
        released: true,
        controller: null,
      };
    }

    if (command.type === 'session.respond') {
      const state = this.requireLiveSession(command.sessionId);
      this.assertConnectionCanMutateSession(connection.id, state);
      state.session.write(command.text);
      this.setSessionStatus(state, 'running', null, new Date().toISOString());
      return {
        responded: true,
        sentBytes: Buffer.byteLength(command.text),
      };
    }

    if (command.type === 'session.interrupt') {
      const state = this.requireLiveSession(command.sessionId);
      this.assertConnectionCanMutateSession(connection.id, state);
      state.session.write('\u0003');
      this.setSessionStatus(state, 'running', null, new Date().toISOString());
      return {
        interrupted: true,
      };
    }

    if (command.type === 'session.remove') {
      const state = this.requireSession(command.sessionId);
      this.assertConnectionCanMutateSession(connection.id, state);
      this.destroySession(command.sessionId, true);
      return {
        removed: true,
      };
    }

    if (command.type === 'pty.start') {
      const startInput: StartSessionRuntimeInput = {
        sessionId: command.sessionId,
        args: command.args,
        initialCols: command.initialCols,
        initialRows: command.initialRows,
        ...(command.env !== undefined ? { env: command.env } : {}),
        ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
        ...(command.tenantId !== undefined ? { tenantId: command.tenantId } : {}),
        ...(command.userId !== undefined ? { userId: command.userId } : {}),
        ...(command.workspaceId !== undefined ? { workspaceId: command.workspaceId } : {}),
        ...(command.worktreeId !== undefined ? { worktreeId: command.worktreeId } : {}),
        ...(command.terminalForegroundHex !== undefined
          ? { terminalForegroundHex: command.terminalForegroundHex }
          : {}),
        ...(command.terminalBackgroundHex !== undefined
          ? { terminalBackgroundHex: command.terminalBackgroundHex }
          : {}),
      };
      this.startSessionRuntime(startInput);

      return {
        sessionId: command.sessionId,
      };
    }

    if (command.type === 'pty.attach') {
      const state = this.requireLiveSession(command.sessionId);
      const previous = state.attachmentByConnectionId.get(connection.id);
      if (previous !== undefined) {
        state.session.detach(previous);
      }

      const attachmentId = state.session.attach(
        {
          onData: (event) => {
            this.sendToConnection(connection.id, {
              kind: 'pty.output',
              sessionId: command.sessionId,
              cursor: event.cursor,
              chunkBase64: Buffer.from(event.chunk).toString('base64'),
            }, command.sessionId);
            const sessionState = this.sessions.get(command.sessionId);
            if (sessionState !== undefined) {
              if (event.cursor <= sessionState.lastObservedOutputCursor) {
                return;
              }
              sessionState.lastObservedOutputCursor = event.cursor;
              this.publishObservedEvent(this.sessionScope(sessionState), {
                type: 'session-output',
                sessionId: command.sessionId,
                outputCursor: event.cursor,
                chunkBase64: Buffer.from(event.chunk).toString('base64'),
                ts: new Date().toISOString(),
                directoryId: sessionState.directoryId,
                conversationId: sessionState.id,
              });
            }
          },
          onExit: (exit) => {
            this.sendToConnection(connection.id, {
              kind: 'pty.exit',
              sessionId: command.sessionId,
              exit,
            }, command.sessionId);
          },
        },
        command.sinceCursor ?? 0,
      );

      state.attachmentByConnectionId.set(connection.id, attachmentId);
      connection.attachedSessionIds.add(command.sessionId);

      return {
        latestCursor: state.session.latestCursorValue(),
      };
    }

    if (command.type === 'pty.detach') {
      this.detachConnectionFromSession(connection.id, command.sessionId);
      connection.attachedSessionIds.delete(command.sessionId);
      return {
        detached: true,
      };
    }

    if (command.type === 'pty.subscribe-events') {
      const state = this.requireSession(command.sessionId);
      state.eventSubscriberConnectionIds.add(connection.id);
      connection.eventSessionIds.add(command.sessionId);
      return {
        subscribed: true,
      };
    }

    if (command.type === 'pty.unsubscribe-events') {
      const state = this.requireSession(command.sessionId);
      state.eventSubscriberConnectionIds.delete(connection.id);
      connection.eventSessionIds.delete(command.sessionId);
      return {
        subscribed: false,
      };
    }

    if (command.type === 'pty.close') {
      const state = this.requireLiveSession(command.sessionId);
      this.assertConnectionCanMutateSession(connection.id, state);
      this.destroySession(command.sessionId, true);
      return {
        closed: true,
      };
    }

    throw new Error(`unsupported command type: ${(command as { type: string }).type}`);
  }

  private handleInput(connectionId: string, sessionId: string, dataBase64: string): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    if (!this.connectionCanMutateSession(connectionId, state)) {
      return;
    }
    if (state.status === 'exited' || state.session === null) {
      return;
    }

    const data = Buffer.from(dataBase64, 'base64');
    if (data.length === 0 && dataBase64.length > 0) {
      return;
    }
    state.session.write(data);
  }

  private handleResize(connectionId: string, sessionId: string, cols: number, rows: number): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    if (!this.connectionCanMutateSession(connectionId, state)) {
      return;
    }
    if (state.status === 'exited' || state.session === null) {
      return;
    }
    state.session.resize(cols, rows);
  }

  private handleSignal(connectionId: string, sessionId: string, signal: StreamSignal): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    if (!this.connectionCanMutateSession(connectionId, state)) {
      return;
    }
    if (state.status === 'exited' || state.session === null) {
      return;
    }

    if (signal === 'interrupt') {
      state.session.write('\u0003');
      return;
    }

    if (signal === 'eof') {
      state.session.write('\u0004');
      return;
    }

    this.destroySession(sessionId, true);
  }

  private handleSessionEvent(sessionId: string, event: CodexLiveEvent): void {
    const sessionState = this.sessions.get(sessionId);
    if (sessionState === undefined) {
      return;
    }

    const mapped = mapSessionEvent(event);
    if (mapped !== null && event.type !== 'terminal-output') {
      const observedAt =
        mapped.type === 'session-exit' ? new Date().toISOString() : mapped.record.ts;
      for (const connectionId of sessionState.eventSubscriberConnectionIds) {
        this.sendToConnection(connectionId, {
          kind: 'pty.event',
          sessionId,
          event: mapped,
        }, sessionId);
      }
      this.publishObservedEvent(
        this.sessionScope(sessionState),
        {
          type: 'session-event',
          sessionId,
          event: mapped,
          ts: new Date().toISOString(),
          directoryId: sessionState.directoryId,
          conversationId: sessionState.id
        }
      );
      const mergedAdapterState = mergeAdapterStateFromSessionEvent(
        sessionState.agentType,
        sessionState.adapterState,
        mapped,
        observedAt
      );
      if (mergedAdapterState !== null) {
        sessionState.adapterState = mergedAdapterState;
        this.stateStore.updateConversationAdapterState(sessionState.id, mergedAdapterState);
      }
      if (mapped.type === 'notify') {
        const keyEvent = this.notifyKeyEventFromPayload(
          sessionState.agentType,
          mapped.record.payload,
          observedAt
        );
        if (keyEvent !== null) {
          sessionState.latestTelemetry = {
            source: keyEvent.source,
            eventName: keyEvent.eventName,
            severity: keyEvent.severity,
            summary: keyEvent.summary,
            observedAt: keyEvent.observedAt
          };
          this.publishSessionKeyObservedEvent(sessionState, keyEvent);
          if (keyEvent.statusHint === 'needs-input') {
            const nextAttentionReason = keyEvent.summary ?? sessionState.attentionReason ?? 'input required';
            this.setSessionStatus(sessionState, 'needs-input', nextAttentionReason, observedAt);
          } else if (keyEvent.statusHint !== null) {
            this.setSessionStatus(sessionState, keyEvent.statusHint, null, observedAt);
          } else {
            this.setSessionStatus(
              sessionState,
              sessionState.status,
              sessionState.attentionReason,
              observedAt
            );
          }
        } else {
          this.setSessionStatus(
            sessionState,
            sessionState.status,
            sessionState.attentionReason,
            observedAt,
          );
        }
      }
    }

    if (event.type === 'session-exit') {
      sessionState.lastExit = event.exit;
      const exitedAt = new Date().toISOString();
      sessionState.exitedAt = exitedAt;
      this.setSessionStatus(sessionState, 'exited', null, exitedAt);
      this.deactivateSession(sessionState.id, true);
    }
  }

  private notifyKeyEventFromPayload(
    agentType: string,
    payload: Record<string, unknown>,
    observedAt: string
  ): StreamSessionKeyEventRecord | null {
    if (agentType === 'codex') {
      const notifyPayloadType = readTrimmedString(payload['type']);
      if (notifyPayloadType !== 'agent-turn-complete') {
        return null;
      }
      return {
        source: 'otlp-metric',
        eventName: 'codex.turn.e2e_duration_ms',
        severity: null,
        summary: 'turn complete (notify)',
        observedAt,
        statusHint: 'completed'
      };
    }
    if (agentType !== 'claude') {
      return null;
    }

    const hookEventNameRaw = readTrimmedString(payload['hook_event_name']) ?? readTrimmedString(payload['hookEventName']);
    if (hookEventNameRaw === null) {
      return null;
    }
    const hookEventToken = normalizeEventToken(hookEventNameRaw);
    if (hookEventToken.length === 0) {
      return null;
    }
    const eventName = `claude.${hookEventToken}`;
    const summary = readTrimmedString(payload['message']) ?? readTrimmedString(payload['reason']);
    const notificationType = readTrimmedString(payload['notification_type'])?.toLowerCase() ?? '';

    let statusHint: StreamSessionKeyEventRecord['statusHint'] = null;
    let normalizedSummary = summary;
    if (hookEventToken === 'userpromptsubmit') {
      statusHint = 'running';
      normalizedSummary ??= 'prompt submitted';
    } else if (hookEventToken === 'pretooluse') {
      statusHint = 'running';
      normalizedSummary ??= 'tool started (hook)';
    } else if (hookEventToken === 'stop' || hookEventToken === 'subagentstop' || hookEventToken === 'sessionend') {
      statusHint = 'completed';
      normalizedSummary ??= 'turn complete (hook)';
    } else if (hookEventToken === 'notification') {
      statusHint = claudeStatusHintFromNotificationType(notificationType);
      if (normalizedSummary === null) {
        normalizedSummary = notificationType.length > 0 ? notificationType : hookEventNameRaw;
      }
    } else if (normalizedSummary === null) {
      normalizedSummary = hookEventNameRaw;
    }

    return {
      source: 'otlp-log',
      eventName,
      severity: null,
      summary: normalizedSummary,
      observedAt,
      statusHint
    };
  }

  private publishSessionKeyObservedEvent(state: SessionState, keyEvent: StreamSessionKeyEventRecord): void {
    this.publishObservedEvent(
      this.sessionScope(state),
      {
        type: 'session-key-event',
        sessionId: state.id,
        keyEvent: {
          source: keyEvent.source,
          eventName: keyEvent.eventName,
          severity: keyEvent.severity,
          summary: keyEvent.summary,
          observedAt: keyEvent.observedAt,
          statusHint: keyEvent.statusHint
        },
        ts: new Date().toISOString(),
        directoryId: state.directoryId,
        conversationId: state.id
      }
    );
  }

  private setSessionStatus(
    state: SessionState,
    status: StreamSessionRuntimeStatus,
    attentionReason: string | null,
    lastEventAt: string | null,
  ): void {
    state.status = status;
    state.attentionReason = attentionReason;
    if (lastEventAt !== null) {
      state.lastEventAt = lastEventAt;
    }
    this.persistConversationRuntime(state);
    this.publishStatusObservedEvent(state);
  }

  private persistConversationRuntime(state: SessionState): void {
    this.stateStore.updateConversationRuntime(state.id, {
      status: state.status,
      live: state.session !== null,
      attentionReason: state.attentionReason,
      processId: state.session?.processId() ?? null,
      lastEventAt: state.lastEventAt,
      lastExit: state.lastExit,
    });
  }

  private publishStatusObservedEvent(state: SessionState): void {
    this.publishObservedEvent(this.sessionScope(state), {
      type: 'session-status',
      sessionId: state.id,
      status: state.status,
      attentionReason: state.attentionReason,
      live: state.session !== null,
      ts: new Date().toISOString(),
      directoryId: state.directoryId,
      conversationId: state.id,
      telemetry: state.latestTelemetry,
      controller: toPublicSessionController(state.controller),
    });
  }

  private publishSessionControlObservedEvent(
    state: SessionState,
    action: 'claimed' | 'released' | 'taken-over',
    controller: StreamSessionController | null,
    previousController: StreamSessionController | null,
    reason: string | null,
  ): void {
    this.publishObservedEvent(this.sessionScope(state), {
      type: 'session-control',
      sessionId: state.id,
      action,
      controller,
      previousController,
      reason,
      ts: new Date().toISOString(),
      directoryId: state.directoryId,
      conversationId: state.id,
    });
  }

  private sessionScope(state: SessionState): StreamObservedScope {
    return {
      tenantId: state.tenantId,
      userId: state.userId,
      workspaceId: state.workspaceId,
      directoryId: state.directoryId,
      conversationId: state.id,
    };
  }

  private eventIncludesRepositoryId(event: StreamObservedEvent, repositoryId: string): boolean {
    if (event.type === 'directory-git-updated') {
      return event.repositoryId === repositoryId;
    }
    if (event.type === 'repository-upserted' || event.type === 'repository-updated') {
      return event.repository['repositoryId'] === repositoryId;
    }
    if (event.type === 'repository-archived') {
      return event.repositoryId === repositoryId;
    }
    if (event.type === 'task-created' || event.type === 'task-updated') {
      return event.task['repositoryId'] === repositoryId;
    }
    if (event.type === 'task-reordered') {
      for (const task of event.tasks) {
        if (task['repositoryId'] === repositoryId) {
          return true;
        }
      }
      return false;
    }
    return false;
  }

  private eventIncludesTaskId(event: StreamObservedEvent, taskId: string): boolean {
    if (event.type === 'task-created' || event.type === 'task-updated') {
      return event.task['taskId'] === taskId;
    }
    if (event.type === 'task-deleted') {
      return event.taskId === taskId;
    }
    if (event.type === 'task-reordered') {
      for (const task of event.tasks) {
        if (task['taskId'] === taskId) {
          return true;
        }
      }
      return false;
    }
    return false;
  }

  private matchesObservedFilter(
    scope: StreamObservedScope,
    event: StreamObservedEvent,
    filter: StreamSubscriptionFilter,
  ): boolean {
    if (!filter.includeOutput && event.type === 'session-output') {
      return false;
    }
    if (filter.tenantId !== undefined && scope.tenantId !== filter.tenantId) {
      return false;
    }
    if (filter.userId !== undefined && scope.userId !== filter.userId) {
      return false;
    }
    if (filter.workspaceId !== undefined && scope.workspaceId !== filter.workspaceId) {
      return false;
    }
    if (
      filter.repositoryId !== undefined &&
      !this.eventIncludesRepositoryId(event, filter.repositoryId)
    ) {
      return false;
    }
    if (filter.taskId !== undefined && !this.eventIncludesTaskId(event, filter.taskId)) {
      return false;
    }
    if (filter.directoryId !== undefined && scope.directoryId !== filter.directoryId) {
      return false;
    }
    if (filter.conversationId !== undefined && scope.conversationId !== filter.conversationId) {
      return false;
    }
    return true;
  }

  private publishObservedEvent(scope: StreamObservedScope, event: StreamObservedEvent): void {
    this.streamCursor += 1;
    const entry: StreamJournalEntry = {
      cursor: this.streamCursor,
      scope,
      event,
    };
    const diagnosticSessionId = this.diagnosticSessionIdForObservedEvent(scope, event);
    this.streamJournal.push(entry);
    if (this.streamJournal.length > this.maxStreamJournalEntries) {
      this.streamJournal.shift();
    }

    for (const subscription of this.streamSubscriptions.values()) {
      if (!this.matchesObservedFilter(scope, event, subscription.filter)) {
        continue;
      }
      this.sendToConnection(subscription.connectionId, {
        kind: 'stream.event',
        subscriptionId: subscription.id,
        cursor: entry.cursor,
        event: entry.event,
      }, diagnosticSessionId);
    }
    this.lifecycleHooks.publish(scope, event, entry.cursor);
  }

  private directoryRecord(directory: ControlPlaneDirectoryRecord): Record<string, unknown> {
    return {
      directoryId: directory.directoryId,
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      path: directory.path,
      createdAt: directory.createdAt,
      archivedAt: directory.archivedAt,
    };
  }

  private conversationRecord(
    conversation: ControlPlaneConversationRecord,
  ): Record<string, unknown> {
    return {
      conversationId: conversation.conversationId,
      directoryId: conversation.directoryId,
      tenantId: conversation.tenantId,
      userId: conversation.userId,
      workspaceId: conversation.workspaceId,
      title: conversation.title,
      agentType: conversation.agentType,
      createdAt: conversation.createdAt,
      archivedAt: conversation.archivedAt,
      runtimeStatus: conversation.runtimeStatus,
      runtimeLive: conversation.runtimeLive,
      runtimeAttentionReason: conversation.runtimeAttentionReason,
      runtimeProcessId: conversation.runtimeProcessId,
      runtimeLastEventAt: conversation.runtimeLastEventAt,
      runtimeLastExit: conversation.runtimeLastExit,
      adapterState: conversation.adapterState,
    };
  }

  private repositoryRecord(repository: ControlPlaneRepositoryRecord): Record<string, unknown> {
    return {
      repositoryId: repository.repositoryId,
      tenantId: repository.tenantId,
      userId: repository.userId,
      workspaceId: repository.workspaceId,
      name: repository.name,
      remoteUrl: repository.remoteUrl,
      defaultBranch: repository.defaultBranch,
      metadata: repository.metadata,
      createdAt: repository.createdAt,
      archivedAt: repository.archivedAt,
    };
  }

  private taskRecord(task: ControlPlaneTaskRecord): Record<string, unknown> {
    return {
      taskId: task.taskId,
      tenantId: task.tenantId,
      userId: task.userId,
      workspaceId: task.workspaceId,
      repositoryId: task.repositoryId,
      title: task.title,
      description: task.description,
      status: task.status,
      orderIndex: task.orderIndex,
      claimedByControllerId: task.claimedByControllerId,
      claimedByDirectoryId: task.claimedByDirectoryId,
      branchName: task.branchName,
      baseBranch: task.baseBranch,
      claimedAt: task.claimedAt,
      completedAt: task.completedAt,
      linear: {
        issueId: task.linear.issueId,
        identifier: task.linear.identifier,
        url: task.linear.url,
        teamId: task.linear.teamId,
        projectId: task.linear.projectId,
        projectMilestoneId: task.linear.projectMilestoneId,
        cycleId: task.linear.cycleId,
        stateId: task.linear.stateId,
        assigneeId: task.linear.assigneeId,
        priority: task.linear.priority,
        estimate: task.linear.estimate,
        dueDate: task.linear.dueDate,
        labelIds: [...task.linear.labelIds],
      },
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private requireSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return state;
  }

  private requireLiveSession(sessionId: string): SessionState & { session: LiveSessionLike } {
    const state = this.requireSession(sessionId);
    if (state.session === null) {
      throw new Error(`session is not live: ${sessionId}`);
    }
    return state as SessionState & { session: LiveSessionLike };
  }

  private connectionCanMutateSession(connectionId: string, state: SessionState): boolean {
    return state.controller === null || state.controller.connectionId === connectionId;
  }

  private assertConnectionCanMutateSession(connectionId: string, state: SessionState): void {
    if (this.connectionCanMutateSession(connectionId, state)) {
      return;
    }
    const controller = state.controller;
    if (controller === null) {
      return;
    }
    throw new Error(`session is claimed by ${controllerDisplayName(controller)}`);
  }

  private detachConnectionFromSession(connectionId: string, sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }

    const attachmentId = state.attachmentByConnectionId.get(connectionId);
    if (attachmentId === undefined) {
      return;
    }
    if (state.session === null) {
      state.attachmentByConnectionId.delete(connectionId);
      return;
    }

    state.session.detach(attachmentId);
    state.attachmentByConnectionId.delete(connectionId);
  }

  private cleanupConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) {
      return;
    }

    for (const sessionId of connection.attachedSessionIds) {
      this.detachConnectionFromSession(connectionId, sessionId);
    }

    for (const sessionId of connection.eventSessionIds) {
      const state = this.sessions.get(sessionId);
      state?.eventSubscriberConnectionIds.delete(connectionId);
    }

    for (const subscriptionId of connection.streamSubscriptionIds) {
      this.streamSubscriptions.delete(subscriptionId);
    }

    for (const state of this.sessions.values()) {
      if (state.controller?.connectionId !== connectionId) {
        continue;
      }
      const previousController = state.controller;
      state.controller = null;
      this.publishSessionControlObservedEvent(
        state,
        'released',
        null,
        toPublicSessionController(previousController),
        'controller-disconnected',
      );
      this.publishStatusObservedEvent(state);
    }

    this.connections.delete(connectionId);
    recordPerfEvent('control-plane.server.connection.closed', {
      role: 'server',
      connectionId,
    });
  }

  private deactivateSession(sessionId: string, closeSession: boolean): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined || state.session === null) {
      return;
    }

    const liveSession = state.session;
    state.session = null;

    if (state.unsubscribe !== null) {
      state.unsubscribe();
      state.unsubscribe = null;
    }

    state.lastSnapshot = this.snapshotRecordFromFrame(liveSession.snapshot());

    if (closeSession) {
      liveSession.close();
    }

    for (const [connectionId, attachmentId] of state.attachmentByConnectionId.entries()) {
      liveSession.detach(attachmentId);
      const connection = this.connections.get(connectionId);
      if (connection !== undefined) {
        connection.attachedSessionIds.delete(sessionId);
      }
    }
    state.attachmentByConnectionId.clear();

    for (const connectionId of state.eventSubscriberConnectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection !== undefined) {
        connection.eventSessionIds.delete(sessionId);
      }
    }
    state.eventSubscriberConnectionIds.clear();

    this.persistConversationRuntime(state);
    this.publishStatusObservedEvent(state);

    if (state.status === 'exited') {
      this.scheduleTombstoneRemoval(state.id);
    }
  }

  private scheduleTombstoneRemoval(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined || state.status !== 'exited') {
      return;
    }

    if (state.tombstoneTimer !== null) {
      clearTimeout(state.tombstoneTimer);
      state.tombstoneTimer = null;
    }

    if (this.sessionExitTombstoneTtlMs <= 0) {
      this.destroySession(sessionId, false);
      return;
    }

    state.tombstoneTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (current === undefined || current.status !== 'exited') {
        return;
      }
      this.destroySession(sessionId, false);
    }, this.sessionExitTombstoneTtlMs);
    state.tombstoneTimer.unref();
  }

  private destroySession(sessionId: string, closeSession: boolean): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }

    if (state.tombstoneTimer !== null) {
      clearTimeout(state.tombstoneTimer);
      state.tombstoneTimer = null;
    }

    if (state.session !== null) {
      this.deactivateSession(sessionId, closeSession);
    }

    this.sessions.delete(sessionId);
    this.launchCommandBySessionId.delete(sessionId);
    for (const [token, mappedSessionId] of this.telemetryTokenToSessionId.entries()) {
      if (mappedSessionId === sessionId) {
        this.telemetryTokenToSessionId.delete(token);
      }
    }
  }

  private sortSessionSummaries(
    sessions: readonly SessionState[],
    sort: StreamSessionListSort,
  ): readonly Record<string, unknown>[] {
    const sorted = [...sessions];
    sorted.sort((left, right) => {
      if (sort === 'started-asc') {
        const byStartedAsc = left.startedAt.localeCompare(right.startedAt);
        if (byStartedAsc !== 0) {
          return byStartedAsc;
        }
        return left.id.localeCompare(right.id);
      }

      if (sort === 'started-desc') {
        const byStartedDesc = right.startedAt.localeCompare(left.startedAt);
        if (byStartedDesc !== 0) {
          return byStartedDesc;
        }
        return left.id.localeCompare(right.id);
      }

      const byPriority = sessionPriority(left.status) - sessionPriority(right.status);
      if (byPriority !== 0) {
        return byPriority;
      }
      const byLastEvent = compareIsoDesc(left.lastEventAt, right.lastEventAt);
      if (byLastEvent !== 0) {
        return byLastEvent;
      }
      const byStartedDesc = right.startedAt.localeCompare(left.startedAt);
      if (byStartedDesc !== 0) {
        return byStartedDesc;
      }
      return left.id.localeCompare(right.id);
    });

    return sorted.map((state) => this.sessionSummaryRecord(state));
  }

  private sessionDiagnosticsRecord(state: SessionState): Record<string, unknown> {
    const nowMs = Date.now();
    const telemetryEventsLast60s = sessionRollingCounterTotal(state.diagnostics.telemetryIngestRate, nowMs);
    return {
      telemetryIngestedTotal: state.diagnostics.telemetryIngestedTotal,
      telemetryRetainedTotal: state.diagnostics.telemetryRetainedTotal,
      telemetryDroppedTotal: state.diagnostics.telemetryDroppedTotal,
      telemetryEventsLast60s,
      telemetryIngestQps1m: Number((telemetryEventsLast60s / 60).toFixed(3)),
      fanoutEventsEnqueuedTotal: state.diagnostics.fanoutEventsEnqueuedTotal,
      fanoutBytesEnqueuedTotal: state.diagnostics.fanoutBytesEnqueuedTotal,
      fanoutBackpressureSignalsTotal: state.diagnostics.fanoutBackpressureSignalsTotal,
      fanoutBackpressureDisconnectsTotal: state.diagnostics.fanoutBackpressureDisconnectsTotal,
    };
  }

  private noteTelemetryIngest(
    sessionId: string,
    outcome: 'ingested-only' | 'retained' | 'dropped',
    observedAt: string,
  ): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    state.diagnostics.telemetryIngestedTotal += 1;
    incrementSessionRollingCounter(
      state.diagnostics.telemetryIngestRate,
      Date.parse(observedAt) || Date.now(),
    );
    if (outcome === 'retained') {
      state.diagnostics.telemetryRetainedTotal += 1;
      return;
    }
    if (outcome === 'dropped') {
      state.diagnostics.telemetryDroppedTotal += 1;
    }
  }

  private noteSessionFanoutEnqueue(sessionId: string | null, bytes: number): void {
    if (sessionId === null) {
      return;
    }
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    state.diagnostics.fanoutEventsEnqueuedTotal += 1;
    state.diagnostics.fanoutBytesEnqueuedTotal += Math.max(0, bytes);
  }

  private noteSessionFanoutBackpressure(sessionId: string | null): void {
    if (sessionId === null) {
      return;
    }
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    state.diagnostics.fanoutBackpressureSignalsTotal += 1;
  }

  private noteSessionFanoutDisconnect(sessionId: string | null): void {
    if (sessionId === null) {
      return;
    }
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    state.diagnostics.fanoutBackpressureDisconnectsTotal += 1;
  }

  private diagnosticSessionIdForObservedEvent(scope: StreamObservedScope, event: StreamObservedEvent): string | null {
    if (event.type === 'session-status') {
      return event.sessionId;
    }
    if (event.type === 'session-event') {
      return event.sessionId;
    }
    if (event.type === 'session-key-event') {
      return event.sessionId;
    }
    if (event.type === 'session-control') {
      return event.sessionId;
    }
    if (event.type === 'session-output') {
      return event.sessionId;
    }
    return scope.conversationId;
  }

  private sessionSummaryRecord(state: SessionState): Record<string, unknown> {
    return {
      sessionId: state.id,
      directoryId: state.directoryId,
      tenantId: state.tenantId,
      userId: state.userId,
      workspaceId: state.workspaceId,
      worktreeId: state.worktreeId,
      status: state.status,
      attentionReason: state.attentionReason,
      latestCursor: state.session?.latestCursorValue() ?? null,
      processId: state.session?.processId() ?? null,
      attachedClients: state.attachmentByConnectionId.size,
      eventSubscribers: state.eventSubscriberConnectionIds.size,
      startedAt: state.startedAt,
      lastEventAt: state.lastEventAt,
      lastExit: state.lastExit,
      exitedAt: state.exitedAt,
      live: state.session !== null,
      launchCommand: this.launchCommandBySessionId.get(state.id) ?? null,
      telemetry: state.latestTelemetry,
      controller: toPublicSessionController(state.controller),
      diagnostics: this.sessionDiagnosticsRecord(state),
    };
  }

  private snapshotRecordFromFrame(frame: TerminalSnapshotFrame): Record<string, unknown> {
    return {
      rows: frame.rows,
      cols: frame.cols,
      activeScreen: frame.activeScreen,
      modes: frame.modes,
      cursor: frame.cursor,
      viewport: frame.viewport,
      lines: frame.lines,
      frameHash: frame.frameHash,
    };
  }

  private sendToConnection(
    connectionId: string,
    envelope: StreamServerEnvelope,
    diagnosticSessionId: string | null = null,
  ): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) {
      return;
    }

    const payload = encodeStreamEnvelope(envelope);
    const payloadBytes = Buffer.byteLength(payload);
    connection.queuedPayloads.push({
      payload,
      bytes: payloadBytes,
      diagnosticSessionId,
    });
    connection.queuedPayloadBytes += payloadBytes;
    this.noteSessionFanoutEnqueue(diagnosticSessionId, payloadBytes);

    if (this.connectionBufferedBytes(connection) > this.maxConnectionBufferedBytes) {
      this.noteSessionFanoutDisconnect(diagnosticSessionId);
      connection.socket.destroy(new Error('connection output buffer exceeded configured maximum'));
      return;
    }

    this.flushConnectionWrites(connectionId);
  }

  private flushConnectionWrites(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined || connection.writeBlocked) {
      return;
    }

    while (connection.queuedPayloads.length > 0) {
      const queued = connection.queuedPayloads.shift()!;
      connection.queuedPayloadBytes -= queued.bytes;
      const writeResult = connection.socket.write(queued.payload);
      if (!writeResult) {
        connection.writeBlocked = true;
        this.noteSessionFanoutBackpressure(queued.diagnosticSessionId);
        break;
      }
    }

    if (this.connectionBufferedBytes(connection) > this.maxConnectionBufferedBytes) {
      const diagnosticSessionId = connection.queuedPayloads[0]?.diagnosticSessionId ?? null;
      this.noteSessionFanoutDisconnect(diagnosticSessionId);
      connection.socket.destroy(new Error('connection output buffer exceeded configured maximum'));
    }
  }

  private connectionBufferedBytes(connection: ConnectionState): number {
    return connection.queuedPayloadBytes + connection.socket.writableLength;
  }
}

export async function startControlPlaneStreamServer(
  options: StartControlPlaneStreamServerOptions,
): Promise<ControlPlaneStreamServer> {
  const server = new ControlPlaneStreamServer(options);
  await server.start();
  return server;
}
