import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { createNormalizedEvent, type EventScope } from '../src/events/normalized-events.ts';
import { SqliteEventStore, normalizeStoredRow } from '../src/store/event-store.ts';
import { DatabaseSync } from '../src/store/sqlite.ts';

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
  } finally {
    db.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('event store fails closed on newer schema version', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-schema-newer-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA user_version = 99;');
  db.close();

  assert.throws(
    () => {
      const store = new SqliteEventStore(dbPath);
      store.close();
    },
    /schema version .* newer than supported version/i,
  );

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
