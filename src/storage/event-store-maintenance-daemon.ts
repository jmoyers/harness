import { SqliteEventStore } from '../store/event-store.ts';
import { StorageLifecycleCore, type StorageLifecyclePolicy } from './storage-lifecycle-core.ts';

type DaemonMessageType =
  | 'daemon.started'
  | 'daemon.stopped'
  | 'maintenance.started'
  | 'maintenance.progress'
  | 'maintenance.completed'
  | 'maintenance.error';

interface DaemonMessageBase {
  readonly type: DaemonMessageType;
  readonly ts: string;
}

export interface EventStoreMaintenanceDaemonStartedMessage extends DaemonMessageBase {
  readonly type: 'daemon.started';
  readonly maintenanceIntervalMs: number;
}

export interface EventStoreMaintenanceDaemonStoppedMessage extends DaemonMessageBase {
  readonly type: 'daemon.stopped';
  readonly reason: 'requested' | 'parent-exit';
}

export interface EventStoreMaintenanceStartedMessage extends DaemonMessageBase {
  readonly type: 'maintenance.started';
  readonly runId: number;
  readonly eligibleRows: number;
  readonly percentLeft: number;
}

export interface EventStoreMaintenanceProgressMessage extends DaemonMessageBase {
  readonly type: 'maintenance.progress';
  readonly runId: number;
  readonly eligibleRows: number;
  readonly prunedRows: number;
  readonly remainingRows: number;
  readonly percentLeft: number;
}

export interface EventStoreMaintenanceCompletedMessage extends DaemonMessageBase {
  readonly type: 'maintenance.completed';
  readonly runId: number;
  readonly eligibleRows: number;
  readonly prunedRows: number;
  readonly remainingRows: number;
  readonly percentLeft: number;
  readonly durationMs: number;
}

export interface EventStoreMaintenanceErrorMessage extends DaemonMessageBase {
  readonly type: 'maintenance.error';
  readonly runId: number;
  readonly phase: 'count' | 'prune' | 'compact';
  readonly message: string;
}

export type EventStoreMaintenanceDaemonMessage =
  | EventStoreMaintenanceDaemonStartedMessage
  | EventStoreMaintenanceDaemonStoppedMessage
  | EventStoreMaintenanceStartedMessage
  | EventStoreMaintenanceProgressMessage
  | EventStoreMaintenanceCompletedMessage
  | EventStoreMaintenanceErrorMessage;

export interface EventStoreMaintenanceDaemonOptions {
  readonly storePath: string;
  readonly policy: Partial<StorageLifecyclePolicy>;
  readonly emitMessage: (message: EventStoreMaintenanceDaemonMessage) => void;
  readonly parentPid?: number;
  readonly parentCheckIntervalMs?: number;
  readonly nowMs?: () => number;
  readonly setIntervalFn?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}

export interface EventStoreMaintenanceDaemonHandle {
  stop(): void;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function roundPercentLeft(remainingRows: number, totalRows: number): number {
  if (totalRows <= 0) {
    return 0;
  }
  const percent = (remainingRows / totalRows) * 100;
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EPERM means the process exists but is not signalable by this user.
      return code === 'EPERM';
    }
    return false;
  }
}

export function startEventStoreMaintenanceDaemon(
  options: EventStoreMaintenanceDaemonOptions,
): EventStoreMaintenanceDaemonHandle {
  const nowMs = options.nowMs ?? Date.now;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const normalizedPolicy = new StorageLifecycleCore({
    policy: options.policy,
  }).policy();
  const store = new SqliteEventStore(options.storePath);

  let stopped = false;
  let runId = 0;
  let tickInFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let parentWatchTimer: ReturnType<typeof setInterval> | null = null;

  const emit = (message: EventStoreMaintenanceDaemonMessage): void => {
    options.emitMessage(message);
  };

  const stop = (reason: 'requested' | 'parent-exit'): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    if (parentWatchTimer !== null) {
      clearIntervalFn(parentWatchTimer);
      parentWatchTimer = null;
    }
    try {
      store.close();
    } catch {
      // Best-effort close only.
    }
    emit({
      type: 'daemon.stopped',
      reason,
      ts: new Date(nowMs()).toISOString(),
    });
  };

  const runTick = (): void => {
    if (stopped || tickInFlight) {
      return;
    }
    tickInFlight = true;
    runId += 1;
    const currentRunId = runId;
    const startedAtMs = nowMs();
    const cutoff = new Date(startedAtMs - normalizedPolicy.eventRetentionMs).toISOString();

    let eligibleRows = 0;
    try {
      eligibleRows = store.countEventsOlderThan(cutoff);
    } catch (error: unknown) {
      emit({
        type: 'maintenance.error',
        runId: currentRunId,
        phase: 'count',
        message: asErrorMessage(error),
        ts: new Date(nowMs()).toISOString(),
      });
      tickInFlight = false;
      return;
    }

    emit({
      type: 'maintenance.started',
      runId: currentRunId,
      eligibleRows,
      percentLeft: roundPercentLeft(eligibleRows, eligibleRows),
      ts: new Date(nowMs()).toISOString(),
    });

    let prunedRows = 0;
    let remainingRows = eligibleRows;
    try {
      prunedRows = store.pruneEventsOlderThan(cutoff, normalizedPolicy.pruneBatchSize);
      remainingRows = Math.max(0, eligibleRows - prunedRows);
      emit({
        type: 'maintenance.progress',
        runId: currentRunId,
        eligibleRows,
        prunedRows,
        remainingRows,
        percentLeft: roundPercentLeft(remainingRows, eligibleRows),
        ts: new Date(nowMs()).toISOString(),
      });
    } catch (error: unknown) {
      emit({
        type: 'maintenance.error',
        runId: currentRunId,
        phase: 'prune',
        message: asErrorMessage(error),
        ts: new Date(nowMs()).toISOString(),
      });
      tickInFlight = false;
      return;
    }

    try {
      const compaction = store.runOnlineCopyForwardCompactionStep(
        normalizedPolicy.copyForwardBatchSize,
        normalizedPolicy.copyForwardFinalizeTailRows,
      );
      if (prunedRows > 0 || compaction.state === 'finalized') {
        store.checkpointWal();
      }
      if (compaction.state === 'finalized') {
        store.compactFreelistPages(normalizedPolicy.compactFreelistPages);
      }
    } catch (error: unknown) {
      emit({
        type: 'maintenance.error',
        runId: currentRunId,
        phase: 'compact',
        message: asErrorMessage(error),
        ts: new Date(nowMs()).toISOString(),
      });
      tickInFlight = false;
      return;
    }

    emit({
      type: 'maintenance.completed',
      runId: currentRunId,
      eligibleRows,
      prunedRows,
      remainingRows,
      percentLeft: roundPercentLeft(remainingRows, eligibleRows),
      durationMs: Math.max(0, nowMs() - startedAtMs),
      ts: new Date(nowMs()).toISOString(),
    });
    tickInFlight = false;
  };

  emit({
    type: 'daemon.started',
    maintenanceIntervalMs: normalizedPolicy.maintenanceIntervalMs,
    ts: new Date(nowMs()).toISOString(),
  });
  runTick();
  timer = setIntervalFn(runTick, normalizedPolicy.maintenanceIntervalMs);
  timer.unref?.();
  if (options.parentPid !== undefined) {
    const parentPid = options.parentPid;
    const parentCheckIntervalMs = options.parentCheckIntervalMs ?? 2_000;
    parentWatchTimer = setIntervalFn(() => {
      if (!isProcessAlive(parentPid)) {
        stop('parent-exit');
      }
    }, parentCheckIntervalMs);
    parentWatchTimer.unref?.();
  }

  return {
    stop: () => {
      stop('requested');
    },
  };
}
