import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { createNormalizedEvent } from '../../../src/events/normalized-events.ts';
import {
  startEventStoreMaintenanceDaemon,
  type EventStoreMaintenanceDaemonMessage,
} from '../../../src/storage/event-store-maintenance-daemon.ts';
import { SqliteEventStore } from '../../../src/store/event-store.ts';

void test('event-store maintenance daemon emits lifecycle and progress messages', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-maintenance-daemon-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  try {
    store.appendEvents([
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          worktreeId: 'worktree-1',
          conversationId: 'conversation-1',
        },
        {
          kind: 'thread',
          threadId: 'thread-1',
        },
        () => new Date('2026-01-01T00:00:00.000Z'),
        () => 'old-event-1',
      ),
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          worktreeId: 'worktree-1',
          conversationId: 'conversation-1',
        },
        {
          kind: 'thread',
          threadId: 'thread-2',
        },
        () => new Date('2026-01-01T00:00:01.000Z'),
        () => 'old-event-2',
      ),
    ]);
  } finally {
    store.close();
  }

  const messages: EventStoreMaintenanceDaemonMessage[] = [];
  const daemon = startEventStoreMaintenanceDaemon({
    storePath: dbPath,
    policy: {
      eventRetentionMs: 1,
      maintenanceIntervalMs: 60_000,
      pruneBatchSize: 10,
    },
    emitMessage: (message) => {
      messages.push(message);
    },
  });
  daemon.stop();

  const daemonStarted = messages.find((message) => message.type === 'daemon.started');
  assert.ok(daemonStarted !== undefined);
  const maintenanceStarted = messages.find((message) => message.type === 'maintenance.started');
  assert.ok(maintenanceStarted !== undefined);
  assert.ok(maintenanceStarted.type === 'maintenance.started');
  assert.ok(maintenanceStarted.eligibleRows >= 2);
  const maintenanceProgress = messages.find((message) => message.type === 'maintenance.progress');
  assert.ok(maintenanceProgress !== undefined);
  assert.ok(maintenanceProgress.type === 'maintenance.progress');
  assert.ok(maintenanceProgress.prunedRows >= 1);
  const maintenanceCompleted = messages.find((message) => message.type === 'maintenance.completed');
  assert.ok(maintenanceCompleted !== undefined);
  assert.ok(maintenanceCompleted.type === 'maintenance.completed');
  assert.equal(maintenanceCompleted.remainingRows, 0);
  assert.equal(maintenanceCompleted.percentLeft, 0);
  const daemonStopped = messages.find((message) => message.type === 'daemon.stopped');
  assert.ok(daemonStopped !== undefined);

  rmSync(dirPath, { recursive: true, force: true });
});

void test('event-store maintenance daemon stops when parent process is not alive', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-event-maintenance-daemon-parent-exit-'));
  const dbPath = join(dirPath, 'events.sqlite');
  const store = new SqliteEventStore(dbPath);
  store.close();

  const intervalCallbacks: Array<() => void> = [];
  const createdTimers: Array<ReturnType<typeof setInterval>> = [];
  const clearedTimers = new Set<ReturnType<typeof setInterval>>();
  const messages: EventStoreMaintenanceDaemonMessage[] = [];
  const daemon = startEventStoreMaintenanceDaemon({
    storePath: dbPath,
    policy: {
      maintenanceIntervalMs: 60_000,
      eventRetentionMs: 1,
      pruneBatchSize: 10,
    },
    parentPid: 999_999_999,
    setIntervalFn: (callback) => {
      intervalCallbacks.push(callback);
      const timer = setInterval(() => {}, 60_000);
      clearInterval(timer);
      createdTimers.push(timer);
      return timer;
    },
    clearIntervalFn: (timer) => {
      clearedTimers.add(timer);
    },
    emitMessage: (message) => {
      messages.push(message);
    },
  });

  assert.equal(intervalCallbacks.length, 2);
  intervalCallbacks[1]!();
  daemon.stop();

  const daemonStopped = messages.filter((message) => message.type === 'daemon.stopped');
  assert.equal(daemonStopped.length, 1);
  assert.equal(daemonStopped[0]?.reason, 'parent-exit');
  assert.equal(createdTimers.length, 2);
  assert.equal(clearedTimers.has(createdTimers[0]!), true);
  assert.equal(clearedTimers.has(createdTimers[1]!), true);

  rmSync(dirPath, { recursive: true, force: true });
});
