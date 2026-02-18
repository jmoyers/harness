import type { StreamSessionRuntimeStatus } from '../control-plane/stream-protocol.ts';
import type { CodexTelemetrySource } from '../control-plane/codex-telemetry.ts';
import type {
  ControlPlaneAutomationPolicyRecord,
  ControlPlaneAutomationPolicyScope,
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneProjectSettingsRecord,
  ControlPlaneProjectTaskFocusMode,
  ControlPlaneProjectThreadSpawnMode,
  ControlPlaneRepositoryRecord,
  ControlPlaneTaskLinearPriority,
  ControlPlaneTaskLinearRecord,
  ControlPlaneTaskRecord,
  ControlPlaneTaskScopeKind,
  ControlPlaneTaskStatus,
  ControlPlaneTelemetryRecord,
  TaskLinearInput,
} from './control-plane-store-types.ts';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
    runtimeStatus: normalizeRuntimeStatus(row.runtime_status),
    runtimeLive: asBooleanFromInt(row.runtime_live, 'runtime_live'),
    runtimeAttentionReason: asStringOrNull(
      row.runtime_attention_reason,
      'runtime_attention_reason',
    ),
    runtimeProcessId: asNumberOrNull(row.runtime_process_id, 'runtime_process_id'),
    runtimeLastEventAt: asStringOrNull(row.runtime_last_event_at, 'runtime_last_event_at'),
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

export function defaultTaskLinearRecord(): ControlPlaneTaskLinearRecord {
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

function normalizeOptionalTaskLinearString(value: string | null, field: string): string | null {
  if (value === null) {
    return null;
  }
  return normalizeNonEmptyLabel(value, field);
}

function normalizeTaskLinearPriority(
  value: number | null,
  field: string,
): ControlPlaneTaskLinearPriority | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw new Error(`expected integer [0..4] for ${field}`);
  }
  return value as ControlPlaneTaskLinearPriority;
}

function normalizeTaskLinearEstimate(value: number | null, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`expected non-negative integer for ${field}`);
  }
  return value;
}

function normalizeTaskLinearDueDate(value: string | null, field: string): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  if (!DATE_ONLY_PATTERN.test(normalized)) {
    throw new Error(`expected YYYY-MM-DD for ${field}`);
  }
  return normalized;
}

function normalizeTaskLinearLabelIds(
  value: readonly string[] | null,
  field: string,
): readonly string[] {
  if (value === null) {
    return [];
  }
  return uniqueValues(
    value.map((entry, idx) => normalizeNonEmptyLabel(entry, `${field}[${String(idx)}]`)),
  );
}

function parseTaskLinearInputRecord(
  record: Record<string, unknown>,
  field: string,
): TaskLinearInput {
  const parsed: TaskLinearInput = {};
  if ('issueId' in record) {
    parsed.issueId = asStringOrNull(record.issueId, `${field}.issueId`);
  }
  if ('identifier' in record) {
    parsed.identifier = asStringOrNull(record.identifier, `${field}.identifier`);
  }
  if ('url' in record) {
    parsed.url = asStringOrNull(record.url, `${field}.url`);
  }
  if ('teamId' in record) {
    parsed.teamId = asStringOrNull(record.teamId, `${field}.teamId`);
  }
  if ('projectId' in record) {
    parsed.projectId = asStringOrNull(record.projectId, `${field}.projectId`);
  }
  if ('projectMilestoneId' in record) {
    parsed.projectMilestoneId = asStringOrNull(
      record.projectMilestoneId,
      `${field}.projectMilestoneId`,
    );
  }
  if ('cycleId' in record) {
    parsed.cycleId = asStringOrNull(record.cycleId, `${field}.cycleId`);
  }
  if ('stateId' in record) {
    parsed.stateId = asStringOrNull(record.stateId, `${field}.stateId`);
  }
  if ('assigneeId' in record) {
    parsed.assigneeId = asStringOrNull(record.assigneeId, `${field}.assigneeId`);
  }
  if ('priority' in record) {
    parsed.priority = asNumberOrNull(record.priority, `${field}.priority`);
  }
  if ('estimate' in record) {
    parsed.estimate = asNumberOrNull(record.estimate, `${field}.estimate`);
  }
  if ('dueDate' in record) {
    parsed.dueDate = asStringOrNull(record.dueDate, `${field}.dueDate`);
  }
  if ('labelIds' in record) {
    const raw = record.labelIds;
    if (raw === null) {
      parsed.labelIds = null;
    } else if (Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')) {
      parsed.labelIds = raw;
    } else {
      throw new Error(`expected string array or null for ${field}.labelIds`);
    }
  }
  return parsed;
}

export function applyTaskLinearInput(
  base: ControlPlaneTaskLinearRecord,
  input: TaskLinearInput,
): ControlPlaneTaskLinearRecord {
  return {
    issueId:
      input.issueId === undefined
        ? base.issueId
        : normalizeOptionalTaskLinearString(input.issueId, 'linear.issueId'),
    identifier:
      input.identifier === undefined
        ? base.identifier
        : normalizeOptionalTaskLinearString(input.identifier, 'linear.identifier'),
    url:
      input.url === undefined
        ? base.url
        : normalizeOptionalTaskLinearString(input.url, 'linear.url'),
    teamId:
      input.teamId === undefined
        ? base.teamId
        : normalizeOptionalTaskLinearString(input.teamId, 'linear.teamId'),
    projectId:
      input.projectId === undefined
        ? base.projectId
        : normalizeOptionalTaskLinearString(input.projectId, 'linear.projectId'),
    projectMilestoneId:
      input.projectMilestoneId === undefined
        ? base.projectMilestoneId
        : normalizeOptionalTaskLinearString(input.projectMilestoneId, 'linear.projectMilestoneId'),
    cycleId:
      input.cycleId === undefined
        ? base.cycleId
        : normalizeOptionalTaskLinearString(input.cycleId, 'linear.cycleId'),
    stateId:
      input.stateId === undefined
        ? base.stateId
        : normalizeOptionalTaskLinearString(input.stateId, 'linear.stateId'),
    assigneeId:
      input.assigneeId === undefined
        ? base.assigneeId
        : normalizeOptionalTaskLinearString(input.assigneeId, 'linear.assigneeId'),
    priority:
      input.priority === undefined
        ? base.priority
        : normalizeTaskLinearPriority(input.priority, 'linear.priority'),
    estimate:
      input.estimate === undefined
        ? base.estimate
        : normalizeTaskLinearEstimate(input.estimate, 'linear.estimate'),
    dueDate:
      input.dueDate === undefined
        ? base.dueDate
        : normalizeTaskLinearDueDate(input.dueDate, 'linear.dueDate'),
    labelIds:
      input.labelIds === undefined
        ? base.labelIds
        : normalizeTaskLinearLabelIds(input.labelIds, 'linear.labelIds'),
  };
}

export function serializeTaskLinear(linear: ControlPlaneTaskLinearRecord): string {
  return JSON.stringify({
    issueId: linear.issueId,
    identifier: linear.identifier,
    url: linear.url,
    teamId: linear.teamId,
    projectId: linear.projectId,
    projectMilestoneId: linear.projectMilestoneId,
    cycleId: linear.cycleId,
    stateId: linear.stateId,
    assigneeId: linear.assigneeId,
    priority: linear.priority,
    estimate: linear.estimate,
    dueDate: linear.dueDate,
    labelIds: [...linear.labelIds],
  });
}

function normalizeTaskLinear(value: unknown): ControlPlaneTaskLinearRecord {
  if (typeof value !== 'string') {
    throw new Error('expected string for linear_json');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return defaultTaskLinearRecord();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultTaskLinearRecord();
  }
  return applyTaskLinearInput(
    defaultTaskLinearRecord(),
    parseTaskLinearInputRecord(parsed as Record<string, unknown>, 'linear_json'),
  );
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
  return {
    taskId: asString(row.task_id, 'task_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    repositoryId,
    scopeKind: normalizeTaskScopeKind(row.scope_kind, repositoryId, projectId),
    projectId,
    title: asString(row.title, 'title'),
    description: asString(row.description, 'description'),
    status: normalizeTaskStatus(row.status),
    orderIndex: asNumberOrNull(row.order_index, 'order_index') as number,
    claimedByControllerId: asStringOrNull(row.claimed_by_controller_id, 'claimed_by_controller_id'),
    claimedByDirectoryId: asStringOrNull(row.claimed_by_directory_id, 'claimed_by_directory_id'),
    branchName: asStringOrNull(row.branch_name, 'branch_name'),
    baseBranch: asStringOrNull(row.base_branch, 'base_branch'),
    claimedAt: asStringOrNull(row.claimed_at, 'claimed_at'),
    completedAt: asStringOrNull(row.completed_at, 'completed_at'),
    linear: normalizeTaskLinear(row.linear_json),
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
