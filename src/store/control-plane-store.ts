import { DatabaseSync } from './sqlite.ts';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizeGitHubPrJobRow,
  normalizeGitHubPullRequestRow,
  normalizeGitHubSyncStateRow,
  normalizeAutomationPolicyRow,
  asNumberOrNull,
  asRecord,
  normalizeProjectSettingsRow,
  asString,
  asStringOrNull,
  normalizeNonEmptyLabel,
  normalizeRepositoryRow,
  normalizeStoredConversationRow,
  normalizeStoredConversationRow as normalizeConversationRow,
  normalizeStoredDirectoryRow,
  normalizeStoredDirectoryRow as normalizeDirectoryRow,
  normalizeTaskRow,
  normalizeTelemetryRow,
  normalizeTelemetrySource,
  sqliteStatementChanges,
  uniqueValues,
} from './control-plane-store-normalize.ts';
import type {
  ControlPlaneAutomationPolicyRecord,
  ControlPlaneAutomationPolicyScope,
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneGitHubCiRollup,
  ControlPlaneGitHubPrJobRecord,
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
  ControlPlaneTelemetrySummary,
} from './control-plane-store-types.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import type { CodexTelemetrySource } from '../control-plane/codex-telemetry.ts';
import type {
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
} from '../control-plane/stream-protocol.ts';

const DEFAULT_RUNTIME_STATUS_MODEL_JSON = JSON.stringify({
  runtimeStatus: 'running',
  phase: 'starting',
  glyph: '◔',
  badge: 'RUN ',
  detailText: 'starting',
  attentionReason: null,
  lastKnownWork: null,
  lastKnownWorkAt: null,
  phaseHint: null,
  observedAt: new Date(0).toISOString(),
} satisfies StreamSessionStatusModel | null);

function statusModelEnabledForAgentType(agentType: string): boolean {
  const normalized = agentType.trim().toLowerCase();
  return normalized === 'codex' || normalized === 'claude' || normalized === 'cursor';
}

function initialRuntimeStatusModel(
  agentType: string,
  observedAt: string,
): StreamSessionStatusModel | null {
  if (!statusModelEnabledForAgentType(agentType)) {
    return null;
  }
  return {
    runtimeStatus: 'running',
    phase: 'starting',
    glyph: '◔',
    badge: 'RUN ',
    detailText: 'starting',
    attentionReason: null,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    phaseHint: null,
    observedAt,
  };
}

function normalizeTaskTitle(value: string | null | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  return value.trim();
}

function normalizeTaskBody(value: string, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`expected string for ${field}`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty`);
  }
  return value;
}

export type {
  ControlPlaneAutomationPolicyRecord,
  ControlPlaneAutomationPolicyScope,
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneGitHubCiRollup,
  ControlPlaneGitHubPrJobRecord,
  ControlPlaneGitHubPullRequestRecord,
  ControlPlaneGitHubSyncStateRecord,
  ControlPlaneProjectSettingsRecord,
  ControlPlaneProjectTaskFocusMode,
  ControlPlaneProjectThreadSpawnMode,
  ControlPlaneRepositoryRecord,
  ControlPlaneTaskRecord,
  ControlPlaneTaskScopeKind,
  ControlPlaneTelemetryRecord,
  ControlPlaneTelemetrySummary,
} from './control-plane-store-types.ts';

export { normalizeStoredConversationRow, normalizeStoredDirectoryRow };

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
  statusModel: StreamSessionStatusModel | null;
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
  projectId?: string;
  title?: string | null;
  body?: string;
}

interface UpdateTaskInput {
  title?: string | null;
  body?: string;
  repositoryId?: string | null;
  projectId?: string | null;
}

interface ListTaskQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  projectId?: string;
  scopeKind?: ControlPlaneTaskScopeKind;
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

interface UpdateProjectSettingsInput {
  directoryId: string;
  pinnedBranch?: string | null;
  taskFocusMode?: ControlPlaneProjectTaskFocusMode;
  threadSpawnMode?: ControlPlaneProjectThreadSpawnMode;
}

interface GetAutomationPolicyInput {
  tenantId: string;
  userId: string;
  workspaceId: string;
  scope: ControlPlaneAutomationPolicyScope;
  scopeId?: string | null;
}

interface UpsertAutomationPolicyInput {
  tenantId: string;
  userId: string;
  workspaceId: string;
  scope: ControlPlaneAutomationPolicyScope;
  scopeId?: string | null;
  automationEnabled?: boolean;
  frozen?: boolean;
}

interface UpsertGitHubPullRequestInput {
  prRecordId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  repositoryId: string;
  directoryId?: string | null;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  authorLogin?: string | null;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  state: 'open' | 'closed';
  isDraft: boolean;
  ciRollup?: ControlPlaneGitHubCiRollup;
  closedAt?: string | null;
  observedAt: string;
}

interface ListGitHubPullRequestQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  directoryId?: string;
  headBranch?: string;
  state?: 'open' | 'closed';
  limit?: number;
}

interface ReplaceGitHubPrJobsInput {
  tenantId: string;
  userId: string;
  workspaceId: string;
  repositoryId: string;
  prRecordId: string;
  observedAt: string;
  jobs: readonly {
    jobRecordId: string;
    provider: 'check-run' | 'status-context';
    externalId: string;
    name: string;
    status: string;
    conclusion?: string | null;
    url?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  }[];
}

interface ListGitHubPrJobsQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  prRecordId?: string;
  limit?: number;
}

interface UpsertGitHubSyncStateInput {
  stateId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  repositoryId: string;
  directoryId?: string | null;
  branchName: string;
  lastSyncAt: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
}

interface ListGitHubSyncStateQuery {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  repositoryId?: string;
  directoryId?: string;
  branchName?: string;
  limit?: number;
}

const CONTROL_PLANE_SCHEMA_VERSION = 1;

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
            `,
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
        input.path,
      );
      if (existing !== null) {
        if (existing.archivedAt !== null) {
          this.db
            .prepare(
              `
              UPDATE directories
              SET archived_at = NULL
              WHERE directory_id = ?
            `,
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
        `,
        )
        .run(
          input.directoryId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          input.path,
          createdAt,
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
      `,
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
      `,
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
        `,
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
      const initialStatusModel = initialRuntimeStatusModel(input.agentType, createdAt);
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
            runtime_status_model_json,
            runtime_live,
            runtime_attention_reason,
            runtime_process_id,
            runtime_last_event_at,
            runtime_last_exit_code,
            runtime_last_exit_signal,
            adapter_state_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'running', ?, 0, NULL, NULL, NULL, NULL, NULL, ?)
        `,
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
          JSON.stringify(initialStatusModel),
          JSON.stringify(input.adapterState ?? {}),
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
          runtime_status_model_json,
          runtime_live,
          runtime_attention_reason,
          runtime_process_id,
          runtime_last_event_at,
          runtime_last_exit_code,
          runtime_last_exit_signal,
          adapter_state_json
        FROM conversations
        WHERE conversation_id = ?
      `,
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
          runtime_status_model_json,
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
      `,
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
        `,
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
    title: string,
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
      `,
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
        `,
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
    adapterState: Record<string, unknown>,
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
      `,
      )
      .run(JSON.stringify(adapterState), conversationId);
    return this.getConversation(conversationId);
  }

  updateConversationRuntime(
    conversationId: string,
    update: ConversationRuntimeUpdate,
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
          runtime_status_model_json = ?,
          runtime_live = ?,
          runtime_attention_reason = ?,
          runtime_process_id = ?,
          runtime_last_event_at = ?,
          runtime_last_exit_code = ?,
          runtime_last_exit_signal = ?
        WHERE conversation_id = ?
      `,
      )
      .run(
        update.status,
        JSON.stringify(update.statusModel),
        update.live ? 1 : 0,
        update.attentionReason,
        update.processId,
        update.lastEventAt,
        update.lastExit?.code ?? null,
        update.lastExit?.signal ?? null,
        conversationId,
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
      `,
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
        input.fingerprint,
      );
    return sqliteStatementChanges(result) > 0;
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
      `,
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
      observedAt: asString(asRow.observed_at, 'observed_at'),
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
      `,
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
          WHERE (
            json_extract(adapter_state_json, '$.codex.resumeSessionId') = ?
            OR json_extract(adapter_state_json, '$.codex.threadId') = ?
          )
            AND archived_at IS NULL
          ORDER BY created_at DESC, conversation_id DESC
          LIMIT 1
        `,
        )
        .get(normalized, normalized);
      if (direct !== undefined) {
        const row = asRecord(direct);
        return asString(row.conversation_id, 'conversation_id');
      }
    } catch {
      // Best-effort index lookup; fallback scan handles environments without json_extract.
    }

    const rows = this.listConversations({
      includeArchived: false,
      limit: 10000,
    });
    for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
      const conversation = rows[idx]!;
      const codex = conversation.adapterState['codex'];
      if (typeof codex !== 'object' || codex === null || Array.isArray(codex)) {
        continue;
      }
      const codexState = codex as Record<string, unknown>;
      const resumeSessionId = codexState['resumeSessionId'];
      if (typeof resumeSessionId === 'string' && resumeSessionId.trim() === normalized) {
        return conversation.conversationId;
      }
      const legacyThreadId = codexState['threadId'];
      if (typeof legacyThreadId === 'string' && legacyThreadId.trim() === normalized) {
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
      'defaultBranch',
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
            `,
            )
            .run(
              normalizedName,
              normalizedRemoteUrl,
              normalizedDefaultBranch,
              JSON.stringify(metadata),
              input.repositoryId,
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
        normalizedRemoteUrl,
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
            `,
            )
            .run(
              normalizedName,
              normalizedDefaultBranch,
              JSON.stringify(metadata),
              existingByScopeUrl.repositoryId,
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
        `,
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
          createdAt,
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
      `,
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
      `,
      )
      .all(...args, limit);
    return rows.map((row) => normalizeRepositoryRow(row));
  }

  updateRepository(
    repositoryId: string,
    update: UpdateRepositoryInput,
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
      `,
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
        `,
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
    const title = normalizeTaskTitle(input.title);
    const body = normalizeTaskBody(input.body ?? title, 'body');
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existing = this.getTask(input.taskId);
      if (existing !== null) {
        throw new Error(`task already exists: ${input.taskId}`);
      }
      const repositoryId = input.repositoryId ?? null;
      const projectId = input.projectId ?? null;
      if (repositoryId === null && projectId === null) {
        throw new Error('task scope required: repositoryId or projectId');
      }
      if (repositoryId !== null) {
        const repository = this.getActiveRepository(repositoryId);
        this.assertScopeMatch(input, repository, 'task');
      }
      if (projectId !== null) {
        const directory = this.getActiveDirectory(projectId);
        this.assertScopeMatch(input, directory, 'task');
      }
      const scopeKind = this.deriveTaskScopeKind(repositoryId, projectId);
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
            scope_kind,
            project_id,
            title,
            body,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `,
        )
        .run(
          input.taskId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          repositoryId,
          scopeKind,
          projectId,
          title,
          body,
          orderIndex,
          createdAt,
          createdAt,
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
          scope_kind,
          project_id,
          title,
          body,
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
      `,
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
    if (query.projectId !== undefined) {
      clauses.push('project_id = ?');
      args.push(query.projectId);
    }
    if (query.scopeKind !== undefined) {
      clauses.push('scope_kind = ?');
      args.push(query.scopeKind);
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
          scope_kind,
          project_id,
          title,
          body,
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
      `,
      )
      .all(...args, limit);
    return rows.map((row) => normalizeTaskRow(row));
  }

  updateTask(taskId: string, update: UpdateTaskInput): ControlPlaneTaskRecord | null {
    const existing = this.getTask(taskId);
    if (existing === null) {
      return null;
    }
    const title = update.title === undefined ? existing.title : normalizeTaskTitle(update.title);
    const body = update.body === undefined ? existing.body : normalizeTaskBody(update.body, 'body');
    const repositoryId =
      update.repositoryId === undefined ? existing.repositoryId : update.repositoryId;
    const projectId = update.projectId === undefined ? existing.projectId : update.projectId;
    if (repositoryId === null && projectId === null) {
      throw new Error('task scope required: repositoryId or projectId');
    }
    if (repositoryId !== null) {
      const repository = this.getActiveRepository(repositoryId);
      this.assertScopeMatch(existing, repository, 'task');
    }
    if (projectId !== null) {
      const directory = this.getActiveDirectory(projectId);
      this.assertScopeMatch(existing, directory, 'task');
    }
    const scopeKind = this.deriveTaskScopeKind(repositoryId, projectId);
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE tasks
        SET
          repository_id = ?,
          scope_kind = ?,
          project_id = ?,
          title = ?,
          body = ?,
          updated_at = ?
        WHERE task_id = ?
      `,
      )
      .run(
        repositoryId,
        scopeKind,
        projectId,
        title,
        body,
        updatedAt,
        taskId,
      );
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
        `,
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
      if (
        task.status === 'in-progress' &&
        task.claimedByControllerId !== null &&
        task.claimedByControllerId !== controllerId
      ) {
        throw new Error(`task already claimed: ${input.taskId}`);
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
        `,
        )
        .run(
          controllerId,
          claimedByDirectoryId,
          input.branchName ?? null,
          input.baseBranch ?? null,
          claimedAt,
          claimedAt,
          input.taskId,
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
        `,
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
        `,
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

  draftTask(taskId: string): ControlPlaneTaskRecord {
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
            status = 'draft',
            claimed_by_controller_id = NULL,
            claimed_by_directory_id = NULL,
            branch_name = NULL,
            base_branch = NULL,
            claimed_at = NULL,
            completed_at = NULL,
            updated_at = ?
          WHERE task_id = ?
        `,
        )
        .run(updatedAt, taskId);
      const drafted = this.getTask(taskId);
      if (drafted === null) {
        throw new Error(`task missing after draft: ${taskId}`);
      }
      this.db.exec('COMMIT');
      return drafted;
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
        limit: 10000,
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
        ...existing.map((task) => task.taskId).filter((taskId) => !orderedSet.has(taskId)),
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
          `,
          )
          .run(idx, new Date().toISOString(), taskId);
      }
      const reordered = this.listTasks({
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        limit: 10000,
      });
      this.db.exec('COMMIT');
      return reordered;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getProjectSettings(directoryId: string): ControlPlaneProjectSettingsRecord {
    const directory = this.getActiveDirectory(directoryId);
    const row = this.db
      .prepare(
        `
        SELECT
          directory_id,
          tenant_id,
          user_id,
          workspace_id,
          pinned_branch,
          task_focus_mode,
          thread_spawn_mode,
          created_at,
          updated_at
        FROM project_settings
        WHERE directory_id = ?
      `,
      )
      .get(directoryId);
    if (row === undefined) {
      return {
        directoryId: directory.directoryId,
        tenantId: directory.tenantId,
        userId: directory.userId,
        workspaceId: directory.workspaceId,
        pinnedBranch: null,
        taskFocusMode: 'balanced',
        threadSpawnMode: 'new-thread',
        createdAt: directory.createdAt,
        updatedAt: directory.createdAt,
      };
    }
    return normalizeProjectSettingsRow(row);
  }

  updateProjectSettings(input: UpdateProjectSettingsInput): ControlPlaneProjectSettingsRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const current = this.getProjectSettings(input.directoryId);
      const pinnedBranch =
        input.pinnedBranch === undefined
          ? current.pinnedBranch
          : input.pinnedBranch === null
            ? null
            : normalizeNonEmptyLabel(input.pinnedBranch, 'pinnedBranch');
      const taskFocusMode = input.taskFocusMode ?? current.taskFocusMode;
      const threadSpawnMode = input.threadSpawnMode ?? current.threadSpawnMode;
      const now = new Date().toISOString();
      this.db
        .prepare(
          `
          INSERT INTO project_settings (
            directory_id,
            tenant_id,
            user_id,
            workspace_id,
            pinned_branch,
            task_focus_mode,
            thread_spawn_mode,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(directory_id) DO UPDATE SET
            pinned_branch = excluded.pinned_branch,
            task_focus_mode = excluded.task_focus_mode,
            thread_spawn_mode = excluded.thread_spawn_mode,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          current.directoryId,
          current.tenantId,
          current.userId,
          current.workspaceId,
          pinnedBranch,
          taskFocusMode,
          threadSpawnMode,
          current.createdAt,
          now,
        );
      const updated = this.getProjectSettings(input.directoryId);
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getAutomationPolicy(input: GetAutomationPolicyInput): ControlPlaneAutomationPolicyRecord | null {
    const normalized = this.normalizeAutomationScope(input.scope, input.scopeId ?? null);
    const row = this.db
      .prepare(
        `
        SELECT
          policy_id,
          tenant_id,
          user_id,
          workspace_id,
          scope_type,
          scope_id,
          automation_enabled,
          frozen,
          created_at,
          updated_at
        FROM automation_policies
        WHERE
          tenant_id = ? AND
          user_id = ? AND
          workspace_id = ? AND
          scope_type = ? AND
          scope_id = ?
      `,
      )
      .get(input.tenantId, input.userId, input.workspaceId, normalized.scope, normalized.scopeKey);
    if (row === undefined) {
      return null;
    }
    return normalizeAutomationPolicyRow(row);
  }

  updateAutomationPolicy(input: UpsertAutomationPolicyInput): ControlPlaneAutomationPolicyRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const normalized = this.normalizeAutomationScope(input.scope, input.scopeId ?? null);
      if (normalized.scope === 'repository') {
        const repository = this.getActiveRepository(normalized.scopeId as string);
        this.assertScopeMatch(input, repository, 'automation policy');
      } else if (normalized.scope === 'project') {
        const directory = this.getActiveDirectory(normalized.scopeId as string);
        this.assertScopeMatch(input, directory, 'automation policy');
      }
      const existing = this.getAutomationPolicy({
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        scope: normalized.scope,
        scopeId: normalized.scopeId,
      });
      const automationEnabled = input.automationEnabled ?? existing?.automationEnabled ?? true;
      const frozen = input.frozen ?? existing?.frozen ?? false;
      const now = new Date().toISOString();
      const policyId = existing?.policyId ?? `policy-${randomUUID()}`;
      this.db
        .prepare(
          `
          INSERT INTO automation_policies (
            policy_id,
            tenant_id,
            user_id,
            workspace_id,
            scope_type,
            scope_id,
            automation_enabled,
            frozen,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id, user_id, workspace_id, scope_type, scope_id) DO UPDATE SET
            automation_enabled = excluded.automation_enabled,
            frozen = excluded.frozen,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          policyId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          normalized.scope,
          normalized.scopeKey,
          automationEnabled ? 1 : 0,
          frozen ? 1 : 0,
          existing?.createdAt ?? now,
          now,
        );
      const updated = this.getAutomationPolicy({
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        scope: normalized.scope,
        scopeId: normalized.scopeId,
      });
      if (updated === null) {
        throw new Error('automation policy missing after update');
      }
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  upsertGitHubPullRequest(
    input: UpsertGitHubPullRequestInput,
  ): ControlPlaneGitHubPullRequestRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const repository = this.getActiveRepository(input.repositoryId);
      this.assertScopeMatch(input, repository, 'github pr');
      if (input.directoryId !== undefined && input.directoryId !== null) {
        const directory = this.getActiveDirectory(input.directoryId);
        this.assertScopeMatch(input, directory, 'github pr');
      }
      const existing = this.db
        .prepare(
          `
          SELECT pr_record_id
          FROM github_pull_requests
          WHERE repository_id = ? AND number = ?
        `,
        )
        .get(input.repositoryId, input.number) as { pr_record_id: string } | undefined;
      const now = new Date().toISOString();
      const closedAt =
        input.state === 'closed' ? (input.closedAt === undefined ? now : input.closedAt) : null;
      const ciRollup = input.ciRollup ?? 'none';
      if (existing === undefined) {
        this.db
          .prepare(
            `
            INSERT INTO github_pull_requests (
              pr_record_id,
              tenant_id,
              user_id,
              workspace_id,
              repository_id,
              directory_id,
              owner,
              repo,
              number,
              title,
              url,
              author_login,
              head_branch,
              head_sha,
              base_branch,
              state,
              is_draft,
              ci_rollup,
              created_at,
              updated_at,
              closed_at,
              observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            input.prRecordId,
            input.tenantId,
            input.userId,
            input.workspaceId,
            input.repositoryId,
            input.directoryId ?? null,
            input.owner,
            input.repo,
            input.number,
            input.title,
            input.url,
            input.authorLogin ?? null,
            input.headBranch,
            input.headSha,
            input.baseBranch,
            input.state,
            input.isDraft ? 1 : 0,
            ciRollup,
            now,
            now,
            closedAt,
            input.observedAt,
          );
      } else {
        this.db
          .prepare(
            `
            UPDATE github_pull_requests
            SET
              directory_id = ?,
              title = ?,
              url = ?,
              author_login = ?,
              head_branch = ?,
              head_sha = ?,
              base_branch = ?,
              state = ?,
              is_draft = ?,
              ci_rollup = ?,
              updated_at = ?,
              closed_at = ?,
              observed_at = ?
            WHERE pr_record_id = ?
          `,
          )
          .run(
            input.directoryId ?? null,
            input.title,
            input.url,
            input.authorLogin ?? null,
            input.headBranch,
            input.headSha,
            input.baseBranch,
            input.state,
            input.isDraft ? 1 : 0,
            ciRollup,
            now,
            closedAt,
            input.observedAt,
            existing.pr_record_id,
          );
      }
      const recordId = existing?.pr_record_id ?? input.prRecordId;
      const updated = this.getGitHubPullRequest(recordId);
      if (updated === null) {
        throw new Error(`github pr missing after upsert: ${recordId}`);
      }
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getGitHubPullRequest(prRecordId: string): ControlPlaneGitHubPullRequestRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          pr_record_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          directory_id,
          owner,
          repo,
          number,
          title,
          url,
          author_login,
          head_branch,
          head_sha,
          base_branch,
          state,
          is_draft,
          ci_rollup,
          created_at,
          updated_at,
          closed_at,
          observed_at
        FROM github_pull_requests
        WHERE pr_record_id = ?
      `,
      )
      .get(prRecordId);
    if (row === undefined) {
      return null;
    }
    return normalizeGitHubPullRequestRow(row);
  }

  listGitHubPullRequests(
    query: ListGitHubPullRequestQuery = {},
  ): ControlPlaneGitHubPullRequestRecord[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
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
    if (query.directoryId !== undefined) {
      clauses.push('directory_id = ?');
      args.push(query.directoryId);
    }
    if (query.headBranch !== undefined) {
      clauses.push('head_branch = ?');
      args.push(query.headBranch);
    }
    if (query.state !== undefined) {
      clauses.push('state = ?');
      args.push(query.state);
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitClause = query.limit === undefined ? '' : 'LIMIT ?';
    if (query.limit !== undefined) {
      args.push(query.limit);
    }
    const rows = this.db
      .prepare(
        `
        SELECT
          pr_record_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          directory_id,
          owner,
          repo,
          number,
          title,
          url,
          author_login,
          head_branch,
          head_sha,
          base_branch,
          state,
          is_draft,
          ci_rollup,
          created_at,
          updated_at,
          closed_at,
          observed_at
        FROM github_pull_requests
        ${whereClause}
        ORDER BY updated_at DESC, number DESC
        ${limitClause}
      `,
      )
      .all(...args);
    return rows.map((row) => normalizeGitHubPullRequestRow(row));
  }

  updateGitHubPullRequestCiRollup(
    prRecordId: string,
    ciRollup: ControlPlaneGitHubCiRollup,
    observedAt: string,
  ): ControlPlaneGitHubPullRequestRecord | null {
    const existing = this.getGitHubPullRequest(prRecordId);
    if (existing === null) {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE github_pull_requests
        SET ci_rollup = ?, observed_at = ?, updated_at = ?
        WHERE pr_record_id = ?
      `,
      )
      .run(ciRollup, observedAt, now, prRecordId);
    return this.getGitHubPullRequest(prRecordId);
  }

  replaceGitHubPrJobs(input: ReplaceGitHubPrJobsInput): ControlPlaneGitHubPrJobRecord[] {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const pr = this.getGitHubPullRequest(input.prRecordId);
      if (pr === null) {
        throw new Error(`github pr not found: ${input.prRecordId}`);
      }
      this.assertScopeMatch(input, pr, 'github pr jobs');
      if (pr.repositoryId !== input.repositoryId) {
        throw new Error('github pr jobs repository mismatch');
      }
      this.db
        .prepare(
          `
          DELETE FROM github_pr_jobs
          WHERE pr_record_id = ?
        `,
        )
        .run(input.prRecordId);
      const now = new Date().toISOString();
      const insert = this.db.prepare(
        `
        INSERT INTO github_pr_jobs (
          job_record_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          pr_record_id,
          provider,
          external_id,
          name,
          status,
          conclusion,
          url,
          started_at,
          completed_at,
          observed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      );
      for (const job of input.jobs) {
        insert.run(
          job.jobRecordId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          input.repositoryId,
          input.prRecordId,
          job.provider,
          job.externalId,
          job.name,
          job.status,
          job.conclusion ?? null,
          job.url ?? null,
          job.startedAt ?? null,
          job.completedAt ?? null,
          input.observedAt,
          now,
        );
      }
      const listed = this.listGitHubPrJobs({
        prRecordId: input.prRecordId,
      });
      this.db.exec('COMMIT');
      return listed;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listGitHubPrJobs(query: ListGitHubPrJobsQuery = {}): ControlPlaneGitHubPrJobRecord[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
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
    if (query.prRecordId !== undefined) {
      clauses.push('pr_record_id = ?');
      args.push(query.prRecordId);
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitClause = query.limit === undefined ? '' : 'LIMIT ?';
    if (query.limit !== undefined) {
      args.push(query.limit);
    }
    const rows = this.db
      .prepare(
        `
        SELECT
          job_record_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          pr_record_id,
          provider,
          external_id,
          name,
          status,
          conclusion,
          url,
          started_at,
          completed_at,
          observed_at,
          updated_at
        FROM github_pr_jobs
        ${whereClause}
        ORDER BY name ASC, external_id ASC
        ${limitClause}
      `,
      )
      .all(...args);
    return rows.map((row) => normalizeGitHubPrJobRow(row));
  }

  upsertGitHubSyncState(input: UpsertGitHubSyncStateInput): ControlPlaneGitHubSyncStateRecord {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const repository = this.getActiveRepository(input.repositoryId);
      this.assertScopeMatch(input, repository, 'github sync state');
      if (input.directoryId !== undefined && input.directoryId !== null) {
        const directory = this.getActiveDirectory(input.directoryId);
        this.assertScopeMatch(input, directory, 'github sync state');
      }
      this.db
        .prepare(
          `
          INSERT INTO github_sync_state (
            state_id,
            tenant_id,
            user_id,
            workspace_id,
            repository_id,
            directory_id,
            branch_name,
            last_sync_at,
            last_success_at,
            last_error,
            last_error_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(state_id) DO UPDATE SET
            last_sync_at = excluded.last_sync_at,
            last_success_at = excluded.last_success_at,
            last_error = excluded.last_error,
            last_error_at = excluded.last_error_at
        `,
        )
        .run(
          input.stateId,
          input.tenantId,
          input.userId,
          input.workspaceId,
          input.repositoryId,
          input.directoryId ?? null,
          input.branchName,
          input.lastSyncAt,
          input.lastSuccessAt ?? null,
          input.lastError ?? null,
          input.lastErrorAt ?? null,
        );
      const updated = this.getGitHubSyncState(input.stateId);
      if (updated === null) {
        throw new Error(`github sync state missing after upsert: ${input.stateId}`);
      }
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getGitHubSyncState(stateId: string): ControlPlaneGitHubSyncStateRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          state_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          directory_id,
          branch_name,
          last_sync_at,
          last_success_at,
          last_error,
          last_error_at
        FROM github_sync_state
        WHERE state_id = ?
      `,
      )
      .get(stateId);
    if (row === undefined) {
      return null;
    }
    return normalizeGitHubSyncStateRow(row);
  }

  listGitHubSyncState(query: ListGitHubSyncStateQuery = {}): ControlPlaneGitHubSyncStateRecord[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
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
    if (query.directoryId !== undefined) {
      clauses.push('directory_id = ?');
      args.push(query.directoryId);
    }
    if (query.branchName !== undefined) {
      clauses.push('branch_name = ?');
      args.push(query.branchName);
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitClause = query.limit === undefined ? '' : 'LIMIT ?';
    if (query.limit !== undefined) {
      args.push(query.limit);
    }
    const rows = this.db
      .prepare(
        `
        SELECT
          state_id,
          tenant_id,
          user_id,
          workspace_id,
          repository_id,
          directory_id,
          branch_name,
          last_sync_at,
          last_success_at,
          last_error,
          last_error_at
        FROM github_sync_state
        ${whereClause}
        ORDER BY last_sync_at DESC, state_id ASC
        ${limitClause}
      `,
      )
      .all(...args);
    return rows.map((row) => normalizeGitHubSyncStateRow(row));
  }

  private findRepositoryByScopeRemoteUrl(
    tenantId: string,
    userId: string,
    workspaceId: string,
    remoteUrl: string,
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
      `,
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
    context: string,
  ): void {
    if (
      left.tenantId !== right.tenantId ||
      left.userId !== right.userId ||
      left.workspaceId !== right.workspaceId
    ) {
      throw new Error(`${context} scope mismatch`);
    }
  }

  private deriveTaskScopeKind(
    repositoryId: string | null,
    projectId: string | null,
  ): ControlPlaneTaskScopeKind {
    if (projectId !== null) {
      return 'project';
    }
    if (repositoryId !== null) {
      return 'repository';
    }
    return 'global';
  }

  private normalizeAutomationScope(
    scope: ControlPlaneAutomationPolicyScope,
    scopeId: string | null,
  ): {
    scope: ControlPlaneAutomationPolicyScope;
    scopeId: string | null;
    scopeKey: string;
  } {
    if (scope === 'global') {
      return {
        scope,
        scopeId: null,
        scopeKey: '',
      };
    }
    const normalizedScopeId = normalizeNonEmptyLabel(scopeId ?? '', 'scopeId');
    return {
      scope,
      scopeId: normalizedScopeId,
      scopeKey: normalizedScopeId,
    };
  }

  private nextTaskOrderIndex(tenantId: string, userId: string, workspaceId: string): number {
    const row = this.db
      .prepare(
        `
        SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order
        FROM tasks
        WHERE tenant_id = ? AND user_id = ? AND workspace_id = ?
      `,
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
    path: string,
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
      `,
      )
      .get(tenantId, userId, workspaceId, path);
    if (row === undefined) {
      return null;
    }
    return normalizeDirectoryRow(row);
  }

  private initializeSchema(): void {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const currentVersion = this.readSchemaVersion();
      if (currentVersion > CONTROL_PLANE_SCHEMA_VERSION) {
        throw new Error(
          `control-plane schema version ${String(currentVersion)} is newer than supported version ${String(CONTROL_PLANE_SCHEMA_VERSION)}`,
        );
      }
      this.applySchemaV1();
      this.writeSchemaVersion(CONTROL_PLANE_SCHEMA_VERSION);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private applySchemaV1(): void {
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
        runtime_status_model_json TEXT NOT NULL DEFAULT '${DEFAULT_RUNTIME_STATUS_MODEL_JSON}',
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
      `adapter_state_json TEXT NOT NULL DEFAULT '{}'`,
    );
    this.ensureColumnExists(
      'conversations',
      'runtime_status_model_json',
      `runtime_status_model_json TEXT NOT NULL DEFAULT '${DEFAULT_RUNTIME_STATUS_MODEL_JSON}'`,
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
        scope_kind TEXT NOT NULL DEFAULT 'global',
        project_id TEXT REFERENCES directories(directory_id),
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
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
    this.ensureColumnExists('tasks', 'scope_kind', `scope_kind TEXT NOT NULL DEFAULT 'global'`);
    this.ensureColumnExists(
      'tasks',
      'project_id',
      `project_id TEXT REFERENCES directories(directory_id)`,
    );
    this.ensureColumnExists('tasks', 'body', `body TEXT NOT NULL DEFAULT ''`);
    if (this.columnExists('tasks', 'description')) {
      this.db.exec(`
        UPDATE tasks
        SET body = description
        WHERE (body IS NULL OR TRIM(body) = '') AND description IS NOT NULL
      `);
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_scope_kind
      ON tasks (tenant_id, user_id, workspace_id, scope_kind, repository_id, project_id, order_index);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON tasks (status, updated_at, task_id);
    `);
    this.db.exec(`
      UPDATE tasks
      SET scope_kind = CASE
        WHEN project_id IS NOT NULL THEN 'project'
        WHEN repository_id IS NOT NULL THEN 'repository'
        ELSE 'global'
      END
      WHERE scope_kind NOT IN ('global', 'repository', 'project');
    `);
    this.db.exec(`
      UPDATE tasks
      SET scope_kind = 'repository'
      WHERE scope_kind = 'global' AND repository_id IS NOT NULL AND project_id IS NULL;
    `);
    this.db.exec(`
      DELETE FROM tasks
      WHERE repository_id IS NULL AND project_id IS NULL;
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_settings (
        directory_id TEXT PRIMARY KEY REFERENCES directories(directory_id),
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        pinned_branch TEXT,
        task_focus_mode TEXT NOT NULL DEFAULT 'balanced',
        thread_spawn_mode TEXT NOT NULL DEFAULT 'new-thread',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_project_settings_scope
      ON project_settings (tenant_id, user_id, workspace_id, directory_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automation_policies (
        policy_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        automation_enabled INTEGER NOT NULL,
        frozen INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, user_id, workspace_id, scope_type, scope_id)
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_automation_policies_scope
      ON automation_policies (tenant_id, user_id, workspace_id, scope_type, scope_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS github_pull_requests (
        pr_record_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(repository_id),
        directory_id TEXT REFERENCES directories(directory_id),
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author_login TEXT,
        head_branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        state TEXT NOT NULL,
        is_draft INTEGER NOT NULL,
        ci_rollup TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        observed_at TEXT NOT NULL,
        UNIQUE(repository_id, number)
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_github_pull_requests_scope
      ON github_pull_requests (
        tenant_id,
        user_id,
        workspace_id,
        repository_id,
        state,
        head_branch,
        updated_at
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS github_pr_jobs (
        job_record_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(repository_id),
        pr_record_id TEXT NOT NULL REFERENCES github_pull_requests(pr_record_id),
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        conclusion TEXT,
        url TEXT,
        started_at TEXT,
        completed_at TEXT,
        observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(pr_record_id, provider, external_id)
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_github_pr_jobs_scope
      ON github_pr_jobs (
        tenant_id,
        user_id,
        workspace_id,
        repository_id,
        pr_record_id,
        updated_at
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS github_sync_state (
        state_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories(repository_id),
        directory_id TEXT REFERENCES directories(directory_id),
        branch_name TEXT NOT NULL,
        last_sync_at TEXT NOT NULL,
        last_success_at TEXT,
        last_error TEXT,
        last_error_at TEXT
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_github_sync_state_scope
      ON github_sync_state (
        tenant_id,
        user_id,
        workspace_id,
        repository_id,
        branch_name,
        last_sync_at
      );
    `);
  }

  private readSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version;').get();
    if (row === undefined) {
      throw new Error('failed to read control-plane schema version');
    }
    const version = (row as Record<string, unknown>)['user_version'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      throw new Error(`invalid control-plane schema version value: ${String(version)}`);
    }
    return version;
  }

  private writeSchemaVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${String(version)};`);
  }

  private configureConnection(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 2000;');
  }

  private columnExists(table: string, column: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((row) => {
      const asRow = row as Record<string, unknown>;
      return asRow['name'] === column;
    });
  }

  private ensureColumnExists(table: string, column: string, definition: string): void {
    if (this.columnExists(table, column)) {
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
