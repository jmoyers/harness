import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinearClient } from '@linear/sdk';
import { type CodexLiveEvent, type LiveSessionNotifyMode } from '../codex/live-session.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import type { TerminalBufferTail, TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';
import {
  encodeStreamEnvelope,
  type StreamObservedEvent,
  type StreamSessionKeyEventRecord,
  type StreamSessionPromptRecord,
  type StreamSessionController,
  type StreamSessionListSort,
  type StreamSessionRuntimeStatus,
  type StreamSessionStatusModel,
  type StreamClientEnvelope,
  type StreamCommand,
  type StreamServerEnvelope,
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
  normalizeAdapterState,
} from '../adapters/agent-session-state.ts';
import {
  buildCursorHookRelayEnvironment,
  buildCursorManagedHookRelayCommand,
  ensureManagedCursorHooksInstalled,
} from '../cursor/managed-hooks.ts';
import { recordPerfEvent } from '../perf/perf-core.ts';
import {
  buildCodexTelemetryConfigArgs,
  parseOtlpLifecycleLogEvents,
  parseOtlpLifecycleMetricEvents,
  parseOtlpLifecycleTraceEvents,
  parseOtlpLogEvents,
  parseOtlpMetricEvents,
  parseOtlpTraceEvents,
  telemetryFingerprint,
  type ParsedCodexTelemetryEvent,
} from './codex-telemetry.ts';
import { executeStreamServerCommand } from './stream-server-command.ts';
import {
  handleAuth as handleConnectionAuth,
  handleClientEnvelope as handleConnectionClientEnvelope,
  handleCommand as handleConnectionCommand,
  handleConnection as handleServerConnection,
  handleSocketData as handleConnectionSocketData,
} from './stream-server-connection.ts';
import {
  pollGitStatus as pollStreamServerGitStatus,
  pollHistoryFile as pollStreamServerHistoryFile,
  pollHistoryFileUnsafe as pollStreamServerHistoryFileUnsafe,
  refreshGitStatusForDirectory as refreshStreamServerGitStatusForDirectory,
} from './stream-server-background.ts';
import {
  applySessionKeyEvent as applyRuntimeSessionKeyEvent,
  handleInput as handleRuntimeInput,
  handleResize as handleRuntimeResize,
  handleSessionEvent as handleRuntimeSessionEvent,
  handleSignal as handleRuntimeSignal,
  persistConversationRuntime as persistRuntimeConversationState,
  publishStatusObservedEvent as publishRuntimeStatusObservedEvent,
  setSessionStatus as setRuntimeSessionStatus,
} from './stream-server-session-runtime.ts';
import { closeOwnedStateStore as closeOwnedStreamServerStateStore } from './stream-server-state-store.ts';
import { SessionStatusEngine } from './status/session-status-engine.ts';
import { SessionPromptEngine } from './prompt/session-prompt-engine.ts';
import {
  appendThreadTitlePromptHistory,
  createAnthropicThreadTitleNamer,
  fallbackThreadTitleFromPromptHistory,
  normalizeThreadTitleCandidate,
  readThreadTitlePromptHistory,
  type ThreadTitleNamer,
} from './prompt/thread-title-namer.ts';
import {
  eventIncludesRepositoryId as filterEventIncludesRepositoryId,
  eventIncludesTaskId as filterEventIncludesTaskId,
  matchesObservedFilter as matchesStreamObservedFilter,
} from './stream-server-observed-filter.ts';
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
  bufferTail?(tailLines?: number): TerminalBufferTail;
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

interface CritiqueLaunchConfig {
  readonly defaultArgs: readonly string[];
}

type AgentToolType = 'codex' | 'claude' | 'cursor' | 'critique';

interface AgentInstallCommandConfig {
  readonly command: string | null;
}

interface AgentInstallConfig {
  readonly codex: AgentInstallCommandConfig;
  readonly claude: AgentInstallCommandConfig;
  readonly cursor: AgentInstallCommandConfig;
  readonly critique: AgentInstallCommandConfig;
}

interface CritiqueConfig {
  readonly launch: CritiqueLaunchConfig;
}

interface CursorLaunchConfig {
  readonly defaultMode: 'yolo' | 'standard';
  readonly directoryModes: Readonly<Record<string, 'yolo' | 'standard'>>;
}

interface CursorHooksConfig {
  readonly managed: boolean;
  readonly hooksFilePath: string | null;
  readonly relayScriptPath: string;
}

interface GitStatusMonitorConfig {
  readonly enabled: boolean;
  readonly pollMs: number;
  readonly maxConcurrency: number;
  readonly minDirectoryRefreshMs: number;
}

interface GitHubIntegrationConfig {
  readonly enabled: boolean;
  readonly apiBaseUrl: string;
  readonly tokenEnvVar: string;
  readonly token: string | null;
  readonly pollMs: number;
  readonly maxConcurrency: number;
  readonly branchStrategy: 'pinned-then-current' | 'current-only' | 'pinned-only';
  readonly viewerLogin: string | null;
}

interface LinearIntegrationConfig {
  readonly enabled: boolean;
  readonly apiBaseUrl: string;
  readonly tokenEnvVar: string;
  readonly token: string | null;
}

interface ThreadTitleConfig {
  readonly enabled: boolean;
  readonly apiKey: string | null;
  readonly modelId: string | null;
  readonly baseUrl: string | null;
  readonly fetch: typeof fetch | null;
}

interface GitHubRemotePullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string | null;
  readonly headBranch: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly state: 'open' | 'closed';
  readonly isDraft: boolean;
  readonly mergedAt: string | null;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly closedAt: string | null;
}

interface GitHubRemotePrJob {
  readonly provider: 'check-run' | 'status-context';
  readonly externalId: string;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly url: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

interface GitHubRemotePrReviewComment {
  readonly commentId: string;
  readonly authorLogin: string | null;
  readonly body: string;
  readonly url: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface GitHubRemotePrReviewThread {
  readonly threadId: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly resolvedByLogin: string | null;
  readonly comments: readonly GitHubRemotePrReviewComment[];
}

interface GitHubProjectReviewCachePullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string | null;
  readonly headBranch: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly state: 'draft' | 'open' | 'merged' | 'closed';
  readonly isDraft: boolean;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly updatedAt: string;
  readonly createdAt: string;
}

interface GitHubProjectReviewCacheEntry {
  readonly repositoryId: string;
  readonly branchName: string;
  readonly pr: GitHubProjectReviewCachePullRequest | null;
  readonly openThreads: readonly GitHubRemotePrReviewThread[];
  readonly resolvedThreads: readonly GitHubRemotePrReviewThread[];
  readonly fetchedAtMs: number;
}

type GitDirectorySnapshot = Awaited<ReturnType<typeof readGitDirectorySnapshot>>;
type GitDirectorySnapshotReader = (cwd: string) => Promise<GitDirectorySnapshot>;
type GitHubTokenResolver = () => Promise<string | null>;
type GitHubExecFile = (
  file: string,
  args: readonly string[],
  options: {
    readonly timeout: number;
    readonly windowsHide: boolean;
  },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

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
  critique?: CritiqueConfig;
  agentInstall?: Partial<Record<AgentToolType, AgentInstallCommandConfig>>;
  cursorLaunch?: CursorLaunchConfig;
  cursorHooks?: Partial<CursorHooksConfig>;
  gitStatus?: GitStatusMonitorConfig;
  github?: Partial<GitHubIntegrationConfig>;
  linear?: Partial<LinearIntegrationConfig>;
  githubTokenResolver?: GitHubTokenResolver;
  githubExecFile?: GitHubExecFile;
  githubFetch?: typeof fetch;
  readGitDirectorySnapshot?: GitDirectorySnapshotReader;
  lifecycleHooks?: HarnessLifecycleHooksConfig;
  threadTitle?: Partial<ThreadTitleConfig>;
  threadTitleNamer?: ThreadTitleNamer;
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
  statusModel: StreamSessionStatusModel | null;
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

interface ThreadTitleRefreshState {
  inFlight: boolean;
  pending: boolean;
}

interface ThreadTitleRefreshResult {
  readonly status: 'updated' | 'unchanged' | 'skipped';
  readonly conversation: ControlPlaneConversationRecord | null;
  readonly reason: string | null;
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
const DEFAULT_GITHUB_POLL_MS = 15_000;
const DEFAULT_GITHUB_PROJECT_REVIEW_PREWARM_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_LINEAR_API_BASE_URL = 'https://api.linear.app/graphql';
const GITHUB_OAUTH_ACCESS_TOKEN_ENV_VAR = 'HARNESS_GITHUB_OAUTH_ACCESS_TOKEN';
const LINEAR_OAUTH_ACCESS_TOKEN_ENV_VAR = 'HARNESS_LINEAR_OAUTH_ACCESS_TOKEN';
const HISTORY_POLL_JITTER_RATIO = 0.35;
const SESSION_DIAGNOSTICS_BUCKET_MS = 10_000;
const SESSION_DIAGNOSTICS_BUCKET_COUNT = 6;
const PROMPT_EVENT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_EVENT_DEDUPE_ENTRIES = 4096;
const DEFAULT_BOOTSTRAP_SESSION_COLS = 80;
const DEFAULT_BOOTSTRAP_SESSION_ROWS = 24;
const DEFAULT_TENANT_ID = 'tenant-local';
const DEFAULT_USER_ID = 'user-local';
const DEFAULT_WORKSPACE_ID = 'workspace-local';
const DEFAULT_WORKTREE_ID = 'worktree-local';
const DEFAULT_CLAUDE_HOOK_RELAY_SCRIPT_PATH = fileURLToPath(
  new URL('../../scripts/codex-notify-relay.ts', import.meta.url),
);
const DEFAULT_CRITIQUE_DEFAULT_ARGS = ['--watch'] as const;
const SUPPORTED_AGENT_TOOL_TYPES = ['codex', 'claude', 'cursor', 'critique'] as const;
const DEFAULT_AGENT_INSTALL_COMMANDS: Readonly<Record<AgentToolType, string | null>> = {
  codex: null,
  claude: null,
  cursor: null,
  critique: 'bun add --global critique@latest',
};
const DEFAULT_CURSOR_HOOK_RELAY_SCRIPT_PATH = fileURLToPath(
  new URL('../../scripts/cursor-hook-relay.ts', import.meta.url),
);
const THREAD_TITLE_AGENT_TYPES = new Set(['codex', 'claude', 'cursor']);
const LIFECYCLE_TELEMETRY_EVENT_NAMES = new Set([
  'codex.user_prompt',
  'codex.turn.e2e_duration_ms',
  'codex.conversation_starts',
]);

function isThreadTitleAgentType(agentType: string): boolean {
  return THREAD_TITLE_AGENT_TYPES.has(agentType.trim().toLowerCase());
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
  const roundedStartMs =
    Math.floor(nowMs / SESSION_DIAGNOSTICS_BUCKET_MS) * SESSION_DIAGNOSTICS_BUCKET_MS;
  return {
    buckets: [0, 0, 0, 0, 0, 0],
    currentBucketStartMs: roundedStartMs,
  };
}

function advanceSessionRollingCounter(counter: SessionRollingCounter, nowMs: number): void {
  const roundedNowMs =
    Math.floor(nowMs / SESSION_DIAGNOSTICS_BUCKET_MS) * SESSION_DIAGNOSTICS_BUCKET_MS;
  const elapsedBuckets = Math.floor(
    (roundedNowMs - counter.currentBucketStartMs) / SESSION_DIAGNOSTICS_BUCKET_MS,
  );
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

function normalizeCritiqueConfig(input: CritiqueConfig | undefined): CritiqueConfig {
  const normalizedDefaultArgs = input?.launch.defaultArgs
    ?.flatMap((value) => (typeof value === 'string' ? [value.trim()] : []))
    .filter((value) => value.length > 0);
  const defaultArgs =
    normalizedDefaultArgs === undefined || normalizedDefaultArgs.length === 0
      ? [...DEFAULT_CRITIQUE_DEFAULT_ARGS]
      : normalizedDefaultArgs;
  return {
    launch: {
      defaultArgs,
    },
  };
}

function normalizeInstallCommand(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeAgentToolType(value: string): AgentToolType | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'codex' ||
    normalized === 'claude' ||
    normalized === 'cursor' ||
    normalized === 'critique'
  ) {
    return normalized;
  }
  return null;
}

function normalizeAgentInstallConfig(
  input: Partial<Record<AgentToolType, AgentInstallCommandConfig>> | undefined,
): AgentInstallConfig {
  const normalized = (agentType: AgentToolType): AgentInstallCommandConfig => ({
    command: (() => {
      const parsedCommand = normalizeInstallCommand(input?.[agentType]?.command);
      if (parsedCommand === undefined) {
        return DEFAULT_AGENT_INSTALL_COMMANDS[agentType];
      }
      return parsedCommand;
    })(),
  });
  return {
    codex: normalized('codex'),
    claude: normalized('claude'),
    cursor: normalized('cursor'),
    critique: normalized('critique'),
  };
}

function normalizeCursorLaunchConfig(input: CursorLaunchConfig | undefined): CursorLaunchConfig {
  return {
    defaultMode: input?.defaultMode ?? 'standard',
    directoryModes: input?.directoryModes ?? {},
  };
}

function normalizeCursorHooksConfig(
  input: Partial<CursorHooksConfig> | undefined,
): CursorHooksConfig {
  const relayScriptPath = input?.relayScriptPath;
  const normalizedRelayScriptPath =
    typeof relayScriptPath === 'string' && relayScriptPath.trim().length > 0
      ? resolve(relayScriptPath)
      : resolve(DEFAULT_CURSOR_HOOK_RELAY_SCRIPT_PATH);
  const hooksFilePath =
    typeof input?.hooksFilePath === 'string' && input.hooksFilePath.trim().length > 0
      ? resolve(input.hooksFilePath)
      : null;
  return {
    managed: input?.managed ?? true,
    hooksFilePath,
    relayScriptPath: normalizedRelayScriptPath,
  };
}

function jitterDelayMs(baseMs: number): number {
  const clampedBaseMs = Math.max(25, Math.floor(baseMs));
  const jitterWindowMs = Math.max(1, Math.floor(clampedBaseMs * HISTORY_POLL_JITTER_RATIO));
  const jitterOffsetMs = Math.floor(Math.random() * (2 * jitterWindowMs + 1) - jitterWindowMs);
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

function normalizeGitHubIntegrationConfig(
  input: Partial<GitHubIntegrationConfig> | undefined,
): GitHubIntegrationConfig {
  const tokenEnvVarRaw = input?.tokenEnvVar;
  const tokenEnvVar =
    typeof tokenEnvVarRaw === 'string' && tokenEnvVarRaw.trim().length > 0
      ? tokenEnvVarRaw.trim()
      : 'GITHUB_TOKEN';
  const manualEnvToken = process.env[tokenEnvVar];
  const oauthEnvToken = process.env[GITHUB_OAUTH_ACCESS_TOKEN_ENV_VAR];
  const envTokenRaw =
    typeof manualEnvToken === 'string' && manualEnvToken.trim().length > 0
      ? manualEnvToken
      : oauthEnvToken;
  const tokenRaw =
    input?.token ??
    (typeof envTokenRaw === 'string' && envTokenRaw.trim().length > 0 ? envTokenRaw.trim() : null);
  const branchStrategyRaw = input?.branchStrategy;
  const branchStrategy =
    branchStrategyRaw === 'current-only' ||
    branchStrategyRaw === 'pinned-only' ||
    branchStrategyRaw === 'pinned-then-current'
      ? branchStrategyRaw
      : 'pinned-then-current';
  const viewerLoginRaw = input?.viewerLogin;
  const viewerLogin =
    typeof viewerLoginRaw === 'string' && viewerLoginRaw.trim().length > 0
      ? viewerLoginRaw.trim()
      : null;
  const pollMsRaw = input?.pollMs;
  const pollMs =
    typeof pollMsRaw === 'number' && Number.isFinite(pollMsRaw)
      ? Math.max(1000, Math.floor(pollMsRaw))
      : DEFAULT_GITHUB_POLL_MS;
  const maxConcurrencyRaw = input?.maxConcurrency;
  const maxConcurrency =
    typeof maxConcurrencyRaw === 'number' && Number.isFinite(maxConcurrencyRaw)
      ? Math.max(1, Math.floor(maxConcurrencyRaw))
      : 1;
  const apiBaseUrlRaw = input?.apiBaseUrl;
  const apiBaseUrl =
    typeof apiBaseUrlRaw === 'string' && apiBaseUrlRaw.trim().length > 0
      ? apiBaseUrlRaw.trim().replace(/\/+$/u, '')
      : 'https://api.github.com';
  return {
    enabled: input?.enabled ?? false,
    apiBaseUrl,
    tokenEnvVar,
    token: tokenRaw,
    pollMs,
    maxConcurrency,
    branchStrategy,
    viewerLogin,
  };
}

function normalizeLinearIntegrationConfig(
  input: Partial<LinearIntegrationConfig> | undefined,
): LinearIntegrationConfig {
  const tokenEnvVarRaw = input?.tokenEnvVar;
  const tokenEnvVar =
    typeof tokenEnvVarRaw === 'string' && tokenEnvVarRaw.trim().length > 0
      ? tokenEnvVarRaw.trim()
      : 'LINEAR_API_KEY';
  const manualEnvToken = process.env[tokenEnvVar];
  const oauthEnvToken = process.env[LINEAR_OAUTH_ACCESS_TOKEN_ENV_VAR];
  const envTokenRaw =
    typeof manualEnvToken === 'string' && manualEnvToken.trim().length > 0
      ? manualEnvToken
      : oauthEnvToken;
  const tokenRaw =
    input?.token ??
    (typeof envTokenRaw === 'string' && envTokenRaw.trim().length > 0 ? envTokenRaw.trim() : null);
  const apiBaseUrlRaw = input?.apiBaseUrl;
  const apiBaseUrl =
    typeof apiBaseUrlRaw === 'string' && apiBaseUrlRaw.trim().length > 0
      ? apiBaseUrlRaw.trim().replace(/\/+$/u, '')
      : DEFAULT_LINEAR_API_BASE_URL;
  return {
    enabled: input?.enabled ?? false,
    apiBaseUrl,
    tokenEnvVar,
    token: tokenRaw,
  };
}

function normalizeThreadTitleConfig(
  input: Partial<ThreadTitleConfig> | undefined,
): ThreadTitleConfig {
  const envApiKeyRaw = process.env.ANTHROPIC_API_KEY;
  const envApiKey =
    typeof envApiKeyRaw === 'string' && envApiKeyRaw.trim().length > 0 ? envApiKeyRaw.trim() : null;
  const apiKeyRaw = input?.apiKey ?? envApiKey;
  const apiKey =
    typeof apiKeyRaw === 'string' && apiKeyRaw.trim().length > 0 ? apiKeyRaw.trim() : null;
  const envModelRaw = process.env.HARNESS_THREAD_TITLE_MODEL;
  const modelFromEnv =
    typeof envModelRaw === 'string' && envModelRaw.trim().length > 0 ? envModelRaw.trim() : null;
  const modelIdRaw = input?.modelId ?? modelFromEnv;
  const modelId =
    typeof modelIdRaw === 'string' && modelIdRaw.trim().length > 0 ? modelIdRaw.trim() : null;
  const baseUrlRaw = input?.baseUrl;
  const baseUrl =
    typeof baseUrlRaw === 'string' && baseUrlRaw.trim().length > 0 ? baseUrlRaw.trim() : null;
  return {
    enabled: input?.enabled ?? apiKey !== null,
    apiKey,
    modelId,
    baseUrl,
    fetch: input?.fetch ?? null,
  };
}

function parseGitHubOwnerRepoFromRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu.exec(trimmed);
  if (httpsMatch !== null) {
    return {
      owner: httpsMatch[1] as string,
      repo: httpsMatch[2] as string,
    };
  }
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/iu.exec(trimmed);
  if (sshMatch !== null) {
    return {
      owner: sshMatch[1] as string,
      repo: sshMatch[2] as string,
    };
  }
  return null;
}

function resolveTrackedBranchName(input: {
  strategy: GitHubIntegrationConfig['branchStrategy'];
  pinnedBranch: string | null;
  currentBranch: string | null;
}): string | null {
  if (input.strategy === 'pinned-only') {
    return input.pinnedBranch;
  }
  if (input.strategy === 'current-only') {
    return input.currentBranch;
  }
  return input.pinnedBranch ?? input.currentBranch;
}

function summarizeGitHubCiRollup(
  jobs: readonly GitHubRemotePrJob[],
): 'pending' | 'success' | 'failure' | 'cancelled' | 'neutral' | 'none' {
  if (jobs.length === 0) {
    return 'none';
  }
  let hasPending = false;
  let hasFailure = false;
  let hasCancelled = false;
  let hasSuccess = false;
  for (const job of jobs) {
    const status = job.status.toLowerCase();
    const conclusion = job.conclusion?.toLowerCase() ?? null;
    if (status !== 'completed') {
      hasPending = true;
      continue;
    }
    if (
      conclusion === 'failure' ||
      conclusion === 'timed_out' ||
      conclusion === 'action_required'
    ) {
      hasFailure = true;
      continue;
    }
    if (conclusion === 'cancelled') {
      hasCancelled = true;
      continue;
    }
    if (conclusion === 'success') {
      hasSuccess = true;
    }
  }
  if (hasFailure) {
    return 'failure';
  }
  if (hasPending) {
    return 'pending';
  }
  if (hasCancelled) {
    return 'cancelled';
  }
  if (hasSuccess) {
    return 'success';
  }
  return 'neutral';
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
      })(),
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
  commandExists,
  normalizeGitHubIntegrationConfig,
  normalizeLinearIntegrationConfig,
  parseGitHubOwnerRepoFromRemote,
  resolveTrackedBranchName,
  summarizeGitHubCiRollup,
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

function looksLikePathCommand(command: string): boolean {
  return command.includes('/') || command.includes('\\');
}

function canExecuteFile(pathname: string): boolean {
  try {
    const stats = statSync(pathname);
    if (!stats.isFile()) {
      return false;
    }
    accessSync(pathname, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  const normalized = command.trim();
  if (normalized.length === 0) {
    return false;
  }
  if (looksLikePathCommand(normalized) || isAbsolute(normalized)) {
    return canExecuteFile(normalized);
  }
  const pathValue = env.PATH ?? '';
  const searchPaths = pathValue
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (searchPaths.length === 0) {
    return false;
  }
  const windowsExtensions =
    platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [''];
  const extensions = platform === 'win32' ? ['', ...windowsExtensions] : windowsExtensions;
  for (const searchPath of searchPaths) {
    for (const extension of extensions) {
      const candidate = join(searchPath, `${normalized}${extension}`);
      if (canExecuteFile(candidate)) {
        return true;
      }
    }
  }
  return false;
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
  private readonly critique: CritiqueConfig;
  private readonly agentInstall: AgentInstallConfig;
  private readonly cursorLaunch: CursorLaunchConfig;
  private readonly cursorHooks: CursorHooksConfig;
  private readonly gitStatusMonitor: GitStatusMonitorConfig;
  private readonly github: GitHubIntegrationConfig;
  private readonly linear: LinearIntegrationConfig;
  private readonly githubTokenResolver: GitHubTokenResolver;
  private readonly githubExecFile: GitHubExecFile;
  private readonly githubFetch: typeof fetch;
  private readonly githubApi: {
    openPullRequestForBranch(input: {
      owner: string;
      repo: string;
      headBranch: string;
    }): Promise<GitHubRemotePullRequest | null>;
    findPullRequestForBranch(input: {
      owner: string;
      repo: string;
      headBranch: string;
    }): Promise<GitHubRemotePullRequest | null>;
    listPullRequestReviewThreads(input: {
      owner: string;
      repo: string;
      pullNumber: number;
    }): Promise<readonly GitHubRemotePrReviewThread[]>;
    createPullRequest(input: {
      owner: string;
      repo: string;
      title: string;
      body: string;
      head: string;
      base: string;
      draft: boolean;
    }): Promise<GitHubRemotePullRequest>;
  };
  private readonly linearApi: {
    issueByIdentifier(input: { identifier: string }): Promise<{
      identifier: string;
      title: string;
      description: string | null;
      url: string | null;
      stateName: string | null;
      teamKey: string | null;
    } | null>;
  };
  private readonly readGitDirectorySnapshot: GitDirectorySnapshotReader;
  private readonly statusEngine = new SessionStatusEngine();
  private readonly promptEngine = new SessionPromptEngine();
  private readonly threadTitleNamer: ThreadTitleNamer | null;
  private readonly promptEventDedupeByKey = new Map<string, number>();
  private readonly threadTitleRevisionBySessionId = new Map<string, number>();
  private readonly threadTitleRefreshBySessionId = new Map<string, ThreadTitleRefreshState>();
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
  private githubPollTimer: NodeJS.Timeout | null = null;
  private githubTokenResolveInFlight: Promise<string | null> | null = null;
  private githubTokenResolutionError: string | null = null;
  private gitStatusPollInFlight = false;
  private githubPollInFlight = false;
  private githubPollPromise: Promise<void> | null = null;
  private readonly gitStatusRefreshInFlightDirectoryIds = new Set<string>();
  private readonly gitStatusByDirectoryId = new Map<string, DirectoryGitStatusCacheEntry>();
  private readonly gitStatusDirectoriesById = new Map<string, ControlPlaneDirectoryRecord>();
  private readonly githubProjectReviewCacheByKey = new Map<string, GitHubProjectReviewCacheEntry>();
  private readonly githubProjectReviewRefreshInFlightByKey = new Map<
    string,
    Promise<GitHubProjectReviewCacheEntry>
  >();
  private readonly connections = new Map<string, ConnectionState>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly launchCommandBySessionId = new Map<string, string>();
  private readonly streamSubscriptions = new Map<string, StreamSubscriptionState>();
  private readonly streamJournal: StreamJournalEntry[] = [];
  private streamCursor = 0;
  private listening = false;
  private stateStoreClosed = false;
  private closing = false;

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
    this.critique = normalizeCritiqueConfig(options.critique);
    this.agentInstall = normalizeAgentInstallConfig(options.agentInstall);
    this.cursorLaunch = normalizeCursorLaunchConfig(options.cursorLaunch);
    this.cursorHooks = normalizeCursorHooksConfig(options.cursorHooks);
    this.gitStatusMonitor = normalizeGitStatusMonitorConfig(options.gitStatus);
    this.github = normalizeGitHubIntegrationConfig(options.github);
    this.linear = normalizeLinearIntegrationConfig(options.linear);
    this.githubExecFile = options.githubExecFile ?? execFile;
    this.githubTokenResolver =
      options.githubTokenResolver ?? (async () => await this.readGhAuthToken());
    this.githubFetch = options.githubFetch ?? fetch;
    this.githubApi = {
      openPullRequestForBranch: this.openGitHubPullRequestForBranch.bind(this),
      findPullRequestForBranch: this.findGitHubPullRequestForBranch.bind(this),
      listPullRequestReviewThreads: this.listGitHubPullRequestReviewThreads.bind(this),
      createPullRequest: this.createGitHubPullRequest.bind(this),
    };
    this.linearApi = {
      issueByIdentifier: this.fetchLinearIssueByIdentifier.bind(this),
    };
    this.readGitDirectorySnapshot =
      options.readGitDirectorySnapshot ??
      (async (cwd: string) =>
        await readGitDirectorySnapshot(cwd, undefined, {
          includeCommitCount: false,
        }));
    const threadTitleConfig = normalizeThreadTitleConfig(options.threadTitle);
    if (options.threadTitleNamer !== undefined) {
      this.threadTitleNamer = options.threadTitleNamer;
    } else if (threadTitleConfig.enabled && threadTitleConfig.apiKey !== null) {
      this.threadTitleNamer = createAnthropicThreadTitleNamer({
        apiKey: threadTitleConfig.apiKey,
        ...(threadTitleConfig.modelId === null ? {} : { modelId: threadTitleConfig.modelId }),
        ...(threadTitleConfig.baseUrl === null ? {} : { baseUrl: threadTitleConfig.baseUrl }),
        ...(threadTitleConfig.fetch === null ? {} : { fetch: threadTitleConfig.fetch }),
      });
    } else {
      this.threadTitleNamer = null;
    }
    this.lifecycleHooks = new LifecycleHooksRuntime(
      options.lifecycleHooks ?? {
        enabled: false,
        providers: {
          codex: true,
          claude: true,
          cursor: true,
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
    this.server = createServer(this.handleConnection.bind(this));
    this.telemetryServer = this.codexTelemetry.enabled
      ? createHttpServer(this.handleTelemetryHttpRequest.bind(this))
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
    this.startGitHubPollingIfEnabled();
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
    this.closing = true;
    this.stopHistoryPolling();
    this.stopGitStatusPolling();
    this.stopGitHubPolling();
    await this.waitForGitHubPollingToSettle();

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
    closeOwnedStreamServerStateStore(
      this as unknown as Parameters<typeof closeOwnedStreamServerStateStore>[0],
    );
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
    void this.pollHistoryFile().catch((error: unknown) => {
      if (this.markStateStoreClosedIfDetected(error)) {
        return;
      }
      if (this.shouldSkipStateStoreWork()) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      recordPerfEvent('control-plane.history.poll.failed', {
        error: message,
      });
    });
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
    this.triggerGitStatusPoll();
    this.gitStatusPollTimer = setInterval(() => {
      this.triggerGitStatusPoll();
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

  private async readGhAuthToken(): Promise<string | null> {
    return await new Promise((resolveToken) => {
      this.githubExecFile(
        'gh',
        ['auth', 'token'],
        {
          timeout: 2000,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error !== null) {
            resolveToken(null);
            return;
          }
          const token = stdout.trim();
          resolveToken(token.length > 0 ? token : null);
        },
      );
    });
  }

  private async resolveGitHubTokenIfNeeded(): Promise<string | null> {
    if (this.github.token !== null) {
      return this.github.token;
    }
    if (this.githubTokenResolveInFlight !== null) {
      return await this.githubTokenResolveInFlight;
    }
    this.githubTokenResolveInFlight = (async () => {
      try {
        const resolved = await this.githubTokenResolver();
        if (resolved === null) {
          this.githubTokenResolutionError = 'missing token and gh auth token unavailable';
          recordPerfEvent('control-plane.github.token.unavailable', {
            tokenEnvVar: this.github.tokenEnvVar,
            fallback: 'gh auth token',
          });
          return null;
        }
        this.githubTokenResolutionError = null;
        (this.github as { token: string | null }).token = resolved;
        recordPerfEvent('control-plane.github.token.resolved', {
          source: 'gh auth token',
        });
        return resolved;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.githubTokenResolutionError = message;
        recordPerfEvent('control-plane.github.token.resolve-failed', {
          error: message,
        });
        return null;
      } finally {
        this.githubTokenResolveInFlight = null;
      }
    })();
    return await this.githubTokenResolveInFlight;
  }

  private startGitHubPollingIfEnabled(): void {
    if (!this.github.enabled || this.githubPollTimer !== null) {
      return;
    }
    this.triggerGitHubPoll();
    this.githubPollTimer = setInterval(() => {
      this.triggerGitHubPoll();
    }, this.github.pollMs);
    this.githubPollTimer.unref();
  }

  private stopGitHubPolling(): void {
    if (this.githubPollTimer === null) {
      return;
    }
    clearInterval(this.githubPollTimer);
    this.githubPollTimer = null;
  }

  private triggerGitHubPoll(): void {
    void this.pollGitHub().catch((error: unknown) => {
      if (this.markStateStoreClosedIfDetected(error)) {
        return;
      }
      if (this.shouldIgnoreGitHubPollError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      recordPerfEvent('control-plane.github.poll.failed', {
        error: message,
      });
    });
  }

  private triggerGitStatusPoll(): void {
    void this.pollGitStatus().catch((error: unknown) => {
      if (this.markStateStoreClosedIfDetected(error)) {
        return;
      }
      if (this.shouldSkipStateStoreWork()) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      recordPerfEvent('control-plane.git-status.poll.failed', {
        error: message,
      });
    });
  }

  private isStateStoreClosedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.trim().toLowerCase();
    return (
      normalized.includes('database has closed') ||
      normalized.includes('database is closed') ||
      normalized.includes('cannot use a closed database')
    );
  }

  private markStateStoreClosedIfDetected(error: unknown): boolean {
    if (!this.isStateStoreClosedError(error)) {
      return false;
    }
    this.stateStoreClosed = true;
    this.stopGitHubPolling();
    this.stopGitStatusPolling();
    this.stopHistoryPolling();
    return true;
  }

  private shouldSkipStateStoreWork(): boolean {
    return this.closing || this.stateStoreClosed;
  }

  private shouldIgnoreGitHubPollError(error: unknown): boolean {
    return this.shouldSkipStateStoreWork() || this.isStateStoreClosedError(error);
  }

  private async waitForGitHubPollingToSettle(): Promise<void> {
    const pollPromise = this.githubPollPromise;
    if (pollPromise === null) {
      return;
    }
    try {
      await pollPromise;
    } catch (error: unknown) {
      if (this.markStateStoreClosedIfDetected(error)) {
        return;
      }
      if (!this.shouldIgnoreGitHubPollError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        recordPerfEvent('control-plane.github.poll.failed-on-close', {
          error: message,
        });
      }
    }
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
    agentType: string,
  ): {
    readonly args: readonly string[];
    readonly notifyFilePath: string;
  } | null {
    if (agentType !== 'claude') {
      return null;
    }
    const notifyFilePath = join(
      tmpdir(),
      `harness-claude-hook-${process.pid}-${sessionId}-${randomUUID()}.jsonl`,
    );
    const relayScriptPath = resolve(DEFAULT_CLAUDE_HOOK_RELAY_SCRIPT_PATH);
    const hookCommand = `/usr/bin/env ${shellEscape(process.execPath)} ${shellEscape(relayScriptPath)} ${shellEscape(notifyFilePath)}`;
    const hook = {
      type: 'command',
      command: hookCommand,
    };
    const settings = {
      hooks: {
        UserPromptSubmit: [{ hooks: [hook] }],
        PreToolUse: [{ hooks: [hook] }],
        Stop: [{ hooks: [hook] }],
        Notification: [{ hooks: [hook] }],
      },
    };
    return {
      args: ['--settings', JSON.stringify(settings)],
      notifyFilePath,
    };
  }

  private cursorHookLaunchConfigForSession(
    sessionId: string,
    agentType: string,
  ): {
    readonly notifyFilePath: string;
    readonly env: Readonly<Record<string, string>>;
  } | null {
    if (agentType !== 'cursor') {
      return null;
    }
    if (this.cursorHooks.managed) {
      const relayCommand = buildCursorManagedHookRelayCommand(this.cursorHooks.relayScriptPath);
      const installResult = ensureManagedCursorHooksInstalled({
        relayCommand,
        ...(this.cursorHooks.hooksFilePath === null
          ? {}
          : { hooksFilePath: this.cursorHooks.hooksFilePath }),
      });
      recordPerfEvent('control-plane.cursor-hooks.managed.ensure', {
        filePath: installResult.filePath,
        changed: installResult.changed,
        removedCount: installResult.removedCount,
        addedCount: installResult.addedCount,
      });
    }
    const notifyFilePath = join(
      tmpdir(),
      `harness-cursor-hook-${process.pid}-${sessionId}-${randomUUID()}.jsonl`,
    );
    return {
      notifyFilePath,
      env: buildCursorHookRelayEnvironment(sessionId, notifyFilePath),
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
        baseArgs: [],
      };
    }
    if (agentType === 'cursor') {
      return {
        command: 'cursor-agent',
        baseArgs: [],
      };
    }
    if (agentType === 'critique') {
      return {
        command: 'critique',
        baseArgs: [],
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

  resolveAgentToolStatus(agentTypes?: readonly string[]): ReadonlyArray<{
    agentType: string;
    launchCommand: string;
    available: boolean;
    installCommand: string | null;
  }> {
    const requested = agentTypes ?? SUPPORTED_AGENT_TOOL_TYPES;
    const normalized: AgentToolType[] = [];
    for (const rawType of requested) {
      const parsedType = normalizeAgentToolType(rawType);
      if (parsedType === null || normalized.includes(parsedType)) {
        continue;
      }
      normalized.push(parsedType);
    }
    const effectiveTypes = normalized.length > 0 ? normalized : [...SUPPORTED_AGENT_TOOL_TYPES];
    return effectiveTypes.map((agentType) => {
      const launchProfile = this.launchProfileForAgent(agentType);
      const launchCommand = launchProfile.command ?? 'codex';
      return {
        agentType,
        launchCommand,
        available: commandExists(launchCommand, process.env, process.platform),
        installCommand: this.agentInstall[agentType].command,
      };
    });
  }

  private autoStartPersistedConversationsOnStartup(): void {
    const conversations = this.stateStore.listConversations();
    let started = 0;
    let failed = 0;
    for (const conversation of conversations) {
      const adapterState = normalizeAdapterState(conversation.adapterState);
      const directory = this.stateStore.getDirectory(conversation.directoryId);
      const baseArgs =
        conversation.agentType === 'critique' ? this.critique.launch.defaultArgs : [];
      const startArgs = buildAgentSessionStartArgs(conversation.agentType, baseArgs, adapterState, {
        directoryPath: directory?.path ?? null,
        codexLaunchDefaultMode: this.codexLaunch.defaultMode,
        codexLaunchModeByDirectoryPath: this.codexLaunch.directoryModes,
        cursorLaunchDefaultMode: this.cursorLaunch.defaultMode,
        cursorLaunchModeByDirectoryPath: this.cursorLaunch.directoryModes,
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
    const baseSessionArgs =
      agentType === 'critique' && command.args.length === 0
        ? [...this.critique.launch.defaultArgs]
        : [...command.args];
    const codexLaunchArgs = this.codexLaunchArgsForSession(command.sessionId, agentType);
    const claudeHookLaunchConfig = this.claudeHookLaunchConfigForSession(
      command.sessionId,
      agentType,
    );
    const cursorHookLaunchConfig = this.cursorHookLaunchConfigForSession(
      command.sessionId,
      agentType,
    );
    const launchProfile = this.launchProfileForAgent(agentType);
    let launchCommandName = launchProfile.command ?? 'codex';
    let launchArgs = [
      ...codexLaunchArgs,
      ...(claudeHookLaunchConfig?.args ?? []),
      ...baseSessionArgs,
    ];
    const launchCommand = formatLaunchCommand(launchCommandName, launchArgs);
    const startInput: StartControlPlaneSessionInput = {
      args: launchArgs,
      initialCols: command.initialCols,
      initialRows: command.initialRows,
    };
    if (agentType === 'codex' || agentType === 'claude') {
      startInput.useNotifyHook = true;
      startInput.notifyMode = (
        agentType === 'claude' ? 'external' : 'codex'
      ) as LiveSessionNotifyMode;
    }
    if (agentType === 'cursor') {
      startInput.useNotifyHook = true;
      startInput.notifyMode = 'external';
    }
    if (claudeHookLaunchConfig !== null) {
      startInput.notifyFilePath = claudeHookLaunchConfig.notifyFilePath;
    }
    if (cursorHookLaunchConfig !== null) {
      const mergedEnv: Record<string, string> = {};
      const baseEnv = command.env ?? process.env;
      for (const [key, value] of Object.entries(baseEnv)) {
        if (typeof value !== 'string') {
          continue;
        }
        mergedEnv[key] = value;
      }
      startInput.notifyFilePath = cursorHookLaunchConfig.notifyFilePath;
      startInput.env = {
        ...mergedEnv,
        ...cursorHookLaunchConfig.env,
      };
    }
    if (launchProfile.command !== undefined || launchCommandName !== 'codex') {
      startInput.command = launchCommandName;
    }
    if (launchProfile.baseArgs !== undefined) {
      startInput.baseArgs = [...launchProfile.baseArgs];
    }
    if (command.env !== undefined && cursorHookLaunchConfig === null) {
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
    const latestTelemetry = this.stateStore.latestTelemetrySummary(command.sessionId);
    const startupObservedAt =
      persistedRuntimeLastEventAt ?? latestTelemetry?.observedAt ?? new Date().toISOString();
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
    const initialStatusModel = this.statusEngine.project({
      agentType,
      runtimeStatus: initialStatus,
      attentionReason: initialAttentionReason,
      telemetry: latestTelemetry,
      observedAt: startupObservedAt,
      previous: persistedConversation?.runtimeStatusModel ?? null,
    });
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
      statusModel: initialStatusModel,
      attentionReason: initialAttentionReason,
      lastEventAt: persistedConversation?.runtimeLastEventAt ?? null,
      lastExit: persistedConversation?.runtimeLastExit ?? null,
      lastSnapshot: null,
      startedAt: new Date().toISOString(),
      exitedAt: null,
      tombstoneTimer: null,
      lastObservedOutputCursor: session.latestCursorValue(),
      latestTelemetry,
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
    const requestWithEvents = request as unknown as {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      once?: (event: string, listener: (...args: unknown[]) => void) => void;
      off?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
    const responseWithEvents = response as unknown as {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      once?: (event: string, listener: (...args: unknown[]) => void) => void;
      off?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
    const onStreamError = (error: unknown): void => {
      if (isTelemetryRequestAbortError(error)) {
        return;
      }
      if (response.writableEnded) {
        return;
      }
      response.statusCode = 500;
      response.end();
    };
    const cleanupStreamErrorListeners = (): void => {
      requestWithEvents.off?.('error', onStreamError);
      responseWithEvents.off?.('error', onStreamError);
      requestWithEvents.off?.('close', cleanupStreamErrorListeners);
      responseWithEvents.off?.('close', cleanupStreamErrorListeners);
      responseWithEvents.off?.('finish', cleanupStreamErrorListeners);
    };
    requestWithEvents.on?.('error', onStreamError);
    responseWithEvents.on?.('error', onStreamError);
    requestWithEvents.once?.('close', cleanupStreamErrorListeners);
    responseWithEvents.once?.('close', cleanupStreamErrorListeners);
    responseWithEvents.once?.('finish', cleanupStreamErrorListeners);

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
    if (inserted && resolvedSessionId !== null) {
      const promptEvent = this.promptEngine.extractFromTelemetry({
        agentType: 'codex',
        source: event.source,
        eventName: event.eventName,
        summary: event.summary,
        payload: event.payload,
        observedAt: event.observedAt,
      });
      if (promptEvent !== null) {
        const liveState = this.sessions.get(resolvedSessionId);
        if (liveState !== undefined) {
          this.publishSessionPromptObservedEvent(liveState, promptEvent);
        } else {
          const observedScope = this.observedScopeForSessionId(resolvedSessionId);
          if (observedScope !== null) {
            this.publishSessionPromptObservedEventForScope(
              resolvedSessionId,
              observedScope,
              promptEvent,
            );
          }
        }
      }
    }
    if (!inserted || resolvedSessionId === null) {
      return;
    }

    const keyEvent: StreamSessionKeyEventRecord = {
      source: event.source,
      eventName: event.eventName,
      severity: event.severity,
      summary: event.summary,
      observedAt: event.observedAt,
      statusHint: event.statusHint,
    };
    const sessionState = this.sessions.get(resolvedSessionId);
    let publishedThroughRuntime = false;
    if (sessionState !== undefined) {
      if (event.providerThreadId !== null) {
        this.updateSessionThreadId(sessionState, event.providerThreadId, event.observedAt);
      }
      const shouldApplyStatusHint =
        keyEvent.statusHint !== null &&
        event.source !== 'history' &&
        sessionState.status !== 'exited' &&
        sessionState.session !== null;
      applyRuntimeSessionKeyEvent(
        this as unknown as Parameters<typeof applyRuntimeSessionKeyEvent>[0],
        sessionState,
        keyEvent,
        {
          applyStatusHint: shouldApplyStatusHint,
        },
      );
      publishedThroughRuntime = true;
    }

    const observedScope = publishedThroughRuntime
      ? null
      : this.observedScopeForSessionId(resolvedSessionId);
    if (observedScope !== null) {
      this.publishObservedEvent(observedScope, {
        type: 'session-key-event',
        sessionId: resolvedSessionId,
        keyEvent,
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
    try {
      await pollStreamServerHistoryFile(
        this as unknown as Parameters<typeof pollStreamServerHistoryFile>[0],
      );
    } catch (error: unknown) {
      if (!this.markStateStoreClosedIfDetected(error)) {
        throw error;
      }
    }
  }

  private async pollHistoryFileUnsafe(): Promise<boolean> {
    return await pollStreamServerHistoryFileUnsafe(
      this as unknown as Parameters<typeof pollStreamServerHistoryFileUnsafe>[0],
    );
  }

  private async pollGitStatus(): Promise<void> {
    try {
      await pollStreamServerGitStatus(
        this as unknown as Parameters<typeof pollStreamServerGitStatus>[0],
      );
    } catch (error: unknown) {
      if (!this.markStateStoreClosedIfDetected(error)) {
        throw error;
      }
    }
  }

  private async refreshGitStatusForDirectory(
    directory: ControlPlaneDirectoryRecord,
    options: {
      readonly forcePublish?: boolean;
    } = {},
  ): Promise<void> {
    await refreshStreamServerGitStatusForDirectory(
      this as unknown as Parameters<typeof refreshStreamServerGitStatusForDirectory>[0],
      directory,
      options,
    );
  }

  private async pollGitHub(): Promise<void> {
    if (!this.github.enabled || this.githubPollInFlight || this.shouldSkipStateStoreWork()) {
      return;
    }
    this.githubPollInFlight = true;
    const pollPromise = (async () => {
      const directories = this.stateStore.listDirectories({
        includeArchived: false,
        limit: 1000,
      });
      const targetsByKey = new Map<
        string,
        {
          directory: ControlPlaneDirectoryRecord;
          repository: ControlPlaneRepositoryRecord;
          owner: string;
          repo: string;
          branchName: string;
        }
      >();
      for (const directory of directories) {
        if (this.shouldSkipStateStoreWork()) {
          return;
        }
        const gitStatus = this.gitStatusByDirectoryId.get(directory.directoryId);
        const repositoryId = gitStatus?.repositoryId ?? null;
        if (repositoryId === null) {
          continue;
        }
        const repository = this.stateStore.getRepository(repositoryId);
        if (repository === null || repository.archivedAt !== null) {
          continue;
        }
        const ownerRepo = parseGitHubOwnerRepoFromRemote(repository.remoteUrl);
        if (ownerRepo === null) {
          continue;
        }
        const settings = this.stateStore.getProjectSettings(directory.directoryId);
        const branchName = resolveTrackedBranchName({
          strategy: this.github.branchStrategy,
          pinnedBranch: settings.pinnedBranch,
          currentBranch: gitStatus?.summary.branch ?? null,
        });
        if (branchName === null) {
          continue;
        }
        const key = `${repository.repositoryId}:${branchName}`;
        if (targetsByKey.has(key)) {
          continue;
        }
        targetsByKey.set(key, {
          directory,
          repository,
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
          branchName,
        });
      }
      if (targetsByKey.size === 0 || this.shouldSkipStateStoreWork()) {
        return;
      }
      const token = this.github.token ?? (await this.resolveGitHubTokenIfNeeded());
      if (token === null || this.shouldSkipStateStoreWork()) {
        return;
      }
      await runWithConcurrencyLimit(
        [...targetsByKey.values()],
        this.github.maxConcurrency,
        async (target) => {
          if (this.shouldSkipStateStoreWork()) {
            return;
          }
          await this.syncGitHubBranch(target);
        },
      );
    })();
    this.githubPollPromise = pollPromise;
    try {
      await pollPromise;
    } catch (error: unknown) {
      if (!this.markStateStoreClosedIfDetected(error)) {
        throw error;
      }
    } finally {
      if (this.githubPollPromise === pollPromise) {
        this.githubPollPromise = null;
      }
      this.githubPollInFlight = false;
    }
  }

  private githubProjectReviewCacheKey(input: { repositoryId: string; branchName: string }): string {
    return `${input.repositoryId}:${input.branchName}`;
  }

  private getGitHubProjectReviewCache(input: { repositoryId: string; branchName: string }): {
    repositoryId: string;
    branchName: string;
    pr: {
      number: number;
      title: string;
      url: string;
      authorLogin: string | null;
      headBranch: string;
      headSha: string;
      baseBranch: string;
      state: 'draft' | 'open' | 'merged' | 'closed';
      isDraft: boolean;
      mergedAt: string | null;
      closedAt: string | null;
      updatedAt: string;
      createdAt: string;
    } | null;
    openThreads: readonly {
      threadId: string;
      isResolved: boolean;
      isOutdated: boolean;
      resolvedByLogin: string | null;
      comments: readonly {
        commentId: string;
        authorLogin: string | null;
        body: string;
        url: string | null;
        createdAt: string;
        updatedAt: string;
      }[];
    }[];
    resolvedThreads: readonly {
      threadId: string;
      isResolved: boolean;
      isOutdated: boolean;
      resolvedByLogin: string | null;
      comments: readonly {
        commentId: string;
        authorLogin: string | null;
        body: string;
        url: string | null;
        createdAt: string;
        updatedAt: string;
      }[];
    }[];
    fetchedAtMs: number;
  } | null {
    const key = this.githubProjectReviewCacheKey(input);
    const cached = this.githubProjectReviewCacheByKey.get(key);
    return cached ?? null;
  }

  private async refreshGitHubProjectReviewCache(input: {
    repositoryId: string;
    owner: string;
    repo: string;
    branchName: string;
    forceRefresh?: boolean;
    remotePr?: GitHubRemotePullRequest | null;
  }): Promise<{
    repositoryId: string;
    branchName: string;
    pr: {
      number: number;
      title: string;
      url: string;
      authorLogin: string | null;
      headBranch: string;
      headSha: string;
      baseBranch: string;
      state: 'draft' | 'open' | 'merged' | 'closed';
      isDraft: boolean;
      mergedAt: string | null;
      closedAt: string | null;
      updatedAt: string;
      createdAt: string;
    } | null;
    openThreads: readonly {
      threadId: string;
      isResolved: boolean;
      isOutdated: boolean;
      resolvedByLogin: string | null;
      comments: readonly {
        commentId: string;
        authorLogin: string | null;
        body: string;
        url: string | null;
        createdAt: string;
        updatedAt: string;
      }[];
    }[];
    resolvedThreads: readonly {
      threadId: string;
      isResolved: boolean;
      isOutdated: boolean;
      resolvedByLogin: string | null;
      comments: readonly {
        commentId: string;
        authorLogin: string | null;
        body: string;
        url: string | null;
        createdAt: string;
        updatedAt: string;
      }[];
    }[];
    fetchedAtMs: number;
  }> {
    const key = this.githubProjectReviewCacheKey(input);
    const forceRefresh = input.forceRefresh === true;
    const cached = this.githubProjectReviewCacheByKey.get(key);
    if (
      !forceRefresh &&
      cached !== undefined &&
      Date.now() - cached.fetchedAtMs < DEFAULT_GITHUB_PROJECT_REVIEW_PREWARM_INTERVAL_MS
    ) {
      return cached;
    }
    const inFlight = this.githubProjectReviewRefreshInFlightByKey.get(key);
    if (inFlight !== undefined) {
      return await inFlight;
    }
    const refreshPromise: Promise<GitHubProjectReviewCacheEntry> = (async () => {
      const remotePr =
        input.remotePr !== undefined
          ? input.remotePr
          : await this.openGitHubPullRequestForBranch({
              owner: input.owner,
              repo: input.repo,
              headBranch: input.branchName,
            });
      if (remotePr === null) {
        const next: GitHubProjectReviewCacheEntry = {
          repositoryId: input.repositoryId,
          branchName: input.branchName,
          pr: null,
          openThreads: [],
          resolvedThreads: [],
          fetchedAtMs: Date.now(),
        };
        this.githubProjectReviewCacheByKey.set(key, next);
        return next;
      }
      const reviewThreads = await this.listGitHubPullRequestReviewThreads({
        owner: input.owner,
        repo: input.repo,
        pullNumber: remotePr.number,
      });
      const next: GitHubProjectReviewCacheEntry = {
        repositoryId: input.repositoryId,
        branchName: input.branchName,
        pr: {
          number: remotePr.number,
          title: remotePr.title,
          url: remotePr.url,
          authorLogin: remotePr.authorLogin,
          headBranch: remotePr.headBranch,
          headSha: remotePr.headSha,
          baseBranch: remotePr.baseBranch,
          state:
            remotePr.state === 'open' && remotePr.isDraft
              ? 'draft'
              : remotePr.state === 'open'
                ? 'open'
                : remotePr.mergedAt !== null
                  ? 'merged'
                  : 'closed',
          isDraft: remotePr.isDraft,
          mergedAt: remotePr.mergedAt,
          closedAt: remotePr.closedAt,
          updatedAt: remotePr.updatedAt,
          createdAt: remotePr.createdAt,
        },
        openThreads: reviewThreads.filter((thread) => !thread.isResolved),
        resolvedThreads: reviewThreads.filter((thread) => thread.isResolved),
        fetchedAtMs: Date.now(),
      };
      this.githubProjectReviewCacheByKey.set(key, next);
      return next;
    })();
    this.githubProjectReviewRefreshInFlightByKey.set(key, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      if (this.githubProjectReviewRefreshInFlightByKey.get(key) === refreshPromise) {
        this.githubProjectReviewRefreshInFlightByKey.delete(key);
      }
    }
  }

  private async syncGitHubBranch(input: {
    directory: ControlPlaneDirectoryRecord;
    repository: ControlPlaneRepositoryRecord;
    owner: string;
    repo: string;
    branchName: string;
  }): Promise<void> {
    if (this.shouldSkipStateStoreWork()) {
      return;
    }
    const now = new Date().toISOString();
    const syncStateId = `github-sync:${input.repository.repositoryId}:${input.directory.directoryId}:${input.branchName}`;
    try {
      const remotePr = await this.openGitHubPullRequestForBranch({
        owner: input.owner,
        repo: input.repo,
        headBranch: input.branchName,
      });
      if (this.shouldSkipStateStoreWork()) {
        return;
      }
      if (remotePr === null) {
        this.githubProjectReviewCacheByKey.set(
          this.githubProjectReviewCacheKey({
            repositoryId: input.repository.repositoryId,
            branchName: input.branchName,
          }),
          {
            repositoryId: input.repository.repositoryId,
            branchName: input.branchName,
            pr: null,
            openThreads: [],
            resolvedThreads: [],
            fetchedAtMs: Date.now(),
          },
        );
        const staleOpen = this.stateStore.listGitHubPullRequests({
          repositoryId: input.repository.repositoryId,
          headBranch: input.branchName,
          state: 'open',
        });
        for (const existing of staleOpen) {
          const closed = this.stateStore.upsertGitHubPullRequest({
            prRecordId: existing.prRecordId,
            tenantId: existing.tenantId,
            userId: existing.userId,
            workspaceId: existing.workspaceId,
            repositoryId: existing.repositoryId,
            directoryId: existing.directoryId,
            owner: existing.owner,
            repo: existing.repo,
            number: existing.number,
            title: existing.title,
            url: existing.url,
            authorLogin: existing.authorLogin,
            headBranch: existing.headBranch,
            headSha: existing.headSha,
            baseBranch: existing.baseBranch,
            state: 'closed',
            isDraft: existing.isDraft,
            ciRollup: existing.ciRollup,
            closedAt: now,
            observedAt: now,
          });
          this.publishObservedEvent(
            {
              tenantId: closed.tenantId,
              userId: closed.userId,
              workspaceId: closed.workspaceId,
              directoryId: input.directory.directoryId,
              conversationId: null,
            },
            {
              type: 'github-pr-closed',
              prRecordId: closed.prRecordId,
              repositoryId: closed.repositoryId,
              ts: now,
            },
          );
        }
        this.stateStore.upsertGitHubSyncState({
          stateId: syncStateId,
          tenantId: input.directory.tenantId,
          userId: input.directory.userId,
          workspaceId: input.directory.workspaceId,
          repositoryId: input.repository.repositoryId,
          directoryId: input.directory.directoryId,
          branchName: input.branchName,
          lastSyncAt: now,
          lastSuccessAt: now,
          lastError: null,
          lastErrorAt: null,
        });
        return;
      }

      const storedPr = this.stateStore.upsertGitHubPullRequest({
        prRecordId: `github-pr-${randomUUID()}`,
        tenantId: input.directory.tenantId,
        userId: input.directory.userId,
        workspaceId: input.directory.workspaceId,
        repositoryId: input.repository.repositoryId,
        directoryId: input.directory.directoryId,
        owner: input.owner,
        repo: input.repo,
        number: remotePr.number,
        title: remotePr.title,
        url: remotePr.url,
        authorLogin: remotePr.authorLogin,
        headBranch: remotePr.headBranch,
        headSha: remotePr.headSha,
        baseBranch: remotePr.baseBranch,
        state: remotePr.state,
        isDraft: remotePr.isDraft,
        observedAt: remotePr.updatedAt || now,
      });
      void this.refreshGitHubProjectReviewCache({
        repositoryId: input.repository.repositoryId,
        owner: input.owner,
        repo: input.repo,
        branchName: input.branchName,
        remotePr,
      }).catch(() => {});
      const jobs = await this.listGitHubPrJobsForCommit({
        owner: input.owner,
        repo: input.repo,
        headSha: storedPr.headSha,
      });
      if (this.shouldSkipStateStoreWork()) {
        return;
      }
      const rollup = summarizeGitHubCiRollup(jobs);
      const updatedPr =
        this.stateStore.updateGitHubPullRequestCiRollup(
          storedPr.prRecordId,
          rollup,
          remotePr.updatedAt || now,
        ) ?? storedPr;
      const storedJobs = this.stateStore.replaceGitHubPrJobs({
        tenantId: updatedPr.tenantId,
        userId: updatedPr.userId,
        workspaceId: updatedPr.workspaceId,
        repositoryId: updatedPr.repositoryId,
        prRecordId: updatedPr.prRecordId,
        observedAt: remotePr.updatedAt || now,
        jobs: jobs.map((job) => ({
          jobRecordId: `github-job-${randomUUID()}`,
          provider: job.provider,
          externalId: job.externalId,
          name: job.name,
          status: job.status,
          conclusion: job.conclusion,
          url: job.url,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        })),
      });
      const observedScope = {
        tenantId: updatedPr.tenantId,
        userId: updatedPr.userId,
        workspaceId: updatedPr.workspaceId,
        directoryId: updatedPr.directoryId,
        conversationId: null,
      };
      this.publishObservedEvent(observedScope, {
        type: 'github-pr-upserted',
        pr: updatedPr as unknown as Record<string, unknown>,
      });
      this.publishObservedEvent(observedScope, {
        type: 'github-pr-jobs-updated',
        prRecordId: updatedPr.prRecordId,
        repositoryId: updatedPr.repositoryId,
        ciRollup: rollup,
        jobs: storedJobs as unknown as Record<string, unknown>[],
        ts: now,
      });
      this.stateStore.upsertGitHubSyncState({
        stateId: syncStateId,
        tenantId: input.directory.tenantId,
        userId: input.directory.userId,
        workspaceId: input.directory.workspaceId,
        repositoryId: input.repository.repositoryId,
        directoryId: input.directory.directoryId,
        branchName: input.branchName,
        lastSyncAt: now,
        lastSuccessAt: now,
        lastError: null,
        lastErrorAt: null,
      });
    } catch (error: unknown) {
      if (this.markStateStoreClosedIfDetected(error)) {
        return;
      }
      if (this.shouldIgnoreGitHubPollError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.stateStore.upsertGitHubSyncState({
          stateId: syncStateId,
          tenantId: input.directory.tenantId,
          userId: input.directory.userId,
          workspaceId: input.directory.workspaceId,
          repositoryId: input.repository.repositoryId,
          directoryId: input.directory.directoryId,
          branchName: input.branchName,
          lastSyncAt: now,
          lastSuccessAt: null,
          lastError: message,
          lastErrorAt: now,
        });
      } catch (syncStateError: unknown) {
        if (this.markStateStoreClosedIfDetected(syncStateError)) {
          return;
        }
        if (!this.shouldIgnoreGitHubPollError(syncStateError)) {
          throw syncStateError;
        }
      }
    }
  }

  private async githubJsonRequest(
    path: string,
    init: Omit<RequestInit, 'headers'> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    const token = this.github.token ?? (await this.resolveGitHubTokenIfNeeded());
    if (token === null) {
      const hint =
        this.githubTokenResolutionError === null
          ? `set ${this.github.tokenEnvVar} or ${GITHUB_OAUTH_ACCESS_TOKEN_ENV_VAR} or run gh auth login`
          : `${this.githubTokenResolutionError}; set ${this.github.tokenEnvVar} or ${GITHUB_OAUTH_ACCESS_TOKEN_ENV_VAR} or run gh auth login`;
      throw new Error(`github token not configured: ${hint}`);
    }
    const response = await this.githubFetch(`${this.github.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'harness-control-plane',
        ...init.headers,
      },
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `github api request failed (${response.status}): ${message || response.statusText}`,
      );
    }
    return await response.json();
  }

  private async fetchLinearIssueByIdentifier(input: { identifier: string }): Promise<{
    identifier: string;
    title: string;
    description: string | null;
    url: string | null;
    stateName: string | null;
    teamKey: string | null;
  } | null> {
    const token = this.linear.token;
    if (token === null || token.trim().length === 0) {
      throw new Error(
        `linear token not configured: set ${this.linear.tokenEnvVar} or ${LINEAR_OAUTH_ACCESS_TOKEN_ENV_VAR}`,
      );
    }
    const client = new LinearClient({
      apiKey: token,
      apiUrl: this.linear.apiBaseUrl,
    });
    const response = await client.client.rawRequest<
      {
        issues?: {
          nodes?: Array<{
            identifier?: string;
            title?: string;
            description?: string | null;
            url?: string | null;
            state?: {
              name?: string | null;
            } | null;
            team?: {
              key?: string | null;
            } | null;
          }>;
        };
      },
      { identifier: string }
    >(
      `
        query HarnessLinearIssueImport($identifier: String!) {
          issues(filter: { identifier: { eq: $identifier } }, first: 1) {
            nodes {
              identifier
              title
              description
              url
              state {
                name
              }
              team {
                key
              }
            }
          }
        }
      `,
      {
        identifier: input.identifier,
      },
    );
    const issue = response.data?.issues?.nodes?.[0];
    if (issue === undefined) {
      return null;
    }
    if (typeof issue.identifier !== 'string' || typeof issue.title !== 'string') {
      throw new Error('linear issue response malformed');
    }
    return {
      identifier: issue.identifier,
      title: issue.title,
      description: typeof issue.description === 'string' ? issue.description : null,
      url: typeof issue.url === 'string' ? issue.url : null,
      stateName: typeof issue.state?.name === 'string' ? issue.state.name : null,
      teamKey: typeof issue.team?.key === 'string' ? issue.team.key : null,
    };
  }

  private parseGitHubPullRequest(value: unknown): GitHubRemotePullRequest | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const number = record['number'];
    const title = record['title'];
    const htmlUrl = record['html_url'];
    const state = record['state'];
    const draft = record['draft'];
    const head = record['head'];
    const base = record['base'];
    const user = record['user'];
    const updatedAt = record['updated_at'];
    const createdAt = record['created_at'];
    const closedAt = record['closed_at'];
    const mergedAtRaw = record['merged_at'];
    const mergedAt = mergedAtRaw === undefined ? null : mergedAtRaw;
    if (
      typeof number !== 'number' ||
      typeof title !== 'string' ||
      typeof htmlUrl !== 'string' ||
      (state !== 'open' && state !== 'closed') ||
      typeof draft !== 'boolean' ||
      typeof updatedAt !== 'string' ||
      typeof createdAt !== 'string' ||
      (closedAt !== null && typeof closedAt !== 'string') ||
      (mergedAt !== null && typeof mergedAt !== 'string') ||
      typeof head !== 'object' ||
      head === null ||
      Array.isArray(head) ||
      typeof base !== 'object' ||
      base === null ||
      Array.isArray(base)
    ) {
      return null;
    }
    const headRecord = head as Record<string, unknown>;
    const baseRecord = base as Record<string, unknown>;
    const headRef = headRecord['ref'];
    const headSha = headRecord['sha'];
    const baseRef = baseRecord['ref'];
    if (typeof headRef !== 'string' || typeof headSha !== 'string' || typeof baseRef !== 'string') {
      return null;
    }
    let authorLogin: string | null = null;
    if (typeof user === 'object' && user !== null && !Array.isArray(user)) {
      const login = (user as Record<string, unknown>)['login'];
      if (typeof login === 'string') {
        authorLogin = login;
      }
    }
    return {
      number,
      title,
      url: htmlUrl,
      authorLogin,
      headBranch: headRef,
      headSha,
      baseBranch: baseRef,
      state,
      isDraft: draft,
      mergedAt: mergedAt as string | null,
      updatedAt,
      createdAt,
      closedAt: closedAt as string | null,
    };
  }

  private async openGitHubPullRequestForBranch(input: {
    owner: string;
    repo: string;
    headBranch: string;
  }): Promise<GitHubRemotePullRequest | null> {
    const head = encodeURIComponent(`${input.owner}:${input.headBranch}`);
    const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?state=open&head=${head}&per_page=1`;
    const payload = await this.githubJsonRequest(path);
    if (!Array.isArray(payload) || payload.length === 0) {
      return null;
    }
    return this.parseGitHubPullRequest(payload[0]);
  }

  private async findGitHubPullRequestForBranch(input: {
    owner: string;
    repo: string;
    headBranch: string;
  }): Promise<GitHubRemotePullRequest | null> {
    const head = encodeURIComponent(`${input.owner}:${input.headBranch}`);
    const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?state=all&head=${head}&per_page=10&sort=updated&direction=desc`;
    const payload = await this.githubJsonRequest(path);
    if (!Array.isArray(payload) || payload.length === 0) {
      return null;
    }
    for (const value of payload) {
      const parsed = this.parseGitHubPullRequest(value);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  private async listGitHubPullRequestReviewThreads(input: {
    owner: string;
    repo: string;
    pullNumber: number;
  }): Promise<readonly GitHubRemotePrReviewThread[]> {
    const payload = await this.githubJsonRequest('/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query HarnessPullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $number) {
                reviewThreads(first: 100) {
                  nodes {
                    id
                    isResolved
                    isOutdated
                    resolvedBy {
                      login
                    }
                    comments(first: 100) {
                      nodes {
                        id
                        body
                        bodyText
                        url
                        createdAt
                        updatedAt
                        author {
                          login
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        variables: {
          owner: input.owner,
          repo: input.repo,
          number: input.pullNumber,
        },
      }),
    });
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('github graphql review threads response malformed');
    }
    const payloadRecord = payload as Record<string, unknown>;
    const errors = payloadRecord['errors'];
    if (Array.isArray(errors) && errors.length > 0) {
      const firstError = errors[0];
      if (typeof firstError === 'object' && firstError !== null && !Array.isArray(firstError)) {
        const message = (firstError as Record<string, unknown>)['message'];
        if (typeof message === 'string' && message.trim().length > 0) {
          throw new Error(`github graphql review threads failed: ${message}`);
        }
      }
      throw new Error('github graphql review threads failed');
    }
    const data =
      typeof payloadRecord['data'] === 'object' &&
      payloadRecord['data'] !== null &&
      !Array.isArray(payloadRecord['data'])
        ? (payloadRecord['data'] as Record<string, unknown>)
        : null;
    const repository =
      data !== null &&
      typeof data['repository'] === 'object' &&
      data['repository'] !== null &&
      !Array.isArray(data['repository'])
        ? (data['repository'] as Record<string, unknown>)
        : null;
    const pullRequest =
      repository !== null &&
      typeof repository['pullRequest'] === 'object' &&
      repository['pullRequest'] !== null &&
      !Array.isArray(repository['pullRequest'])
        ? (repository['pullRequest'] as Record<string, unknown>)
        : null;
    const reviewThreads =
      pullRequest !== null &&
      typeof pullRequest['reviewThreads'] === 'object' &&
      pullRequest['reviewThreads'] !== null &&
      !Array.isArray(pullRequest['reviewThreads'])
        ? (pullRequest['reviewThreads'] as Record<string, unknown>)
        : null;
    const threadNodes = reviewThreads?.['nodes'];
    if (!Array.isArray(threadNodes)) {
      return [];
    }
    const threads: GitHubRemotePrReviewThread[] = [];
    for (const threadRaw of threadNodes) {
      if (typeof threadRaw !== 'object' || threadRaw === null || Array.isArray(threadRaw)) {
        continue;
      }
      const thread = threadRaw as Record<string, unknown>;
      const threadId = thread['id'];
      const isResolved = thread['isResolved'];
      const isOutdated = thread['isOutdated'];
      const resolvedBy =
        typeof thread['resolvedBy'] === 'object' &&
        thread['resolvedBy'] !== null &&
        !Array.isArray(thread['resolvedBy'])
          ? (thread['resolvedBy'] as Record<string, unknown>)
          : null;
      const resolvedByLogin =
        resolvedBy !== null && typeof resolvedBy['login'] === 'string' ? resolvedBy['login'] : null;
      const commentsRecord =
        typeof thread['comments'] === 'object' &&
        thread['comments'] !== null &&
        !Array.isArray(thread['comments'])
          ? (thread['comments'] as Record<string, unknown>)
          : null;
      const commentsNodes = commentsRecord?.['nodes'];
      if (
        typeof threadId !== 'string' ||
        typeof isResolved !== 'boolean' ||
        typeof isOutdated !== 'boolean' ||
        !Array.isArray(commentsNodes)
      ) {
        continue;
      }
      const comments: GitHubRemotePrReviewComment[] = [];
      for (const commentRaw of commentsNodes) {
        if (typeof commentRaw !== 'object' || commentRaw === null || Array.isArray(commentRaw)) {
          continue;
        }
        const comment = commentRaw as Record<string, unknown>;
        const commentId = comment['id'];
        const bodyText = comment['bodyText'];
        const body = comment['body'];
        const url = comment['url'];
        const createdAt = comment['createdAt'];
        const updatedAt = comment['updatedAt'];
        const author =
          typeof comment['author'] === 'object' &&
          comment['author'] !== null &&
          !Array.isArray(comment['author'])
            ? (comment['author'] as Record<string, unknown>)
            : null;
        const authorLogin =
          author !== null && typeof author['login'] === 'string' ? author['login'] : null;
        const normalizedBody =
          typeof bodyText === 'string' ? bodyText : typeof body === 'string' ? body : null;
        if (
          typeof commentId !== 'string' ||
          normalizedBody === null ||
          (url !== null && url !== undefined && typeof url !== 'string') ||
          typeof createdAt !== 'string' ||
          typeof updatedAt !== 'string'
        ) {
          continue;
        }
        comments.push({
          commentId,
          authorLogin,
          body: normalizedBody,
          url: typeof url === 'string' ? url : null,
          createdAt,
          updatedAt,
        });
      }
      threads.push({
        threadId,
        isResolved,
        isOutdated,
        resolvedByLogin,
        comments,
      });
    }
    return threads;
  }

  private async createGitHubPullRequest(input: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
  }): Promise<GitHubRemotePullRequest> {
    const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`;
    const payload = await this.githubJsonRequest(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
      }),
    });
    const parsed = this.parseGitHubPullRequest(payload);
    if (parsed === null) {
      throw new Error('github create pr returned malformed response');
    }
    return parsed;
  }

  private async listGitHubPrJobsForCommit(input: {
    owner: string;
    repo: string;
    headSha: string;
  }): Promise<readonly GitHubRemotePrJob[]> {
    const owner = encodeURIComponent(input.owner);
    const repo = encodeURIComponent(input.repo);
    const sha = encodeURIComponent(input.headSha);
    const checkRunsPayload = await this.githubJsonRequest(
      `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
    );
    const checkRuns: GitHubRemotePrJob[] = [];
    if (
      typeof checkRunsPayload === 'object' &&
      checkRunsPayload !== null &&
      !Array.isArray(checkRunsPayload)
    ) {
      const runsRaw = (checkRunsPayload as Record<string, unknown>)['check_runs'];
      if (Array.isArray(runsRaw)) {
        for (const runRaw of runsRaw) {
          if (typeof runRaw !== 'object' || runRaw === null || Array.isArray(runRaw)) {
            continue;
          }
          const run = runRaw as Record<string, unknown>;
          const id = run['id'];
          const name = run['name'];
          const status = run['status'];
          const conclusion = run['conclusion'];
          const htmlUrl = run['html_url'];
          const startedAt = run['started_at'];
          const completedAt = run['completed_at'];
          if (
            typeof id !== 'number' ||
            typeof name !== 'string' ||
            typeof status !== 'string' ||
            (conclusion !== null && typeof conclusion !== 'string')
          ) {
            continue;
          }
          checkRuns.push({
            provider: 'check-run',
            externalId: String(id),
            name,
            status,
            conclusion: conclusion as string | null,
            url: typeof htmlUrl === 'string' ? htmlUrl : null,
            startedAt: typeof startedAt === 'string' ? startedAt : null,
            completedAt: typeof completedAt === 'string' ? completedAt : null,
          });
        }
      }
    }
    const statusPayload = await this.githubJsonRequest(
      `/repos/${owner}/${repo}/commits/${sha}/status`,
    );
    const statusJobs: GitHubRemotePrJob[] = [];
    if (
      typeof statusPayload === 'object' &&
      statusPayload !== null &&
      !Array.isArray(statusPayload)
    ) {
      const contextsRaw = (statusPayload as Record<string, unknown>)['statuses'];
      if (Array.isArray(contextsRaw)) {
        for (const statusRaw of contextsRaw) {
          if (typeof statusRaw !== 'object' || statusRaw === null || Array.isArray(statusRaw)) {
            continue;
          }
          const context = statusRaw as Record<string, unknown>;
          const id = context['id'];
          const name = context['context'];
          const state = context['state'];
          const targetUrl = context['target_url'];
          const createdAt = context['created_at'];
          const updatedAt = context['updated_at'];
          if (typeof id !== 'number' || typeof name !== 'string' || typeof state !== 'string') {
            continue;
          }
          statusJobs.push({
            provider: 'status-context',
            externalId: String(id),
            name,
            status: state === 'pending' ? 'in_progress' : 'completed',
            conclusion: state === 'pending' ? null : state,
            url: typeof targetUrl === 'string' ? targetUrl : null,
            startedAt: typeof createdAt === 'string' ? createdAt : null,
            completedAt: typeof updatedAt === 'string' ? updatedAt : null,
          });
        }
      }
    }
    return [...checkRuns, ...statusJobs];
  }

  private handleConnection(socket: Socket): void {
    handleServerConnection(this as unknown as Parameters<typeof handleServerConnection>[0], socket);
  }

  private handleSocketData(connection: ConnectionState, chunk: Buffer): void {
    handleConnectionSocketData(
      this as unknown as Parameters<typeof handleConnectionSocketData>[0],
      connection,
      chunk,
    );
  }

  private handleClientEnvelope(connection: ConnectionState, envelope: StreamClientEnvelope): void {
    handleConnectionClientEnvelope(
      this as unknown as Parameters<typeof handleConnectionClientEnvelope>[0],
      connection,
      envelope,
    );
  }

  private handleAuth(connection: ConnectionState, token: string): void {
    handleConnectionAuth(
      this as unknown as Parameters<typeof handleConnectionAuth>[0],
      connection,
      token,
    );
  }

  private handleCommand(
    connection: ConnectionState,
    commandId: string,
    command: StreamCommand,
  ): void {
    handleConnectionCommand(
      this as unknown as Parameters<typeof handleConnectionCommand>[0],
      connection,
      commandId,
      command,
    );
  }

  private executeCommand(
    connection: ConnectionState,
    command: StreamCommand,
  ): Promise<Record<string, unknown>> {
    return executeStreamServerCommand(
      this as unknown as Parameters<typeof executeStreamServerCommand>[0],
      connection,
      command,
    );
  }

  private async refreshConversationTitle(conversationId: string): Promise<{
    conversation: ControlPlaneConversationRecord;
    status: 'updated' | 'unchanged' | 'skipped';
    reason: string | null;
  }> {
    const existing = this.stateStore.getConversation(conversationId);
    if (existing === null) {
      throw new Error(`conversation not found: ${conversationId}`);
    }
    const refreshed = await this.refreshThreadTitle(conversationId);
    const conversation = this.stateStore.getConversation(conversationId);
    if (conversation === null) {
      throw new Error(`conversation not found: ${conversationId}`);
    }
    return {
      conversation,
      status: refreshed.status,
      reason: refreshed.reason,
    };
  }

  private handleInput(connectionId: string, sessionId: string, dataBase64: string): void {
    handleRuntimeInput(
      this as unknown as Parameters<typeof handleRuntimeInput>[0],
      connectionId,
      sessionId,
      dataBase64,
    );
  }

  private handleResize(connectionId: string, sessionId: string, cols: number, rows: number): void {
    handleRuntimeResize(
      this as unknown as Parameters<typeof handleRuntimeResize>[0],
      connectionId,
      sessionId,
      cols,
      rows,
    );
  }

  private handleSignal(connectionId: string, sessionId: string, signal: StreamSignal): void {
    handleRuntimeSignal(
      this as unknown as Parameters<typeof handleRuntimeSignal>[0],
      connectionId,
      sessionId,
      signal,
    );
  }

  private handleSessionEvent(sessionId: string, event: CodexLiveEvent): void {
    handleRuntimeSessionEvent(
      this as unknown as Parameters<typeof handleRuntimeSessionEvent>[0],
      sessionId,
      event,
    );
  }

  private publishSessionKeyObservedEvent(
    state: SessionState,
    keyEvent: StreamSessionKeyEventRecord,
  ): void {
    this.publishObservedEvent(this.sessionScope(state), {
      type: 'session-key-event',
      sessionId: state.id,
      keyEvent: {
        source: keyEvent.source,
        eventName: keyEvent.eventName,
        severity: keyEvent.severity,
        summary: keyEvent.summary,
        observedAt: keyEvent.observedAt,
        statusHint: keyEvent.statusHint,
      },
      ts: new Date().toISOString(),
      directoryId: state.directoryId,
      conversationId: state.id,
    });
  }

  private promptEventSecondBucket(observedAt: string): string {
    const normalized = observedAt.trim();
    if (normalized.length >= 19) {
      return normalized.slice(0, 19);
    }
    return normalized;
  }

  private shouldPublishPromptEvent(sessionId: string, prompt: StreamSessionPromptRecord): boolean {
    const bucket = this.promptEventSecondBucket(prompt.observedAt);
    const dedupeKey = `${sessionId}:${prompt.hash}:${prompt.providerEventName ?? ''}:${bucket}`;
    if (this.promptEventDedupeByKey.has(dedupeKey)) {
      return false;
    }
    const nowMs = Date.now();
    this.promptEventDedupeByKey.set(dedupeKey, nowMs);
    if (this.promptEventDedupeByKey.size > MAX_PROMPT_EVENT_DEDUPE_ENTRIES) {
      for (const [key, observedMs] of this.promptEventDedupeByKey) {
        if (nowMs - observedMs > PROMPT_EVENT_DEDUPE_TTL_MS) {
          this.promptEventDedupeByKey.delete(key);
        }
      }
      if (this.promptEventDedupeByKey.size > MAX_PROMPT_EVENT_DEDUPE_ENTRIES) {
        let dropCount = this.promptEventDedupeByKey.size - MAX_PROMPT_EVENT_DEDUPE_ENTRIES;
        for (const key of this.promptEventDedupeByKey.keys()) {
          this.promptEventDedupeByKey.delete(key);
          dropCount -= 1;
          if (dropCount <= 0) {
            break;
          }
        }
      }
    }
    return true;
  }

  private publishSessionPromptObservedEventForScope(
    sessionId: string,
    scope: StreamObservedScope,
    prompt: StreamSessionPromptRecord,
  ): void {
    if (!this.shouldPublishPromptEvent(sessionId, prompt)) {
      return;
    }
    this.recordThreadPrompt(sessionId, prompt);
    this.publishObservedEvent(scope, {
      type: 'session-prompt-event',
      sessionId,
      prompt: {
        text: prompt.text,
        hash: prompt.hash,
        confidence: prompt.confidence,
        captureSource: prompt.captureSource,
        providerEventName: prompt.providerEventName,
        providerPayloadKeys: [...prompt.providerPayloadKeys],
        observedAt: prompt.observedAt,
      },
      ts: new Date().toISOString(),
      directoryId: scope.directoryId,
      conversationId: scope.conversationId,
    });
  }

  private publishSessionPromptObservedEvent(
    state: SessionState,
    prompt: StreamSessionPromptRecord,
  ): void {
    this.publishSessionPromptObservedEventForScope(state.id, this.sessionScope(state), prompt);
  }

  private recordThreadPrompt(sessionId: string, prompt: StreamSessionPromptRecord): void {
    const conversation = this.stateStore.getConversation(sessionId);
    if (conversation === null) {
      this.threadTitleRevisionBySessionId.delete(sessionId);
      this.threadTitleRefreshBySessionId.delete(sessionId);
      return;
    }
    if (!isThreadTitleAgentType(conversation.agentType)) {
      return;
    }
    const appended = appendThreadTitlePromptHistory(conversation.adapterState, prompt);
    if (!appended.added) {
      return;
    }
    this.stateStore.updateConversationAdapterState(sessionId, appended.nextAdapterState);
    const liveState = this.sessions.get(sessionId);
    if (liveState !== undefined) {
      liveState.adapterState = appended.nextAdapterState;
    }
    const nextRevision = (this.threadTitleRevisionBySessionId.get(sessionId) ?? 0) + 1;
    this.threadTitleRevisionBySessionId.set(sessionId, nextRevision);
    if (this.threadTitleNamer !== null) {
      this.scheduleThreadTitleRefresh(sessionId);
    }
  }

  private scheduleThreadTitleRefresh(sessionId: string): void {
    const state = this.threadTitleRefreshBySessionId.get(sessionId) ?? {
      inFlight: false,
      pending: false,
    };
    this.threadTitleRefreshBySessionId.set(sessionId, state);
    if (state.inFlight) {
      state.pending = true;
      return;
    }
    state.inFlight = true;
    state.pending = false;
    void this.runThreadTitleRefreshLoop(sessionId, state);
  }

  private async runThreadTitleRefreshLoop(
    sessionId: string,
    refreshState: ThreadTitleRefreshState,
  ): Promise<void> {
    let shouldReschedule = false;
    try {
      while (true) {
        refreshState.pending = false;
        const revision = this.threadTitleRevisionBySessionId.get(sessionId) ?? 0;
        if (revision <= 0) {
          return;
        }
        await this.refreshThreadTitleForRevision(sessionId, revision);
        const latestRevision = this.threadTitleRevisionBySessionId.get(sessionId) ?? 0;
        if (!refreshState.pending && latestRevision === revision) {
          return;
        }
      }
    } finally {
      refreshState.inFlight = false;
      shouldReschedule = refreshState.pending;
      if (!shouldReschedule) {
        this.threadTitleRefreshBySessionId.delete(sessionId);
      }
    }
    if (shouldReschedule) {
      this.scheduleThreadTitleRefresh(sessionId);
    }
  }

  private async refreshThreadTitle(
    sessionId: string,
    expectedRevision?: number,
  ): Promise<ThreadTitleRefreshResult> {
    if (this.threadTitleNamer === null) {
      return {
        status: 'skipped',
        conversation: this.stateStore.getConversation(sessionId),
        reason: 'thread-title-namer-disabled',
      };
    }
    const conversation = this.stateStore.getConversation(sessionId);
    if (conversation === null) {
      if (expectedRevision !== undefined) {
        this.threadTitleRevisionBySessionId.delete(sessionId);
      }
      return {
        status: 'skipped',
        conversation: null,
        reason: 'conversation-not-found',
      };
    }
    if (!isThreadTitleAgentType(conversation.agentType)) {
      return {
        status: 'skipped',
        conversation,
        reason: 'non-agent-thread',
      };
    }
    const promptHistory = readThreadTitlePromptHistory(conversation.adapterState);
    if (promptHistory.length === 0) {
      return {
        status: 'skipped',
        conversation,
        reason: 'prompt-history-empty',
      };
    }

    let suggestedTitle: string | null = null;
    try {
      suggestedTitle = await this.threadTitleNamer.suggest({
        conversationId: conversation.conversationId,
        agentType: conversation.agentType,
        currentTitle: conversation.title,
        promptHistory,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      recordPerfEvent('control-plane.thread-title.error', {
        sessionId,
        error: message,
      });
    }

    if (expectedRevision !== undefined) {
      const latestRevision = this.threadTitleRevisionBySessionId.get(sessionId) ?? 0;
      if (latestRevision !== expectedRevision) {
        return {
          status: 'skipped',
          conversation,
          reason: 'stale-revision',
        };
      }
    }

    const nextTitle =
      (suggestedTitle === null ? null : normalizeThreadTitleCandidate(suggestedTitle)) ??
      fallbackThreadTitleFromPromptHistory(promptHistory);
    if (conversation.title === nextTitle) {
      return {
        status: 'unchanged',
        conversation,
        reason: null,
      };
    }
    const updated = this.stateStore.updateConversationTitle(sessionId, nextTitle);
    if (updated === null) {
      return {
        status: 'skipped',
        conversation: null,
        reason: 'conversation-not-found',
      };
    }
    this.publishConversationUpdatedObservedEvent(updated);
    return {
      status: 'updated',
      conversation: updated,
      reason: null,
    };
  }

  private async refreshThreadTitleForRevision(sessionId: string, revision: number): Promise<void> {
    await this.refreshThreadTitle(sessionId, revision);
  }

  private publishConversationUpdatedObservedEvent(
    conversation: ControlPlaneConversationRecord,
  ): void {
    this.publishObservedEvent(
      {
        tenantId: conversation.tenantId,
        userId: conversation.userId,
        workspaceId: conversation.workspaceId,
        directoryId: conversation.directoryId,
        conversationId: conversation.conversationId,
      },
      {
        type: 'conversation-updated',
        conversation: this.conversationRecord(conversation),
      },
    );
  }

  private setSessionStatus(
    state: SessionState,
    status: StreamSessionRuntimeStatus,
    attentionReason: string | null,
    lastEventAt: string | null,
  ): void {
    setRuntimeSessionStatus(
      this as unknown as Parameters<typeof setRuntimeSessionStatus>[0],
      state,
      status,
      attentionReason,
      lastEventAt,
    );
  }

  private refreshSessionStatusModel(state: SessionState, observedAt: string): void {
    state.statusModel = this.statusEngine.project({
      agentType: state.agentType,
      runtimeStatus: state.status,
      attentionReason: state.attentionReason,
      telemetry: state.latestTelemetry,
      observedAt,
      previous: state.statusModel,
    });
  }

  private persistConversationRuntime(state: SessionState): void {
    persistRuntimeConversationState(
      this as unknown as Parameters<typeof persistRuntimeConversationState>[0],
      state,
    );
  }

  private publishStatusObservedEvent(state: SessionState): void {
    publishRuntimeStatusObservedEvent(
      this as unknown as Parameters<typeof publishRuntimeStatusObservedEvent>[0],
      state,
    );
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
    return filterEventIncludesRepositoryId(event, repositoryId);
  }

  private eventIncludesTaskId(event: StreamObservedEvent, taskId: string): boolean {
    return filterEventIncludesTaskId(event, taskId);
  }

  private matchesObservedFilter(
    scope: StreamObservedScope,
    event: StreamObservedEvent,
    filter: StreamSubscriptionFilter,
  ): boolean {
    return matchesStreamObservedFilter(
      this as unknown as Parameters<typeof matchesStreamObservedFilter>[0],
      scope,
      event,
      filter,
    );
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
      this.sendToConnection(
        subscription.connectionId,
        {
          kind: 'stream.event',
          subscriptionId: subscription.id,
          cursor: entry.cursor,
          event: entry.event,
        },
        diagnosticSessionId,
      );
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
      runtimeStatusModel: conversation.runtimeStatusModel,
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
      scopeKind: task.scopeKind,
      projectId: task.projectId,
      title: task.title,
      body: task.body,
      status: task.status,
      orderIndex: task.orderIndex,
      claimedByControllerId: task.claimedByControllerId,
      claimedByDirectoryId: task.claimedByDirectoryId,
      branchName: task.branchName,
      baseBranch: task.baseBranch,
      claimedAt: task.claimedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private toPublicSessionController(
    controller: SessionControllerState | null | undefined,
  ): StreamSessionController | null {
    return toPublicSessionController(controller);
  }

  private controllerDisplayName(controller: SessionControllerState): string {
    return controllerDisplayName(controller);
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
    this.threadTitleRevisionBySessionId.delete(sessionId);
    this.threadTitleRefreshBySessionId.delete(sessionId);
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
    const telemetryEventsLast60s = sessionRollingCounterTotal(
      state.diagnostics.telemetryIngestRate,
      nowMs,
    );
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

  private diagnosticSessionIdForObservedEvent(
    scope: StreamObservedScope,
    event: StreamObservedEvent,
  ): string | null {
    if (event.type === 'session-status') {
      return event.sessionId;
    }
    if (event.type === 'session-event') {
      return event.sessionId;
    }
    if (event.type === 'session-key-event') {
      return event.sessionId;
    }
    if (event.type === 'session-prompt-event') {
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
      statusModel: state.statusModel,
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
