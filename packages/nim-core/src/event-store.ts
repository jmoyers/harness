import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { parseNimEventEnvelope, type NimEventEnvelope } from './events.ts';

export type NimEventStoreQuery = {
  readonly tenantId: string;
  readonly sessionId?: string;
  readonly runId?: string;
};

export interface NimEventStore {
  append(event: NimEventEnvelope): void;
  getById(eventId: string): NimEventEnvelope | undefined;
  list(input: NimEventStoreQuery): readonly NimEventEnvelope[];
}

export class InMemoryNimEventStore implements NimEventStore {
  private events: NimEventEnvelope[] = [];
  private eventById = new Map<string, NimEventEnvelope>();

  public append(event: NimEventEnvelope): void {
    this.events.push(event);
    this.eventById.set(event.event_id, event);
  }

  public getById(eventId: string): NimEventEnvelope | undefined {
    return this.eventById.get(eventId);
  }

  public list(input: NimEventStoreQuery): readonly NimEventEnvelope[] {
    return this.events.filter((event) => {
      if (event.tenant_id !== input.tenantId) {
        return false;
      }
      if (input.sessionId !== undefined && event.session_id !== input.sessionId) {
        return false;
      }
      if (input.runId !== undefined && event.run_id !== input.runId) {
        return false;
      }
      return true;
    });
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

const NIM_EVENT_STORE_SCHEMA_VERSION = 1;

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

function readEventJsonFromRow(row: unknown): string {
  return asString(asRecord(row).event_json, 'event_json');
}

function parseEventRow(row: unknown): NimEventEnvelope {
  const eventJson = readEventJsonFromRow(row);
  return parseNimEventEnvelope(JSON.parse(eventJson) as unknown);
}

function preparePath(filePath: string): string {
  if (filePath === ':memory:') {
    return filePath;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  return filePath;
}

export class NimSqliteEventStore implements NimEventStore {
  private readonly db: DatabaseSync;

  public constructor(filePath = ':memory:') {
    this.db = new DatabaseSync(preparePath(filePath));
    this.configureConnection();
    this.initializeSchema();
  }

  public close(): void {
    this.db.close();
  }

  public append(event: NimEventEnvelope): void {
    this.db
      .prepare(
        `
      INSERT INTO nim_events (
        event_id,
        tenant_id,
        session_id,
        run_id,
        event_seq,
        ts,
        event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        event.event_id,
        event.tenant_id,
        event.session_id,
        event.run_id,
        event.event_seq,
        event.ts,
        JSON.stringify(event),
      );
  }

  public getById(eventId: string): NimEventEnvelope | undefined {
    const row = this.db
      .prepare(
        `
      SELECT event_json
      FROM nim_events
      WHERE event_id = ?
      LIMIT 1
    `,
      )
      .get(eventId);
    if (row === undefined) {
      return undefined;
    }
    return parseEventRow(row);
  }

  public list(input: NimEventStoreQuery): readonly NimEventEnvelope[] {
    const clauses = ['tenant_id = ?'];
    const args: Array<number | string> = [input.tenantId];

    if (input.sessionId !== undefined) {
      clauses.push('session_id = ?');
      args.push(input.sessionId);
    }
    if (input.runId !== undefined) {
      clauses.push('run_id = ?');
      args.push(input.runId);
    }

    const rows = this.db
      .prepare(
        `
      SELECT event_json
      FROM nim_events
      WHERE ${clauses.join(' AND ')}
      ORDER BY row_id ASC
    `,
      )
      .all(...args);
    return rows.map((row) => parseEventRow(row));
  }

  private configureConnection(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 2000;');
  }

  private initializeSchema(): void {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const currentVersion = this.readSchemaVersion();
      if (currentVersion > NIM_EVENT_STORE_SCHEMA_VERSION) {
        throw new Error(
          `nim event store schema version ${String(currentVersion)} is newer than supported version ${String(NIM_EVENT_STORE_SCHEMA_VERSION)}`,
        );
      }
      this.applySchemaV1();
      this.writeSchemaVersion(NIM_EVENT_STORE_SCHEMA_VERSION);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private applySchemaV1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nim_events (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL,
        ts TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nim_events_scope
      ON nim_events (tenant_id, session_id, run_id, row_id);
    `);
  }

  private readSchemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version;').get();
    if (row === undefined) {
      throw new Error('failed to read nim event store schema version');
    }
    const version = asRecord(row).user_version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      throw new Error(`invalid nim event store schema version value: ${String(version)}`);
    }
    return version;
  }

  private writeSchemaVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${String(version)};`);
  }
}
