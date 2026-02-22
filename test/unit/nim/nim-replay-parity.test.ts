import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  InMemoryNimRuntime,
  NimJsonlTelemetrySink,
  NimSqliteEventStore,
  readNimJsonlTelemetry,
} from '../../../packages/nim-core/src/index.ts';

test('nim replay parity stays 1:1 across replay api sqlite store and jsonl telemetry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-replay-parity-'));
  const eventDbPath = join(dir, 'nim-events.sqlite');
  const telemetryPath = join(dir, 'nim-events.jsonl');

  const eventStore = new NimSqliteEventStore(eventDbPath);
  try {
    const runtime = new InMemoryNimRuntime({
      eventStore,
      telemetrySinks: [new NimJsonlTelemetrySink({ filePath: telemetryPath })],
    });
    runtime.registerProvider({
      id: 'anthropic',
      displayName: 'Anthropic',
      models: ['anthropic/claude-3-5-haiku-latest'],
    });
    runtime.registerTools([
      {
        name: 'mock-tool',
        description: 'mock',
      },
    ]);
    runtime.setToolPolicy({
      hash: 'policy-test',
      allow: ['mock-tool'],
      deny: [],
    });

    const session = await runtime.startSession({
      tenantId: 'tenant-a',
      userId: 'user-a',
      model: 'anthropic/claude-3-5-haiku-latest',
    });
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'use-tool mock-tool',
      idempotencyKey: 'idem-replay-parity',
    });
    await turn.done;

    const replay = await runtime.replayEvents({
      tenantId: 'tenant-a',
      sessionId: session.sessionId,
      includeThoughtDeltas: true,
      includeToolArgumentDeltas: true,
    });
    const stored = eventStore.list({
      tenantId: 'tenant-a',
      sessionId: session.sessionId,
    });
    const logged = readNimJsonlTelemetry(telemetryPath).filter(
      (event) => event.tenant_id === 'tenant-a' && event.session_id === session.sessionId,
    );

    assert.equal(replay.events.length > 0, true);
    assert.equal(stored.length, replay.events.length);
    assert.equal(logged.length, replay.events.length);
    const replayIds = replay.events.map((event) => event.event_id);
    assert.deepEqual(
      stored.map((event) => event.event_id),
      replayIds,
    );
    assert.deepEqual(
      logged.map((event) => event.event_id),
      replayIds,
    );
  } finally {
    eventStore.close();
  }
});
