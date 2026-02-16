import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PtyExit } from '../pty/pty_host.ts';
import type { StreamSessionRuntimeStatus } from '../control-plane/stream-protocol.ts';
import type { CodexTelemetrySource } from '../control-plane/codex-telemetry.ts';

export interface ControlPlaneDirectoryRecord {
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface ControlPlaneConversationRecord {
  readonly conversationId: string;
  readonly directoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly agentType: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly runtimeStatus: StreamSessionRuntimeStatus;
  readonly runtimeLive: boolean;
  readonly runtimeAttentionReason: string | null;
  readonly runtimeProcessId: number | null;
  readonly runtimeLastEventAt: string | null;
  readonly runtimeLastExit: PtyExit | null;
  readonly adapterState: Record<string, unknown>;
}

export interface ControlPlaneTelemetryRecord {
  readonly telemetryId: number;
  readonly source: CodexTelemetrySource;
  readonly sessionId: string | null;
  readonly providerThreadId: string | null;
  readonly eventName: string | null;
  readonly severity: string | null;
  readonly summary: string | null;
  readonly observedAt: string;
  readonly ingestedAt: string;
  readonly payload: Record<string, unknown>;
  readonly fingerprint: string;
}

export interface ControlPlaneTelemetrySummary {
  readonly source: CodexTelemetrySource;
  readonly eventName: string | null;
  readonly severity: string | null;
  readonly summary: string | null;
  readonly observedAt: string;
}

type ControlPlaneTaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';

export interface ControlPlaneRepositoryRecord {
  readonly repositoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly defaultBranch: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface ControlPlaneTaskRecord {
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly description: string;
  readonly status: ControlPlaneTaskStatus;
  readonly orderIndex: number;
  readonly claimedByControllerId: string | null;
  readonly claimedByDirectoryId: string | null;
  readonly branchName: string | null;
  readonly baseBranch: string | null;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface UpsertDirectoryInput {
  directoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  path: string;
}

interface CreateConversationInput {
  conversationId: string;
  directoryId: string;
  title: string;
  agentType: string;
  adapterState?: Record<string, unknown>;
}

interface ListDirectoryQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface ListConversationQuery {
  directoryId?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface ConversationRuntimeUpdate {
  status: StreamSessionRuntimeStatus;
  live: boolean;
  attentionReason: string | null;
  processId: number | null;
  lastEventAt: string | null;
  lastExit: PtyExit | null;
}

interface AppendTelemetryInput {
  source: CodexTelemetrySource;
  sessionId: string | null;
  providerThreadId: string | null;
  eventName: string | null;
  severity: string | null;
  summary: string | null;
  observedAt: string;
  payload: Record<string, unknown>;
  fingerprint: string;
}

interface UpsertRepositoryInput {
  repositoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  name: string;
  remoteUrl: string;
  defaultBranch?: string;
  metadata?: Record<string, unknown>;
}

interface UpdateRepositoryInput {
  name?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  metadata?: Record<string, unknown>;
}

interface ListRepositoryQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface CreateTaskInput {
  taskId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  repositoryId?: string;
  title: string;
  description?: string;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  repositoryId?: string | null;
}

interface ListTaskQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  status?: ControlPlaneTaskStatus;
  limit?: number;
}

interface ClaimTaskInput {
  taskId: string;
  controllerId: string;
  directoryId?: string;
  branchName?: string;
  baseBranch?: string;
}

interface ReorderTasksInput {
  tenantId: string;
  userId: string;
  workspaceId: string;
  orderedTaskIds: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected object row');
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`expected string for ${field}`);
  }
  return value;
}

function asStringOrNull(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return asString(value, field);
}

function asNumberOrNull(value: unknown, field: string): number | null {
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

function normalizeDirectoryRow(value: unknown): ControlPlaneDirectoryRecord {
  const row = asRecord(value);
  return {
    directoryId: asString(row.directory_id, 'directory_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    path: asString(row.path, 'path'),
    createdAt: asString(row.created_at, 'created_at'),
    archivedAt: asStringOrNull(row.archived_at, 'archived_at')
  };
}

export function normalizeStoredDirectoryRow(value: unknown): ControlPlaneDirectoryRecord {
  return normalizeDirectoryRow(value);
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

function normalizeConversationRow(value: unknown): ControlPlaneConversationRecord {
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
    runtimeAttentionReason: asStringOrNull(row.runtime_attention_reason, 'runtime_attention_reason'),
    runtimeProcessId: asNumberOrNull(row.runtime_process_id, 'runtime_process_id'),
    runtimeLastEventAt: asStringOrNull(row.runtime_last_event_at, 'runtime_last_event_at'),
    runtimeLastExit:
      row.runtime_last_exit_code === null && row.runtime_last_exit_signal === null
        ? null
        : {
            code: asNumberOrNull(row.runtime_last_exit_code, 'runtime_last_exit_code'),
            signal: lastExitSignal as NodeJS.Signals | null
          },
    adapterState: normalizeAdapterState(row.adapter_state_json)
  };
}

export function normalizeStoredConversationRow(value: unknown): ControlPlaneConversationRecord {
  return normalizeConversationRow(value);
}

function normalizeTelemetrySource(value: unknown): CodexTelemetrySource {
  const source = asString(value, 'source');
  if (source === 'otlp-log' || source === 'otlp-metric' || source === 'otlp-trace' || source === 'history') {
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

function normalizeTelemetryRow(value: unknown): ControlPlaneTelemetryRecord {
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
    fingerprint: asString(row.fingerprint, 'fingerprint')
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

function normalizeRepositoryRow(value: unknown): ControlPlaneRepositoryRecord {
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
    archivedAt: asStringOrNull(row.archived_at, 'archived_at')
  };
}

function normalizeTaskRow(value: unknown): ControlPlaneTaskRecord {
  const row = asRecord(value);
  return {
    taskId: asString(row.task_id, 'task_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    repositoryId: asStringOrNull(row.repository_id, 'repository_id'),
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
    createdAt: asString(row.created_at, 'created_at'),
    updatedAt: asString(row.updated_at, 'updated_at')
  };
}

function normalizeNonEmptyLabel(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`expected non-empty ${field}`);
  }
  return normalized;
}

function uniqueValues(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export class SqliteControlPlaneStore {
  private readonly db: DatabaseSync;

  constructor(filePath = ':memory:') {
    const resolvedPath = this.preparePath(filePath);
    this.db = new DatabaseSync(resolvedPath);
    this.configureConnection();
    this.initializeSchema();
  }

  close(): void {
    this.db.close();
  }

  upsertDirectory(input: UpsertDirectoryInput): ControlPlaneDirectoryRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existingById = this.getDirectory(input.directoryId);
      if (existingById !== null) {
        if (
          existingById.tenantId !== input.tenantId ||
          existingById.userId !== input.userId ||
          existingById.workspaceId !== input.workspaceId
        ) {
          throw new Error(`directory scope mismatch: ${input.directoryId}`);
        }
        if (existingById.path !== input.path || existingById.archivedAt !== null) {
          this.db
            .prepare(
              `
              UPDATE directories
              SET path = ?, archived_at = NULL
              WHERE directory_id = ?
            `
            )
            .run(input.path, input.directoryId);
          const updated = this.getDirectory(input.directoryId);
          if (updated === null) {
            throw new Error(`directory missing after update: ${input.directoryId}`);
          }
          this.db.exec('COMMIT');
          return updated;
        }
        this.db.exec('COMMIT');
        return existingById;
      }

      const existing = this.findDirectoryByScopePath(
        input.tenantId,
        input.userId,
        input.workspaceId,
        input.path
      );
      if (existing !== null) {
        if (existing.archivedAt !== null) {
          this.db
            .prepare(
              `
              UPDATE directories
              SET archived_at = NULL
              WHERE directory_id = ?
            `
            )
            .run(existing.directoryId);
          const restored = this.getDirectory(existing.directoryId);
          if (restored === null) {
            throw new Error(`directory missing after restore: ${existing.directoryId}`);
          }
          this.db.exec('COMMIT');
          return restored;
        }
        this.db.exec('COMMIT');
        return existing;
      }

      const createdAt = new Date().toISOString();
      this.db
        .prepare(
          `
          INSERT INTO directories (
            directory_id,
            tenant_id,
            user_id,
            workspace_id,
            path,
            created_at,
            archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL)
        `
        )
        .run(
          input.directoryId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          input.path,
          createdAt
        );
      const inserted = this.getDirectory(input.directoryId);
      if (inserted === null) {
        throw new Error(`directory insert failed: ${input.directoryId}`);
      }
      this.db.exec('COMMIT');
      return inserted;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getDirectory(directoryId: string): ControlPlaneDirectoryRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          directory_id,
          tenant_id,
          user_id,
          workspace_id,
          path,
          created_at,
          archived_at
        FROM directories
        WHERE directory_id = ?
      `
      )
      .get(directoryId);
    if (row === undefined) {
      return null;
    }
    return normalizeDirectoryRow(row);
  }

  listDirectories(query: ListDirectoryQuery = {}): readonly ControlPlaneDirectoryRecord[] {
    const clauses: string[] = [];
    const args: Array<number | string> = [];
    if (query.tenantId !== undefined) {
      clauses.push('tenant_id = ?');
      args.push(query.tenantId);
    }
    if (query.userId !== undefined) {
      clauses.push('user_id = ?');
      args.push(query.userId);
    }
    if (query.workspaceId !== undefined) {
      clauses.push('workspace_id = ?');
      args.push(query.workspaceId);
    }
    if (query.includeArchived !== true) {
      clauses.push('archived_at IS NULL');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit ?? 1000;

    const rows = this.db
      .prepare(
        `
        SELECT
          directory_id,
          tenant_id,
          user_id,
          workspace_id,
          path,
          created_at,
          archived_at
        FROM directories
        ${where}
        ORDER BY created_at ASC, directory_id ASC
        LIMIT ?
      `
      )
      .all(...args, limit);
    return rows.map((row) => normalizeDirectoryRow(row));
  }

  archiveDirectory(directoryId: string): ControlPlaneDirectoryRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getDirectory(directoryId);
      if (existing === null) {
        throw new Error(`directory not found: ${directoryId}`);
      }
      if (existing.archivedAt !== null) {
        this.db.exec('COMMIT');
        return existing;
      }
      const archivedAt = new Date().toISOString();
      this.db
        .prepare(
          `
          UPDATE directories
          SET archived_at = ?
          WHERE directory_id = ?
        `
        )
        .run(archivedAt, directoryId);
      const archived = this.getDirectory(directoryId);
      if (archived === null) {
        throw new Error(`directory missing after archive: ${directoryId}`);
      }
      this.db.exec('COMMIT');
      return archived;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createConversation(input: CreateConversationInput): ControlPlaneConversationRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const directory = this.getDirectory(input.directoryId);
      if (directory === null || directory.archivedAt !== null) {
        throw new Error(`directory not found: ${input.directoryId}`);
      }
      const existing = this.getConversation(input.conversationId);
      if (existing !== null) {
        throw new Error(`conversation already exists: ${input.conversationId}`);
      }

      const createdAt = new Date().toISOString();
      this.db
        .prepare(
          `
          INSERT INTO conversations (
            conversation_id,
            directory_id,
            tenant_id,
            user_id,
            workspace_id,
            title,
            agent_type,
            created_at,
            archived_at,
            runtime_status,
            runtime_live,
            runtime_attention_reason,
            runtime_process_id,
            runtime_last_event_at,
            runtime_last_exit_code,
            runtime_last_exit_signal,
            adapter_state_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'running', 0, NULL, NULL, NULL, NULL, NULL, ?)
        `
        )
        .run(
          input.conversationId,
          input.directoryId,
          directory.tenantId,
          directory.userId,
          directory.workspaceId,
          input.title,
          input.agentType,
          createdAt,
          JSON.stringify(input.adapterState ?? {})
        );
      const created = this.getConversation(input.conversationId);
      if (created === null) {
        throw new Error(`conversation insert failed: ${input.conversationId}`);
      }
      this.db.exec('COMMIT');
      return created;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getConversation(conversationId: string): ControlPlaneConversationRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          conversation_id,
          directory_id,
          tenant_id,
          user_id,
          workspace_id,
          title,
          agent_type,
          created_at,
          archived_at,
          runtime_status,
          runtime_live,
          runtime_attention_reason,
          runtime_process_id,
          runtime_last_event_at,
          runtime_last_exit_code,
          runtime_last_exit_signal,
          adapter_state_json
        FROM conversations
        WHERE conversation_id = ?
      `
      )
      .get(conversationId);
    if (row === undefined) {
      return null;
    }
    return normalizeConversationRow(row);
  }

  listConversations(query: ListConversationQuery = {}): readonly ControlPlaneConversationRecord[] {
    const clauses: string[] = [];
    const args: Array<number | string> = [];
    if (query.directoryId !== undefined) {
      clauses.push('directory_id = ?');
      args.push(query.directoryId);
    }
    if (query.tenantId !== undefined) {
      clauses.push('tenant_id = ?');
      args.push(query.tenantId);
    }
    if (query.userId !== undefined) {
      clauses.push('user_id = ?');
      args.push(query.userId);
    }
    if (query.workspaceId !== undefined) {
      clauses.push('workspace_id = ?');
      args.push(query.workspaceId);
    }
    if (query.includeArchived !== true) {
      clauses.push('archived_at IS NULL');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit ?? 5000;

    const rows = this.db
      .prepare(
        `
        SELECT
          conversation_id,
          directory_id,
          tenant_id,
          user_id,
          workspace_id,
          title,
          agent_type,
          created_at,
          archived_at,
          runtime_status,
          runtime_live,
          runtime_attention_reason,
          runtime_process_id,
          runtime_last_event_at,
          runtime_last_exit_code,
          runtime_last_exit_signal,
          adapter_state_json
        FROM conversations
        ${where}
        ORDER BY created_at ASC, conversation_id ASC
        LIMIT ?
      `
      )
      .all(...args, limit);
    return rows.map((row) => normalizeConversationRow(row));
  }

  archiveConversation(conversationId: string): ControlPlaneConversationRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getConversation(conversationId);
      if (existing === null) {
        throw new Error(`conversation not found: ${conversationId}`);
      }
      const archivedAt = new Date().toISOString();
      this.db
        .prepare(
          `
          UPDATE conversations
          SET archived_at = ?
          WHERE conversation_id = ?
        `
        )
        .run(archivedAt, conversationId);
      const archived = this.getConversation(conversationId);
      if (archived === null) {
        throw new Error(`conversation missing after archive: ${conversationId}`);
      }
      this.db.exec('COMMIT');
      return archived;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updateConversationTitle(
    conversationId: string,
    title: string
  ): ControlPlaneConversationRecord | null {
    const existing = this.getConversation(conversationId);
    if (existing === null) {
      return null;
    }
    this.db
      .prepare(
        `
        UPDATE conversations
        SET title = ?
        WHERE conversation_id = ?
      `
      )
      .run(title, conversationId);
    return this.getConversation(conversationId);
  }

  deleteConversation(conversationId: string): boolean {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getConversation(conversationId);
      if (existing === null) {
        throw new Error(`conversation not found: ${conversationId}`);
      }
      this.db
        .prepare(
          `
          DELETE FROM conversations
          WHERE conversation_id = ?
        `
        )
        .run(conversationId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updateConversationAdapterState(
    conversationId: string,
    adapterState: Record<string, unknown>
  ): ControlPlaneConversationRecord | null {
    const existing = this.getConversation(conversationId);
    if (existing === null) {
      return null;
    }
    this.db
      .prepare(
        `
        UPDATE conversations
        SET adapter_state_json = ?
        WHERE conversation_id = ?
      `
      )
      .run(JSON.stringify(adapterState), conversationId);
    return this.getConversation(conversationId);
  }

  updateConversationRuntime(
    conversationId: string,
    update: ConversationRuntimeUpdate
  ): ControlPlaneConversationRecord | null {
    const existing = this.getConversation(conversationId);
    if (existing === null) {
      return null;
    }
    this.db
      .prepare(
        `
        UPDATE conversations
        SET
          runtime_status = ?,
          runtime_live = ?,
          runtime_attention_reason = ?,
          runtime_process_id = ?,
          runtime_last_event_at = ?,
          runtime_last_exit_code = ?,
          runtime_last_exit_signal = ?
        WHERE conversation_id = ?
      `
      )
      .run(
        update.status,
        update.live ? 1 : 0,
        update.attentionReason,
        update.processId,
        update.lastEventAt,
        update.lastExit?.code ?? null,
        update.lastExit?.signal ?? null,
        conversationId
      );
    return this.getConversation(conversationId);
  }

  appendTelemetry(input: AppendTelemetryInput): boolean {
    const ingestedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `
        INSERT INTO session_telemetry (
          source,
          session_id,
          provider_thread_id,
          event_name,
          severity,
          summary,
          observed_at,
          ingested_at,
          payload_json,
          fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO NOTHING
      `
      )
      .run(
        input.source,
        input.sessionId,
        input.providerThreadId,
        input.eventName,
        input.severity,
        input.summary,
        input.observedAt,
        ingestedAt,
        JSON.stringify(input.payload),
        input.fingerprint
      );
    return Number(result.changes) > 0;
  }

  latestTelemetrySummary(sessionId: string): ControlPlaneTelemetrySummary | null {
    const row = this.db
      .prepare(
        `
        SELECT
          source,
          event_name,
          severity,
          summary,
          observed_at
        FROM session_telemetry
        WHERE session_id = ?
        ORDER BY observed_at DESC, telemetry_id DESC
        LIMIT 1
      `
      )
      .get(sessionId);
    if (row === undefined) {
      return null;
    }
    const asRow = asRecord(row);
    return {
      source: normalizeTelemetrySource(asRow.source),
      eventName: asStringOrNull(asRow.event_name, 'event_name'),
      severity: asStringOrNull(asRow.severity, 'severity'),
      summary: asStringOrNull(asRow.summary, 'summary'),
      observedAt: asString(asRow.observed_at, 'observed_at')
    };
  }

  listTelemetryForSession(sessionId: string, limit = 200): readonly ControlPlaneTelemetryRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          telemetry_id,
          source,
          session_id,
          provider_thread_id,
          event_name,
          severity,
          summary,
          observed_at,
          ingested_at,
          payload_json,
          fingerprint
        FROM session_telemetry
        WHERE session_id = ?
        ORDER BY observed_at DESC, telemetry_id DESC
        LIMIT ?
      `
      )
      .all(sessionId, limit);
    return rows.map((row) => normalizeTelemetryRow(row));
  }

  findConversationIdByCodexThreadId(threadId: string): string | null {
    const normalized = threadId.trim();
    if (normalized.length === 0) {
      return null;
    }

    try {
      const direct = this.db
        .prepare(
          `
          SELECT conversation_id
          FROM conversations
          WHERE json_extract(adapter_state_json, '$.codex.resumeSessionId') = ?
            AND archived_at IS NULL
          ORDER BY created_at DESC, conversation_id DESC
          LIMIT 1
        `
        )
        .get(normalized);
      if (direct !== undefined) {
        const row = asRecord(direct);
        return asString(row.conversation_id, 'conversation_id');
      }
    } catch {
      // Best-effort index lookup; fallback scan handles environments without json_extract.
    }

    const rows = this.listConversations({
      includeArchived: false,
      limit: 10000
    });
    for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
      const conversation = rows[idx]!;
      const codex = conversation.adapterState['codex'];
      if (typeof codex !== 'object' || codex === null || Array.isArray(codex)) {
        continue;
      }
      const resumeSessionId = (codex as Record<string, unknown>)['resumeSessionId'];
      if (typeof resumeSessionId === 'string' && resumeSessionId.trim() === normalized) {
        return conversation.conversationId;
      }
    }
    return null;
  }

  upsertRepository(input: UpsertRepositoryInput): ControlPlaneRepositoryRecord {
    const normalizedName = normalizeNonEmptyLabel(input.name, 'name');
    const normalizedRemoteUrl = normalizeNonEmptyLabel(input.remoteUrl, 'remoteUrl');
    const normalizedDefaultBranch = normalizeNonEmptyLabel(
      input.defaultBranch ?? 'main',
      'defaultBranch'
    );
    const metadata = input.metadata ?? {};
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existingById = this.getRepository(input.repositoryId);
      if (existingById !== null) {
        this.assertScopeMatch(existingById, input, 'repository');
        if (
          existingById.name !== normalizedName ||
          existingById.remoteUrl !== normalizedRemoteUrl ||
          existingById.defaultBranch !== normalizedDefaultBranch ||
          JSON.stringify(existingById.metadata) !== JSON.stringify(metadata) ||
          existingById.archivedAt !== null
        ) {
          this.db
            .prepare(
              `
              UPDATE repositories
              SET
                name = ?,
                remote_url = ?,
                default_branch = ?,
                metadata_json = ?,
                archived_at = NULL
              WHERE repository_id = ?
            `
            )
            .run(
              normalizedName,
              normalizedRemoteUrl,
              normalizedDefaultBranch,
              JSON.stringify(metadata),
              input.repositoryId
            );
          const updated = this.getRepository(input.repositoryId);
          if (updated === null) {
            throw new Error(`repository missing after update: ${input.repositoryId}`);
          }
          this.db.exec('COMMIT');
          return updated;
        }
        this.db.exec('COMMIT');
        return existingById;
      }

      const existingByScopeUrl = this.findRepositoryByScopeRemoteUrl(
        input.tenantId,
        input.userId,
        input.workspaceId,
        normalizedRemoteUrl
      );
      if (existingByScopeUrl !== null) {
        if (
          existingByScopeUrl.name !== normalizedName ||
          existingByScopeUrl.defaultBranch !== normalizedDefaultBranch ||
          JSON.stringify(existingByScopeUrl.metadata) !== JSON.stringify(metadata) ||
          existingByScopeUrl.archivedAt !== null
        ) {
          this.db
            .prepare(
              `
              UPDATE repositories
              SET
                name = ?,
                default_branch = ?,
                metadata_json = ?,
                archived_at = NULL
              WHERE repository_id = ?
            `
            )
            .run(
              normalizedName,
              normalizedDefaultBranch,
              JSON.stringify(metadata),
              existingByScopeUrl.repositoryId
            );
          const restored = this.getRepository(existingByScopeUrl.repositoryId);
          if (restored === null) {
            throw new Error(`repository missing after restore: ${existingByScopeUrl.repositoryId}`);
          }
          this.db.exec('COMMIT');
          return restored;
        }
        this.db.exec('COMMIT');
        return existingByScopeUrl;
      }

      const createdAt = new Date().toISOString();
      this.db
        .prepare(
          `
          INSERT INTO repositories (
            repository_id,
            tenant_id,
            user_id,
            workspace_id,
            name,
            remote_url,
            default_branch,
            metadata_json,
            created_at,
            archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `
        )
        .run(
          input.repositoryId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          normalizedName,
          normalizedRemoteUrl,
          normalizedDefaultBranch,
          JSON.stringify(metadata),
          createdAt
        );
      const inserted = this.getRepository(input.repositoryId);
      if (inserted === null) {
        throw new Error(`repository insert failed: ${input.repositoryId}`);
      }
      this.db.exec('COMMIT');
      return inserted;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getRepository(repositoryId: string): ControlPlaneRepositoryRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          repository_id,
          tenant_id,
          user_id,
          workspace_id,
          name,
          remote_url,
          default_branch,
          metadata_json,
          created_at,
          archived_at
        FROM repositories
        WHERE repository_id = ?
      `
      )
      .get(repositoryId);
    if (row === undefined) {
      return null;
    }
    return normalizeRepositoryRow(row);
  }

  listRepositories(query: ListRepositoryQuery = {}): readonly ControlPlaneRepositoryRecord[] {
    const clauses: string[] = [];
    const args: Array<number | string> = [];
    if (query.tenantId !== undefined) {
      clauses.push('tenant_id = ?');
      args.push(query.tenantId);
    }
    if (query.userId !== undefined) {
      clauses.push('user_id = ?');
      args.push(query.userId);
    }
    if (query.workspaceId !== undefined) {
      clauses.push('workspace_id = ?');
      args.push(query.workspaceId);
    }
    if (query.includeArchived !== true) {
      clauses.push('archived_at IS NULL');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit ?? 1000;
    const rows = this.db
      .prepare(
        `
        SELECT
          repository_id,
          tenant_id,
          user_id,
          workspace_id,
          name,
          remote_url,
          default_branch,
          metadata_json,
          created_at,
          archived_at
        FROM repositories
        ${where}
        ORDER BY created_at ASC, repository_id ASC
        LIMIT ?
      `
      )
      .all(...args, limit);
    return rows.map((row) => normalizeRepositoryRow(row));
  }

  updateRepository(
    repositoryId: string,
    update: UpdateRepositoryInput
  ): ControlPlaneRepositoryRecord | null {
    const existing = this.getRepository(repositoryId);
    if (existing === null) {
      return null;
    }
    const name =
      update.name === undefined ? existing.name : normalizeNonEmptyLabel(update.name, 'name');
    const remoteUrl =
      update.remoteUrl === undefined
        ? existing.remoteUrl
        : normalizeNonEmptyLabel(update.remoteUrl, 'remoteUrl');
    const defaultBranch =
      update.defaultBranch === undefined
        ? existing.defaultBranch
        : normalizeNonEmptyLabel(update.defaultBranch, 'defaultBranch');
    const metadata = update.metadata === undefined ? existing.metadata : update.metadata;
    this.db
      .prepare(
        `
        UPDATE repositories
        SET
          name = ?,
          remote_url = ?,
          default_branch = ?,
          metadata_json = ?
        WHERE repository_id = ?
      `
      )
      .run(name, remoteUrl, defaultBranch, JSON.stringify(metadata), repositoryId);
    return this.getRepository(repositoryId);
  }

  archiveRepository(repositoryId: string): ControlPlaneRepositoryRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getRepository(repositoryId);
      if (existing === null) {
        throw new Error(`repository not found: ${repositoryId}`);
      }
      if (existing.archivedAt !== null) {
        this.db.exec('COMMIT');
        return existing;
      }
      const archivedAt = new Date().toISOString();
      this.db
        .prepare(
          `
          UPDATE repositories
          SET archived_at = ?
          WHERE repository_id = ?
        `
        )
        .run(archivedAt, repositoryId);
      const archived = this.getRepository(repositoryId);
      if (archived === null) {
        throw new Error(`repository missing after archive: ${repositoryId}`);
      }
      this.db.exec('COMMIT');
      return archived;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createTask(input: CreateTaskInput): ControlPlaneTaskRecord {
    const title = normalizeNonEmptyLabel(input.title, 'title');
    const description = input.description ?? '';
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getTask(input.taskId);
      if (existing !== null) {
        throw new Error(`task already exists: ${input.taskId}`);
      }
      if (input.repositoryId !== undefined) {
        const repository = this.getActiveRepository(input.repositoryId);
        this.assertScopeMatch(input, repository, 'task');
      }
      const createdAt = new Date().toISOString();
      const orderIndex = this.nextTaskOrderIndex(input.tenantId, input.userId, input.workspaceId);
      this.db
        .prepare(
          `
          INSERT INTO tasks (
            task_id,
            tenant_id,
            user_id,
            workspace_id,
            repository_id,
            title,
            description,
            status,
            order_index,
            claimed_by_controller_id,
            claimed_by_directory_id,
            branch_name,
            base_branch,
            claimed_at,
            completed_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `
        )
        .run(
          input.taskId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          input.repositoryId ?? null,
          title,
          description,
          orderIndex,
          createdAt,
          createdAt
        );
      const inserted = this.getTask(input.taskId);
      if (inserted === null) {
        throw new Error(`task insert failed: ${input.taskId}`);
      }
      this.db.exec('COMMIT');
      return inserted;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getTask(taskId: string): ControlPlaneTaskRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          task_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          title,
          description,
          status,
          order_index,
          claimed_by_controller_id,
          claimed_by_directory_id,
          branch_name,
          base_branch,
          claimed_at,
          completed_at,
          created_at,
          updated_at
        FROM tasks
        WHERE task_id = ?
      `
      )
      .get(taskId);
    if (row === undefined) {
      return null;
    }
    return normalizeTaskRow(row);
  }

  listTasks(query: ListTaskQuery = {}): readonly ControlPlaneTaskRecord[] {
    const clauses: string[] = [];
    const args: Array<number | string> = [];
    if (query.tenantId !== undefined) {
      clauses.push('tenant_id = ?');
      args.push(query.tenantId);
    }
    if (query.userId !== undefined) {
      clauses.push('user_id = ?');
      args.push(query.userId);
    }
    if (query.workspaceId !== undefined) {
      clauses.push('workspace_id = ?');
      args.push(query.workspaceId);
    }
    if (query.repositoryId !== undefined) {
      clauses.push('repository_id = ?');
      args.push(query.repositoryId);
    }
    if (query.status !== undefined) {
      clauses.push('status = ?');
      args.push(query.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = query.limit ?? 5000;
    const rows = this.db
      .prepare(
        `
        SELECT
          task_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          title,
          description,
          status,
          order_index,
          claimed_by_controller_id,
          claimed_by_directory_id,
          branch_name,
          base_branch,
          claimed_at,
          completed_at,
          created_at,
          updated_at
        FROM tasks
        ${where}
        ORDER BY order_index ASC, created_at ASC, task_id ASC
        LIMIT ?
      `
      )
      .all(...args, limit);
    return rows.map((row) => normalizeTaskRow(row));
  }

  updateTask(taskId: string, update: UpdateTaskInput): ControlPlaneTaskRecord | null {
    const existing = this.getTask(taskId);
    if (existing === null) {
      return null;
    }
    const title =
      update.title === undefined ? existing.title : normalizeNonEmptyLabel(update.title, 'title');
    const description = update.description === undefined ? existing.description : update.description;
    const repositoryId =
      update.repositoryId === undefined ? existing.repositoryId : update.repositoryId;
    if (repositoryId !== null) {
      const repository = this.getActiveRepository(repositoryId);
      this.assertScopeMatch(existing, repository, 'task');
    }
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE tasks
        SET
          repository_id = ?,
          title = ?,
          description = ?,
          updated_at = ?
        WHERE task_id = ?
      `
      )
      .run(repositoryId, title, description, updatedAt, taskId);
    return this.getTask(taskId);
  }

  deleteTask(taskId: string): boolean {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getTask(taskId);
      if (existing === null) {
        throw new Error(`task not found: ${taskId}`);
      }
      this.db
        .prepare(
          `
          DELETE FROM tasks
          WHERE task_id = ?
        `
        )
        .run(taskId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  claimTask(input: ClaimTaskInput): ControlPlaneTaskRecord {
    const controllerId = normalizeNonEmptyLabel(input.controllerId, 'controllerId');
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const task = this.getTask(input.taskId);
      if (task === null) {
        throw new Error(`task not found: ${input.taskId}`);
      }
      if (task.status === 'completed') {
        throw new Error(`cannot claim completed task: ${input.taskId}`);
      }
      if (task.status === 'draft') {
        throw new Error(`cannot claim draft task: ${input.taskId}`);
      }
      let claimedByDirectoryId: string | null = null;
      if (input.directoryId !== undefined) {
        const directory = this.getActiveDirectory(input.directoryId);
        this.assertScopeMatch(task, directory, 'task claim');
        claimedByDirectoryId = directory.directoryId;
      }

      const claimedAt = new Date().toISOString();
      this.db
        .prepare(
          `
          UPDATE tasks
          SET
            status = 'in-progress',
            claimed_by_controller_id = ?,
            claimed_by_directory_id = ?,
            branch_name = ?,
            base_branch = ?,
            claimed_at = ?,
            completed_at = NULL,
            updated_at = ?
          WHERE task_id = ?
        `
        )
        .run(
          controllerId,
          claimedByDirectoryId,
          input.branchName ?? null,
          input.baseBranch ?? null,
          claimedAt,
          claimedAt,
          input.taskId
        );
      const claimed = this.getTask(input.taskId);
      if (claimed === null) {
        throw new Error(`task missing after claim: ${input.taskId}`);
      }
      this.db.exec('COMMIT');
      return claimed;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  completeTask(taskId: string): ControlPlaneTaskRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getTask(taskId);
      if (existing === null) {
        throw new Error(`task not found: ${taskId}`);
      }
      if (existing.status === 'completed') {
        this.db.exec('COMMIT');
        return existing;
      }
      const completedAt = new Date().toISOString();
      this.db
        .prepare(
          `
          UPDATE tasks
          SET
            status = 'completed',
            completed_at = ?,
            updated_at = ?
          WHERE task_id = ?
        `
        )
        .run(completedAt, completedAt, taskId);
      const completed = this.getTask(taskId);
      if (completed === null) {
        throw new Error(`task missing after complete: ${taskId}`);
      }
      this.db.exec('COMMIT');
      return completed;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  readyTask(taskId: string): ControlPlaneTaskRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getTask(taskId);
      if (existing === null) {
        throw new Error(`task not found: ${taskId}`);
      }
      const updatedAt = new Date().toISOString();
      this.db
        .prepare(
          `
          UPDATE tasks
          SET
            status = 'ready',
            claimed_by_controller_id = NULL,
            claimed_by_directory_id = NULL,
            branch_name = NULL,
            base_branch = NULL,
            claimed_at = NULL,
            completed_at = NULL,
            updated_at = ?
          WHERE task_id = ?
        `
        )
        .run(updatedAt, taskId);
      const ready = this.getTask(taskId);
      if (ready === null) {
        throw new Error(`task missing after ready: ${taskId}`);
      }
      this.db.exec('COMMIT');
      return ready;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  queueTask(taskId: string): ControlPlaneTaskRecord {
    return this.readyTask(taskId);
  }

  reorderTasks(input: ReorderTasksInput): readonly ControlPlaneTaskRecord[] {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const normalizedOrder = input.orderedTaskIds
        .map((taskId) => taskId.trim())
        .filter((taskId) => taskId.length > 0);
      if (uniqueValues(normalizedOrder).length !== normalizedOrder.length) {
        throw new Error('orderedTaskIds contains duplicate ids');
      }
      const existing = this.listTasks({
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        limit: 10000
      });
      const byId = new Map(existing.map((task) => [task.taskId, task] as const));
      for (const taskId of normalizedOrder) {
        if (!byId.has(taskId)) {
          throw new Error(`task not found in scope for reorder: ${taskId}`);
        }
      }
      const orderedSet = new Set(normalizedOrder);
      const finalOrder = [
        ...normalizedOrder,
        ...existing
          .map((task) => task.taskId)
          .filter((taskId) => !orderedSet.has(taskId))
      ];
      for (let idx = 0; idx < finalOrder.length; idx += 1) {
        const taskId = finalOrder[idx]!;
        this.db
          .prepare(
            `
            UPDATE tasks
            SET
              order_index = ?,
              updated_at = ?
            WHERE task_id = ?
          `
          )
          .run(idx, new Date().toISOString(), taskId);
      }
      const reordered = this.listTasks({
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        limit: 10000
      });
      this.db.exec('COMMIT');
      return reordered;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private findRepositoryByScopeRemoteUrl(
    tenantId: string,
    userId: string,
    workspaceId: string,
    remoteUrl: string
  ): ControlPlaneRepositoryRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          repository_id,
          tenant_id,
          user_id,
          workspace_id,
          name,
          remote_url,
          default_branch,
          metadata_json,
          created_at,
          archived_at
        FROM repositories
        WHERE tenant_id = ? AND user_id = ? AND workspace_id = ? AND remote_url = ?
      `
      )
      .get(tenantId, userId, workspaceId, remoteUrl);
    if (row === undefined) {
      return null;
    }
    return normalizeRepositoryRow(row);
  }

  private getActiveRepository(repositoryId: string): ControlPlaneRepositoryRecord {
    const repository = this.getRepository(repositoryId);
    if (repository === null || repository.archivedAt !== null) {
      throw new Error(`repository not found: ${repositoryId}`);
    }
    return repository;
  }

  private getActiveDirectory(directoryId: string): ControlPlaneDirectoryRecord {
    const directory = this.getDirectory(directoryId);
    if (directory === null || directory.archivedAt !== null) {
      throw new Error(`directory not found: ${directoryId}`);
    }
    return directory;
  }

  private assertScopeMatch(
    left: { tenantId: string; userId: string; workspaceId: string },
    right: { tenantId: string; userId: string; workspaceId: string },
    context: string
  ): void {
    if (
      left.tenantId !== right.tenantId ||
      left.userId !== right.userId ||
      left.workspaceId !== right.workspaceId
    ) {
      throw new Error(`${context} scope mismatch`);
    }
  }

  private nextTaskOrderIndex(tenantId: string, userId: string, workspaceId: string): number {
    const row = this.db
      .prepare(
        `
        SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order
        FROM tasks
        WHERE tenant_id = ? AND user_id = ? AND workspace_id = ?
      `
      )
      .get(tenantId, userId, workspaceId);
    const asRow = asRecord(row);
    const next = asNumberOrNull(asRow.next_order, 'next_order') as number;
    return Math.max(0, Math.floor(next));
  }

  private findDirectoryByScopePath(
    tenantId: string,
    userId: string,
    workspaceId: string,
    path: string
  ): ControlPlaneDirectoryRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          directory_id,
          tenant_id,
          user_id,
          workspace_id,
          path,
          created_at,
          archived_at
        FROM directories
        WHERE tenant_id = ? AND user_id = ? AND workspace_id = ? AND path = ?
      `
      )
      .get(tenantId, userId, workspaceId, path);
    if (row === undefined) {
      return null;
    }
    return normalizeDirectoryRow(row);
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS directories (
        directory_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        UNIQUE(tenant_id, user_id, workspace_id, path)
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_directories_scope
      ON directories (tenant_id, user_id, workspace_id, created_at);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY,
        directory_id TEXT NOT NULL REFERENCES directories(directory_id),
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT,
        runtime_status TEXT NOT NULL,
        runtime_live INTEGER NOT NULL,
        runtime_attention_reason TEXT,
        runtime_process_id INTEGER,
        runtime_last_event_at TEXT,
        runtime_last_exit_code INTEGER,
        runtime_last_exit_signal TEXT,
        adapter_state_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_directory
      ON conversations (directory_id, created_at);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_scope
      ON conversations (tenant_id, user_id, workspace_id, created_at);
    `);
    this.ensureColumnExists(
      'conversations',
      'adapter_state_json',
      `adapter_state_json TEXT NOT NULL DEFAULT '{}'`
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_telemetry (
        telemetry_id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        session_id TEXT,
        provider_thread_id TEXT,
        event_name TEXT,
        severity TEXT,
        summary TEXT,
        observed_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_telemetry_session
      ON session_telemetry (session_id, observed_at DESC, telemetry_id DESC);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_telemetry_thread
      ON session_telemetry (provider_thread_id, observed_at DESC, telemetry_id DESC);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        repository_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        archived_at TEXT,
        UNIQUE(tenant_id, user_id, workspace_id, remote_url)
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_repositories_scope
      ON repositories (tenant_id, user_id, workspace_id, created_at);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        repository_id TEXT REFERENCES repositories(repository_id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        claimed_by_controller_id TEXT,
        claimed_by_directory_id TEXT REFERENCES directories(directory_id),
        branch_name TEXT,
        base_branch TEXT,
        claimed_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_scope
      ON tasks (tenant_id, user_id, workspace_id, order_index, created_at, task_id);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON tasks (status, updated_at, task_id);
    `);
  }

  private configureConnection(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 2000;');
  }

  private ensureColumnExists(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = rows.some((row) => {
      const asRow = row as Record<string, unknown>;
      return asRow['name'] === column;
    });
    if (exists) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
  }

  private preparePath(filePath: string): string {
    if (filePath === ':memory:') {
      return filePath;
    }
    mkdirSync(dirname(filePath), { recursive: true });
    return filePath;
  }
}
