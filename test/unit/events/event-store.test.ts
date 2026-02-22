import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { createNormalizedEvent, type EventScope } from '../../../src/events/normalized-events.ts';
import { SqliteEventStore, normalizeStoredRow } from '../../../src/store/event-store.ts';
import { DatabaseSync } from '../../../src/store/sqlite.ts';

function makeScope(overrides: Partial<EventScope> = {}): EventScope {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    worktreeId: 'worktree-1',
    conversationId: 'conversation-1',
    ...overrides,
  };
}

function createThreadEvent(scope: EventScope, eventId: string) {
  return createNormalizedEvent(
    'provider',
    'provider-thread-started',
    scope,
    {
      kind: 'thread',
      threadId: 'thread-1',
    },
    () => new Date('2026-02-14T03:00:00.000Z'),
    () => eventId,
  );
}

void test('event store stamps schema version during initialization', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-schema-version-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  store.close();
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('PRAGMA user_version;').get() as Record<string, unknown>;
    assert.equal(row['user_version'], 1);
    const autoVacuum = db.prepare('PRAGMA auto_vacuum;').get() as Record<string, unknown>;
    assert.equal(autoVacuum['auto_vacuum'], 2);
  } finally {
    db.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store startup tolerates a transient write lock when schema is already current', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-schema-lock-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const bootstrap = new SqliteEventStore(dbPath);
  bootstrap.close();

  const lock = new DatabaseSync(dbPath);
  lock.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const store = new SqliteEventStore(dbPath);
    store.close();
  } finally {
    lock.exec('ROLLBACK;');
    lock.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store upgrades legacy sqlite file to incremental auto-vacuum', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-auto-vacuum-migrate-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const bootstrap = new DatabaseSync(dbPath);
  bootstrap.exec(`
    CREATE TABLE legacy_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL
    );
  `);
  bootstrap.exec(`INSERT INTO legacy_records (value) VALUES ('legacy');`);
  const before = bootstrap.prepare('PRAGMA auto_vacuum;').get() as Record<string, unknown>;
  assert.equal(before['auto_vacuum'], 0);
  bootstrap.close();

  const store = new SqliteEventStore(dbPath);
  store.close();

  const verification = new DatabaseSync(dbPath);
  try {
    const autoVacuum = verification.prepare('PRAGMA auto_vacuum;').get() as Record<string, unknown>;
    assert.equal(autoVacuum['auto_vacuum'], 2);
  } finally {
    verification.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store skips auto-vacuum migration for large legacy sqlite files', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-auto-vacuum-skip-large-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const bootstrap = new DatabaseSync(dbPath);
  bootstrap.exec(`
    CREATE TABLE legacy_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL
    );
  `);
  bootstrap.exec(`INSERT INTO legacy_records (value) VALUES ('legacy');`);
  const before = bootstrap.prepare('PRAGMA auto_vacuum;').get() as Record<string, unknown>;
  assert.equal(before['auto_vacuum'], 0);
  bootstrap.close();

  truncateSync(dbPath, 80 * 1024 * 1024);

  const store = new SqliteEventStore(dbPath);
  store.close();

  const verification = new DatabaseSync(dbPath);
  try {
    const autoVacuum = verification.prepare('PRAGMA auto_vacuum;').get() as Record<string, unknown>;
    assert.equal(autoVacuum['auto_vacuum'], 0);
  } finally {
    verification.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store fails closed on newer schema version', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-schema-newer-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA user_version = 99;');
  db.close();

  assert.throws(() => {
    const store = new SqliteEventStore(dbPath);
    store.close();
  }, /schema version .* newer than supported version/i);

  rmSync(dirPath, { recursive: true, force: true });
});

void test('event store appends and reads events with tenant user and cursor filters', () => {
  const store = new SqliteEventStore(':memory:');
  try {
    store.appendEvents([]);
    store.appendEvents([
      createThreadEvent(makeScope(), 'event-1'),
      createNormalizedEvent(
        'provider',
        'provider-turn-started',
        {
          ...makeScope(),
          turnId: 'turn-1',
        },
        {
          kind: 'turn',
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'in-progress',
        },
        () => new Date('2026-02-14T03:00:01.000Z'),
        () => 'event-2',
      ),
      createThreadEvent(
        makeScope({
          tenantId: 'tenant-2',
          userId: 'user-2',
          conversationId: 'conversation-2',
        }),
        'event-3',
      ),
    ]);

    const firstPage = store.listEvents({
      tenantId: 'tenant-1',
      userId: 'user-1',
      limit: 1,
    });
    assert.equal(firstPage.length, 1);
    assert.equal(firstPage[0]?.event.eventId, 'event-1');

    const nextPage = store.listEvents({
      tenantId: 'tenant-1',
      userId: 'user-1',
      afterRowId: firstPage[0]?.rowId,
      limit: 10,
    });
    assert.equal(nextPage.length, 1);
    assert.equal(nextPage[0]?.event.eventId, 'event-2');
    assert.equal(nextPage[0]?.event.scope.turnId, 'turn-1');

    const otherTenant = store.listEvents({
      tenantId: 'tenant-2',
      userId: 'user-2',
      conversationId: 'conversation-2',
    });
    assert.equal(otherTenant.length, 1);
    assert.equal(otherTenant[0]?.event.eventId, 'event-3');
  } finally {
    store.close();
  }
});

void test('normalizeStoredRow validates row shape and field types', () => {
  assert.throws(() => {
    normalizeStoredRow(null);
  });

  assert.throws(() => {
    normalizeStoredRow({
      row_id: 1,
      tenant_id: 123,
      user_id: 'user-1',
      workspace_id: 'workspace-1',
      worktree_id: 'worktree-1',
      conversation_id: 'conversation-1',
      turn_id: null,
      event_id: 'event-1',
      source: 'provider',
      event_type: 'provider-thread-started',
      ts: '2026-02-14T03:00:00.000Z',
      payload_json: '{}',
    });
  });

  assert.throws(() => {
    normalizeStoredRow({
      row_id: 'bad',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      workspace_id: 'workspace-1',
      worktree_id: 'worktree-1',
      conversation_id: 'conversation-1',
      turn_id: null,
      event_id: 'event-1',
      source: 'provider',
      event_type: 'provider-thread-started',
      ts: '2026-02-14T03:00:00.000Z',
      payload_json: '{}',
    });
  });
});

void test('event store writes are transactional and rollback on duplicate event id', () => {
  const store = new SqliteEventStore(':memory:');
  try {
    store.appendEvents([createThreadEvent(makeScope(), 'event-1')]);
    const before = store.listEvents({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    assert.equal(before.length, 1);

    assert.throws(() => {
      store.appendEvents([
        createThreadEvent(makeScope(), 'event-2'),
        createThreadEvent(makeScope(), 'event-1'),
      ]);
    });

    const after = store.listEvents({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    assert.equal(after.length, 1);
    assert.equal(after[0]?.event.eventId, 'event-1');
  } finally {
    store.close();
  }
});

void test('event store prunes rows older than cutoff in bounded batches', () => {
  const store = new SqliteEventStore(':memory:');
  try {
    store.appendEvents([
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        makeScope(),
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date('2026-02-14T03:00:00.000Z'),
        () => 'prune-event-1',
      ),
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        makeScope(),
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date('2026-02-14T03:00:01.000Z'),
        () => 'prune-event-2',
      ),
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        makeScope(),
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date('2026-02-14T03:00:02.000Z'),
        () => 'prune-event-3',
      ),
    ]);

    const cutoff = '2026-02-14T03:00:02.000Z';
    assert.equal(store.countEventsOlderThan(cutoff), 2);
    assert.equal(store.pruneEventsOlderThan(cutoff, 1), 1);
    assert.equal(store.countEventsOlderThan(cutoff), 1);
    assert.equal(store.pruneEventsOlderThan(cutoff, 100), 1);
    assert.equal(store.countEventsOlderThan(cutoff), 0);

    const remaining = store.listEvents({
      tenantId: 'tenant-1',
      userId: 'user-1',
      limit: 10,
    });
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.event.eventId, 'prune-event-3');
  } finally {
    store.close();
  }
});

void test('event store checkpoint and compact hooks are callable', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-sqlite-compact-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  try {
    store.checkpointWalTruncate();
    store.compactFreelistPages(16);
  } finally {
    store.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store copy-forward compaction remains idle until pruning frees rows', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-copy-forward-idle-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  try {
    store.appendEvents([
      createThreadEvent(makeScope(), 'copy-forward-idle-1'),
      createThreadEvent(makeScope(), 'copy-forward-idle-2'),
    ]);
    const step = store.runOnlineCopyForwardCompactionStep(1, 1);
    assert.deepEqual(step, {
      state: 'idle',
      copiedRows: 0,
    });
  } finally {
    store.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store copy-forward compaction runs in bounded steps and preserves cursor continuity', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-copy-forward-live-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  try {
    const scope = makeScope();
    const events = Array.from({ length: 9 }, (_, index) =>
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        scope,
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date(`2026-02-14T03:00:${String(index).padStart(2, '0')}.000Z`),
        () => `copy-forward-event-${String(index + 1)}`,
      ),
    );
    store.appendEvents(events);
    assert.equal(store.pruneEventsOlderThan('2026-02-14T03:00:02.000Z', 10), 2);

    const first = store.runOnlineCopyForwardCompactionStep(2, 2);
    const second = store.runOnlineCopyForwardCompactionStep(2, 2);
    const third = store.runOnlineCopyForwardCompactionStep(2, 2);

    assert.deepEqual(first, {
      state: 'copying',
      copiedRows: 2,
    });
    assert.deepEqual(second, {
      state: 'copying',
      copiedRows: 2,
    });
    assert.deepEqual(third, {
      state: 'finalized',
      copiedRows: 3,
    });

    const remaining = store.listEvents({
      tenantId: scope.tenantId,
      userId: scope.userId,
      limit: 20,
    });
    assert.equal(remaining.length, 7);
    assert.equal(remaining[0]?.event.eventId, 'copy-forward-event-3');
    assert.equal(remaining[0]?.rowId, 3);

    store.appendEvents([
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        scope,
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date('2026-02-14T03:00:10.000Z'),
        () => 'copy-forward-event-10',
      ),
    ]);
    const appended = store.listEvents({
      tenantId: scope.tenantId,
      userId: scope.userId,
      afterRowId: 9,
      limit: 10,
    });
    assert.equal(appended.length, 1);
    assert.equal(appended[0]?.event.eventId, 'copy-forward-event-10');
  } finally {
    store.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store copy-forward compaction recovers after forced copy failure', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-copy-forward-failure-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  const internals = store as unknown as {
    db: {
      prepare: (sql: string) => {
        run: (...args: unknown[]) => unknown;
        get: (...args: unknown[]) => unknown;
        all: (...args: unknown[]) => unknown[];
      };
    };
  };
  try {
    const scope = makeScope();
    store.appendEvents([
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        scope,
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date('2026-02-14T03:00:00.000Z'),
        () => 'copy-forward-failure-1',
      ),
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        scope,
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date('2026-02-14T03:00:01.000Z'),
        () => 'copy-forward-failure-2',
      ),
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        scope,
        { kind: 'thread', threadId: 'thread-1' },
        () => new Date('2026-02-14T03:00:02.000Z'),
        () => 'copy-forward-failure-3',
      ),
    ]);
    assert.equal(store.pruneEventsOlderThan('2026-02-14T03:00:01.000Z', 10), 1);

    const originalPrepare = internals.db.prepare.bind(internals.db);
    internals.db.prepare = ((sql: string) => {
      if (sql.includes('INSERT INTO events_compaction_shadow')) {
        return {
          run: () => {
            throw new Error('forced-event-copy-failure');
          },
          get: () => undefined,
          all: () => [],
        };
      }
      return originalPrepare(sql);
    }) as typeof internals.db.prepare;

    assert.throws(
      () => store.runOnlineCopyForwardCompactionStep(2, 2),
      /forced-event-copy-failure/,
    );

    internals.db.prepare = originalPrepare;
    const recovered = store.runOnlineCopyForwardCompactionStep(10, 10);
    assert.equal(recovered.state, 'finalized');
    assert.equal(recovered.copiedRows, 2);
  } finally {
    store.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store persists to file path and payload parsing is preserved', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-sqlite-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const scope = makeScope();

  try {
    const firstStore = new SqliteEventStore(dbPath);
    firstStore.appendEvents([
      createNormalizedEvent(
        'meta',
        'meta-attention-raised',
        {
          ...scope,
          turnId: 'turn-2',
        },
        {
          kind: 'attention',
          threadId: 'thread-1',
          turnId: 'turn-2',
          reason: 'approval',
          detail: 'manual-check',
        },
        () => new Date('2026-02-14T03:00:02.000Z'),
        () => 'event-file-1',
      ),
    ]);
    firstStore.close();

    const secondStore = new SqliteEventStore(dbPath);
    const records = secondStore.listEvents({
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0]?.event.type, 'meta-attention-raised');
    assert.equal(records[0]?.event.payload.kind, 'attention');
    secondStore.close();
  } finally {
    rmSync(dirPath, { recursive: true, force: true });
  }
});
