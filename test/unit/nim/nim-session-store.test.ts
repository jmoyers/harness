import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  InMemoryNimSessionStore,
  NimSqliteSessionStore,
  type NimPersistedSession,
} from '../../../packages/nim-core/src/index.ts';

function buildSession(sessionId: string): NimPersistedSession {
  return {
    sessionId,
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-5-haiku-latest',
    lane: `session:${sessionId}`,
    soulHash: 'soul:1',
    skillsSnapshotVersion: 1,
    eventSeq: 3,
    lastRunId: 'run-a',
    followups: [],
  };
}

test('nim in-memory session store persists sessions and idempotency mappings', () => {
  const store = new InMemoryNimSessionStore();
  const session = buildSession('session-a');
  store.upsertSession(session);
  store.upsertIdempotency(session.sessionId, 'idem-a', 'run-a');
  store.upsertIdempotency(session.sessionId, 'idem-a', 'run-b');

  const listed = store.listSessions('tenant-a', 'user-a');
  assert.equal(listed.length, 1);
  assert.deepEqual(store.getSession(session.sessionId), session);
  assert.equal(store.getRunIdByIdempotency(session.sessionId, 'idem-a'), 'run-a');
  assert.deepEqual(store.listIdempotency(session.sessionId), [
    {
      idempotencyKey: 'idem-a',
      runId: 'run-a',
    },
  ]);
});

test('nim sqlite session store persists and reloads sessions and idempotency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-session-store-'));
  const dbPath = join(dir, 'nim-sessions.sqlite');
  const session = buildSession('session-a');
  const writer = new NimSqliteSessionStore(dbPath);
  writer.upsertSession(session);
  writer.upsertIdempotency(session.sessionId, 'idem-a', 'run-a');
  writer.close();

  const reader = new NimSqliteSessionStore(dbPath);
  try {
    const listed = reader.listSessions('tenant-a', 'user-a');
    assert.equal(listed.length, 1);
    assert.deepEqual(reader.getSession(session.sessionId), session);
    assert.equal(reader.getRunIdByIdempotency(session.sessionId, 'idem-a'), 'run-a');
    assert.deepEqual(reader.listIdempotency(session.sessionId), [
      {
        idempotencyKey: 'idem-a',
        runId: 'run-a',
      },
    ]);
  } finally {
    reader.close();
  }
});

test('nim sqlite session store fails closed on newer schema versions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-session-store-'));
  const dbPath = join(dir, 'nim-sessions.sqlite');
  const store = new NimSqliteSessionStore(dbPath);
  store.close();

  const require = createRequire(import.meta.url);
  const module = require('bun:sqlite') as {
    Database: new (path: string) => {
      exec: (sql: string) => void;
      close: () => void;
    };
  };
  const db = new module.Database(dbPath);
  db.exec('PRAGMA user_version = 99;');
  db.close();

  assert.throws(() => new NimSqliteSessionStore(dbPath), {
    message: 'nim session store schema version 99 is newer than supported version 2',
  });
});

test('nim sqlite session store migrates v1 schema to include followups', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-session-store-'));
  const dbPath = join(dir, 'nim-sessions.sqlite');
  const require = createRequire(import.meta.url);
  const module = require('bun:sqlite') as {
    Database: new (path: string) => {
      exec: (sql: string) => void;
      close: () => void;
    };
  };
  const db = new module.Database(dbPath);
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS nim_session_idempotency (
      session_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      run_id TEXT NOT NULL,
      PRIMARY KEY (session_id, idempotency_key)
    );
  `);
  db.exec('PRAGMA user_version = 1;');
  db.close();

  const store = new NimSqliteSessionStore(dbPath);
  try {
    const session = buildSession('session-migrated');
    store.upsertSession(session);
    const loaded = store.getSession('session-migrated');
    assert.notEqual(loaded, undefined);
    assert.deepEqual(loaded?.followups, []);
  } finally {
    store.close();
  }
});
