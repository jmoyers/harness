import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'bun:test';
import {
  NimJsonlTelemetrySink,
  readNimJsonlTelemetry,
  type NimEventEnvelope,
} from '../packages/nim-core/src/index.ts';

function fixtureEvent(eventId: string, eventSeq: number): NimEventEnvelope {
  return {
    event_id: eventId,
    event_seq: eventSeq,
    ts: '2026-02-20T00:00:00.000Z',
    tenant_id: 'tenant-a',
    user_id: 'user-a',
    workspace_id: 'workspace-a',
    session_id: 'session-a',
    run_id: 'run-a',
    turn_id: 'turn-a',
    step_id: `step:${eventSeq}`,
    source: 'system',
    type: 'turn.completed',
    payload_hash: `hash:${eventSeq}`,
    idempotency_key: `idem:${eventSeq}`,
    lane: 'session:session-a',
    policy_hash: 'policy-a',
    trace_id: 'trace-a',
    span_id: `span:${eventSeq}`,
  };
}

test('nim jsonl telemetry sink truncates by default and records canonical event lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'nim-telemetry-'));
  const filePath = join(root, 'logs', 'events.jsonl');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, 'stale\n', 'utf8');

  const sink = new NimJsonlTelemetrySink({ filePath });
  const event = fixtureEvent('event-1', 1);
  sink.record(event);

  const rows = readNimJsonlTelemetry(filePath);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], event);
});

test('nim jsonl telemetry sink append mode preserves existing log rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'nim-telemetry-'));
  const filePath = join(root, 'logs', 'events.jsonl');
  mkdirSync(dirname(filePath), { recursive: true });
  const existing = fixtureEvent('event-1', 1);
  writeFileSync(filePath, `${JSON.stringify(existing)}\n`, 'utf8');

  const sink = new NimJsonlTelemetrySink({
    filePath,
    mode: 'append',
  });
  const appended = fixtureEvent('event-2', 2);
  sink.record(appended);

  const rows = readNimJsonlTelemetry(filePath);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], existing);
  assert.deepEqual(rows[1], appended);
});

test('nim jsonl telemetry reader rejects invalid json rows with line number', () => {
  const root = mkdtempSync(join(tmpdir(), 'nim-telemetry-'));
  const filePath = join(root, 'logs', 'events.jsonl');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '{"event_id":"a"}\nnot-json\n', 'utf8');

  assert.throws(() => readNimJsonlTelemetry(filePath), {
    message: 'invalid Nim telemetry event envelope at line 1',
  });

  writeFileSync(filePath, `${JSON.stringify(fixtureEvent('event-1', 1))}\nnot-json\n`, 'utf8');
  assert.throws(() => readNimJsonlTelemetry(filePath), {
    message: 'invalid Nim telemetry JSONL at line 2',
  });
});
