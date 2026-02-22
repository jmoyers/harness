import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqliteEventStore } from '../../src/store/event-store.ts';
import {
  StorageLifecycleCore,
  DEFAULT_STORAGE_LIFECYCLE_POLICY,
} from '../../src/storage/storage-lifecycle-core.ts';
import {
  createNormalizedEvent,
  type NormalizedEventEnvelope,
} from '../../src/events/normalized-events.ts';

const BACKLOG_EVENT_COUNT = 20_000;
const BACKLOG_TICK_ROUNDS = 40;
const STEADY_STATE_ROUNDS = 20;
const STEADY_STATE_EVENTS_PER_TICK = 50;
const BATCH_INSERT_SIZE = 200;

function makeScope() {
  return {
    tenantId: 'bench-tenant',
    userId: 'bench-user',
    workspaceId: 'bench-ws',
    worktreeId: 'bench-wt',
    conversationId: `conv-${randomUUID().slice(0, 8)}`,
    turnId: `turn-${randomUUID().slice(0, 8)}`,
  };
}

function makeEvent(
  scope: ReturnType<typeof makeScope>,
  ts: Date,
): NormalizedEventEnvelope {
  return createNormalizedEvent(
    'provider',
    'provider-text-delta',
    scope,
    {
      kind: 'text-delta',
      threadId: 'th-1',
      turnId: scope.turnId!,
      delta: 'x'.repeat(120),
    },
    () => ts,
  );
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function printSummary(label: string, durations: number[]): void {
  durations.sort((a, b) => a - b);
  console.log(`\n── ${label} ──`);
  console.log(`  ticks: ${durations.length}`);
  if (durations.length > 0) {
    console.log(`  min:   ${durations[0]!.toFixed(2)} ms`);
    console.log(`  p50:   ${percentile(durations, 50).toFixed(2)} ms`);
    console.log(`  p95:   ${percentile(durations, 95).toFixed(2)} ms`);
    console.log(`  p99:   ${percentile(durations, 99).toFixed(2)} ms`);
    console.log(`  max:   ${durations[durations.length - 1]!.toFixed(2)} ms`);
  }
}

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-bench-lifecycle-'));
  const dbPath = join(dir, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);

  const retentionMs = 60_000;
  let clockMs = Date.now();

  const lifecycle = new StorageLifecycleCore({
    eventStore: {
      pruneEventsOlderThan: (cutoffTs, limit) =>
        store.pruneEventsOlderThan(cutoffTs, limit),
      checkpointWal: (mode) => {
        store.checkpointWal(mode);
      },
      compactFreelistPages: (maxPages) => {
        store.compactFreelistPages(maxPages);
      },
      runOnlineCopyForwardCompactionStep: (batchSize, finalizeTailRows) =>
        store.runOnlineCopyForwardCompactionStep(batchSize, finalizeTailRows),
    },
    policy: {
      ...DEFAULT_STORAGE_LIFECYCLE_POLICY,
      eventRetentionMs: retentionMs,
      maintenanceIntervalMs: 1,
      pruneBatchSize: 2000,
      copyForwardBatchSize: 500,
      copyForwardFinalizeTailRows: 1200,
    },
    nowMs: () => clockMs,
  });

  // ── Phase 1: Backlog catchup ──
  console.log(`\n═══ Phase 1: Backlog Catchup (${BACKLOG_EVENT_COUNT} expired events) ═══\n`);
  const scope = makeScope();
  const populateStart = performance.now();
  for (let i = 0; i < BACKLOG_EVENT_COUNT; i += BATCH_INSERT_SIZE) {
    const batch: NormalizedEventEnvelope[] = [];
    const batchEnd = Math.min(i + BATCH_INSERT_SIZE, BACKLOG_EVENT_COUNT);
    for (let j = i; j < batchEnd; j++) {
      const ageMs = retentionMs + 1000 + (BACKLOG_EVENT_COUNT - j) * 10;
      batch.push(makeEvent(scope, new Date(clockMs - ageMs)));
    }
    store.appendEvents(batch);
  }
  console.log(`Populated in ${(performance.now() - populateStart).toFixed(1)} ms`);

  const backlogDurations: number[] = [];
  let totalPruned = 0;

  console.log(`\n  tick │ pruned │ duration (ms)`);
  console.log(`───────┼────────┼──────────────`);
  for (let i = 0; i < BACKLOG_TICK_ROUNDS; i++) {
    const t0 = performance.now();
    const result = lifecycle.runMaintenanceTick();
    const dt = performance.now() - t0;
    if (!result.ran) continue;
    backlogDurations.push(dt);
    totalPruned += result.eventsPruned;
    console.log(
      `  ${String(i + 1).padStart(5)} │ ${String(result.eventsPruned).padStart(6)} │ ${dt.toFixed(2).padStart(12)}`,
    );
    if (result.eventsPruned === 0 && dt < 0.5) break;
  }
  printSummary(`Backlog Summary (pruned ${totalPruned} total)`, backlogDurations);

  // ── Phase 2: Steady state ──
  console.log(
    `\n\n═══ Phase 2: Steady State (${STEADY_STATE_EVENTS_PER_TICK} events arrive between ticks) ═══\n`,
  );
  const steadyScope = makeScope();
  const steadyDurations: number[] = [];

  console.log(`  tick │ pruned │ duration (ms)`);
  console.log(`───────┼────────┼──────────────`);
  for (let i = 0; i < STEADY_STATE_ROUNDS; i++) {
    const batch: NormalizedEventEnvelope[] = [];
    for (let j = 0; j < STEADY_STATE_EVENTS_PER_TICK; j++) {
      const ageMs = retentionMs + 500 + j * 5;
      batch.push(makeEvent(steadyScope, new Date(clockMs - ageMs)));
    }
    store.appendEvents(batch);

    clockMs += 5000;

    const t0 = performance.now();
    const result = lifecycle.runMaintenanceTick();
    const dt = performance.now() - t0;
    if (!result.ran) continue;
    steadyDurations.push(dt);
    console.log(
      `  ${String(i + 1).padStart(5)} │ ${String(result.eventsPruned).padStart(6)} │ ${dt.toFixed(2).padStart(12)}`,
    );
  }
  printSummary('Steady State Summary', steadyDurations);

  // ── Phase 3: Idle (nothing to do) ──
  console.log(`\n\n═══ Phase 3: Idle (no expired events) ═══\n`);
  clockMs += 5000;
  const idleDurations: number[] = [];
  for (let i = 0; i < 20; i++) {
    clockMs += 5000;
    const t0 = performance.now();
    const result = lifecycle.runMaintenanceTick();
    const dt = performance.now() - t0;
    if (result.ran) idleDurations.push(dt);
  }
  printSummary('Idle Summary', idleDurations);

  console.log('\n');
  store.close();
  rmSync(dir, { recursive: true, force: true });
}

run();
