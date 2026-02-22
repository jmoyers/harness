import { DatabaseSync } from './sqlite.ts';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NormalizedEventEnvelope } from '../events/normalized-events.ts';

interface EventRow {
  rowId: number;
  tenantId: string;
  userId: string;
  workspaceId: string;
  worktreeId: string;
  conversationId: string;
  turnId: string | null;
  eventId: string;
  source: string;
  eventType: string;
  ts: string;
  payloadJson: string;
}

interface EventQuery {
  tenantId: string;
  userId: string;
  conversationId?: string;
  afterRowId?: number;
  limit?: number;
}

interface PersistedEvent {
  rowId: number;
  event: NormalizedEventEnvelope;
}

interface OnlineCopyForwardCompactionStepResult {
  readonly state: 'idle' | 'copying' | 'finalized';
  readonly copiedRows: number;
}

const EVENT_STORE_SCHEMA_VERSION = 1;
const EVENT_COMPACTION_SHADOW_TABLE = 'events_compaction_shadow';
const EVENT_COMPACTION_OLD_TABLE = 'events_compaction_old';
const EVENT_STORE_AUTO_VACUUM_MIGRATION_MAX_FILE_BYTES = 64 * 1024 * 1024;

function sqliteStatementChanges(value: unknown): number {
  if (typeof value !== 'object' || value === null) {
    return 0;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.changes === 'number' ? candidate.changes : 0;
}

function asObject(value: unknown): Record<string, unknown> {
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

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new Error(`expected number for ${field}`);
  }
  return value;
}

function asStringOrNull(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return asString(value, field);
}

function normalizeRow(value: unknown): EventRow {
  const row = asObject(value);
  return {
    rowId: asNumber(row.row_id, 'row_id'),
    tenantId: asString(row.tenant_id, 'tenant_id'),
    userId: asString(row.user_id, 'user_id'),
    workspaceId: asString(row.workspace_id, 'workspace_id'),
    worktreeId: asString(row.worktree_id, 'worktree_id'),
    conversationId: asString(row.conversation_id, 'conversation_id'),
    turnId: asStringOrNull(row.turn_id, 'turn_id'),
    eventId: asString(row.event_id, 'event_id'),
    source: asString(row.source, 'source'),
    eventType: asString(row.event_type, 'event_type'),
    ts: asString(row.ts, 'ts'),
    payloadJson: asString(row.payload_json, 'payload_json'),
  };
}

export function normalizeStoredRow(value: unknown): {
  rowId: number;
  tenantId: string;
  userId: string;
  workspaceId: string;
  worktreeId: string;
  conversationId: string;
  turnId: string | null;
  eventId: string;
  source: string;
  eventType: string;
  ts: string;
  payloadJson: string;
} {
  return normalizeRow(value);
}

export class SqliteEventStore {
  private readonly db: DatabaseSync;
  private readonly inMemory: boolean;
  private readonly dbPath: string;
  private copyForwardRequested = false;
  private copyForwardActive = false;
  private copyForwardCursorRowId = 0;

  constructor(filePath = ':memory:') {
    const dbPath = this.preparePath(filePath);
    this.dbPath = dbPath;
    this.inMemory = dbPath === ':memory:';
    this.db = new DatabaseSync(dbPath);
    this.configureConnection();
    this.initializeSchema();
    this.ensureIncrementalAutoVacuumMode();
  }

  close(): void {
    this.db.close();
  }

  appendEvents(events: readonly NormalizedEventEnvelope[]): void {
    if (events.length === 0) {
      return;
    }

    const insertStatement = this.db.prepare(`
      INSERT INTO events (
        tenant_id,
        user_id,
        workspace_id,
        worktree_id,
        conversation_id,
        turn_id,
        event_id,
        source,
        event_type,
        ts,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (const event of events) {
        insertStatement.run(
          event.scope.tenantId,
          event.scope.userId,
          event.scope.workspaceId,
          event.scope.worktreeId,
          event.scope.conversationId,
          event.scope.turnId ?? null,
          event.eventId,
          event.source,
          event.type,
          event.ts,
          JSON.stringify(event.payload),
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listEvents(query: EventQuery): PersistedEvent[] {
    const limit = query.limit ?? 100;
    const afterRowId = query.afterRowId ?? 0;

    const clauses = ['tenant_id = ?', 'user_id = ?', 'row_id > ?'];
    const args: Array<number | string> = [query.tenantId, query.userId, afterRowId];

    if (query.conversationId !== undefined) {
      clauses.push('conversation_id = ?');
      args.push(query.conversationId);
    }

    const sql = `
      SELECT
        row_id,
        tenant_id,
        user_id,
        workspace_id,
        worktree_id,
        conversation_id,
        turn_id,
        event_id,
        source,
        event_type,
        ts,
        payload_json
      FROM events
      WHERE ${clauses.join(' AND ')}
      ORDER BY row_id ASC
      LIMIT ?
    `;
    args.push(limit);

    const rows = this.db.prepare(sql).all(...args);
    return rows.map((row) => {
      const normalizedRow = normalizeStoredRow(row);
      const payload = JSON.parse(normalizedRow.payloadJson) as NormalizedEventEnvelope['payload'];
      const event: NormalizedEventEnvelope = {
        schemaVersion: '1',
        eventId: normalizedRow.eventId,
        source: normalizedRow.source as NormalizedEventEnvelope['source'],
        type: normalizedRow.eventType as NormalizedEventEnvelope['type'],
        ts: normalizedRow.ts,
        scope: {
          tenantId: normalizedRow.tenantId,
          userId: normalizedRow.userId,
          workspaceId: normalizedRow.workspaceId,
          worktreeId: normalizedRow.worktreeId,
          conversationId: normalizedRow.conversationId,
          ...(normalizedRow.turnId === null ? {} : { turnId: normalizedRow.turnId }),
        },
        payload,
      };
      return {
        rowId: normalizedRow.rowId,
        event,
      };
    });
  }

  pruneEventsOlderThan(cutoffTs: string, limit = 1000): number {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1000;
    const result = this.db
      .prepare(
        `
        DELETE FROM events
        WHERE row_id IN (
          SELECT row_id
          FROM events
          WHERE ts < ?
          ORDER BY row_id ASC
          LIMIT ?
        )
      `,
      )
      .run(cutoffTs, safeLimit);
    const changes = sqliteStatementChanges(result);
    if (changes > 0) {
      this.copyForwardRequested = true;
    }
    return changes;
  }

  countEventsOlderThan(cutoffTs: string): number {
    const row = this.db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM events
        WHERE ts < ?
      `,
      )
      .get(cutoffTs);
    const asRow = asObject(row);
    return asNumber(asRow.count, 'count');
  }

  checkpointWal(mode: 'PASSIVE' | 'TRUNCATE' = 'PASSIVE'): void {
    this.db.exec(`PRAGMA wal_checkpoint(${mode});`);
  }

  compactFreelistPages(maxPages: number): void {
    const safeMaxPages = Number.isFinite(maxPages) ? Math.max(1, Math.floor(maxPages)) : 1;
    this.db.exec(`PRAGMA incremental_vacuum(${String(safeMaxPages)});`);
  }

  runOnlineCopyForwardCompactionStep(
    batchSize = 5000,
    finalizeTailRows = 1200,
  ): OnlineCopyForwardCompactionStepResult {
    if (this.inMemory) {
      return {
        state: 'idle',
        copiedRows: 0,
      };
    }

    const safeBatchSize = Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : 5000;
    const safeFinalizeTailRows = Number.isFinite(finalizeTailRows)
      ? Math.max(1, Math.floor(finalizeTailRows))
      : 1200;

    if (!this.copyForwardActive) {
      if (!this.copyForwardRequested) {
        return { state: 'idle', copiedRows: 0 };
      }
      if (this.countTotalEventRows() === 0) {
        this.copyForwardRequested = false;
        return { state: 'idle', copiedRows: 0 };
      }
      this.db.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        this.resetCompactionShadowTable();
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      this.copyForwardActive = true;
      this.copyForwardCursorRowId = 0;
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    let copiedRows: number;
    let remainingRows: number;
    try {
      copiedRows = this.copyCompactionBatch(this.copyForwardCursorRowId, safeBatchSize);
      if (copiedRows > 0) {
        this.copyForwardCursorRowId = this.readCompactionShadowCursorRowId();
      }
      remainingRows = this.countEventsAfterRowId(this.copyForwardCursorRowId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.resetCompactionStateAfterFailure();
      throw error;
    }

    if (remainingRows > safeFinalizeTailRows) {
      return { state: 'copying', copiedRows };
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const tailCopied = this.copyCompactionBatch(
        this.copyForwardCursorRowId,
        safeFinalizeTailRows,
      );
      if (tailCopied > 0) {
        this.copyForwardCursorRowId = this.readCompactionShadowCursorRowId();
      }
      const postTailRemaining = this.countEventsAfterRowId(this.copyForwardCursorRowId);
      if (postTailRemaining > 0) {
        this.db.exec('COMMIT');
        return { state: 'copying', copiedRows: copiedRows + tailCopied };
      }
      this.swapInCompactionShadowTable();
      this.copyForwardRequested = false;
      this.copyForwardActive = false;
      this.copyForwardCursorRowId = 0;
      this.db.exec('COMMIT');
      return { state: 'finalized', copiedRows: copiedRows + tailCopied };
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.resetCompactionStateAfterFailure();
      throw error;
    }
  }

  private initializeSchema(): void {
    const initialVersion = this.readSchemaVersion();
    this.assertSchemaVersionSupported(initialVersion);
    if (
      initialVersion === EVENT_STORE_SCHEMA_VERSION &&
      this.hasSchemaV1Table() &&
      this.hasSchemaV1Index()
    ) {
      return;
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const currentVersion = this.readSchemaVersion();
      this.assertSchemaVersionSupported(currentVersion);
      this.applySchemaV1();
      this.writeSchemaVersion(EVENT_STORE_SCHEMA_VERSION);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (
        this.isBusyLockError(error) &&
        this.readSchemaVersion() === EVENT_STORE_SCHEMA_VERSION &&
        this.hasSchemaV1Table() &&
        this.hasSchemaV1Index()
      ) {
        return;
      }
      throw error;
    }
  }

  private assertSchemaVersionSupported(currentVersion: number): void {
    if (currentVersion > EVENT_STORE_SCHEMA_VERSION) {
      throw new Error(
        `event store schema version ${String(currentVersion)} is newer than supported version ${String(EVENT_STORE_SCHEMA_VERSION)}`,
      );
    }
  }

  private hasSchemaV1Table(): boolean {
    const row = this.db
      .prepare(
        `
        SELECT 1 AS present
        FROM sqlite_master
        WHERE type = 'table' AND name = 'events'
        LIMIT 1
      `,
      )
      .get();
    return row !== undefined;
  }

  private hasSchemaV1Index(): boolean {
    const row = this.db
      .prepare(
        `
        SELECT 1 AS present
        FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_events_scope_cursor'
        LIMIT 1
      `,
      )
      .get();
    return row !== undefined;
  }

  private isBusyLockError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.message.toLowerCase().includes('database is locked');
  }

  private applySchemaV1(): void {
    this.db.exec('PRAGMA auto_vacuum = INCREMENTAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT,
        event_id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ts TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_scope_cursor
      ON events (tenant_id, user_id, conversation_id, row_id);
    `);
  }

  private readSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version;').get();
    if (row === undefined) {
      throw new Error('failed to read event store schema version');
    }
    const version = (row as Record<string, unknown>)['user_version'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      throw new Error(`invalid event store schema version value: ${String(version)}`);
    }
    return version;
  }

  private writeSchemaVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${String(version)};`);
  }

  private configureConnection(): void {
    this.db.exec('PRAGMA busy_timeout = 2000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  private ensureIncrementalAutoVacuumMode(): void {
    if (this.inMemory) {
      return;
    }
    if (!this.shouldAttemptAutoVacuumModeMigration()) {
      return;
    }
    const modeRow = this.db.prepare('PRAGMA auto_vacuum;').get();
    const mode = asNumber(asObject(modeRow).auto_vacuum, 'auto_vacuum');
    if (mode === 2) {
      return;
    }
    try {
      this.db.exec('PRAGMA auto_vacuum = INCREMENTAL;');
      this.db.exec('VACUUM;');
    } catch {
      // Best-effort migration only; maintenance can still run without mode flip.
    }
  }

  private shouldAttemptAutoVacuumModeMigration(): boolean {
    try {
      return statSync(this.dbPath).size <= EVENT_STORE_AUTO_VACUUM_MIGRATION_MAX_FILE_BYTES;
    } catch {
      return true;
    }
  }

  private countTotalEventRows(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM events;').get();
    return asNumber(asObject(row).count, 'count');
  }

  private countEventsAfterRowId(rowId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM events WHERE row_id > ?;')
      .get(rowId);
    return asNumber(asObject(row).count, 'count');
  }

  private copyCompactionBatch(afterRowId: number, limit: number): number {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
    const result = this.db
      .prepare(
        `
        INSERT INTO ${EVENT_COMPACTION_SHADOW_TABLE} (
          row_id,
          tenant_id,
          user_id,
          workspace_id,
          worktree_id,
          conversation_id,
          turn_id,
          event_id,
          source,
          event_type,
          ts,
          payload_json
        )
        SELECT
          row_id,
          tenant_id,
          user_id,
          workspace_id,
          worktree_id,
          conversation_id,
          turn_id,
          event_id,
          source,
          event_type,
          ts,
          payload_json
        FROM events
        WHERE row_id > ?
        ORDER BY row_id ASC
        LIMIT ?
      `,
      )
      .run(afterRowId, safeLimit);
    return sqliteStatementChanges(result);
  }

  private readCompactionShadowCursorRowId(): number {
    const row = this.db
      .prepare(
        `
        SELECT row_id
        FROM ${EVENT_COMPACTION_SHADOW_TABLE}
        ORDER BY row_id DESC
        LIMIT 1
      `,
      )
      .get();
    if (row === undefined) {
      return 0;
    }
    return asNumber(asObject(row).row_id, 'row_id');
  }

  private resetCompactionShadowTable(): void {
    this.db.exec(`DROP TABLE IF EXISTS ${EVENT_COMPACTION_SHADOW_TABLE};`);
    this.db.exec(`
      CREATE TABLE ${EVENT_COMPACTION_SHADOW_TABLE} (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT,
        event_id TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        ts TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
  }

  private swapInCompactionShadowTable(): void {
    this.db.exec('DROP INDEX IF EXISTS idx_events_scope_cursor;');
    this.db.exec(`ALTER TABLE events RENAME TO ${EVENT_COMPACTION_OLD_TABLE};`);
    this.db.exec(`ALTER TABLE ${EVENT_COMPACTION_SHADOW_TABLE} RENAME TO events;`);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_scope_cursor
      ON events (tenant_id, user_id, conversation_id, row_id);
    `);
    this.db.exec(`DROP TABLE ${EVENT_COMPACTION_OLD_TABLE};`);
  }

  private resetCompactionStateAfterFailure(): void {
    this.copyForwardActive = false;
    this.copyForwardCursorRowId = 0;
    try {
      this.db.exec(`DROP TABLE IF EXISTS ${EVENT_COMPACTION_SHADOW_TABLE};`);
    } catch {
      // Best-effort cleanup only.
    }
  }

  private preparePath(filePath: string): string {
    if (filePath === ':memory:') {
      return filePath;
    }

    mkdirSync(dirname(filePath), { recursive: true });
    return filePath;
  }
}
