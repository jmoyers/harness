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

const EVENT_COUNT = 20_000;
const BATCH_INSERT_SIZE = 500;
const STEADY_STATE_ROUNDS = 30;
const STEADY_STATE_EVENTS_PER_TICK = 50;

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
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function fmt(ms: number): string {
  return ms.toFixed(2).padStart(8);
}

interface ScenarioResult {
  backlogTicks: number;
  backlogDurations: number[];
  backlogTotalPruned: number;
  steadyDurations: number[];
  idleDurations: number[];
}

function runScenario(
  copyForwardBatchSize: number,
  pruneBatchSize: number,
): ScenarioResult {
  const dir = mkdtempSync(join(tmpdir(), 'harness-bench-lifecycle-'));
  const dbPath = join(dir, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  const retentionMs = 60_000;
  const intervalMs = 100;
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
      maintenanceIntervalMs: intervalMs,
      pruneBatchSize,
      copyForwardBatchSize,
      copyForwardFinalizeTailRows: Math.max(100, copyForwardBatchSize * 2),
    },
    nowMs: () => clockMs,
  });

  // Populate expired events
  const scope = makeScope();
  for (let i = 0; i < EVENT_COUNT; i += BATCH_INSERT_SIZE) {
    const batch: NormalizedEventEnvelope[] = [];
    const batchEnd = Math.min(i + BATCH_INSERT_SIZE, EVENT_COUNT);
    for (let j = i; j < batchEnd; j++) {
      const ageMs = retentionMs + 1000 + (EVENT_COUNT - j) * 10;
      batch.push(makeEvent(scope, new Date(clockMs - ageMs)));
    }
    store.appendEvents(batch);
  }

  // Phase 1: Drain full backlog (advance clock each iteration so tick always fires)
  const backlogDurations: number[] = [];
  let backlogPruned = 0;
  for (let i = 0; i < 500; i++) {
    clockMs += intervalMs;
    const t0 = performance.now();
    const result = lifecycle.runMaintenanceTick();
    const dt = performance.now() - t0;
    if (!result.ran) continue;
    backlogDurations.push(dt);
    backlogPruned += result.eventsPruned;
    if (result.eventsPruned === 0 && dt < 1) break;
  }

  // Phase 2: Steady state — add events between ticks
  const steadyScope = makeScope();
  const steadyDurations: number[] = [];
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
    if (result.ran) steadyDurations.push(dt);
  }

  // Phase 3: Idle
  const idleDurations: number[] = [];
  for (let i = 0; i < 30; i++) {
    clockMs += 5000;
    const t0 = performance.now();
    const result = lifecycle.runMaintenanceTick();
    const dt = performance.now() - t0;
    if (result.ran) idleDurations.push(dt);
  }

  store.close();
  rmSync(dir, { recursive: true, force: true });

  return {
    backlogTicks: backlogDurations.length,
    backlogDurations,
    backlogTotalPruned: backlogPruned,
    steadyDurations,
    idleDurations,
  };
}

function run() {
  const configs = [
    { copyForward: 500, prune: 2000, label: 'copy=500  prune=2000' },
    { copyForward: 500, prune: 500,  label: 'copy=500  prune=500 ' },
    { copyForward: 250, prune: 500,  label: 'copy=250  prune=500 ' },
    { copyForward: 250, prune: 250,  label: 'copy=250  prune=250 ' },
    { copyForward: 100, prune: 250,  label: 'copy=100  prune=250 ' },
    { copyForward: 100, prune: 100,  label: 'copy=100  prune=100 ' },
  ];

  // Warmup run (discard)
  process.stderr.write('Warmup…\n');
  runScenario(500, 2000);

  const results: Array<{
    label: string;
    r: ScenarioResult;
  }> = [];

  for (const config of configs) {
    process.stderr.write(`Running: ${config.label}…\n`);
    const r = runScenario(config.copyForward, config.prune);
    results.push({ label: config.label, r });
  }

  console.log(`\n${'═'.repeat(105)}`);
  console.log(`  Maintenance Tick Duration vs Batch Size (${EVENT_COUNT} expired events, ${STEADY_STATE_EVENTS_PER_TICK} events/tick steady state)`);
  console.log(`${'═'.repeat(105)}\n`);

  console.log(`  ┌─ BACKLOG DRAIN ${'─'.repeat(87)}`);
  console.log(
    `  │ ${'config'.padEnd(22)} │ ${'ticks'.padStart(6)} │ ${'p50 ms'.padStart(8)} │ ${'p95 ms'.padStart(8)} │ ${'max ms'.padStart(8)} │ ${'wall ms'.padStart(9)} │ ${'pruned'.padStart(8)} │`,
  );
  console.log(
    `  │${'─'.repeat(23)}┼${'─'.repeat(8)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(11)}┼${'─'.repeat(10)}│`,
  );
  for (const { label, r } of results) {
    const d = [...r.backlogDurations].sort((a, b) => a - b);
    const total = d.reduce((s, v) => s + v, 0);
    console.log(
      `  │ ${label.padEnd(22)}│ ${String(d.length).padStart(6)} │ ${fmt(percentile(d, 50))} │ ${fmt(percentile(d, 95))} │ ${fmt(d[d.length - 1] ?? 0)} │ ${fmt(total).padStart(9)} │ ${String(r.backlogTotalPruned).padStart(8)} │`,
    );
  }
  console.log(`  └${'─'.repeat(103)}\n`);

  console.log(`  ┌─ STEADY STATE (${STEADY_STATE_EVENTS_PER_TICK} events added between each 5 s tick) ${'─'.repeat(47)}`);
  console.log(
    `  │ ${'config'.padEnd(22)} │ ${'p50 ms'.padStart(8)} │ ${'p95 ms'.padStart(8)} │ ${'max ms'.padStart(8)} │`,
  );
  console.log(`  │${'─'.repeat(23)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}│`);
  for (const { label, r } of results) {
    const d = [...r.steadyDurations].sort((a, b) => a - b);
    console.log(
      `  │ ${label.padEnd(22)}│ ${fmt(percentile(d, 50))} │ ${fmt(percentile(d, 95))} │ ${fmt(d[d.length - 1] ?? 0)} │`,
    );
  }
  console.log(`  └${'─'.repeat(54)}\n`);

  console.log(`  ┌─ IDLE ${'─'.repeat(45)}`);
  console.log(
    `  │ ${'config'.padEnd(22)} │ ${'p50 ms'.padStart(8)} │ ${'max ms'.padStart(8)} │`,
  );
  console.log(`  │${'─'.repeat(23)}┼${'─'.repeat(10)}┼${'─'.repeat(10)}│`);
  for (const { label, r } of results) {
    const d = [...r.idleDurations].sort((a, b) => a - b);
    console.log(
      `  │ ${label.padEnd(22)}│ ${fmt(percentile(d, 50))} │ ${fmt(d[d.length - 1] ?? 0)} │`,
    );
  }
  console.log(`  └${'─'.repeat(44)}\n`);
}

run();
