import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { DatabaseSync, createDatabaseForRuntime } from '../../../src/store/sqlite.ts';

function createStatementStub() {
  return {
    run: () => ({ changes: 1 }),
    get: () => undefined,
    all: () => [],
  };
}

void test('createDatabaseForRuntime loads bun sqlite module', () => {
  let loadedSpecifier: 'bun:sqlite' | null = null;
  let constructedPath: string | null = null;

  class BunDatabase {
    constructor(path: string) {
      constructedPath = path;
    }
    close(): void {}
    exec(): void {}
    prepare() {
      return createStatementStub();
    }
  }

  const database = createDatabaseForRuntime('/tmp/harness-bun-sqlite', {
    bunVersion: '1.3.9',
    loadModule: (specifier) => {
      loadedSpecifier = specifier;
      return { Database: BunDatabase };
    },
  });

  assert.equal(loadedSpecifier, 'bun:sqlite');
  assert.equal(constructedPath, '/tmp/harness-bun-sqlite');
  database.close();
});

void test('createDatabaseForRuntime requires bun runtime', () => {
  let loaded = false;
  assert.throws(() =>
    createDatabaseForRuntime('/tmp/harness-node-sqlite', {
      bunVersion: undefined,
      loadModule: () => {
        loaded = true;
        return {};
      },
    }),
  );
  assert.equal(loaded, false);
});

void test('DatabaseSync wrapped statements normalize null get values to undefined', () => {
  let loadedSpecifier: 'bun:sqlite' | null = null;
  const statement = {
    run: () => ({ changes: 2 }),
    get: () => null,
    all: () => ['row-a', 'row-b'],
  };

  class BunDatabase {
    close(): void {}
    exec(): void {}
    prepare() {
      return statement;
    }
  }

  const database = new DatabaseSync('/tmp/harness-wrapped-sqlite', {
    bunVersion: '1.3.9',
    loadModule: (specifier) => {
      loadedSpecifier = specifier;
      return { Database: BunDatabase };
    },
  });

  const prepared = database.prepare('SELECT 1');
  assert.deepEqual(prepared.run(), { changes: 2 });
  assert.equal(prepared.get(), undefined);
  assert.deepEqual(prepared.all(), ['row-a', 'row-b']);
  assert.equal(loadedSpecifier, 'bun:sqlite');
  database.close();
});
