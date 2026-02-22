import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createNormalizedEvent, type EventScope } from '../../../src/events/normalized-events.ts';
import {
  StorageLifecycleCore,
  type StorageLifecycleEventStore,
  type StorageLifecycleTelemetryStore,
} from '../../../src/storage/storage-lifecycle-core.ts';

function makeScope(overrides: Partial<EventScope> = {}): EventScope {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    worktreeId: 'worktree-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

function makeTextDeltaEvent(eventId: string, ts: string, delta: string) {
  return createNormalizedEvent(
    'provider',
    'provider-text-delta',
    makeScope(),
    {
      kind: 'text-delta',
      threadId: 'thread-1',
      turnId: 'turn-1',
      delta,
    },
    () => new Date(ts),
    () => eventId,
  );
}

test('storage lifecycle coalesces contiguous provider text deltas within policy window', () => {
  const core = new StorageLifecycleCore({
    policy: {
      textDeltaCoalesceWindowMs: 2000,
      textDeltaPayloadMaxBytes: 1024,
    },
  });

  const prepared = core.prepareEventBatch([
    makeTextDeltaEvent('evt-1', '2026-02-22T00:00:00.000Z', 'hello '),
    makeTextDeltaEvent('evt-2', '2026-02-22T00:00:00.500Z', 'world'),
    makeTextDeltaEvent('evt-3', '2026-02-22T00:00:01.000Z', '!'),
  ]);

  assert.equal(prepared.length, 1);
  const only = prepared[0]!;
  assert.equal(only.eventId, 'evt-1');
  assert.equal(only.ts, '2026-02-22T00:00:01.000Z');
  assert.equal(only.type, 'provider-text-delta');
  assert.equal(only.payload.kind, 'text-delta');
  assert.equal(only.payload.delta, 'hello world!');
});

test('storage lifecycle does not coalesce text deltas across scope mismatch or byte limits', () => {
  const core = new StorageLifecycleCore({
    policy: {
      textDeltaCoalesceWindowMs: 2000,
      textDeltaPayloadMaxBytes: 5,
    },
  });
  const crossConversation = createNormalizedEvent(
    'provider',
    'provider-text-delta',
    makeScope({
      conversationId: 'conversation-2',
    }),
    {
      kind: 'text-delta',
      threadId: 'thread-2',
      turnId: 'turn-1',
      delta: 'x',
    },
    () => new Date('2026-02-22T00:00:00.100Z'),
    () => 'evt-cross',
  );

  const prepared = core.prepareEventBatch([
    makeTextDeltaEvent('evt-1', '2026-02-22T00:00:00.000Z', 'abc'),
    makeTextDeltaEvent('evt-2', '2026-02-22T00:00:00.200Z', 'def'),
    crossConversation,
  ]);

  assert.equal(prepared.length, 3);
  assert.equal(prepared[0]?.eventId, 'evt-1');
  assert.equal(prepared[1]?.eventId, 'evt-2');
  assert.equal(prepared[2]?.eventId, 'evt-cross');
});

test('storage lifecycle truncates oversized telemetry payloads with metadata', () => {
  const core = new StorageLifecycleCore({
    policy: {
      telemetryPayloadMaxBytes: 512,
    },
  });
  const payload = {
    resource: {
      service: 'codex',
    },
    batch: {
      text: 'x'.repeat(10_000),
    },
  } satisfies Record<string, unknown>;

  const prepared = core.prepareTelemetryPayload(payload);
  const serializedPrepared = JSON.stringify(prepared);
  assert.equal(Buffer.byteLength(serializedPrepared, 'utf8') <= 512, true);
  const metadata = prepared['storageLifecycle'];
  assert.equal(typeof metadata, 'object');
  assert.notEqual(metadata, null);
  const metadataRecord = metadata as Record<string, unknown>;
  assert.equal(metadataRecord['truncated'], true);
  assert.equal(typeof metadataRecord['originalBytes'], 'number');
  assert.equal(metadataRecord['maxBytes'], 512);
  assert.equal(typeof metadataRecord['sha256'], 'string');
});

test('storage lifecycle maintenance tick prunes event and telemetry stores on interval', () => {
  const maintenanceCalls: string[] = [];
  const eventStore: StorageLifecycleEventStore = {
    pruneEventsOlderThan: (_cutoffTs, limit) => {
      maintenanceCalls.push(`event-prune:${String(limit)}`);
      return 4;
    },
    checkpointWal: () => {
      maintenanceCalls.push('event-checkpoint');
    },
    compactFreelistPages: (maxPages) => {
      maintenanceCalls.push(`event-compact:${String(maxPages)}`);
    },
  };
  const telemetryStore: StorageLifecycleTelemetryStore = {
    pruneTelemetryOlderThan: (_cutoff, limit) => {
      maintenanceCalls.push(`telemetry-prune:${String(limit)}`);
      return 2;
    },
    checkpointWal: () => {
      maintenanceCalls.push('telemetry-checkpoint');
    },
    compactFreelistPages: (maxPages) => {
      maintenanceCalls.push(`telemetry-compact:${String(maxPages)}`);
    },
  };

  let nowMs = Date.parse('2026-02-22T00:00:00.000Z');
  const core = new StorageLifecycleCore({
    eventStore,
    telemetryStore,
    nowMs: () => nowMs,
    policy: {
      maintenanceIntervalMs: 1000,
      pruneBatchSize: 50,
      compactFreelistPages: 8,
      eventRetentionMs: 1000,
      telemetryRetentionMs: 1000,
    },
  });

  const first = core.runMaintenanceTick();
  assert.deepEqual(first, {
    ran: true,
    eventsPruned: 4,
    telemetryPruned: 2,
  });

  const second = core.runMaintenanceTick();
  assert.deepEqual(second, {
    ran: false,
    eventsPruned: 0,
    telemetryPruned: 0,
  });

  nowMs += 1000;
  const third = core.runMaintenanceTick();
  assert.deepEqual(third, {
    ran: true,
    eventsPruned: 4,
    telemetryPruned: 2,
  });

  assert.deepEqual(maintenanceCalls, [
    'event-prune:50',
    'event-checkpoint',
    'telemetry-prune:50',
    'telemetry-checkpoint',
    'event-prune:50',
    'event-checkpoint',
    'telemetry-prune:50',
    'telemetry-checkpoint',
  ]);
});

test('storage lifecycle maintenance failures are isolated and reported', () => {
  const stderr: string[] = [];
  const core = new StorageLifecycleCore({
    eventStore: {
      pruneEventsOlderThan: () => {
        throw new Error('event-failure');
      },
      checkpointWal: () => {},
      compactFreelistPages: () => {},
    },
    telemetryStore: {
      pruneTelemetryOlderThan: () => {
        throw new Error('telemetry-failure');
      },
      checkpointWal: () => {},
      compactFreelistPages: () => {},
    },
    writeStderr: (text) => {
      stderr.push(text);
    },
  });

  const result = core.runMaintenanceTick();
  assert.deepEqual(result, {
    ran: true,
    eventsPruned: 0,
    telemetryPruned: 0,
  });
  assert.equal(
    stderr.some((entry) => entry.includes('event maintenance failed: event-failure')),
    true,
  );
  assert.equal(
    stderr.some((entry) => entry.includes('telemetry maintenance failed: telemetry-failure')),
    true,
  );
});

test('storage lifecycle checkpoints when online compaction finalizes even without prune deletes', () => {
  const calls: string[] = [];
  let eventCompactionCalls = 0;
  let telemetryCompactionCalls = 0;
  let nowMs = Date.parse('2026-02-22T00:00:00.000Z');
  const core = new StorageLifecycleCore({
    eventStore: {
      pruneEventsOlderThan: () => 0,
      checkpointWal: () => {
        calls.push('event-checkpoint');
      },
      compactFreelistPages: (maxPages) => {
        calls.push(`event-compact:${String(maxPages)}`);
      },
      runOnlineCopyForwardCompactionStep: () => {
        eventCompactionCalls += 1;
        return {
          state: eventCompactionCalls < 2 ? 'copying' : 'finalized',
          copiedRows: eventCompactionCalls < 2 ? 250 : 40,
        };
      },
    },
    telemetryStore: {
      pruneTelemetryOlderThan: () => 0,
      checkpointWal: () => {
        calls.push('telemetry-checkpoint');
      },
      compactFreelistPages: (maxPages) => {
        calls.push(`telemetry-compact:${String(maxPages)}`);
      },
      runOnlineCopyForwardCompactionStep: () => {
        telemetryCompactionCalls += 1;
        return {
          state: telemetryCompactionCalls < 2 ? 'copying' : 'finalized',
          copiedRows: telemetryCompactionCalls < 2 ? 120 : 15,
        };
      },
    },
    nowMs: () => nowMs,
    policy: {
      maintenanceIntervalMs: 1,
      compactFreelistPages: 11,
      pruneBatchSize: 10,
      eventRetentionMs: 1,
      telemetryRetentionMs: 1,
    },
  });

  const first = core.runMaintenanceTick();
  assert.deepEqual(first, {
    ran: true,
    eventsPruned: 0,
    telemetryPruned: 0,
  });
  assert.deepEqual(calls, []);

  nowMs += 1;
  const second = core.runMaintenanceTick();
  assert.deepEqual(second, {
    ran: true,
    eventsPruned: 0,
    telemetryPruned: 0,
  });
  assert.deepEqual(calls, [
    'event-checkpoint',
    'event-compact:11',
    'telemetry-checkpoint',
    'telemetry-compact:11',
  ]);
});

test('storage lifecycle updatePolicy merges with current values and reports interval changes', () => {
  const core = new StorageLifecycleCore({
    policy: {
      maintenanceIntervalMs: 4000,
      pruneBatchSize: 77,
      telemetryPayloadMaxBytes: 2048,
    },
  });

  const first = core.updatePolicy({
    maintenanceIntervalMs: 2000,
  });
  assert.equal(first.maintenanceIntervalChanged, true);
  assert.equal(first.previous.maintenanceIntervalMs, 4000);
  assert.equal(first.current.maintenanceIntervalMs, 2000);
  assert.equal(first.current.pruneBatchSize, 77);
  assert.equal(first.current.telemetryPayloadMaxBytes, 2048);
  assert.equal(core.policy().maintenanceIntervalMs, 2000);
  assert.equal(core.policy().pruneBatchSize, 77);

  const second = core.updatePolicy({
    telemetryPayloadMaxBytes: 4096,
  });
  assert.equal(second.maintenanceIntervalChanged, false);
  assert.equal(second.current.maintenanceIntervalMs, 2000);
  assert.equal(second.current.telemetryPayloadMaxBytes, 4096);
});

test('storage lifecycle updatePolicy accelerates next tick when interval shrinks', () => {
  let nowMs = Date.parse('2026-02-22T00:00:00.000Z');
  let pruneCalls = 0;
  const core = new StorageLifecycleCore({
    telemetryStore: {
      pruneTelemetryOlderThan: () => {
        pruneCalls += 1;
        return 0;
      },
      checkpointWal: () => {},
      compactFreelistPages: () => {},
    },
    nowMs: () => nowMs,
    policy: {
      maintenanceIntervalMs: 10_000,
      telemetryRetentionMs: 1,
      pruneBatchSize: 1,
    },
  });

  const first = core.runMaintenanceTick();
  assert.equal(first.ran, true);
  assert.equal(pruneCalls, 1);

  nowMs += 5000;
  const second = core.runMaintenanceTick();
  assert.equal(second.ran, false);
  assert.equal(pruneCalls, 1);

  core.updatePolicy({
    maintenanceIntervalMs: 1000,
  });
  nowMs += 1000;
  const third = core.runMaintenanceTick();
  assert.equal(third.ran, true);
  assert.equal(pruneCalls, 2);
});
