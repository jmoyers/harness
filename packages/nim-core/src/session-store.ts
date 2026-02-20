import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { NimModelRef } from './contracts.ts';

export type NimPersistedSession = {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly model: NimModelRef;
  readonly lane: string;
  readonly soulHash?: string;
  readonly skillsSnapshotVersion?: number;
  readonly eventSeq: number;
  readonly lastRunId?: string;
  readonly followups: readonly NimPersistedFollowUp[];
};

export type NimPersistedIdempotency = {
  readonly idempotencyKey: string;
  readonly runId: string;
};

export type NimPersistedFollowUp = {
  readonly queueId: string;
  readonly text: string;
  readonly priority: 'normal' | 'high';
  readonly dedupeKey: string;
};

export interface NimSessionStore {
  upsertSession(session: NimPersistedSession): void;
  getSession(sessionId: string): NimPersistedSession | undefined;
  listSessions(tenantId: string, userId: string): readonly NimPersistedSession[];
  upsertIdempotency(sessionId: string, idempotencyKey: string, runId: string): void;
  getRunIdByIdempotency(sessionId: string, idempotencyKey: string): string | undefined;
  listIdempotency(sessionId: string): readonly NimPersistedIdempotency[];
}

export class InMemoryNimSessionStore implements NimSessionStore {
  private sessions = new Map<string, NimPersistedSession>();
  private idempotencyBySession = new Map<string, Map<string, string>>();

  public upsertSession(session: NimPersistedSession): void {
    this.sessions.set(session.sessionId, session);
  }

  public getSession(sessionId: string): NimPersistedSession | undefined {
    return this.sessions.get(sessionId);
  }

  public listSessions(tenantId: string, userId: string): readonly NimPersistedSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.tenantId === tenantId && session.userId === userId,
    );
  }

  public upsertIdempotency(sessionId: string, idempotencyKey: string, runId: string): void {
    let map = this.idempotencyBySession.get(sessionId);
    if (map === undefined) {
      map = new Map<string, string>();
      this.idempotencyBySession.set(sessionId, map);
    }
    if (map.has(idempotencyKey)) {
      return;
    }
    map.set(idempotencyKey, runId);
  }

  public getRunIdByIdempotency(sessionId: string, idempotencyKey: string): string | undefined {
    return this.idempotencyBySession.get(sessionId)?.get(idempotencyKey);
  }

  public listIdempotency(sessionId: string): readonly NimPersistedIdempotency[] {
    const map = this.idempotencyBySession.get(sessionId);
    if (map === undefined) {
      return [];
    }
    return Array.from(map.entries()).map(([idempotencyKey, runId]) => ({
      idempotencyKey,
      runId,
    }));
  }
}

interface StatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

class WrappedStatement {
  private readonly statement: StatementLike;

  public constructor(statement: StatementLike) {
    this.statement = statement;
  }

  public run(...params: unknown[]): unknown {
    return this.statement.run(...params);
  }

  public get(...params: unknown[]): unknown {
    const value = this.statement.get(...params);
    return value === null ? undefined : value;
  }

  public all(...params: unknown[]): unknown[] {
    return this.statement.all(...params);
  }
}

interface SqliteDatabaseLike {
  close: () => void;
  exec: (sql: string) => unknown;
  prepare: (sql: string) => StatementLike;
}

type BunSqliteModule = {
  Database: new (path: string) => SqliteDatabaseLike;
};

interface SqliteRuntime {
  readonly bunVersion: string | undefined;
  readonly loadModule: (specifier: 'bun:sqlite') => unknown;
}

const require = createRequire(import.meta.url);
const defaultRuntime: SqliteRuntime = {
  bunVersion: process.versions.bun,
  loadModule: (specifier) => require(specifier) as unknown,
};

function createDatabaseForRuntime(
  path: string,
  runtime: SqliteRuntime = defaultRuntime,
): SqliteDatabaseLike {
  if (runtime.bunVersion === undefined) {
    throw new Error('bun runtime is required for sqlite access');
  }
  const module = runtime.loadModule('bun:sqlite') as BunSqliteModule;
  return new module.Database(path);
}

class DatabaseSync {
  private readonly database: SqliteDatabaseLike;

  public constructor(path: string, runtime: SqliteRuntime = defaultRuntime) {
    this.database = createDatabaseForRuntime(path, runtime);
  }

  public close(): void {
    this.database.close();
  }

  public exec(sql: string): void {
    this.database.exec(sql);
  }

  public prepare(sql: string): WrappedStatement {
    return new WrappedStatement(this.database.prepare(sql));
  }
}

const NIM_SESSION_STORE_SCHEMA_VERSION = 2;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('expected sqlite row object');
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`expected string for ${field}`);
  }
  return value;
}

function asFollowupPriority(value: unknown, field: string): 'normal' | 'high' {
  if (value === 'normal' || value === 'high') {
    return value;
  }
  throw new Error(`expected follow-up priority for ${field}`);
}

function asStringOrUndefined(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return asString(value, field);
}

function asNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`expected non-negative integer for ${field}`);
  }
  return value;
}

function asNonNegativeIntegerOrUndefined(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return asNonNegativeInteger(value, field);
}

function parseFollowupsJson(value: unknown): readonly NimPersistedFollowUp[] {
  const json = asString(value, 'followups_json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('invalid followups_json');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('expected followups_json array');
  }
  return parsed.map((item, index) => {
    const row = asRecord(item);
    return {
      queueId: asString(row.queueId, `followups_json[${String(index)}].queueId`),
      text: asString(row.text, `followups_json[${String(index)}].text`),
      priority: asFollowupPriority(row.priority, `followups_json[${String(index)}].priority`),
      dedupeKey: asString(row.dedupeKey, `followups_json[${String(index)}].dedupeKey`),
    };
  });
}

function parsePersistedSessionRow(row: unknown): NimPersistedSession {
  const value = asRecord(row);
  const soulHash = asStringOrUndefined(value.soul_hash, 'soul_hash');
  const skillsSnapshotVersion = asNonNegativeIntegerOrUndefined(
    value.skills_snapshot_version,
    'skills_snapshot_version',
  );
  const lastRunId = asStringOrUndefined(value.last_run_id, 'last_run_id');
  const followups = parseFollowupsJson(value.followups_json);
  return {
    sessionId: asString(value.session_id, 'session_id'),
    tenantId: asString(value.tenant_id, 'tenant_id'),
    userId: asString(value.user_id, 'user_id'),
    model: asString(value.model, 'model') as NimModelRef,
    lane: asString(value.lane, 'lane'),
    ...(soulHash !== undefined ? { soulHash } : {}),
    ...(skillsSnapshotVersion !== undefined ? { skillsSnapshotVersion } : {}),
    eventSeq: asNonNegativeInteger(value.event_seq, 'event_seq'),
    ...(lastRunId !== undefined ? { lastRunId } : {}),
    followups,
  };
}

function parseIdempotencyRow(row: unknown): NimPersistedIdempotency {
  const value = asRecord(row);
  return {
    idempotencyKey: asString(value.idempotency_key, 'idempotency_key'),
    runId: asString(value.run_id, 'run_id'),
  };
}

function preparePath(filePath: string): string {
  if (filePath === ':memory:') {
    return filePath;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  return filePath;
}

export class NimSqliteSessionStore implements NimSessionStore {
  private readonly db: DatabaseSync;

  public constructor(filePath = ':memory:') {
    this.db = new DatabaseSync(preparePath(filePath));
    this.configureConnection();
    this.initializeSchema();
  }

  public close(): void {
    this.db.close();
  }

  public upsertSession(session: NimPersistedSession): void {
    this.db
      .prepare(
        `
      INSERT INTO nim_sessions (
        session_id,
        tenant_id,
        user_id,
        model,
        lane,
        soul_hash,
        skills_snapshot_version,
        event_seq,
        last_run_id,
        followups_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        user_id = excluded.user_id,
        model = excluded.model,
        lane = excluded.lane,
        soul_hash = excluded.soul_hash,
        skills_snapshot_version = excluded.skills_snapshot_version,
        event_seq = excluded.event_seq,
        last_run_id = excluded.last_run_id,
        followups_json = excluded.followups_json
    `,
      )
      .run(
        session.sessionId,
        session.tenantId,
        session.userId,
        session.model,
        session.lane,
        session.soulHash ?? null,
        session.skillsSnapshotVersion ?? null,
        session.eventSeq,
        session.lastRunId ?? null,
        JSON.stringify(session.followups),
      );
  }

  public getSession(sessionId: string): NimPersistedSession | undefined {
    const row = this.db
      .prepare(
        `
      SELECT
        session_id,
        tenant_id,
        user_id,
        model,
        lane,
        soul_hash,
        skills_snapshot_version,
        event_seq,
        last_run_id,
        followups_json
      FROM nim_sessions
      WHERE session_id = ?
      LIMIT 1
    `,
      )
      .get(sessionId);
    if (row === undefined) {
      return undefined;
    }
    return parsePersistedSessionRow(row);
  }

  public listSessions(tenantId: string, userId: string): readonly NimPersistedSession[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        session_id,
        tenant_id,
        user_id,
        model,
        lane,
        soul_hash,
        skills_snapshot_version,
        event_seq,
        last_run_id,
        followups_json
      FROM nim_sessions
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY session_id ASC
    `,
      )
      .all(tenantId, userId);
    return rows.map((row) => parsePersistedSessionRow(row));
  }

  public upsertIdempotency(sessionId: string, idempotencyKey: string, runId: string): void {
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO nim_session_idempotency (
        session_id,
        idempotency_key,
        run_id
      ) VALUES (?, ?, ?)
    `,
      )
      .run(sessionId, idempotencyKey, runId);
  }

  public getRunIdByIdempotency(sessionId: string, idempotencyKey: string): string | undefined {
    const row = this.db
      .prepare(
        `
      SELECT run_id
      FROM nim_session_idempotency
      WHERE session_id = ? AND idempotency_key = ?
      LIMIT 1
    `,
      )
      .get(sessionId, idempotencyKey);
    if (row === undefined) {
      return undefined;
    }
    return asString(asRecord(row).run_id, 'run_id');
  }

  public listIdempotency(sessionId: string): readonly NimPersistedIdempotency[] {
    const rows = this.db
      .prepare(
        `
      SELECT idempotency_key, run_id
      FROM nim_session_idempotency
      WHERE session_id = ?
      ORDER BY idempotency_key ASC
    `,
      )
      .all(sessionId);
    return rows.map((row) => parseIdempotencyRow(row));
  }

  private configureConnection(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 2000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  private initializeSchema(): void {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const currentVersion = this.readSchemaVersion();
      if (currentVersion > NIM_SESSION_STORE_SCHEMA_VERSION) {
        throw new Error(
          `nim session store schema version ${String(currentVersion)} is newer than supported version ${String(NIM_SESSION_STORE_SCHEMA_VERSION)}`,
        );
      }
      if (currentVersion < 1) {
        this.applySchemaV1();
      }
      if (currentVersion < 2) {
        this.applySchemaV2();
      }
      this.writeSchemaVersion(NIM_SESSION_STORE_SCHEMA_VERSION);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private applySchemaV1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nim_sessions (
        session_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        model TEXT NOT NULL,
        lane TEXT NOT NULL,
        soul_hash TEXT,
        skills_snapshot_version INTEGER,
        event_seq INTEGER NOT NULL,
        last_run_id TEXT
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nim_sessions_scope
      ON nim_sessions (tenant_id, user_id, session_id);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nim_session_idempotency (
        session_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        run_id TEXT NOT NULL,
        PRIMARY KEY (session_id, idempotency_key),
        FOREIGN KEY (session_id) REFERENCES nim_sessions(session_id) ON DELETE CASCADE
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nim_session_idempotency_session
      ON nim_session_idempotency (session_id, idempotency_key);
    `);
  }

  private applySchemaV2(): void {
    if (!this.tableHasColumn('nim_sessions', 'followups_json')) {
      this.db.exec(`
        ALTER TABLE nim_sessions
        ADD COLUMN followups_json TEXT NOT NULL DEFAULT '[]';
      `);
    }
  }

  private readSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version;').get();
    if (row === undefined) {
      throw new Error('failed to read nim session store schema version');
    }
    const version = asRecord(row).user_version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      throw new Error(`invalid nim session store schema version value: ${String(version)}`);
    }
    return version;
  }

  private writeSchemaVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${String(version)};`);
  }

  private tableHasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName});`).all();
    return rows.some((row) => {
      const name = asRecord(row).name;
      return typeof name === 'string' && name === columnName;
    });
  }
}
