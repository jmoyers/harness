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
