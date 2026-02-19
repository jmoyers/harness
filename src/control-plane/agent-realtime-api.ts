import type { PtyExit } from '../pty/pty_host.ts';
import { connectControlPlaneStreamClient, type ControlPlaneStreamClient } from './stream-client.ts';
import { parseSessionSummaryList, parseSessionSummaryRecord } from './session-summary.ts';
import {
  type StreamCommand,
  type StreamObservedEvent,
  type StreamSessionController,
  type StreamSessionControllerType,
  type StreamSessionRuntimeStatus,
  type StreamSessionStatusModel,
  type StreamSignal,
} from './stream-protocol.ts';

export interface AgentRealtimeSubscriptionFilter {
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

export interface AgentRealtimeConnectOptions {
  host: string;
  port: number;
  authToken?: string;
  connectRetryWindowMs?: number;
  connectRetryDelayMs?: number;
  subscription?: AgentRealtimeSubscriptionFilter;
  onHandlerError?: (error: unknown, event: AgentRealtimeEventEnvelope) => void;
}

interface AgentEventTypeMap {
  'directory.upserted': Extract<StreamObservedEvent, { type: 'directory-upserted' }>;
  'directory.archived': Extract<StreamObservedEvent, { type: 'directory-archived' }>;
  'directory.git-updated': Extract<StreamObservedEvent, { type: 'directory-git-updated' }>;
  'conversation.created': Extract<StreamObservedEvent, { type: 'conversation-created' }>;
  'conversation.updated': Extract<StreamObservedEvent, { type: 'conversation-updated' }>;
  'conversation.archived': Extract<StreamObservedEvent, { type: 'conversation-archived' }>;
  'conversation.deleted': Extract<StreamObservedEvent, { type: 'conversation-deleted' }>;
  'repository.upserted': Extract<StreamObservedEvent, { type: 'repository-upserted' }>;
  'repository.updated': Extract<StreamObservedEvent, { type: 'repository-updated' }>;
  'repository.archived': Extract<StreamObservedEvent, { type: 'repository-archived' }>;
  'task.created': Extract<StreamObservedEvent, { type: 'task-created' }>;
  'task.updated': Extract<StreamObservedEvent, { type: 'task-updated' }>;
  'task.deleted': Extract<StreamObservedEvent, { type: 'task-deleted' }>;
  'task.reordered': Extract<StreamObservedEvent, { type: 'task-reordered' }>;
  'github.pr-upserted': Extract<StreamObservedEvent, { type: 'github-pr-upserted' }>;
  'github.pr-closed': Extract<StreamObservedEvent, { type: 'github-pr-closed' }>;
  'github.pr-jobs-updated': Extract<StreamObservedEvent, { type: 'github-pr-jobs-updated' }>;
  'session.status': Extract<StreamObservedEvent, { type: 'session-status' }>;
  'session.event': Extract<StreamObservedEvent, { type: 'session-event' }>;
  'session.telemetry': Extract<StreamObservedEvent, { type: 'session-key-event' }>;
  'session.control': Extract<StreamObservedEvent, { type: 'session-control' }>;
  'session.output': Extract<StreamObservedEvent, { type: 'session-output' }>;
}

export type AgentRealtimeEventType = keyof AgentEventTypeMap;

export interface AgentRealtimeEventEnvelope<
  TEventType extends AgentRealtimeEventType = AgentRealtimeEventType,
> {
  readonly type: TEventType;
  readonly subscriptionId?: string;
  readonly cursor: number;
  readonly observed: AgentEventTypeMap[TEventType];
}

type AgentRealtimeListener<TEventType extends AgentRealtimeEventType> = (
  event: AgentRealtimeEventEnvelope<TEventType>,
) => void | Promise<void>;

type AnyRealtimeListener = (event: AgentRealtimeEventEnvelope) => void | Promise<void>;

export interface AgentClaimSessionInput {
  sessionId: string;
  controllerId: string;
  controllerType: StreamSessionControllerType;
  controllerLabel?: string;
  reason?: string;
  takeover?: boolean;
}

export interface AgentReleaseSessionInput {
  sessionId: string;
  reason?: string;
}

export interface AgentSessionClaimResult {
  sessionId: string;
  action: 'claimed' | 'taken-over';
  controller: StreamSessionController;
}

export interface AgentSessionReleaseResult {
  sessionId: string;
  released: boolean;
}

export type AgentSessionSummary = NonNullable<ReturnType<typeof parseSessionSummaryRecord>>;

export interface AgentScopeQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
}

export interface AgentProject {
  projectId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  path: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface AgentProjectUpsertInput extends AgentScopeQuery {
  projectId?: string;
  path: string;
}

export interface AgentProjectListQuery extends AgentScopeQuery {
  includeArchived?: boolean;
  limit?: number;
}

interface AgentProjectGitStatusListQuery extends AgentScopeQuery {
  projectId?: string;
}

interface AgentProjectGitStatus {
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
  repository: AgentRepository | null;
  observedAt: string;
}

export interface AgentThread {
  threadId: string;
  projectId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  agentType: string;
  createdAt: string;
  archivedAt: string | null;
  runtimeStatus: StreamSessionRuntimeStatus;
  runtimeStatusModel: StreamSessionStatusModel | null;
  runtimeLive: boolean;
  runtimeAttentionReason: string | null;
  runtimeProcessId: number | null;
  runtimeLastEventAt: string | null;
  runtimeLastExit: PtyExit | null;
  adapterState: Record<string, unknown>;
}

export interface AgentThreadCreateInput {
  threadId?: string;
  projectId: string;
  title: string;
  agentType: string;
  adapterState?: Record<string, unknown>;
}

export interface AgentThreadListQuery extends AgentScopeQuery {
  projectId?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface AgentThreadUpdateInput {
  title: string;
}

export interface AgentRepository {
  repositoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  name: string;
  remoteUrl: string;
  defaultBranch: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  archivedAt: string | null;
}

export interface AgentRepositoryUpsertInput extends AgentScopeQuery {
  repositoryId?: string;
  name: string;
  remoteUrl: string;
  defaultBranch?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRepositoryListQuery extends AgentScopeQuery {
  includeArchived?: boolean;
  limit?: number;
}

export interface AgentRepositoryUpdateInput {
  name?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  metadata?: Record<string, unknown>;
}

export type AgentTaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';
export type AgentTaskLinearPriority = 0 | 1 | 2 | 3 | 4;

export interface AgentTaskLinearRecord {
  issueId: string | null;
  identifier: string | null;
  url: string | null;
  teamId: string | null;
  projectId: string | null;
  projectMilestoneId: string | null;
  cycleId: string | null;
  stateId: string | null;
  assigneeId: string | null;
  priority: AgentTaskLinearPriority | null;
  estimate: number | null;
  dueDate: string | null;
  labelIds: readonly string[];
}

export interface AgentTaskLinearInput {
  issueId?: string | null;
  identifier?: string | null;
  url?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  cycleId?: string | null;
  stateId?: string | null;
  assigneeId?: string | null;
  priority?: AgentTaskLinearPriority | null;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: readonly string[] | null;
}

export interface AgentTask {
  taskId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  repositoryId: string | null;
  scopeKind: 'global' | 'repository' | 'project';
  projectId: string | null;
  title: string;
  description: string;
  status: AgentTaskStatus;
  orderIndex: number;
  claimedByControllerId: string | null;
  claimedByProjectId: string | null;
  branchName: string | null;
  baseBranch: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  linear: AgentTaskLinearRecord;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskCreateInput extends AgentScopeQuery {
  taskId?: string;
  repositoryId?: string;
  projectId?: string;
  title: string;
  description?: string;
  linear?: AgentTaskLinearInput;
}

export interface AgentTaskListQuery extends AgentScopeQuery {
  repositoryId?: string;
  projectId?: string;
  scopeKind?: 'global' | 'repository' | 'project';
  status?: AgentTaskStatus;
  limit?: number;
}

export interface AgentTaskUpdateInput {
  title?: string;
  description?: string;
  repositoryId?: string | null;
  projectId?: string | null;
  linear?: AgentTaskLinearInput | null;
}

export interface AgentTaskClaimInput {
  taskId: string;
  controllerId: string;
  projectId?: string;
  branchName?: string;
  baseBranch?: string;
}

export interface AgentTaskPullInput extends AgentScopeQuery {
  controllerId: string;
  projectId?: string;
  repositoryId?: string;
  branchName?: string;
  baseBranch?: string;
}

export interface AgentProjectSettings {
  directoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  pinnedBranch: string | null;
  taskFocusMode: 'balanced' | 'own-only';
  threadSpawnMode: 'new-thread' | 'reuse-thread';
  createdAt: string;
  updatedAt: string;
}

export interface AgentProjectSettingsUpdateInput {
  pinnedBranch?: string | null;
  taskFocusMode?: 'balanced' | 'own-only';
  threadSpawnMode?: 'new-thread' | 'reuse-thread';
}

export interface AgentAutomationPolicy {
  policyId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  scope: 'global' | 'repository' | 'project';
  scopeId: string | null;
  automationEnabled: boolean;
  frozen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskReorderInput {
  tenantId: string;
  userId: string;
  workspaceId: string;
  orderedTaskIds: readonly string[];
}

export interface AgentRealtimeSubscription {
  readonly subscriptionId: string;
  readonly cursor: number;
  unsubscribe(): Promise<{ unsubscribed: boolean }>;
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

function readNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (!value.every((entry) => typeof entry === 'string')) {
    return undefined;
  }
  return [...value];
}

function defaultTaskLinearRecord(): AgentTaskLinearRecord {
  return {
    issueId: null,
    identifier: null,
    url: null,
    teamId: null,
    projectId: null,
    projectMilestoneId: null,
    cycleId: null,
    stateId: null,
    assigneeId: null,
    priority: null,
    estimate: null,
    dueDate: null,
    labelIds: [],
  };
}

function parseTaskLinearRecord(value: unknown): AgentTaskLinearRecord | null {
  if (value === undefined) {
    return defaultTaskLinearRecord();
  }
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const issueId = readNullableString(record['issueId']);
  const identifier = readNullableString(record['identifier']);
  const url = readNullableString(record['url']);
  const teamId = readNullableString(record['teamId']);
  const projectId = readNullableString(record['projectId']);
  const projectMilestoneId = readNullableString(record['projectMilestoneId']);
  const cycleId = readNullableString(record['cycleId']);
  const stateId = readNullableString(record['stateId']);
  const assigneeId = readNullableString(record['assigneeId']);
  const priority = readNullableNumber(record['priority']);
  const estimate = readNullableNumber(record['estimate']);
  const dueDate = readNullableString(record['dueDate']);
  const labelIdsRaw = record['labelIds'];
  const labelIds = labelIdsRaw === undefined ? [] : readStringArray(labelIdsRaw);
  if (
    issueId === undefined ||
    identifier === undefined ||
    url === undefined ||
    teamId === undefined ||
    projectId === undefined ||
    projectMilestoneId === undefined ||
    cycleId === undefined ||
    stateId === undefined ||
    assigneeId === undefined ||
    priority === undefined ||
    estimate === undefined ||
    dueDate === undefined ||
    labelIds === undefined
  ) {
    return null;
  }
  if (priority !== null && !Number.isInteger(priority)) {
    return null;
  }
  if (priority !== null && (priority < 0 || priority > 4)) {
    return null;
  }
  if (estimate !== null && (!Number.isInteger(estimate) || estimate < 0)) {
    return null;
  }
  return {
    issueId,
    identifier,
    url,
    teamId,
    projectId,
    projectMilestoneId,
    cycleId,
    stateId,
    assigneeId,
    priority: priority as AgentTaskLinearPriority | null,
    estimate,
    dueDate,
    labelIds,
  };
}

function parseTaskStatus(value: unknown): AgentTaskStatus | null {
  if (value === 'draft' || value === 'ready' || value === 'in-progress' || value === 'completed') {
    return value;
  }
  return null;
}

function parseTaskScopeKind(
  value: unknown,
  repositoryId: string | null | undefined,
  projectId: string | null | undefined,
): 'global' | 'repository' | 'project' | null {
  if (value === 'global' || value === 'repository' || value === 'project') {
    return value;
  }
  if (projectId !== null) {
    return 'project';
  }
  if (repositoryId !== null) {
    return 'repository';
  }
  if (value === undefined || value === null) {
    return 'global';
  }
  return null;
}

function parseRuntimeStatus(value: unknown): StreamSessionRuntimeStatus | null {
  if (
    value === 'running' ||
    value === 'needs-input' ||
    value === 'completed' ||
    value === 'exited'
  ) {
    return value;
  }
  return null;
}

function parseRuntimeStatusModel(value: unknown): StreamSessionStatusModel | null | undefined {
  if (value === null) {
    return null;
  }
  const record = asRecord(value);
  if (record === null) {
    return undefined;
  }
  const runtimeStatus = parseRuntimeStatus(record['runtimeStatus']);
  const phase = readString(record['phase']);
  const glyph = readString(record['glyph']);
  const badge = readString(record['badge']);
  const detailText = readString(record['detailText']);
  const attentionReason = readNullableString(record['attentionReason']);
  const lastKnownWork = readNullableString(record['lastKnownWork']);
  const lastKnownWorkAt = readNullableString(record['lastKnownWorkAt']);
  const phaseHint = readNullableString(record['phaseHint']);
  const observedAt = readString(record['observedAt']);
  if (
    runtimeStatus === null ||
    phase === null ||
    (phase !== 'needs-action' &&
      phase !== 'starting' &&
      phase !== 'working' &&
      phase !== 'idle' &&
      phase !== 'exited') ||
    glyph === null ||
    (glyph !== '▲' && glyph !== '◔' && glyph !== '◆' && glyph !== '○' && glyph !== '■') ||
    badge === null ||
    (badge !== 'NEED' && badge !== 'RUN ' && badge !== 'DONE' && badge !== 'EXIT') ||
    detailText === null ||
    attentionReason === undefined ||
    lastKnownWork === undefined ||
    lastKnownWorkAt === undefined ||
    phaseHint === undefined ||
    (phaseHint !== null &&
      phaseHint !== 'needs-action' &&
      phaseHint !== 'working' &&
      phaseHint !== 'idle') ||
    observedAt === null
  ) {
    return undefined;
  }
  return {
    runtimeStatus,
    phase,
    glyph,
    badge,
    detailText,
    attentionReason,
    lastKnownWork,
    lastKnownWorkAt,
    phaseHint,
    observedAt,
  };
}

function parseSignal(value: unknown): NodeJS.Signals | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  if (!/^SIG[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(value)) {
    return undefined;
  }
  return value as NodeJS.Signals;
}

function parseExit(value: unknown): PtyExit | null | undefined {
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
  const code = readNullableNumber(record['code']);
  const signal = parseSignal(record['signal']);
  if (code === undefined || signal === undefined) {
    return undefined;
  }
  return {
    code,
    signal,
  };
}

function parseProjectRecord(value: unknown): AgentProject | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const projectId = readString(record['directoryId']);
  const tenantId = readString(record['tenantId']);
  const userId = readString(record['userId']);
  const workspaceId = readString(record['workspaceId']);
  const path = readString(record['path']);
  const createdAt = readString(record['createdAt']);
  const archivedAt = readNullableString(record['archivedAt']);
  if (
    projectId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    path === null ||
    createdAt === null ||
    archivedAt === undefined
  ) {
    return null;
  }
  return {
    projectId,
    tenantId,
    userId,
    workspaceId,
    path,
    createdAt,
    archivedAt,
  };
}

function parseProjectSettingsRecord(value: unknown): AgentProjectSettings | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const directoryId = readString(record['directoryId']);
  const tenantId = readString(record['tenantId']);
  const userId = readString(record['userId']);
  const workspaceId = readString(record['workspaceId']);
  const pinnedBranch = readNullableString(record['pinnedBranch']);
  const taskFocusMode = record['taskFocusMode'];
  const threadSpawnMode = record['threadSpawnMode'];
  const createdAt = readString(record['createdAt']);
  const updatedAt = readString(record['updatedAt']);
  if (
    directoryId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    pinnedBranch === undefined ||
    (taskFocusMode !== 'balanced' && taskFocusMode !== 'own-only') ||
    (threadSpawnMode !== 'new-thread' && threadSpawnMode !== 'reuse-thread') ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  return {
    directoryId,
    tenantId,
    userId,
    workspaceId,
    pinnedBranch,
    taskFocusMode,
    threadSpawnMode,
    createdAt,
    updatedAt,
  };
}

function parseAutomationPolicyRecord(value: unknown): AgentAutomationPolicy | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const policyId = readString(record['policyId']);
  const tenantId = readString(record['tenantId']);
  const userId = readString(record['userId']);
  const workspaceId = readString(record['workspaceId']);
  const scope = record['scope'];
  const scopeId = readNullableString(record['scopeId']);
  const automationEnabled = readBoolean(record['automationEnabled']);
  const frozen = readBoolean(record['frozen']);
  const createdAt = readString(record['createdAt']);
  const updatedAt = readString(record['updatedAt']);
  if (
    policyId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    (scope !== 'global' && scope !== 'repository' && scope !== 'project') ||
    scopeId === undefined ||
    automationEnabled === null ||
    frozen === null ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  return {
    policyId,
    tenantId,
    userId,
    workspaceId,
    scope,
    scopeId,
    automationEnabled,
    frozen,
    createdAt,
    updatedAt,
  };
}

function parseThreadRecord(value: unknown): AgentThread | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const threadId = readString(record['conversationId']);
  const projectId = readString(record['directoryId']);
  const tenantId = readString(record['tenantId']);
  const userId = readString(record['userId']);
  const workspaceId = readString(record['workspaceId']);
  const title = readString(record['title']);
  const agentType = readString(record['agentType']);
  const createdAt = readString(record['createdAt']);
  const archivedAt = readNullableString(record['archivedAt']);
  const runtimeStatus = parseRuntimeStatus(record['runtimeStatus']);
  const runtimeStatusModel = parseRuntimeStatusModel(record['runtimeStatusModel']);
  const runtimeLive = readBoolean(record['runtimeLive']);
  const runtimeAttentionReason = readNullableString(record['runtimeAttentionReason']);
  const runtimeProcessId = readNullableNumber(record['runtimeProcessId']);
  const runtimeLastEventAt = readNullableString(record['runtimeLastEventAt']);
  const runtimeLastExit = parseExit(record['runtimeLastExit']);
  const adapterState = asRecord(record['adapterState']);
  if (
    threadId === null ||
    projectId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    title === null ||
    agentType === null ||
    createdAt === null ||
    archivedAt === undefined ||
    runtimeStatus === null ||
    runtimeStatusModel === undefined ||
    runtimeLive === null ||
    runtimeAttentionReason === undefined ||
    runtimeProcessId === undefined ||
    runtimeLastEventAt === undefined ||
    runtimeLastExit === undefined ||
    adapterState === null
  ) {
    return null;
  }
  return {
    threadId,
    projectId,
    tenantId,
    userId,
    workspaceId,
    title,
    agentType,
    createdAt,
    archivedAt,
    runtimeStatus,
    runtimeStatusModel,
    runtimeLive,
    runtimeAttentionReason,
    runtimeProcessId,
    runtimeLastEventAt,
    runtimeLastExit,
    adapterState,
  };
}

function parseRepositoryRecord(value: unknown): AgentRepository | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const repositoryId = readString(record['repositoryId']);
  const tenantId = readString(record['tenantId']);
  const userId = readString(record['userId']);
  const workspaceId = readString(record['workspaceId']);
  const name = readString(record['name']);
  const remoteUrl = readString(record['remoteUrl']);
  const defaultBranch = readString(record['defaultBranch']);
  const metadata = asRecord(record['metadata']);
  const createdAt = readString(record['createdAt']);
  const archivedAt = readNullableString(record['archivedAt']);
  if (
    repositoryId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    name === null ||
    remoteUrl === null ||
    defaultBranch === null ||
    metadata === null ||
    createdAt === null ||
    archivedAt === undefined
  ) {
    return null;
  }
  return {
    repositoryId,
    tenantId,
    userId,
    workspaceId,
    name,
    remoteUrl,
    defaultBranch,
    metadata,
    createdAt,
    archivedAt,
  };
}

function parseProjectGitStatusRecord(value: unknown): AgentProjectGitStatus | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const directoryId = readString(record['directoryId']);
  const summaryRecord = asRecord(record['summary']);
  const repositorySnapshotRecord = asRecord(record['repositorySnapshot']);
  const repositoryId = readNullableString(record['repositoryId']);
  const observedAt = readString(record['observedAt']);
  const repositoryRaw = record['repository'];
  const repository =
    repositoryRaw === null || repositoryRaw === undefined
      ? null
      : parseRepositoryRecord(repositoryRaw);
  if (
    directoryId === null ||
    summaryRecord === null ||
    repositorySnapshotRecord === null ||
    repositoryId === undefined ||
    observedAt === null ||
    (repositoryRaw !== null && repositoryRaw !== undefined && repository === null)
  ) {
    return null;
  }
  const branch = readString(summaryRecord['branch']);
  const changedFiles = readNumber(summaryRecord['changedFiles']);
  const additions = readNumber(summaryRecord['additions']);
  const deletions = readNumber(summaryRecord['deletions']);
  const normalizedRemoteUrl = readNullableString(repositorySnapshotRecord['normalizedRemoteUrl']);
  const commitCount = readNullableNumber(repositorySnapshotRecord['commitCount']);
  const lastCommitAt = readNullableString(repositorySnapshotRecord['lastCommitAt']);
  const shortCommitHash = readNullableString(repositorySnapshotRecord['shortCommitHash']);
  const inferredName = readNullableString(repositorySnapshotRecord['inferredName']);
  const defaultBranch = readNullableString(repositorySnapshotRecord['defaultBranch']);
  if (
    branch === null ||
    changedFiles === null ||
    additions === null ||
    deletions === null ||
    normalizedRemoteUrl === undefined ||
    commitCount === undefined ||
    lastCommitAt === undefined ||
    shortCommitHash === undefined ||
    inferredName === undefined ||
    defaultBranch === undefined
  ) {
    return null;
  }
  return {
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

function parseTaskRecord(value: unknown): AgentTask | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const taskId = readString(record['taskId']);
  const tenantId = readString(record['tenantId']);
  const userId = readString(record['userId']);
  const workspaceId = readString(record['workspaceId']);
  const repositoryId = readNullableString(record['repositoryId']);
  const projectId = readNullableString(record['projectId']);
  const title = readString(record['title']);
  const description = readString(record['description']);
  const status = parseTaskStatus(record['status']);
  const scopeKind = parseTaskScopeKind(record['scopeKind'], repositoryId, projectId);
  const orderIndex = readNumber(record['orderIndex']);
  const claimedByControllerId = readNullableString(record['claimedByControllerId']);
  const claimedByProjectId = readNullableString(record['claimedByDirectoryId']);
  const branchName = readNullableString(record['branchName']);
  const baseBranch = readNullableString(record['baseBranch']);
  const claimedAt = readNullableString(record['claimedAt']);
  const completedAt = readNullableString(record['completedAt']);
  const linear = parseTaskLinearRecord(record['linear']);
  const createdAt = readString(record['createdAt']);
  const updatedAt = readString(record['updatedAt']);
  if (
    taskId === null ||
    tenantId === null ||
    userId === null ||
    workspaceId === null ||
    repositoryId === undefined ||
    projectId === undefined ||
    scopeKind === null ||
    title === null ||
    description === null ||
    status === null ||
    orderIndex === null ||
    claimedByControllerId === undefined ||
    claimedByProjectId === undefined ||
    branchName === undefined ||
    baseBranch === undefined ||
    claimedAt === undefined ||
    completedAt === undefined ||
    linear === null ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  return {
    taskId,
    tenantId,
    userId,
    workspaceId,
    repositoryId,
    scopeKind,
    projectId,
    title,
    description,
    status,
    orderIndex,
    claimedByControllerId,
    claimedByProjectId,
    branchName,
    baseBranch,
    claimedAt,
    completedAt,
    linear,
    createdAt,
    updatedAt,
  };
}

function parseExactRecordArray<T>(
  value: unknown,
  parser: (entry: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed: T[] = [];
  for (const entry of value) {
    const normalized = parser(entry);
    if (normalized === null) {
      return null;
    }
    parsed.push(normalized);
  }
  return parsed;
}

function requireParsed<T>(
  value: unknown,
  parser: (entry: unknown) => T | null,
  errorMessage: string,
): T {
  const parsed = parser(value);
  if (parsed === null) {
    throw new Error(errorMessage);
  }
  return parsed;
}

function requireParsedArray<T>(
  value: unknown,
  parser: (entry: unknown) => T | null,
  errorMessage: string,
): readonly T[] {
  const parsed = parseExactRecordArray(value, parser);
  if (parsed === null) {
    throw new Error(errorMessage);
  }
  return parsed;
}

function requireBoolean(value: unknown, errorMessage: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(errorMessage);
  }
  return value;
}

function optionalField<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  if (value === undefined) {
    return {};
  }
  return {
    [key]: value,
  } as Record<TKey, TValue>;
}

function parseSessionController(value: unknown): StreamSessionController | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const controllerId = record['controllerId'];
  const controllerType = record['controllerType'];
  const controllerLabel = record['controllerLabel'];
  const claimedAt = record['claimedAt'];
  if (
    typeof controllerId !== 'string' ||
    (controllerType !== 'human' && controllerType !== 'agent' && controllerType !== 'automation') ||
    (controllerLabel !== null && typeof controllerLabel !== 'string') ||
    typeof claimedAt !== 'string'
  ) {
    return null;
  }
  return {
    controllerId,
    controllerType,
    controllerLabel,
    claimedAt,
  };
}

function mapObservedEventType(observed: StreamObservedEvent): AgentRealtimeEventType {
  if (observed.type === 'directory-upserted') {
    return 'directory.upserted';
  }
  if (observed.type === 'directory-archived') {
    return 'directory.archived';
  }
  if (observed.type === 'directory-git-updated') {
    return 'directory.git-updated';
  }
  if (observed.type === 'conversation-created') {
    return 'conversation.created';
  }
  if (observed.type === 'conversation-updated') {
    return 'conversation.updated';
  }
  if (observed.type === 'conversation-archived') {
    return 'conversation.archived';
  }
  if (observed.type === 'conversation-deleted') {
    return 'conversation.deleted';
  }
  if (observed.type === 'repository-upserted') {
    return 'repository.upserted';
  }
  if (observed.type === 'repository-updated') {
    return 'repository.updated';
  }
  if (observed.type === 'repository-archived') {
    return 'repository.archived';
  }
  if (observed.type === 'task-created') {
    return 'task.created';
  }
  if (observed.type === 'task-updated') {
    return 'task.updated';
  }
  if (observed.type === 'task-deleted') {
    return 'task.deleted';
  }
  if (observed.type === 'task-reordered') {
    return 'task.reordered';
  }
  if (observed.type === 'github-pr-upserted') {
    return 'github.pr-upserted';
  }
  if (observed.type === 'github-pr-closed') {
    return 'github.pr-closed';
  }
  if (observed.type === 'github-pr-jobs-updated') {
    return 'github.pr-jobs-updated';
  }
  if (observed.type === 'session-status') {
    return 'session.status';
  }
  if (observed.type === 'session-event') {
    return 'session.event';
  }
  if (observed.type === 'session-key-event') {
    return 'session.telemetry';
  }
  if (observed.type === 'session-control') {
    return 'session.control';
  }
  return 'session.output';
}

function parseClaimResult(result: Record<string, unknown>): AgentSessionClaimResult {
  const sessionId = result['sessionId'];
  const action = result['action'];
  const controller = parseSessionController(result['controller']);
  if (
    typeof sessionId !== 'string' ||
    (action !== 'claimed' && action !== 'taken-over') ||
    controller === null
  ) {
    throw new Error('control-plane session.claim returned malformed response');
  }
  return {
    sessionId,
    action,
    controller,
  };
}

function parseReleaseResult(result: Record<string, unknown>): AgentSessionReleaseResult {
  const sessionId = result['sessionId'];
  const released = result['released'];
  if (typeof sessionId !== 'string' || typeof released !== 'boolean') {
    throw new Error('control-plane session.release returned malformed response');
  }
  return {
    sessionId,
    released,
  };
}

function parseSubscriptionResult(result: Record<string, unknown>): {
  subscriptionId: string;
  cursor: number;
} {
  const subscriptionId = result['subscriptionId'];
  const cursor = result['cursor'];
  if (
    typeof subscriptionId !== 'string' ||
    subscriptionId.length === 0 ||
    typeof cursor !== 'number' ||
    !Number.isFinite(cursor)
  ) {
    throw new Error('control-plane stream.subscribe returned malformed subscription id');
  }
  return {
    subscriptionId,
    cursor,
  };
}

function parseUnsubscribeResult(result: Record<string, unknown>): { unsubscribed: boolean } {
  const unsubscribed = result['unsubscribed'];
  if (typeof unsubscribed !== 'boolean') {
    throw new Error('control-plane stream.unsubscribe returned malformed response');
  }
  return {
    unsubscribed,
  };
}

function buildSubscriptionCommand(filter?: AgentRealtimeSubscriptionFilter): {
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
} {
  const command: {
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
  } = {
    type: 'stream.subscribe',
    includeOutput: filter?.includeOutput ?? false,
  };
  if (filter?.tenantId !== undefined) {
    command.tenantId = filter.tenantId;
  }
  if (filter?.userId !== undefined) {
    command.userId = filter.userId;
  }
  if (filter?.workspaceId !== undefined) {
    command.workspaceId = filter.workspaceId;
  }
  if (filter?.repositoryId !== undefined) {
    command.repositoryId = filter.repositoryId;
  }
  if (filter?.taskId !== undefined) {
    command.taskId = filter.taskId;
  }
  if (filter?.directoryId !== undefined) {
    command.directoryId = filter.directoryId;
  }
  if (filter?.conversationId !== undefined) {
    command.conversationId = filter.conversationId;
  }
  if (filter?.afterCursor !== undefined) {
    command.afterCursor = filter.afterCursor;
  }
  return command;
}

export class HarnessAgentRealtimeClient {
  readonly client: ControlPlaneStreamClient;
  readonly projects = {
    create: async (input: AgentProjectUpsertInput): Promise<AgentProject> =>
      await this.createProject(input),
    upsert: async (input: AgentProjectUpsertInput): Promise<AgentProject> =>
      await this.upsertProject(input),
    get: async (projectId: string, scope: AgentScopeQuery = {}): Promise<AgentProject> =>
      await this.getProject(projectId, scope),
    list: async (query: AgentProjectListQuery = {}): Promise<readonly AgentProject[]> =>
      await this.listProjects(query),
    listGitStatus: async (
      query: AgentProjectGitStatusListQuery = {},
    ): Promise<readonly AgentProjectGitStatus[]> => await this.listProjectGitStatus(query),
    update: async (
      projectId: string,
      input: Omit<AgentProjectUpsertInput, 'projectId'>,
    ): Promise<AgentProject> => await this.updateProject(projectId, input),
    archive: async (projectId: string): Promise<AgentProject> =>
      await this.archiveProject(projectId),
    status: async (projectId: string): Promise<Record<string, unknown>> =>
      await this.projectStatus(projectId),
    settings: {
      get: async (projectId: string): Promise<AgentProjectSettings> =>
        await this.getProjectSettings(projectId),
      update: async (
        projectId: string,
        update: AgentProjectSettingsUpdateInput,
      ): Promise<AgentProjectSettings> => await this.updateProjectSettings(projectId, update),
    },
  };

  readonly threads = {
    create: async (input: AgentThreadCreateInput): Promise<AgentThread> =>
      await this.createThread(input),
    get: async (threadId: string, query: AgentThreadListQuery = {}): Promise<AgentThread> =>
      await this.getThread(threadId, query),
    list: async (query: AgentThreadListQuery = {}): Promise<readonly AgentThread[]> =>
      await this.listThreads(query),
    update: async (threadId: string, input: AgentThreadUpdateInput): Promise<AgentThread> =>
      await this.updateThread(threadId, input),
    archive: async (threadId: string): Promise<AgentThread> => await this.archiveThread(threadId),
    delete: async (threadId: string): Promise<{ deleted: boolean }> =>
      await this.deleteThread(threadId),
    status: async (threadId: string): Promise<AgentSessionSummary> =>
      await this.threadStatus(threadId),
  };

  readonly repositories = {
    create: async (input: AgentRepositoryUpsertInput): Promise<AgentRepository> =>
      await this.createRepository(input),
    upsert: async (input: AgentRepositoryUpsertInput): Promise<AgentRepository> =>
      await this.upsertRepository(input),
    get: async (repositoryId: string): Promise<AgentRepository> =>
      await this.getRepository(repositoryId),
    list: async (query: AgentRepositoryListQuery = {}): Promise<readonly AgentRepository[]> =>
      await this.listRepositories(query),
    update: async (
      repositoryId: string,
      update: AgentRepositoryUpdateInput,
    ): Promise<AgentRepository> => await this.updateRepository(repositoryId, update),
    archive: async (repositoryId: string): Promise<AgentRepository> =>
      await this.archiveRepository(repositoryId),
  };

  readonly tasks = {
    create: async (input: AgentTaskCreateInput): Promise<AgentTask> => await this.createTask(input),
    get: async (taskId: string): Promise<AgentTask> => await this.getTask(taskId),
    list: async (query: AgentTaskListQuery = {}): Promise<readonly AgentTask[]> =>
      await this.listTasks(query),
    update: async (taskId: string, update: AgentTaskUpdateInput): Promise<AgentTask> =>
      await this.updateTask(taskId, update),
    delete: async (taskId: string): Promise<{ deleted: boolean }> => await this.deleteTask(taskId),
    claim: async (input: AgentTaskClaimInput): Promise<AgentTask> => await this.claimTask(input),
    pull: async (
      input: AgentTaskPullInput,
    ): Promise<{
      task: AgentTask | null;
      directoryId: string | null;
      availability: string;
      reason: string | null;
      settings: AgentProjectSettings | null;
      repositoryId: string | null;
    }> => await this.pullTask(input),
    complete: async (taskId: string): Promise<AgentTask> => await this.completeTask(taskId),
    ready: async (taskId: string): Promise<AgentTask> => await this.readyTask(taskId),
    draft: async (taskId: string): Promise<AgentTask> => await this.draftTask(taskId),
    queue: async (taskId: string): Promise<AgentTask> => await this.queueTask(taskId),
    reorder: async (input: AgentTaskReorderInput): Promise<readonly AgentTask[]> =>
      await this.reorderTasks(input),
  };

  readonly automation = {
    getPolicy: async (input: {
      scope: 'global' | 'repository' | 'project';
      scopeId?: string;
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
    }): Promise<AgentAutomationPolicy> => await this.getAutomationPolicy(input),
    setPolicy: async (input: {
      scope: 'global' | 'repository' | 'project';
      scopeId?: string;
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      automationEnabled?: boolean;
      frozen?: boolean;
    }): Promise<AgentAutomationPolicy> => await this.setAutomationPolicy(input),
  };

  readonly sessions = {
    list: async (
      query: Parameters<HarnessAgentRealtimeClient['listSessions']>[0] = {},
    ): Promise<readonly AgentSessionSummary[]> => await this.listSessions(query),
    status: async (sessionId: string): Promise<AgentSessionSummary> =>
      await this.sessionStatus(sessionId),
    claim: async (input: AgentClaimSessionInput): Promise<AgentSessionClaimResult> =>
      await this.claimSession(input),
    takeover: async (
      input: Omit<AgentClaimSessionInput, 'takeover'>,
    ): Promise<AgentSessionClaimResult> => await this.takeoverSession(input),
    release: async (input: AgentReleaseSessionInput): Promise<AgentSessionReleaseResult> =>
      await this.releaseSession(input),
    respond: async (
      sessionId: string,
      text: string,
    ): Promise<{ responded: boolean; sentBytes: number }> => await this.respond(sessionId, text),
    interrupt: async (sessionId: string): Promise<{ interrupted: boolean }> =>
      await this.interrupt(sessionId),
    remove: async (sessionId: string): Promise<{ removed: boolean }> =>
      await this.removeSession(sessionId),
    start: async (
      input: Parameters<HarnessAgentRealtimeClient['startSession']>[0],
    ): Promise<{ sessionId: string }> => await this.startSession(input),
    attach: async (sessionId: string, sinceCursor = 0): Promise<{ latestCursor: number }> =>
      await this.attachSession(sessionId, sinceCursor),
    detach: async (sessionId: string): Promise<{ detached: boolean }> =>
      await this.detachSession(sessionId),
    close: async (sessionId: string): Promise<{ closed: boolean }> =>
      await this.closeSession(sessionId),
    subscribeEvents: async (sessionId: string): Promise<{ subscribed: boolean }> =>
      await this.subscribeSessionEvents(sessionId),
    unsubscribeEvents: async (sessionId: string): Promise<{ subscribed: boolean }> =>
      await this.unsubscribeSessionEvents(sessionId),
  };

  readonly subscriptions = {
    create: async (filter?: AgentRealtimeSubscriptionFilter): Promise<AgentRealtimeSubscription> =>
      await this.subscribe(filter),
    remove: async (subscriptionId: string): Promise<{ unsubscribed: boolean }> =>
      await this.unsubscribe(subscriptionId),
  };

  private readonly listenersByType = new Map<
    AgentRealtimeEventType | '*',
    Set<AnyRealtimeListener>
  >();
  private readonly subscriptionIds = new Set<string>();
  private readonly onHandlerError:
    | ((error: unknown, event: AgentRealtimeEventEnvelope) => void)
    | undefined;
  private readonly removeEnvelopeListener: () => void;
  private closed = false;

  private constructor(
    client: ControlPlaneStreamClient,
    initialSubscriptionId: string,
    removeEnvelopeListener: () => void,
    onHandlerError: ((error: unknown, event: AgentRealtimeEventEnvelope) => void) | undefined,
  ) {
    this.client = client;
    this.subscriptionIds.add(initialSubscriptionId);
    this.removeEnvelopeListener = removeEnvelopeListener;
    this.onHandlerError = onHandlerError;
  }

  static async connect(options: AgentRealtimeConnectOptions): Promise<HarnessAgentRealtimeClient> {
    const connectOptions: {
      host: string;
      port: number;
      authToken?: string;
      connectRetryWindowMs?: number;
      connectRetryDelayMs?: number;
    } = {
      host: options.host,
      port: options.port,
    };
    if (options.authToken !== undefined) {
      connectOptions.authToken = options.authToken;
    }
    if (options.connectRetryWindowMs !== undefined) {
      connectOptions.connectRetryWindowMs = options.connectRetryWindowMs;
    }
    if (options.connectRetryDelayMs !== undefined) {
      connectOptions.connectRetryDelayMs = options.connectRetryDelayMs;
    }
    const client = await connectControlPlaneStreamClient(connectOptions);

    const buffered: Array<{
      subscriptionId: string;
      cursor: number;
      observed: StreamObservedEvent;
    }> = [];
    let instance: HarnessAgentRealtimeClient | null = null;

    const removeEnvelopeListener = client.onEnvelope((envelope) => {
      if (envelope.kind !== 'stream.event') {
        return;
      }
      const payload = {
        subscriptionId: envelope.subscriptionId,
        cursor: envelope.cursor,
        observed: envelope.event,
      };
      if (instance === null) {
        buffered.push(payload);
        return;
      }
      if (!instance.hasSubscription(payload.subscriptionId)) {
        return;
      }
      instance.dispatch(payload.subscriptionId, payload.cursor, payload.observed);
    });

    try {
      const subscribed = parseSubscriptionResult(
        await client.sendCommand(buildSubscriptionCommand(options.subscription)),
      );
      instance = new HarnessAgentRealtimeClient(
        client,
        subscribed.subscriptionId,
        removeEnvelopeListener,
        options.onHandlerError,
      );
      for (const payload of buffered) {
        if (!instance.hasSubscription(payload.subscriptionId)) {
          continue;
        }
        instance.dispatch(payload.subscriptionId, payload.cursor, payload.observed);
      }
      buffered.length = 0;
      return instance;
    } catch (error: unknown) {
      removeEnvelopeListener();
      client.close();
      throw error;
    }
  }

  on<TEventType extends AgentRealtimeEventType>(
    type: TEventType,
    listener: AgentRealtimeListener<TEventType>,
  ): () => void;
  on(type: '*', listener: AnyRealtimeListener): () => void;
  on(type: AgentRealtimeEventType | '*', listener: AnyRealtimeListener): () => void {
    const existing = this.listenersByType.get(type);
    if (existing === undefined) {
      this.listenersByType.set(type, new Set([listener]));
    } else {
      existing.add(listener);
    }
    return () => {
      const current = this.listenersByType.get(type);
      current?.delete(listener);
      if (current !== undefined && current.size === 0) {
        this.listenersByType.delete(type);
      }
    };
  }

  async sendCommand(command: StreamCommand): Promise<Record<string, unknown>> {
    return await this.client.sendCommand(command);
  }

  async subscribe(filter?: AgentRealtimeSubscriptionFilter): Promise<AgentRealtimeSubscription> {
    const subscribed = parseSubscriptionResult(
      await this.client.sendCommand(buildSubscriptionCommand(filter)),
    );
    this.subscriptionIds.add(subscribed.subscriptionId);
    return {
      subscriptionId: subscribed.subscriptionId,
      cursor: subscribed.cursor,
      unsubscribe: async (): Promise<{ unsubscribed: boolean }> =>
        await this.unsubscribe(subscribed.subscriptionId),
    };
  }

  async unsubscribe(subscriptionId: string): Promise<{ unsubscribed: boolean }> {
    if (!this.subscriptionIds.has(subscriptionId)) {
      return {
        unsubscribed: false,
      };
    }
    const result = parseUnsubscribeResult(
      await this.client.sendCommand({
        type: 'stream.unsubscribe',
        subscriptionId,
      }),
    );
    this.subscriptionIds.delete(subscriptionId);
    return result;
  }

  async upsertProject(input: AgentProjectUpsertInput): Promise<AgentProject> {
    const result = await this.client.sendCommand({
      type: 'directory.upsert',
      ...optionalField('directoryId', input.projectId),
      ...optionalField('tenantId', input.tenantId),
      ...optionalField('userId', input.userId),
      ...optionalField('workspaceId', input.workspaceId),
      path: input.path,
    });
    return requireParsed(
      result['directory'],
      parseProjectRecord,
      'control-plane directory.upsert returned malformed project',
    );
  }

  async createProject(input: AgentProjectUpsertInput): Promise<AgentProject> {
    return await this.upsertProject(input);
  }

  async updateProject(
    projectId: string,
    input: Omit<AgentProjectUpsertInput, 'projectId'>,
  ): Promise<AgentProject> {
    return await this.upsertProject({
      ...input,
      projectId,
    });
  }

  async listProjects(query: AgentProjectListQuery = {}): Promise<readonly AgentProject[]> {
    const result = await this.client.sendCommand({
      type: 'directory.list',
      ...optionalField('tenantId', query.tenantId),
      ...optionalField('userId', query.userId),
      ...optionalField('workspaceId', query.workspaceId),
      ...optionalField('includeArchived', query.includeArchived),
      ...optionalField('limit', query.limit),
    });
    return requireParsedArray(
      result['directories'],
      parseProjectRecord,
      'control-plane directory.list returned malformed projects',
    );
  }

  async listProjectGitStatus(
    query: AgentProjectGitStatusListQuery = {},
  ): Promise<readonly AgentProjectGitStatus[]> {
    const result = await this.client.sendCommand({
      type: 'directory.git-status',
      ...optionalField('tenantId', query.tenantId),
      ...optionalField('userId', query.userId),
      ...optionalField('workspaceId', query.workspaceId),
      ...optionalField('directoryId', query.projectId),
    });
    return requireParsedArray(
      result['gitStatuses'],
      parseProjectGitStatusRecord,
      'control-plane directory.git-status returned malformed statuses',
    );
  }

  async getProject(projectId: string, scope: AgentScopeQuery = {}): Promise<AgentProject> {
    const projects = await this.listProjects({
      ...scope,
      includeArchived: true,
    });
    const project = projects.find((entry) => entry.projectId === projectId);
    if (project === undefined) {
      throw new Error(`project not found: ${projectId}`);
    }
    return project;
  }

  async archiveProject(projectId: string): Promise<AgentProject> {
    const result = await this.client.sendCommand({
      type: 'directory.archive',
      directoryId: projectId,
    });
    return requireParsed(
      result['directory'],
      parseProjectRecord,
      'control-plane directory.archive returned malformed project',
    );
  }

  async projectStatus(projectId: string): Promise<Record<string, unknown>> {
    return await this.client.sendCommand({
      type: 'project.status',
      directoryId: projectId,
    });
  }

  async getProjectSettings(projectId: string): Promise<AgentProjectSettings> {
    const result = await this.client.sendCommand({
      type: 'project.settings-get',
      directoryId: projectId,
    });
    return requireParsed(
      result['settings'],
      parseProjectSettingsRecord,
      'control-plane project.settings-get returned malformed settings',
    );
  }

  async updateProjectSettings(
    projectId: string,
    update: AgentProjectSettingsUpdateInput,
  ): Promise<AgentProjectSettings> {
    const result = await this.client.sendCommand({
      type: 'project.settings-update',
      directoryId: projectId,
      ...update,
    });
    return requireParsed(
      result['settings'],
      parseProjectSettingsRecord,
      'control-plane project.settings-update returned malformed settings',
    );
  }

  async createThread(input: AgentThreadCreateInput): Promise<AgentThread> {
    const result = await this.client.sendCommand({
      type: 'conversation.create',
      ...optionalField('conversationId', input.threadId),
      directoryId: input.projectId,
      title: input.title,
      agentType: input.agentType,
      ...optionalField('adapterState', input.adapterState),
    });
    return requireParsed(
      result['conversation'],
      parseThreadRecord,
      'control-plane conversation.create returned malformed thread',
    );
  }

  async listThreads(query: AgentThreadListQuery = {}): Promise<readonly AgentThread[]> {
    const result = await this.client.sendCommand({
      type: 'conversation.list',
      ...optionalField('directoryId', query.projectId),
      ...optionalField('tenantId', query.tenantId),
      ...optionalField('userId', query.userId),
      ...optionalField('workspaceId', query.workspaceId),
      ...optionalField('includeArchived', query.includeArchived),
      ...optionalField('limit', query.limit),
    });
    return requireParsedArray(
      result['conversations'],
      parseThreadRecord,
      'control-plane conversation.list returned malformed threads',
    );
  }

  async getThread(threadId: string, query: AgentThreadListQuery = {}): Promise<AgentThread> {
    const threads = await this.listThreads({
      ...query,
      includeArchived: true,
    });
    const thread = threads.find((entry) => entry.threadId === threadId);
    if (thread === undefined) {
      throw new Error(`thread not found: ${threadId}`);
    }
    return thread;
  }

  async updateThread(threadId: string, input: AgentThreadUpdateInput): Promise<AgentThread> {
    const result = await this.client.sendCommand({
      type: 'conversation.update',
      conversationId: threadId,
      title: input.title,
    });
    return requireParsed(
      result['conversation'],
      parseThreadRecord,
      'control-plane conversation.update returned malformed thread',
    );
  }

  async archiveThread(threadId: string): Promise<AgentThread> {
    const result = await this.client.sendCommand({
      type: 'conversation.archive',
      conversationId: threadId,
    });
    return requireParsed(
      result['conversation'],
      parseThreadRecord,
      'control-plane conversation.archive returned malformed thread',
    );
  }

  async deleteThread(threadId: string): Promise<{ deleted: boolean }> {
    const result = await this.client.sendCommand({
      type: 'conversation.delete',
      conversationId: threadId,
    });
    const deleted = requireBoolean(
      result['deleted'],
      'control-plane conversation.delete returned malformed response',
    );
    return {
      deleted,
    };
  }

  async threadStatus(threadId: string): Promise<AgentSessionSummary> {
    return await this.sessionStatus(threadId);
  }

  async upsertRepository(input: AgentRepositoryUpsertInput): Promise<AgentRepository> {
    const result = await this.client.sendCommand({
      type: 'repository.upsert',
      ...optionalField('repositoryId', input.repositoryId),
      ...optionalField('tenantId', input.tenantId),
      ...optionalField('userId', input.userId),
      ...optionalField('workspaceId', input.workspaceId),
      name: input.name,
      remoteUrl: input.remoteUrl,
      ...optionalField('defaultBranch', input.defaultBranch),
      ...optionalField('metadata', input.metadata),
    });
    return requireParsed(
      result['repository'],
      parseRepositoryRecord,
      'control-plane repository.upsert returned malformed repository',
    );
  }

  async createRepository(input: AgentRepositoryUpsertInput): Promise<AgentRepository> {
    return await this.upsertRepository(input);
  }

  async getRepository(repositoryId: string): Promise<AgentRepository> {
    const result = await this.client.sendCommand({
      type: 'repository.get',
      repositoryId,
    });
    return requireParsed(
      result['repository'],
      parseRepositoryRecord,
      'control-plane repository.get returned malformed repository',
    );
  }

  async listRepositories(
    query: AgentRepositoryListQuery = {},
  ): Promise<readonly AgentRepository[]> {
    const result = await this.client.sendCommand({
      type: 'repository.list',
      ...optionalField('tenantId', query.tenantId),
      ...optionalField('userId', query.userId),
      ...optionalField('workspaceId', query.workspaceId),
      ...optionalField('includeArchived', query.includeArchived),
      ...optionalField('limit', query.limit),
    });
    return requireParsedArray(
      result['repositories'],
      parseRepositoryRecord,
      'control-plane repository.list returned malformed repositories',
    );
  }

  async updateRepository(
    repositoryId: string,
    update: AgentRepositoryUpdateInput,
  ): Promise<AgentRepository> {
    const result = await this.client.sendCommand({
      type: 'repository.update',
      repositoryId,
      ...update,
    });
    return requireParsed(
      result['repository'],
      parseRepositoryRecord,
      'control-plane repository.update returned malformed repository',
    );
  }

  async archiveRepository(repositoryId: string): Promise<AgentRepository> {
    const result = await this.client.sendCommand({
      type: 'repository.archive',
      repositoryId,
    });
    return requireParsed(
      result['repository'],
      parseRepositoryRecord,
      'control-plane repository.archive returned malformed repository',
    );
  }

  async createTask(input: AgentTaskCreateInput): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.create',
      ...optionalField('taskId', input.taskId),
      ...optionalField('tenantId', input.tenantId),
      ...optionalField('userId', input.userId),
      ...optionalField('workspaceId', input.workspaceId),
      ...optionalField('repositoryId', input.repositoryId),
      ...optionalField('projectId', input.projectId),
      title: input.title,
      ...optionalField('description', input.description),
      ...optionalField('linear', input.linear),
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.create returned malformed task',
    );
  }

  async getTask(taskId: string): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.get',
      taskId,
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.get returned malformed task',
    );
  }

  async listTasks(query: AgentTaskListQuery = {}): Promise<readonly AgentTask[]> {
    const result = await this.client.sendCommand({
      type: 'task.list',
      ...optionalField('tenantId', query.tenantId),
      ...optionalField('userId', query.userId),
      ...optionalField('workspaceId', query.workspaceId),
      ...optionalField('repositoryId', query.repositoryId),
      ...optionalField('projectId', query.projectId),
      ...optionalField('scopeKind', query.scopeKind),
      ...optionalField('status', query.status),
      ...optionalField('limit', query.limit),
    });
    return requireParsedArray(
      result['tasks'],
      parseTaskRecord,
      'control-plane task.list returned malformed tasks',
    );
  }

  async updateTask(taskId: string, update: AgentTaskUpdateInput): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.update',
      taskId,
      ...update,
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.update returned malformed task',
    );
  }

  async deleteTask(taskId: string): Promise<{ deleted: boolean }> {
    const result = await this.client.sendCommand({
      type: 'task.delete',
      taskId,
    });
    const deleted = requireBoolean(
      result['deleted'],
      'control-plane task.delete returned malformed response',
    );
    return {
      deleted,
    };
  }

  async claimTask(input: AgentTaskClaimInput): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.claim',
      taskId: input.taskId,
      controllerId: input.controllerId,
      ...optionalField('directoryId', input.projectId),
      ...optionalField('branchName', input.branchName),
      ...optionalField('baseBranch', input.baseBranch),
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.claim returned malformed task',
    );
  }

  async pullTask(input: AgentTaskPullInput): Promise<{
    task: AgentTask | null;
    directoryId: string | null;
    availability: string;
    reason: string | null;
    settings: AgentProjectSettings | null;
    repositoryId: string | null;
  }> {
    const result = await this.client.sendCommand({
      type: 'task.pull',
      ...optionalField('tenantId', input.tenantId),
      ...optionalField('userId', input.userId),
      ...optionalField('workspaceId', input.workspaceId),
      controllerId: input.controllerId,
      ...optionalField('directoryId', input.projectId),
      ...optionalField('repositoryId', input.repositoryId),
      ...optionalField('branchName', input.branchName),
      ...optionalField('baseBranch', input.baseBranch),
    });
    const taskRaw = result['task'];
    const task =
      taskRaw === null || taskRaw === undefined
        ? null
        : requireParsed(
            taskRaw,
            parseTaskRecord,
            'control-plane task.pull returned malformed task',
          );
    const directoryId = readNullableString(result['directoryId']);
    const availability = result['availability'];
    const reason = readNullableString(result['reason']);
    const settingsRaw = result['settings'];
    const settings =
      settingsRaw === null || settingsRaw === undefined
        ? null
        : requireParsed(
            settingsRaw,
            parseProjectSettingsRecord,
            'control-plane task.pull returned malformed settings',
          );
    const repositoryId = readNullableString(result['repositoryId']);
    if (
      directoryId === undefined ||
      typeof availability !== 'string' ||
      reason === undefined ||
      repositoryId === undefined
    ) {
      throw new Error('control-plane task.pull returned malformed response');
    }
    return {
      task,
      directoryId,
      availability,
      reason,
      settings,
      repositoryId,
    };
  }

  async completeTask(taskId: string): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.complete',
      taskId,
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.complete returned malformed task',
    );
  }

  async readyTask(taskId: string): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.ready',
      taskId,
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.ready returned malformed task',
    );
  }

  async draftTask(taskId: string): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.draft',
      taskId,
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.draft returned malformed task',
    );
  }

  async queueTask(taskId: string): Promise<AgentTask> {
    const result = await this.client.sendCommand({
      type: 'task.queue',
      taskId,
    });
    return requireParsed(
      result['task'],
      parseTaskRecord,
      'control-plane task.queue returned malformed task',
    );
  }

  async reorderTasks(input: AgentTaskReorderInput): Promise<readonly AgentTask[]> {
    const result = await this.client.sendCommand({
      type: 'task.reorder',
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      orderedTaskIds: [...input.orderedTaskIds],
    });
    return requireParsedArray(
      result['tasks'],
      parseTaskRecord,
      'control-plane task.reorder returned malformed tasks',
    );
  }

  async getAutomationPolicy(input: {
    scope: 'global' | 'repository' | 'project';
    scopeId?: string;
    tenantId?: string;
    userId?: string;
    workspaceId?: string;
  }): Promise<AgentAutomationPolicy> {
    const result = await this.client.sendCommand({
      type: 'automation.policy-get',
      scope: input.scope,
      ...optionalField('scopeId', input.scopeId),
      ...optionalField('tenantId', input.tenantId),
      ...optionalField('userId', input.userId),
      ...optionalField('workspaceId', input.workspaceId),
    });
    return requireParsed(
      result['policy'],
      parseAutomationPolicyRecord,
      'control-plane automation.policy-get returned malformed policy',
    );
  }

  async setAutomationPolicy(input: {
    scope: 'global' | 'repository' | 'project';
    scopeId?: string;
    tenantId?: string;
    userId?: string;
    workspaceId?: string;
    automationEnabled?: boolean;
    frozen?: boolean;
  }): Promise<AgentAutomationPolicy> {
    const result = await this.client.sendCommand({
      type: 'automation.policy-set',
      scope: input.scope,
      ...optionalField('scopeId', input.scopeId),
      ...optionalField('tenantId', input.tenantId),
      ...optionalField('userId', input.userId),
      ...optionalField('workspaceId', input.workspaceId),
      ...optionalField('automationEnabled', input.automationEnabled),
      ...optionalField('frozen', input.frozen),
    });
    return requireParsed(
      result['policy'],
      parseAutomationPolicyRecord,
      'control-plane automation.policy-set returned malformed policy',
    );
  }

  async listSessions(
    command: {
      tenantId?: string;
      userId?: string;
      workspaceId?: string;
      worktreeId?: string;
      status?: 'running' | 'needs-input' | 'completed' | 'exited';
      live?: boolean;
      sort?: 'attention-first' | 'started-desc' | 'started-asc';
      limit?: number;
    } = {},
  ): Promise<readonly AgentSessionSummary[]> {
    const result = await this.client.sendCommand({
      type: 'session.list',
      ...command,
    });
    const parsed = parseSessionSummaryList(result['sessions']);
    return parsed;
  }

  async sessionStatus(sessionId: string): Promise<AgentSessionSummary> {
    const result = await this.client.sendCommand({
      type: 'session.status',
      sessionId,
    });
    const parsed = parseSessionSummaryRecord(result);
    if (parsed === null) {
      throw new Error('control-plane session.status returned malformed summary');
    }
    return parsed;
  }

  async claimSession(input: AgentClaimSessionInput): Promise<AgentSessionClaimResult> {
    const command: {
      type: 'session.claim';
      sessionId: string;
      controllerId: string;
      controllerType: StreamSessionControllerType;
      controllerLabel?: string;
      reason?: string;
      takeover?: boolean;
    } = {
      type: 'session.claim',
      sessionId: input.sessionId,
      controllerId: input.controllerId,
      controllerType: input.controllerType,
    };
    if (input.controllerLabel !== undefined) {
      command.controllerLabel = input.controllerLabel;
    }
    if (input.reason !== undefined) {
      command.reason = input.reason;
    }
    if (input.takeover !== undefined) {
      command.takeover = input.takeover;
    }
    const result = await this.client.sendCommand(command);
    return parseClaimResult(result);
  }

  async takeoverSession(
    input: Omit<AgentClaimSessionInput, 'takeover'>,
  ): Promise<AgentSessionClaimResult> {
    return await this.claimSession({
      ...input,
      takeover: true,
    });
  }

  async releaseSession(input: AgentReleaseSessionInput): Promise<AgentSessionReleaseResult> {
    const command: {
      type: 'session.release';
      sessionId: string;
      reason?: string;
    } = {
      type: 'session.release',
      sessionId: input.sessionId,
    };
    if (input.reason !== undefined) {
      command.reason = input.reason;
    }
    const result = await this.client.sendCommand(command);
    return parseReleaseResult(result);
  }

  async respond(
    sessionId: string,
    text: string,
  ): Promise<{ responded: boolean; sentBytes: number }> {
    const result = await this.client.sendCommand({
      type: 'session.respond',
      sessionId,
      text,
    });
    const responded = result['responded'];
    const sentBytes = result['sentBytes'];
    if (typeof responded !== 'boolean' || typeof sentBytes !== 'number') {
      throw new Error('control-plane session.respond returned malformed response');
    }
    return {
      responded,
      sentBytes,
    };
  }

  async interrupt(sessionId: string): Promise<{ interrupted: boolean }> {
    const result = await this.client.sendCommand({
      type: 'session.interrupt',
      sessionId,
    });
    const interrupted = result['interrupted'];
    if (typeof interrupted !== 'boolean') {
      throw new Error('control-plane session.interrupt returned malformed response');
    }
    return {
      interrupted,
    };
  }

  async removeSession(sessionId: string): Promise<{ removed: boolean }> {
    const result = await this.client.sendCommand({
      type: 'session.remove',
      sessionId,
    });
    const removed = result['removed'];
    if (typeof removed !== 'boolean') {
      throw new Error('control-plane session.remove returned malformed response');
    }
    return {
      removed,
    };
  }

  async startSession(input: {
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
  }): Promise<{ sessionId: string }> {
    const result = await this.client.sendCommand({
      type: 'pty.start',
      ...input,
    });
    const sessionId = result['sessionId'];
    if (typeof sessionId !== 'string') {
      throw new Error('control-plane pty.start returned malformed response');
    }
    return {
      sessionId,
    };
  }

  async attachSession(sessionId: string, sinceCursor = 0): Promise<{ latestCursor: number }> {
    const result = await this.client.sendCommand({
      type: 'pty.attach',
      sessionId,
      sinceCursor,
    });
    const latestCursor = result['latestCursor'];
    if (typeof latestCursor !== 'number') {
      throw new Error('control-plane pty.attach returned malformed response');
    }
    return {
      latestCursor,
    };
  }

  async detachSession(sessionId: string): Promise<{ detached: boolean }> {
    const result = await this.client.sendCommand({
      type: 'pty.detach',
      sessionId,
    });
    const detached = result['detached'];
    if (typeof detached !== 'boolean') {
      throw new Error('control-plane pty.detach returned malformed response');
    }
    return {
      detached,
    };
  }

  async subscribeSessionEvents(sessionId: string): Promise<{ subscribed: boolean }> {
    const result = await this.client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId,
    });
    const subscribed = requireBoolean(
      result['subscribed'],
      'control-plane pty.subscribe-events returned malformed response',
    );
    return {
      subscribed,
    };
  }

  async unsubscribeSessionEvents(sessionId: string): Promise<{ subscribed: boolean }> {
    const result = await this.client.sendCommand({
      type: 'pty.unsubscribe-events',
      sessionId,
    });
    const subscribed = requireBoolean(
      result['subscribed'],
      'control-plane pty.unsubscribe-events returned malformed response',
    );
    return {
      subscribed,
    };
  }

  async closeSession(sessionId: string): Promise<{ closed: boolean }> {
    const result = await this.client.sendCommand({
      type: 'pty.close',
      sessionId,
    });
    const closed = result['closed'];
    if (typeof closed !== 'boolean') {
      throw new Error('control-plane pty.close returned malformed response');
    }
    return {
      closed,
    };
  }

  sendInput(sessionId: string, data: string | Buffer): void {
    const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    this.client.sendInput(sessionId, chunk);
  }

  sendResize(sessionId: string, cols: number, rows: number): void {
    this.client.sendResize(sessionId, cols, rows);
  }

  sendSignal(sessionId: string, signal: StreamSignal): void {
    this.client.sendSignal(sessionId, signal);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.removeEnvelopeListener();
    const subscriptions = [...this.subscriptionIds];
    for (const subscriptionId of subscriptions) {
      try {
        await this.client.sendCommand({
          type: 'stream.unsubscribe',
          subscriptionId,
        });
      } catch {
        // Best-effort unsubscribe only.
      }
      this.subscriptionIds.delete(subscriptionId);
    }
    this.client.close();
  }

  private hasSubscription(subscriptionId: string): boolean {
    return this.subscriptionIds.has(subscriptionId);
  }

  private dispatch(subscriptionId: string, cursor: number, observed: StreamObservedEvent): void {
    const type = mapObservedEventType(observed);
    const envelope = {
      type,
      subscriptionId,
      cursor,
      observed,
    } as AgentRealtimeEventEnvelope;
    const specific = this.listenersByType.get(type);
    if (specific !== undefined) {
      for (const handler of specific) {
        this.invokeHandler(handler, envelope);
      }
    }
    const wildcard = this.listenersByType.get('*');
    if (wildcard !== undefined) {
      for (const handler of wildcard) {
        this.invokeHandler(handler, envelope);
      }
    }
  }

  private invokeHandler(handler: AnyRealtimeListener, event: AgentRealtimeEventEnvelope): void {
    void Promise.resolve(handler(event)).catch((error: unknown) => {
      if (this.onHandlerError !== undefined) {
        this.onHandlerError(error, event);
      }
    });
  }
}

export async function connectHarnessAgentRealtimeClient(
  options: AgentRealtimeConnectOptions,
): Promise<HarnessAgentRealtimeClient> {
  return await HarnessAgentRealtimeClient.connect(options);
}
