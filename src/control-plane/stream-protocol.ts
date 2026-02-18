import type { PtyExit } from '../pty/pty_host.ts';
import { parseStreamCommand } from './stream-command-parser.ts';

export type StreamSignal = 'interrupt' | 'eof' | 'terminate';
export type StreamSessionRuntimeStatus = 'running' | 'needs-input' | 'completed' | 'exited';
export type StreamSessionListSort = 'attention-first' | 'started-desc' | 'started-asc';
export type StreamTelemetrySource = 'otlp-log' | 'otlp-metric' | 'otlp-trace' | 'history';
export type StreamTelemetryStatusHint = 'running' | 'completed' | 'needs-input';
export type StreamSessionControllerType = 'human' | 'agent' | 'automation';

export interface StreamSessionController {
  controllerId: string;
  controllerType: StreamSessionControllerType;
  controllerLabel: string | null;
  claimedAt: string;
}

export interface StreamTelemetrySummary {
  source: StreamTelemetrySource;
  eventName: string | null;
  severity: string | null;
  summary: string | null;
  observedAt: string;
}

export interface StreamSessionKeyEventRecord {
  source: StreamTelemetrySource;
  eventName: string | null;
  severity: string | null;
  summary: string | null;
  observedAt: string;
  statusHint: StreamTelemetryStatusHint | null;
}

interface DirectoryUpsertCommand {
  type: 'directory.upsert';
  directoryId?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  path: string;
}

interface DirectoryListCommand {
  type: 'directory.list';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface DirectoryArchiveCommand {
  type: 'directory.archive';
  directoryId: string;
}

interface DirectoryGitStatusListCommand {
  type: 'directory.git-status';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  directoryId?: string;
}

interface ConversationCreateCommand {
  type: 'conversation.create';
  conversationId?: string;
  directoryId: string;
  title: string;
  agentType: string;
  adapterState?: Record<string, unknown>;
}

interface ConversationListCommand {
  type: 'conversation.list';
  directoryId?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface ConversationArchiveCommand {
  type: 'conversation.archive';
  conversationId: string;
}

interface ConversationUpdateCommand {
  type: 'conversation.update';
  conversationId: string;
  title: string;
}

interface ConversationDeleteCommand {
  type: 'conversation.delete';
  conversationId: string;
}

type StreamTaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';
type StreamTaskScopeKind = 'global' | 'repository' | 'project';
type StreamTaskLinearPriority = 0 | 1 | 2 | 3 | 4;
type StreamProjectTaskFocusMode = 'balanced' | 'own-only';
type StreamProjectThreadSpawnMode = 'new-thread' | 'reuse-thread';
type StreamAutomationPolicyScope = 'global' | 'repository' | 'project';

interface StreamTaskLinearInput {
  issueId?: string | null;
  identifier?: string | null;
  url?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  cycleId?: string | null;
  stateId?: string | null;
  assigneeId?: string | null;
  priority?: StreamTaskLinearPriority | null;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: readonly string[] | null;
}

interface RepositoryUpsertCommand {
  type: 'repository.upsert';
  repositoryId?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  name: string;
  remoteUrl: string;
  defaultBranch?: string;
  metadata?: Record<string, unknown>;
}

interface RepositoryGetCommand {
  type: 'repository.get';
  repositoryId: string;
}

interface RepositoryListCommand {
  type: 'repository.list';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface RepositoryUpdateCommand {
  type: 'repository.update';
  repositoryId: string;
  name?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  metadata?: Record<string, unknown>;
}

interface RepositoryArchiveCommand {
  type: 'repository.archive';
  repositoryId: string;
}

interface TaskCreateCommand {
  type: 'task.create';
  taskId?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  projectId?: string;
  title: string;
  description?: string;
  linear?: StreamTaskLinearInput;
}

interface TaskGetCommand {
  type: 'task.get';
  taskId: string;
}

interface TaskListCommand {
  type: 'task.list';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  projectId?: string;
  scopeKind?: StreamTaskScopeKind;
  status?: StreamTaskStatus;
  limit?: number;
}

interface TaskUpdateCommand {
  type: 'task.update';
  taskId: string;
  title?: string;
  description?: string;
  repositoryId?: string | null;
  projectId?: string | null;
  linear?: StreamTaskLinearInput | null;
}

interface TaskDeleteCommand {
  type: 'task.delete';
  taskId: string;
}

interface TaskClaimCommand {
  type: 'task.claim';
  taskId: string;
  controllerId: string;
  directoryId?: string;
  branchName?: string;
  baseBranch?: string;
}

interface TaskPullCommand {
  type: 'task.pull';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  controllerId: string;
  directoryId?: string;
  repositoryId?: string;
  branchName?: string;
  baseBranch?: string;
}

interface TaskCompleteCommand {
  type: 'task.complete';
  taskId: string;
}

interface TaskQueueCommand {
  type: 'task.queue';
  taskId: string;
}

interface TaskReadyCommand {
  type: 'task.ready';
  taskId: string;
}

interface TaskDraftCommand {
  type: 'task.draft';
  taskId: string;
}

interface TaskReorderCommand {
  type: 'task.reorder';
  tenantId: string;
  userId: string;
  workspaceId: string;
  orderedTaskIds: string[];
}

interface ProjectSettingsGetCommand {
  type: 'project.settings-get';
  directoryId: string;
}

interface ProjectSettingsUpdateCommand {
  type: 'project.settings-update';
  directoryId: string;
  pinnedBranch?: string | null;
  taskFocusMode?: StreamProjectTaskFocusMode;
  threadSpawnMode?: StreamProjectThreadSpawnMode;
}

interface ProjectStatusCommand {
  type: 'project.status';
  directoryId: string;
}

interface AutomationPolicyGetCommand {
  type: 'automation.policy-get';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  scope: StreamAutomationPolicyScope;
  scopeId?: string;
}

interface AutomationPolicySetCommand {
  type: 'automation.policy-set';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  scope: StreamAutomationPolicyScope;
  scopeId?: string;
  automationEnabled?: boolean;
  frozen?: boolean;
}

interface StreamSubscribeCommand {
  type: 'stream.subscribe';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  taskId?: string;
  directoryId?: string;
  conversationId?: string;
  includeOutput?: boolean;
  afterCursor?: number;
}

interface StreamUnsubscribeCommand {
  type: 'stream.unsubscribe';
  subscriptionId: string;
}

interface SessionListCommand {
  type: 'session.list';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  worktreeId?: string;
  status?: StreamSessionRuntimeStatus;
  live?: boolean;
  sort?: StreamSessionListSort;
  limit?: number;
}

interface AttentionListCommand {
  type: 'attention.list';
}

interface SessionStatusCommand {
  type: 'session.status';
  sessionId: string;
}

interface SessionSnapshotCommand {
  type: 'session.snapshot';
  sessionId: string;
  tailLines?: number;
}

interface SessionRespondCommand {
  type: 'session.respond';
  sessionId: string;
  text: string;
}

interface SessionClaimCommand {
  type: 'session.claim';
  sessionId: string;
  controllerId: string;
  controllerType: StreamSessionControllerType;
  controllerLabel?: string;
  reason?: string;
  takeover?: boolean;
}

interface SessionReleaseCommand {
  type: 'session.release';
  sessionId: string;
  reason?: string;
}

interface SessionInterruptCommand {
  type: 'session.interrupt';
  sessionId: string;
}

interface SessionRemoveCommand {
  type: 'session.remove';
  sessionId: string;
}

interface PtyStartCommand {
  type: 'pty.start';
  sessionId: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  initialCols: number;
  initialRows: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  worktreeId?: string;
}

interface PtyAttachCommand {
  type: 'pty.attach';
  sessionId: string;
  sinceCursor?: number;
}

interface PtyDetachCommand {
  type: 'pty.detach';
  sessionId: string;
}

interface PtySubscribeEventsCommand {
  type: 'pty.subscribe-events';
  sessionId: string;
}

interface PtyUnsubscribeEventsCommand {
  type: 'pty.unsubscribe-events';
  sessionId: string;
}

interface PtyCloseCommand {
  type: 'pty.close';
  sessionId: string;
}

export type StreamCommand =
  | DirectoryUpsertCommand
  | DirectoryListCommand
  | DirectoryArchiveCommand
  | DirectoryGitStatusListCommand
  | ConversationCreateCommand
  | ConversationListCommand
  | ConversationArchiveCommand
  | ConversationUpdateCommand
  | ConversationDeleteCommand
  | RepositoryUpsertCommand
  | RepositoryGetCommand
  | RepositoryListCommand
  | RepositoryUpdateCommand
  | RepositoryArchiveCommand
  | TaskCreateCommand
  | TaskGetCommand
  | TaskListCommand
  | TaskUpdateCommand
  | TaskDeleteCommand
  | TaskClaimCommand
  | TaskPullCommand
  | TaskCompleteCommand
  | TaskQueueCommand
  | TaskReadyCommand
  | TaskDraftCommand
  | TaskReorderCommand
  | ProjectSettingsGetCommand
  | ProjectSettingsUpdateCommand
  | ProjectStatusCommand
  | AutomationPolicyGetCommand
  | AutomationPolicySetCommand
  | StreamSubscribeCommand
  | StreamUnsubscribeCommand
  | SessionListCommand
  | AttentionListCommand
  | SessionStatusCommand
  | SessionSnapshotCommand
  | SessionRespondCommand
  | SessionClaimCommand
  | SessionReleaseCommand
  | SessionInterruptCommand
  | SessionRemoveCommand
  | PtyStartCommand
  | PtyAttachCommand
  | PtyDetachCommand
  | PtySubscribeEventsCommand
  | PtyUnsubscribeEventsCommand
  | PtyCloseCommand;

export interface StreamCommandEnvelope {
  kind: 'command';
  commandId: string;
  command: StreamCommand;
}

interface StreamAuthEnvelope {
  kind: 'auth';
  token: string;
}

interface StreamInputEnvelope {
  kind: 'pty.input';
  sessionId: string;
  dataBase64: string;
}

interface StreamResizeEnvelope {
  kind: 'pty.resize';
  sessionId: string;
  cols: number;
  rows: number;
}

interface StreamSignalEnvelope {
  kind: 'pty.signal';
  sessionId: string;
  signal: StreamSignal;
}

export type StreamClientEnvelope =
  | StreamAuthEnvelope
  | StreamCommandEnvelope
  | StreamInputEnvelope
  | StreamResizeEnvelope
  | StreamSignalEnvelope;

interface StreamNotifyRecord {
  ts: string;
  payload: Record<string, unknown>;
}

export type StreamSessionEvent =
  | {
      type: 'notify';
      record: StreamNotifyRecord;
    }
  | {
      type: 'session-exit';
      exit: PtyExit;
    };

export type StreamObservedEvent =
  | {
      type: 'directory-upserted';
      directory: Record<string, unknown>;
    }
  | {
      type: 'directory-archived';
      directoryId: string;
      ts: string;
    }
  | {
      type: 'directory-git-updated';
      directoryId: string;
      summary: {
        branch: string;
        changedFiles: number;
        additions: number;
        deletions: number;
      };
      repositorySnapshot: {
        normalizedRemoteUrl: string | null;
        commitCount: number | null;
        lastCommitAt: string | null;
        shortCommitHash: string | null;
        inferredName: string | null;
        defaultBranch: string | null;
      };
      repositoryId: string | null;
      repository: Record<string, unknown> | null;
      observedAt: string;
    }
  | {
      type: 'conversation-created';
      conversation: Record<string, unknown>;
    }
  | {
      type: 'conversation-updated';
      conversation: Record<string, unknown>;
    }
  | {
      type: 'conversation-archived';
      conversationId: string;
      ts: string;
    }
  | {
      type: 'conversation-deleted';
      conversationId: string;
      ts: string;
    }
  | {
      type: 'repository-upserted';
      repository: Record<string, unknown>;
    }
  | {
      type: 'repository-updated';
      repository: Record<string, unknown>;
    }
  | {
      type: 'repository-archived';
      repositoryId: string;
      ts: string;
    }
  | {
      type: 'task-created';
      task: Record<string, unknown>;
    }
  | {
      type: 'task-updated';
      task: Record<string, unknown>;
    }
  | {
      type: 'task-deleted';
      taskId: string;
      ts: string;
    }
  | {
      type: 'task-reordered';
      tasks: Record<string, unknown>[];
      ts: string;
    }
  | {
      type: 'session-status';
      sessionId: string;
      status: StreamSessionRuntimeStatus;
      attentionReason: string | null;
      live: boolean;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
      telemetry: StreamTelemetrySummary | null;
      controller: StreamSessionController | null;
    }
  | {
      type: 'session-event';
      sessionId: string;
      event: StreamSessionEvent;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
    }
  | {
      type: 'session-key-event';
      sessionId: string;
      keyEvent: StreamSessionKeyEventRecord;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
    }
  | {
      type: 'session-control';
      sessionId: string;
      action: 'claimed' | 'released' | 'taken-over';
      controller: StreamSessionController | null;
      previousController: StreamSessionController | null;
      reason: string | null;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
    }
  | {
      type: 'session-output';
      sessionId: string;
      outputCursor: number;
      chunkBase64: string;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
    };

interface StreamCommandAcceptedEnvelope {
  kind: 'command.accepted';
  commandId: string;
}

interface StreamAuthOkEnvelope {
  kind: 'auth.ok';
}

interface StreamAuthErrorEnvelope {
  kind: 'auth.error';
  error: string;
}

interface StreamCommandCompletedEnvelope {
  kind: 'command.completed';
  commandId: string;
  result: Record<string, unknown>;
}

interface StreamCommandFailedEnvelope {
  kind: 'command.failed';
  commandId: string;
  error: string;
}

interface StreamPtyOutputEnvelope {
  kind: 'pty.output';
  sessionId: string;
  cursor: number;
  chunkBase64: string;
}

interface StreamPtyExitEnvelope {
  kind: 'pty.exit';
  sessionId: string;
  exit: PtyExit;
}

interface StreamPtyEventEnvelope {
  kind: 'pty.event';
  sessionId: string;
  event: StreamSessionEvent;
}

interface StreamObservedEventEnvelope {
  kind: 'stream.event';
  subscriptionId: string;
  cursor: number;
  event: StreamObservedEvent;
}

export type StreamServerEnvelope =
  | StreamAuthOkEnvelope
  | StreamAuthErrorEnvelope
  | StreamCommandAcceptedEnvelope
  | StreamCommandCompletedEnvelope
  | StreamCommandFailedEnvelope
  | StreamPtyOutputEnvelope
  | StreamPtyExitEnvelope
  | StreamPtyEventEnvelope
  | StreamObservedEventEnvelope;

interface ConsumedJsonLines {
  messages: unknown[];
  remainder: string;
}

export function encodeStreamEnvelope(
  envelope: StreamClientEnvelope | StreamServerEnvelope,
): string {
  return `${JSON.stringify(envelope)}\n`;
}

export function consumeJsonLines(buffer: string): ConsumedJsonLines {
  const lines = buffer.split('\n');
  const remainder = lines.pop() as string;
  const messages: unknown[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // Invalid lines are ignored so malformed peers cannot break stream processing.
    }
  }

  return {
    messages,
    remainder,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readSignalName(value: unknown): NodeJS.Signals | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (!/^SIG[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(value)) {
    return null;
  }
  return value as NodeJS.Signals;
}

export function parseClientEnvelope(value: unknown): StreamClientEnvelope | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const kind = readString(record['kind']);
  if (kind === null) {
    return null;
  }

  if (kind === 'auth') {
    const token = readString(record['token']);
    if (token === null) {
      return null;
    }
    return {
      kind,
      token,
    };
  }

  if (kind === 'command') {
    const commandId = readString(record['commandId']);
    const command = parseStreamCommand(record['command']);
    if (commandId === null || command === null) {
      return null;
    }

    return {
      kind,
      commandId,
      command,
    };
  }

  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }

  if (kind === 'pty.input') {
    const dataBase64 = readString(record['dataBase64']);
    if (dataBase64 === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      dataBase64,
    };
  }

  if (kind === 'pty.resize') {
    const cols = readNumber(record['cols']);
    const rows = readNumber(record['rows']);
    if (cols === null || rows === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      cols,
      rows,
    };
  }

  if (kind === 'pty.signal') {
    const signal = readString(record['signal']);
    if (signal !== 'interrupt' && signal !== 'eof' && signal !== 'terminate') {
      return null;
    }
    return {
      kind,
      sessionId,
      signal,
    };
  }

  return null;
}

function parseStreamSessionEvent(value: unknown): StreamSessionEvent | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const type = readString(record['type']);
  if (type === null) {
    return null;
  }

  if (type === 'session-exit') {
    const exitRecord = asRecord(record['exit']);
    if (exitRecord === null) {
      return null;
    }
    const code = exitRecord['code'];
    const signal = exitRecord['signal'];
    const normalizedCode = code === null ? null : readNumber(code);
    const normalizedSignal = signal === null ? null : readSignalName(signal);
    if (normalizedCode === null && code !== null) {
      return null;
    }
    if (normalizedSignal === null && signal !== null) {
      return null;
    }
    return {
      type,
      exit: {
        code: normalizedCode,
        signal: normalizedSignal,
      },
    };
  }

  if (type === 'notify') {
    const notifyRecord = asRecord(record['record']);
    if (notifyRecord === null) {
      return null;
    }
    const ts = readString(notifyRecord['ts']);
    const payload = asRecord(notifyRecord['payload']);
    if (ts === null || payload === null) {
      return null;
    }
    return {
      type: 'notify',
      record: {
        ts,
        payload,
      },
    };
  }

  return null;
}

function parseTelemetrySource(value: unknown): StreamTelemetrySource | null {
  if (
    value === 'otlp-log' ||
    value === 'otlp-metric' ||
    value === 'otlp-trace' ||
    value === 'history'
  ) {
    return value;
  }
  return null;
}

function parseSessionControllerType(value: unknown): StreamSessionControllerType | null {
  if (value === 'human' || value === 'agent' || value === 'automation') {
    return value;
  }
  return null;
}

function parseSessionController(value: unknown): StreamSessionController | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }
  const controllerId = readString(record['controllerId']);
  const controllerType = parseSessionControllerType(record['controllerType']);
  const controllerLabel =
    record['controllerLabel'] === null ? null : readString(record['controllerLabel']);
  const claimedAt = readString(record['claimedAt']);
  if (
    controllerId === null ||
    controllerType === null ||
    (controllerLabel === null && record['controllerLabel'] !== null) ||
    claimedAt === null
  ) {
    return undefined;
  }
  return {
    controllerId,
    controllerType,
    controllerLabel,
    claimedAt,
  };
}

function parseTelemetryStatusHint(value: unknown): StreamTelemetryStatusHint | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (value === 'running' || value === 'completed' || value === 'needs-input') {
    return value;
  }
  return undefined;
}

function parseTelemetrySummary(value: unknown): StreamTelemetrySummary | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }
  const source = parseTelemetrySource(record['source']);
  const eventName = record['eventName'] === null ? null : readString(record['eventName']);
  const severity = record['severity'] === null ? null : readString(record['severity']);
  const summary = record['summary'] === null ? null : readString(record['summary']);
  const observedAt = readString(record['observedAt']);
  if (
    source === null ||
    (eventName === null && record['eventName'] !== null) ||
    (severity === null && record['severity'] !== null) ||
    (summary === null && record['summary'] !== null) ||
    observedAt === null
  ) {
    return undefined;
  }
  return {
    source,
    eventName,
    severity,
    summary,
    observedAt,
  };
}

function parseSessionKeyEventRecord(value: unknown): StreamSessionKeyEventRecord | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const source = parseTelemetrySource(record['source']);
  const eventName = record['eventName'] === null ? null : readString(record['eventName']);
  const severity = record['severity'] === null ? null : readString(record['severity']);
  const summary = record['summary'] === null ? null : readString(record['summary']);
  const observedAt = readString(record['observedAt']);
  const statusHint = parseTelemetryStatusHint(record['statusHint']);
  if (
    source === null ||
    (eventName === null && record['eventName'] !== null) ||
    (severity === null && record['severity'] !== null) ||
    (summary === null && record['summary'] !== null) ||
    observedAt === null ||
    statusHint === undefined
  ) {
    return null;
  }
  return {
    source,
    eventName,
    severity,
    summary,
    observedAt,
    statusHint,
  };
}

function parseStreamObservedEvent(value: unknown): StreamObservedEvent | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const type = readString(record['type']);
  if (type === null) {
    return null;
  }

  if (type === 'directory-upserted') {
    const directory = asRecord(record['directory']);
    if (directory === null) {
      return null;
    }
    return {
      type,
      directory,
    };
  }

  if (type === 'directory-archived') {
    const directoryId = readString(record['directoryId']);
    const ts = readString(record['ts']);
    if (directoryId === null || ts === null) {
      return null;
    }
    return {
      type,
      directoryId,
      ts,
    };
  }

  if (type === 'directory-git-updated') {
    const directoryId = readString(record['directoryId']);
    const summaryRecord = asRecord(record['summary']);
    const repositorySnapshotRecord = asRecord(record['repositorySnapshot']);
    const repositoryId =
      record['repositoryId'] === null ? null : readString(record['repositoryId']);
    const repository = record['repository'] === null ? null : asRecord(record['repository']);
    const observedAt = readString(record['observedAt']);
    if (
      directoryId === null ||
      summaryRecord === null ||
      repositorySnapshotRecord === null ||
      (repositoryId === null && record['repositoryId'] !== null) ||
      (repository === null && record['repository'] !== null) ||
      observedAt === null
    ) {
      return null;
    }
    const branch = readString(summaryRecord['branch']);
    const changedFiles = readNumber(summaryRecord['changedFiles']);
    const additions = readNumber(summaryRecord['additions']);
    const deletions = readNumber(summaryRecord['deletions']);
    if (branch === null || changedFiles === null || additions === null || deletions === null) {
      return null;
    }
    const normalizedRemoteUrl =
      repositorySnapshotRecord['normalizedRemoteUrl'] === null
        ? null
        : readString(repositorySnapshotRecord['normalizedRemoteUrl']);
    const commitCount =
      repositorySnapshotRecord['commitCount'] === null
        ? null
        : readNumber(repositorySnapshotRecord['commitCount']);
    const lastCommitAt =
      repositorySnapshotRecord['lastCommitAt'] === null
        ? null
        : readString(repositorySnapshotRecord['lastCommitAt']);
    const shortCommitHash =
      repositorySnapshotRecord['shortCommitHash'] === null
        ? null
        : readString(repositorySnapshotRecord['shortCommitHash']);
    const inferredName =
      repositorySnapshotRecord['inferredName'] === null
        ? null
        : readString(repositorySnapshotRecord['inferredName']);
    const defaultBranch =
      repositorySnapshotRecord['defaultBranch'] === null
        ? null
        : readString(repositorySnapshotRecord['defaultBranch']);
    if (
      (normalizedRemoteUrl === null && repositorySnapshotRecord['normalizedRemoteUrl'] !== null) ||
      (commitCount === null && repositorySnapshotRecord['commitCount'] !== null) ||
      (lastCommitAt === null && repositorySnapshotRecord['lastCommitAt'] !== null) ||
      (shortCommitHash === null && repositorySnapshotRecord['shortCommitHash'] !== null) ||
      (inferredName === null && repositorySnapshotRecord['inferredName'] !== null) ||
      (defaultBranch === null && repositorySnapshotRecord['defaultBranch'] !== null)
    ) {
      return null;
    }
    return {
      type,
      directoryId,
      summary: {
        branch,
        changedFiles,
        additions,
        deletions,
      },
      repositorySnapshot: {
        normalizedRemoteUrl,
        commitCount,
        lastCommitAt,
        shortCommitHash,
        inferredName,
        defaultBranch,
      },
      repositoryId,
      repository,
      observedAt,
    };
  }

  if (type === 'conversation-created') {
    const conversation = asRecord(record['conversation']);
    if (conversation === null) {
      return null;
    }
    return {
      type,
      conversation,
    };
  }

  if (type === 'conversation-updated') {
    const conversation = asRecord(record['conversation']);
    if (conversation === null) {
      return null;
    }
    return {
      type,
      conversation,
    };
  }

  if (type === 'conversation-archived') {
    const conversationId = readString(record['conversationId']);
    const ts = readString(record['ts']);
    if (conversationId === null || ts === null) {
      return null;
    }
    return {
      type,
      conversationId,
      ts,
    };
  }

  if (type === 'conversation-deleted') {
    const conversationId = readString(record['conversationId']);
    const ts = readString(record['ts']);
    if (conversationId === null || ts === null) {
      return null;
    }
    return {
      type,
      conversationId,
      ts,
    };
  }

  if (type === 'repository-upserted') {
    const repository = asRecord(record['repository']);
    if (repository === null) {
      return null;
    }
    return {
      type,
      repository,
    };
  }

  if (type === 'repository-updated') {
    const repository = asRecord(record['repository']);
    if (repository === null) {
      return null;
    }
    return {
      type,
      repository,
    };
  }

  if (type === 'repository-archived') {
    const repositoryId = readString(record['repositoryId']);
    const ts = readString(record['ts']);
    if (repositoryId === null || ts === null) {
      return null;
    }
    return {
      type,
      repositoryId,
      ts,
    };
  }

  if (type === 'task-created') {
    const task = asRecord(record['task']);
    if (task === null) {
      return null;
    }
    return {
      type,
      task,
    };
  }

  if (type === 'task-updated') {
    const task = asRecord(record['task']);
    if (task === null) {
      return null;
    }
    return {
      type,
      task,
    };
  }

  if (type === 'task-deleted') {
    const taskId = readString(record['taskId']);
    const ts = readString(record['ts']);
    if (taskId === null || ts === null) {
      return null;
    }
    return {
      type,
      taskId,
      ts,
    };
  }

  if (type === 'task-reordered') {
    const tasksValue = record['tasks'];
    if (!Array.isArray(tasksValue)) {
      return null;
    }
    const tasks: Record<string, unknown>[] = [];
    for (const entry of tasksValue) {
      const normalized = asRecord(entry);
      if (normalized === null) {
        return null;
      }
      tasks.push(normalized);
    }
    const ts = readString(record['ts']);
    if (ts === null) {
      return null;
    }
    return {
      type,
      tasks,
      ts,
    };
  }

  if (type === 'session-status') {
    const sessionId = readString(record['sessionId']);
    const status = readString(record['status']);
    const attentionReason = readString(record['attentionReason']);
    const live = readBoolean(record['live']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    const telemetry = parseTelemetrySummary(record['telemetry']);
    const controller = parseSessionController(record['controller']);
    if (
      sessionId === null ||
      status === null ||
      live === null ||
      ts === null ||
      (record['attentionReason'] !== null && attentionReason === null) ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null) ||
      (record['telemetry'] !== undefined && telemetry === undefined) ||
      (record['controller'] !== undefined && controller === undefined)
    ) {
      return null;
    }
    if (
      status !== 'running' &&
      status !== 'needs-input' &&
      status !== 'completed' &&
      status !== 'exited'
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      status,
      attentionReason: record['attentionReason'] === null ? null : attentionReason,
      live,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId,
      telemetry: telemetry ?? null,
      controller: controller ?? null,
    };
  }

  if (type === 'session-event') {
    const sessionId = readString(record['sessionId']);
    const event = parseStreamSessionEvent(record['event']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    if (
      sessionId === null ||
      event === null ||
      ts === null ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null)
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      event,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId,
    };
  }

  if (type === 'session-key-event') {
    const sessionId = readString(record['sessionId']);
    const keyEvent = parseSessionKeyEventRecord(record['keyEvent']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    if (
      sessionId === null ||
      keyEvent === null ||
      ts === null ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null)
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      keyEvent,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId,
    };
  }

  if (type === 'session-control') {
    const sessionId = readString(record['sessionId']);
    const action = readString(record['action']);
    const controller = parseSessionController(record['controller']);
    const previousController = parseSessionController(record['previousController']);
    const reason = record['reason'] === null ? null : readString(record['reason']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    if (
      sessionId === null ||
      (action !== 'claimed' && action !== 'released' && action !== 'taken-over') ||
      controller === undefined ||
      previousController === undefined ||
      (reason === null && record['reason'] !== null) ||
      ts === null ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null)
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      action,
      controller,
      previousController,
      reason,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId,
    };
  }

  if (type === 'session-output') {
    const sessionId = readString(record['sessionId']);
    const outputCursor = readNumber(record['outputCursor']);
    const chunkBase64 = readString(record['chunkBase64']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    if (
      sessionId === null ||
      outputCursor === null ||
      chunkBase64 === null ||
      ts === null ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null)
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      outputCursor,
      chunkBase64,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId,
    };
  }

  return null;
}

export function parseServerEnvelope(value: unknown): StreamServerEnvelope | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const kind = readString(record['kind']);
  if (kind === null) {
    return null;
  }

  if (kind === 'auth.ok') {
    return {
      kind,
    };
  }

  if (kind === 'auth.error') {
    const error = readString(record['error']);
    if (error === null) {
      return null;
    }
    return {
      kind,
      error,
    };
  }

  if (kind === 'command.accepted') {
    const commandId = readString(record['commandId']);
    if (commandId === null) {
      return null;
    }
    return {
      kind,
      commandId,
    };
  }

  if (kind === 'command.completed') {
    const commandId = readString(record['commandId']);
    const result = asRecord(record['result']);
    if (commandId === null || result === null) {
      return null;
    }
    return {
      kind,
      commandId,
      result,
    };
  }

  if (kind === 'command.failed') {
    const commandId = readString(record['commandId']);
    const error = readString(record['error']);
    if (commandId === null || error === null) {
      return null;
    }
    return {
      kind,
      commandId,
      error,
    };
  }

  if (kind === 'stream.event') {
    const subscriptionId = readString(record['subscriptionId']);
    const cursor = readNumber(record['cursor']);
    const event = parseStreamObservedEvent(record['event']);
    if (subscriptionId === null || cursor === null || event === null) {
      return null;
    }
    return {
      kind,
      subscriptionId,
      cursor,
      event,
    };
  }

  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }

  if (kind === 'pty.output') {
    const cursor = readNumber(record['cursor']);
    const chunkBase64 = readString(record['chunkBase64']);
    if (cursor === null || chunkBase64 === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      cursor,
      chunkBase64,
    };
  }

  if (kind === 'pty.exit') {
    const exitRecord = asRecord(record['exit']);
    if (exitRecord === null) {
      return null;
    }
    const code = exitRecord['code'];
    const signal = exitRecord['signal'];
    const normalizedCode = code === null ? null : readNumber(code);
    const normalizedSignal = signal === null ? null : readSignalName(signal);
    if (normalizedCode === null && code !== null) {
      return null;
    }
    if (normalizedSignal === null && signal !== null) {
      return null;
    }
    return {
      kind,
      sessionId,
      exit: {
        code: normalizedCode,
        signal: normalizedSignal,
      },
    };
  }

  if (kind === 'pty.event') {
    const event = parseStreamSessionEvent(record['event']);
    if (event === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      event,
    };
  }

  return null;
}
