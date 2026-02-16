import { createRequire } from 'node:module';

interface StatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

class WrappedStatement {
  private readonly statement: StatementLike;

  constructor(statement: StatementLike) {
    this.statement = statement;
  }

  run(...params: unknown[]): unknown {
    return this.statement.run(...params);
  }

  get(...params: unknown[]): unknown {
    const value = this.statement.get(...params);
    return value === null ? undefined : value;
  }

  all(...params: unknown[]): unknown[] {
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

const require = createRequire(import.meta.url);

interface SqliteRuntime {
  readonly bunVersion: string | undefined;
  readonly loadModule: (specifier: 'bun:sqlite') => unknown;
}

const defaultRuntime: SqliteRuntime = {
  bunVersion: process.versions.bun,
  loadModule: (specifier) => require(specifier) as unknown
};

export function createDatabaseForRuntime(path: string, runtime: SqliteRuntime = defaultRuntime): SqliteDatabaseLike {
  if (runtime.bunVersion === undefined) {
    throw new Error('bun runtime is required for sqlite access');
  }
  const module = runtime.loadModule('bun:sqlite') as BunSqliteModule;
  return new module.Database(path);
}

export class DatabaseSync {
  private readonly database: SqliteDatabaseLike;

  constructor(path: string, runtime: SqliteRuntime = defaultRuntime) {
    this.database = createDatabaseForRuntime(path, runtime);
  }

  close(): void {
    this.database.close();
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): WrappedStatement {
    return new WrappedStatement(this.database.prepare(sql));
  }
}
