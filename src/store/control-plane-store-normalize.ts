import type {
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
} from '../control-plane/stream-protocol.ts';
import type { CodexTelemetrySource } from '../control-plane/codex-telemetry.ts';
import type {
  ControlPlaneAutomationPolicyRecord,
  ControlPlaneAutomationPolicyScope,
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneGitHubCiRollup,
  ControlPlaneGitHubPrJobRecord,
  ControlPlaneGitHubPrState,
  ControlPlaneGitHubPullRequestRecord,
  ControlPlaneGitHubSyncStateRecord,
  ControlPlaneProjectSettingsRecord,
  ControlPlaneProjectTaskFocusMode,
  ControlPlaneProjectThreadSpawnMode,
  ControlPlaneRepositoryRecord,
  ControlPlaneTaskRecord,
  ControlPlaneTaskScopeKind,
  ControlPlaneTaskStatus,
  ControlPlaneTelemetryRecord,
} from './control-plane-store-types.ts';

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected object row');
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`expected string for ${field}`);
  }
  return value;
}

export function asStringOrNull(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return asString(value, field);
}

export function asNumberOrNull(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`expected finite number for ${field}`);
  }
  return value;
}

function asBooleanFromInt(value: unknown, field: string): boolean {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`expected integer flag for ${field}`);
  }
  if (value === 0) {
    return false;
  }
  if (value === 1) {
    return true;
  }
  throw new Error(`unexpected flag value for ${field}`);
}

export function sqliteStatementChanges(value: unknown): number {
  if (typeof value !== 'object' || value === null) {
    return 0;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.changes === 'number' ? candidate.changes : 0;
}

function normalizeAdapterState(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    throw new Error('expected string for adapter_state_json');
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeRuntimeStatus(value: unknown): StreamSessionRuntimeStatus {
  const status = asString(value, 'runtime_status');
  if (
    status === 'running' ||
    status === 'needs-input' ||
    status === 'completed' ||
    status === 'exited'
  ) {
    return status;
  }
  throw new Error('expected runtime_status enum value');
}

function normalizeRuntimeStatusModel(value: unknown): StreamSessionStatusModel | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('expected string for runtime_status_model_json');
  }
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null) {
    return null;
  }
  const model = asRecord(parsed);
  const runtimeStatusRaw = asString(model.runtimeStatus, 'runtimeStatus');
  if (
    runtimeStatusRaw !== 'running' &&
    runtimeStatusRaw !== 'needs-input' &&
    runtimeStatusRaw !== 'completed' &&
    runtimeStatusRaw !== 'exited'
  ) {
    throw new Error('expected runtimeStatus enum value');
  }
  const phaseRaw = asString(model.phase, 'phase');
  if (
    phaseRaw !== 'needs-action' &&
    phaseRaw !== 'starting' &&
    phaseRaw !== 'working' &&
    phaseRaw !== 'idle' &&
    phaseRaw !== 'exited'
  ) {
    throw new Error('expected phase enum value');
  }
  const glyph = asString(model.glyph, 'glyph') as StreamSessionStatusModel['glyph'];
  if (glyph !== '▲' && glyph !== '◔' && glyph !== '◆' && glyph !== '○' && glyph !== '■') {
    throw new Error('expected glyph enum value');
  }
  const badge = asString(model.badge, 'badge') as StreamSessionStatusModel['badge'];
  if (badge !== 'NEED' && badge !== 'RUN ' && badge !== 'DONE' && badge !== 'EXIT') {
    throw new Error('expected badge enum value');
  }
  const detailText = asString(model.detailText, 'detailText');
  const attentionReason = asStringOrNull(model.attentionReason, 'attentionReason');
  const lastKnownWork = asStringOrNull(model.lastKnownWork, 'lastKnownWork');
  const lastKnownWorkAt = asStringOrNull(model.lastKnownWorkAt, 'lastKnownWorkAt');
  const activityHintRaw = asStringOrNull(model.activityHint, 'activityHint');
  const observedAt = asString(model.observedAt, 'observedAt');
  if (
    activityHintRaw !== null &&
    activityHintRaw !== 'needs-action' &&
    activityHintRaw !== 'working' &&
    activityHintRaw !== 'idle'
  ) {
    throw new Error('expected activityHint enum value');
  }
  return {
    runtimeStatus: runtimeStatusRaw,
    phase: phaseRaw,
    glyph,
    badge,
    detailText,
    attentionReason,
    lastKnownWork,
    lastKnownWorkAt,
    activityHint: activityHintRaw,
    observedAt,
  };
}

export function normalizeStoredDirectoryRow(value: unknown): ControlPlaneDirectoryRecord {
  const row = asRecord(value);
  return {
    directoryId: asString(row.directory_id, 'directory_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    path: asString(row.path, 'path'),
    createdAt: asString(row.created_at, 'created_at'),
    archivedAt: asStringOrNull(row.archived_at, 'archived_at'),
  };
}

export function normalizeStoredConversationRow(value: unknown): ControlPlaneConversationRecord {
  const row = asRecord(value);
  const runtimeStatus = normalizeRuntimeStatus(row.runtime_status);
  const runtimeAttentionReason = asStringOrNull(
    row.runtime_attention_reason,
    'runtime_attention_reason',
  );
  const runtimeLastEventAt = asStringOrNull(row.runtime_last_event_at, 'runtime_last_event_at');
  const lastExitSignal = asStringOrNull(row.runtime_last_exit_signal, 'runtime_last_exit_signal');
  if (lastExitSignal !== null && !/^SIG[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(lastExitSignal)) {
    throw new Error('expected runtime_last_exit_signal to be a signal name');
  }
  return {
    conversationId: asString(row.conversation_id, 'conversation_id'),
    directoryId: asString(row.directory_id, 'directory_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    title: asString(row.title, 'title'),
    agentType: asString(row.agent_type, 'agent_type'),
    createdAt: asString(row.created_at, 'created_at'),
    archivedAt: asStringOrNull(row.archived_at, 'archived_at'),
    runtimeStatus,
    runtimeStatusModel: normalizeRuntimeStatusModel(row.runtime_status_model_json),
    runtimeLive: asBooleanFromInt(row.runtime_live, 'runtime_live'),
    runtimeAttentionReason,
    runtimeProcessId: asNumberOrNull(row.runtime_process_id, 'runtime_process_id'),
    runtimeLastEventAt,
    runtimeLastExit:
      row.runtime_last_exit_code === null && row.runtime_last_exit_signal === null
        ? null
        : {
            code: asNumberOrNull(row.runtime_last_exit_code, 'runtime_last_exit_code'),
            signal: lastExitSignal as NodeJS.Signals | null,
          },
    adapterState: normalizeAdapterState(row.adapter_state_json),
  };
}

export function normalizeTelemetrySource(value: unknown): CodexTelemetrySource {
  const source = asString(value, 'source');
  if (
    source === 'otlp-log' ||
    source === 'otlp-metric' ||
    source === 'otlp-trace' ||
    source === 'history'
  ) {
    return source;
  }
  throw new Error('expected telemetry source enum value');
}

function normalizePayloadJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    throw new Error('expected string for payload_json');
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function normalizeTelemetryRow(value: unknown): ControlPlaneTelemetryRecord {
  const row = asRecord(value);
  return {
    telemetryId: asNumberOrNull(row.telemetry_id, 'telemetry_id') as number,
    source: normalizeTelemetrySource(row.source),
    sessionId: asStringOrNull(row.session_id, 'session_id'),
    providerThreadId: asStringOrNull(row.provider_thread_id, 'provider_thread_id'),
    eventName: asStringOrNull(row.event_name, 'event_name'),
    severity: asStringOrNull(row.severity, 'severity'),
    summary: asStringOrNull(row.summary, 'summary'),
    observedAt: asString(row.observed_at, 'observed_at'),
    ingestedAt: asString(row.ingested_at, 'ingested_at'),
    payload: normalizePayloadJson(row.payload_json),
    fingerprint: asString(row.fingerprint, 'fingerprint'),
  };
}

function normalizeRepositoryMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    throw new Error('expected string for metadata_json');
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeTaskStatus(value: unknown): ControlPlaneTaskStatus {
  const status = asString(value, 'status');
  if (
    status === 'draft' ||
    status === 'ready' ||
    status === 'in-progress' ||
    status === 'completed'
  ) {
    return status;
  }
  if (status === 'queued') {
    return 'ready';
  }
  throw new Error('expected task status enum value');
}

function normalizeTaskScopeKind(
  value: unknown,
  repositoryId: string | null,
  projectId: string | null,
): ControlPlaneTaskScopeKind {
  if (typeof value === 'string') {
    if (value === 'global' || value === 'repository' || value === 'project') {
      return value;
    }
    throw new Error('expected task scope enum value');
  }
  if (projectId !== null) {
    return 'project';
  }
  if (repositoryId !== null) {
    return 'repository';
  }
  return 'global';
}

function normalizeProjectTaskFocusMode(value: unknown): ControlPlaneProjectTaskFocusMode {
  const mode = asString(value, 'task_focus_mode');
  if (mode === 'balanced' || mode === 'own-only') {
    return mode;
  }
  throw new Error('expected project task focus enum value');
}

function normalizeProjectThreadSpawnMode(value: unknown): ControlPlaneProjectThreadSpawnMode {
  const mode = asString(value, 'thread_spawn_mode');
  if (mode === 'new-thread' || mode === 'reuse-thread') {
    return mode;
  }
  throw new Error('expected project thread spawn enum value');
}

function normalizeAutomationPolicyScope(value: unknown): ControlPlaneAutomationPolicyScope {
  const scope = asString(value, 'scope_type');
  if (scope === 'global' || scope === 'repository' || scope === 'project') {
    return scope;
  }
  throw new Error('expected automation policy scope enum value');
}

function normalizeGitHubPrState(value: unknown): ControlPlaneGitHubPrState {
  const state = asString(value, 'state');
  if (state === 'open' || state === 'closed') {
    return state;
  }
  throw new Error('expected github pr state enum value');
}

function normalizeGitHubCiRollup(value: unknown): ControlPlaneGitHubCiRollup {
  const rollup = asString(value, 'ci_rollup');
  if (
    rollup === 'pending' ||
    rollup === 'success' ||
    rollup === 'failure' ||
    rollup === 'cancelled' ||
    rollup === 'neutral' ||
    rollup === 'none'
  ) {
    return rollup;
  }
  throw new Error('expected github ci rollup enum value');
}

export function normalizeRepositoryRow(value: unknown): ControlPlaneRepositoryRecord {
  const row = asRecord(value);
  return {
    repositoryId: asString(row.repository_id, 'repository_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    name: asString(row.name, 'name'),
    remoteUrl: asString(row.remote_url, 'remote_url'),
    defaultBranch: asString(row.default_branch, 'default_branch'),
    metadata: normalizeRepositoryMetadata(row.metadata_json),
    createdAt: asString(row.created_at, 'created_at'),
    archivedAt: asStringOrNull(row.archived_at, 'archived_at'),
  };
}

export function normalizeTaskRow(value: unknown): ControlPlaneTaskRecord {
  const row = asRecord(value);
  const repositoryId = asStringOrNull(row.repository_id, 'repository_id');
  const projectId = asStringOrNull(row.project_id, 'project_id');
  const bodyValue = row.body ?? row.description;
  return {
    taskId: asString(row.task_id, 'task_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    repositoryId,
    scopeKind: normalizeTaskScopeKind(row.scope_kind, repositoryId, projectId),
    projectId,
    title: asString(row.title, 'title'),
    body: asString(bodyValue, 'body'),
    status: normalizeTaskStatus(row.status),
    orderIndex: asNumberOrNull(row.order_index, 'order_index') as number,
    claimedByControllerId: asStringOrNull(row.claimed_by_controller_id, 'claimed_by_controller_id'),
    claimedByDirectoryId: asStringOrNull(row.claimed_by_directory_id, 'claimed_by_directory_id'),
    branchName: asStringOrNull(row.branch_name, 'branch_name'),
    baseBranch: asStringOrNull(row.base_branch, 'base_branch'),
    claimedAt: asStringOrNull(row.claimed_at, 'claimed_at'),
    completedAt: asStringOrNull(row.completed_at, 'completed_at'),
    createdAt: asString(row.created_at, 'created_at'),
    updatedAt: asString(row.updated_at, 'updated_at'),
  };
}

export function normalizeProjectSettingsRow(value: unknown): ControlPlaneProjectSettingsRecord {
  const row = asRecord(value);
  return {
    directoryId: asString(row.directory_id, 'directory_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    pinnedBranch: asStringOrNull(row.pinned_branch, 'pinned_branch'),
    taskFocusMode: normalizeProjectTaskFocusMode(row.task_focus_mode),
    threadSpawnMode: normalizeProjectThreadSpawnMode(row.thread_spawn_mode),
    createdAt: asString(row.created_at, 'created_at'),
    updatedAt: asString(row.updated_at, 'updated_at'),
  };
}

export function normalizeAutomationPolicyRow(value: unknown): ControlPlaneAutomationPolicyRecord {
  const row = asRecord(value);
  const scope = normalizeAutomationPolicyScope(row.scope_type);
  const scopeId = asStringOrNull(row.scope_id, 'scope_id');
  return {
    policyId: asString(row.policy_id, 'policy_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    scope,
    scopeId: scope === 'global' ? null : normalizeNonEmptyLabel(scopeId ?? '', 'scope_id'),
    automationEnabled: asBooleanFromInt(row.automation_enabled, 'automation_enabled'),
    frozen: asBooleanFromInt(row.frozen, 'frozen'),
    createdAt: asString(row.created_at, 'created_at'),
    updatedAt: asString(row.updated_at, 'updated_at'),
  };
}

export function normalizeGitHubPullRequestRow(value: unknown): ControlPlaneGitHubPullRequestRecord {
  const row = asRecord(value);
  return {
    prRecordId: asString(row.pr_record_id, 'pr_record_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    repositoryId: asString(row.repository_id, 'repository_id'),
    directoryId: asStringOrNull(row.directory_id, 'directory_id'),
    owner: asString(row.owner, 'owner'),
    repo: asString(row.repo, 'repo'),
    number: asNumberOrNull(row.number, 'number') as number,
    title: asString(row.title, 'title'),
    url: asString(row.url, 'url'),
    authorLogin: asStringOrNull(row.author_login, 'author_login'),
    headBranch: asString(row.head_branch, 'head_branch'),
    headSha: asString(row.head_sha, 'head_sha'),
    baseBranch: asString(row.base_branch, 'base_branch'),
    state: normalizeGitHubPrState(row.state),
    isDraft: asBooleanFromInt(row.is_draft, 'is_draft'),
    ciRollup: normalizeGitHubCiRollup(row.ci_rollup),
    createdAt: asString(row.created_at, 'created_at'),
    updatedAt: asString(row.updated_at, 'updated_at'),
    closedAt: asStringOrNull(row.closed_at, 'closed_at'),
    observedAt: asString(row.observed_at, 'observed_at'),
  };
}

function normalizeGitHubPrJobProvider(value: unknown): ControlPlaneGitHubPrJobRecord['provider'] {
  const provider = asString(value, 'provider');
  if (provider === 'check-run' || provider === 'status-context') {
    return provider;
  }
  throw new Error('expected github pr job provider enum value');
}

export function normalizeGitHubPrJobRow(value: unknown): ControlPlaneGitHubPrJobRecord {
  const row = asRecord(value);
  return {
    jobRecordId: asString(row.job_record_id, 'job_record_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    repositoryId: asString(row.repository_id, 'repository_id'),
    prRecordId: asString(row.pr_record_id, 'pr_record_id'),
    provider: normalizeGitHubPrJobProvider(row.provider),
    externalId: asString(row.external_id, 'external_id'),
    name: asString(row.name, 'name'),
    status: asString(row.status, 'status'),
    conclusion: asStringOrNull(row.conclusion, 'conclusion'),
    url: asStringOrNull(row.url, 'url'),
    startedAt: asStringOrNull(row.started_at, 'started_at'),
    completedAt: asStringOrNull(row.completed_at, 'completed_at'),
    observedAt: asString(row.observed_at, 'observed_at'),
    updatedAt: asString(row.updated_at, 'updated_at'),
  };
}

export function normalizeGitHubSyncStateRow(value: unknown): ControlPlaneGitHubSyncStateRecord {
  const row = asRecord(value);
  return {
    stateId: asString(row.state_id, 'state_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    repositoryId: asString(row.repository_id, 'repository_id'),
    directoryId: asStringOrNull(row.directory_id, 'directory_id'),
    branchName: asString(row.branch_name, 'branch_name'),
    lastSyncAt: asString(row.last_sync_at, 'last_sync_at'),
    lastSuccessAt: asStringOrNull(row.last_success_at, 'last_success_at'),
    lastError: asStringOrNull(row.last_error, 'last_error'),
    lastErrorAt: asStringOrNull(row.last_error_at, 'last_error_at'),
  };
}

export function normalizeNonEmptyLabel(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`expected non-empty ${field}`);
  }
  return normalized;
}

export function uniqueValues(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
