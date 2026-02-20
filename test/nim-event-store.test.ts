import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'bun:test';
import {
  InMemoryNimEventStore,
  NimSqliteEventStore,
  type NimEventEnvelope,
} from '../packages/nim-core/src/index.ts';

function buildEvent(input: {
  eventId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  eventSeq: number;
}): NimEventEnvelope {
  return {
    event_id: input.eventId,
    event_seq: input.eventSeq,
    ts: `2026-02-20T00:00:0${String(input.eventSeq)}.000Z`,
    tenant_id: input.tenantId,
    user_id: 'user-a',
    workspace_id: 'workspace-a',
    session_id: input.sessionId,
    run_id: input.runId,
    turn_id: input.runId,
    step_id: `step:${String(input.eventSeq)}`,
    source: 'system',
    type: 'turn.completed',
    payload_hash: `hash:${String(input.eventSeq)}`,
    idempotency_key: `idem:${String(input.eventSeq)}`,
    lane: `session:${input.sessionId}`,
    policy_hash: 'policy-a',
    trace_id: `trace:${input.runId}`,
    span_id: `span:${String(input.eventSeq)}`,
  };
}

test('nim in-memory event store appends and filters by tenant session and run', () => {
  const store = new InMemoryNimEventStore();
  const events = [
    buildEvent({
      eventId: 'evt-1',
      tenantId: 'tenant-a',
      sessionId: 'session-a',
      runId: 'run-a',
      eventSeq: 1,
    }),
    buildEvent({
      eventId: 'evt-2',
      tenantId: 'tenant-a',
      sessionId: 'session-a',
      runId: 'run-b',
      eventSeq: 2,
    }),
    buildEvent({
      eventId: 'evt-3',
      tenantId: 'tenant-a',
      sessionId: 'session-b',
      runId: 'run-c',
      eventSeq: 1,
    }),
    buildEvent({
      eventId: 'evt-4',
      tenantId: 'tenant-b',
      sessionId: 'session-c',
      runId: 'run-d',
      eventSeq: 1,
    }),
  ];
  for (const event of events) {
    store.append(event);
  }

  assert.equal(store.list({ tenantId: 'tenant-a' }).length, 3);
  assert.equal(store.list({ tenantId: 'tenant-a', sessionId: 'session-a' }).length, 2);
  assert.equal(store.list({ tenantId: 'tenant-a', runId: 'run-b' }).length, 1);
  assert.equal(
    store.list({ tenantId: 'tenant-a', sessionId: 'session-a', runId: 'run-b' }).length,
    1,
  );
  assert.equal(store.list({ tenantId: 'tenant-z' }).length, 0);
  assert.equal(store.getById('evt-1')?.event_id, 'evt-1');
  assert.equal(store.getById('missing'), undefined);
});

test('nim sqlite event store persists append-only rows and returns ordered query results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-event-store-'));
  const dbPath = join(dir, 'nim-events.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });

  const first = buildEvent({
    eventId: 'evt-1',
    tenantId: 'tenant-a',
    sessionId: 'session-a',
    runId: 'run-a',
    eventSeq: 1,
  });
  const second = buildEvent({
    eventId: 'evt-2',
    tenantId: 'tenant-a',
    sessionId: 'session-a',
    runId: 'run-b',
    eventSeq: 2,
  });

  const writer = new NimSqliteEventStore(dbPath);
  writer.append(first);
  writer.append(second);
  writer.close();

  const reader = new NimSqliteEventStore(dbPath);
  const tenantEvents = reader.list({ tenantId: 'tenant-a' });
  assert.equal(tenantEvents.length, 2);
  assert.equal(tenantEvents[0]?.event_id, 'evt-1');
  assert.equal(tenantEvents[1]?.event_id, 'evt-2');
  assert.equal(reader.list({ tenantId: 'tenant-a', runId: 'run-b' }).length, 1);
  assert.equal(reader.getById('evt-2')?.run_id, 'run-b');
  assert.equal(reader.getById('missing'), undefined);
  reader.close();
});

test('nim sqlite event store fails closed on newer schema versions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-event-store-'));
  const dbPath = join(dir, 'nim-events.sqlite');

  const store = new NimSqliteEventStore(dbPath);
  store.close();

  const require = createRequire(import.meta.url);
  const module = require('bun:sqlite') as {
    Database: new (path: string) => { exec: (sql: string) => void; close: () => void };
  };
  const db = new module.Database(dbPath);
  db.exec('PRAGMA user_version = 99;');
  db.close();

  assert.throws(() => new NimSqliteEventStore(dbPath), {
    message: 'nim event store schema version 99 is newer than supported version 1',
  });
});
