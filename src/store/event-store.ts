import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
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
    payloadJson: asString(row.payload_json, 'payload_json')
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

  constructor(filePath = ':memory:') {
    const dbPath = this.preparePath(filePath);
    this.db = new DatabaseSync(dbPath);
    this.configureConnection();
    this.initializeSchema();
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
          JSON.stringify(event.payload)
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

    const clauses = [
      'tenant_id = ?',
      'user_id = ?',
      'row_id > ?'
    ];
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
          ...(normalizedRow.turnId === null ? {} : { turnId: normalizedRow.turnId })
        },
        payload
      };
      return {
        rowId: normalizedRow.rowId,
        event
      };
    });
  }

  private initializeSchema(): void {
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

  private configureConnection(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 2000;');
  }

  private preparePath(filePath: string): string {
    if (filePath === ':memory:') {
      return filePath;
    }

    mkdirSync(dirname(filePath), { recursive: true });
    return filePath;
  }
}
