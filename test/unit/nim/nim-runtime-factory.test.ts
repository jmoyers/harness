import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  createSqliteBackedNimRuntime,
  readNimJsonlTelemetry,
  type InMemoryNimRuntime,
} from '../../../packages/nim-core/src/index.ts';

function registerDefaults(runtime: InMemoryNimRuntime): void {
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
}

test('nim runtime factory composes sqlite-backed runtime with restart continuation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-runtime-factory-'));
  const eventStorePath = join(dir, 'events.sqlite');
  const sessionStorePath = join(dir, 'sessions.sqlite');
  const telemetryPath = join(dir, 'events.jsonl');

  const first = createSqliteBackedNimRuntime({
    eventStorePath,
    sessionStorePath,
    telemetry: {
      filePath: telemetryPath,
      mode: 'truncate',
    },
  });
  registerDefaults(first.runtime);
  const session = await first.runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-5-haiku-latest',
  });
  const turn = await first.runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool mock-tool',
    idempotencyKey: 'idem-runtime-factory-a',
  });
  await turn.done;
  first.close();

  const second = createSqliteBackedNimRuntime({
    eventStorePath,
    sessionStorePath,
    telemetry: {
      filePath: telemetryPath,
      mode: 'append',
    },
  });
  try {
    registerDefaults(second.runtime);
    const listed = await second.runtime.listSessions({
      tenantId: 'tenant-a',
      userId: 'user-a',
    });
    assert.equal(
      listed.sessions.some((item) => item.sessionId === session.sessionId),
      true,
    );

    const resumed = await second.runtime.resumeSession({
      tenantId: 'tenant-a',
      userId: 'user-a',
      sessionId: session.sessionId,
    });
    assert.equal(resumed.sessionId, session.sessionId);

    const reused = await second.runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'use-tool mock-tool',
      idempotencyKey: 'idem-runtime-factory-a',
    });
    assert.equal(reused.runId, turn.runId);
    await reused.done;
  } finally {
    second.close();
  }

  const telemetryRows = readNimJsonlTelemetry(telemetryPath);
  assert.equal(telemetryRows.length > 0, true);
});
