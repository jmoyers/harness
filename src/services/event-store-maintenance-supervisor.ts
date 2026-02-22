import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type {
  EventStoreMaintenanceDaemonMessage,
  EventStoreMaintenanceDaemonOptions,
} from '../storage/event-store-maintenance-daemon.ts';

export type { EventStoreMaintenanceDaemonMessage };

type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

interface EventStoreMaintenanceSupervisorOptions {
  readonly daemonScriptPath: string;
  readonly daemonOptions: Omit<EventStoreMaintenanceDaemonOptions, 'emitMessage'>;
  readonly onMessage: (message: EventStoreMaintenanceDaemonMessage) => void;
  readonly writeStderr: (text: string) => void;
  readonly forceKillAfterMs?: number;
  readonly spawnFn?: SpawnLike;
  readonly commandPath?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseMessageFromLine(line: string): EventStoreMaintenanceDaemonMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record = asRecord(parsed);
    if (record === null || typeof record.type !== 'string' || typeof record.ts !== 'string') {
      return null;
    }
    const type = record.type;
    if (type === 'daemon.started' && typeof record.maintenanceIntervalMs === 'number') {
      return {
        type,
        ts: record.ts,
        maintenanceIntervalMs: record.maintenanceIntervalMs,
      };
    }
    if (
      type === 'daemon.stopped' &&
      (record.reason === 'requested' || record.reason === 'parent-exit')
    ) {
      return {
        type,
        ts: record.ts,
        reason: record.reason,
      };
    }
    if (
      type === 'maintenance.started' &&
      typeof record.runId === 'number' &&
      typeof record.eligibleRows === 'number' &&
      typeof record.percentLeft === 'number'
    ) {
      return {
        type,
        ts: record.ts,
        runId: record.runId,
        eligibleRows: record.eligibleRows,
        percentLeft: record.percentLeft,
      };
    }
    if (
      type === 'maintenance.progress' &&
      typeof record.runId === 'number' &&
      typeof record.eligibleRows === 'number' &&
      typeof record.prunedRows === 'number' &&
      typeof record.remainingRows === 'number' &&
      typeof record.percentLeft === 'number'
    ) {
      return {
        type,
        ts: record.ts,
        runId: record.runId,
        eligibleRows: record.eligibleRows,
        prunedRows: record.prunedRows,
        remainingRows: record.remainingRows,
        percentLeft: record.percentLeft,
      };
    }
    if (
      type === 'maintenance.completed' &&
      typeof record.runId === 'number' &&
      typeof record.eligibleRows === 'number' &&
      typeof record.prunedRows === 'number' &&
      typeof record.remainingRows === 'number' &&
      typeof record.percentLeft === 'number' &&
      typeof record.durationMs === 'number'
    ) {
      return {
        type,
        ts: record.ts,
        runId: record.runId,
        eligibleRows: record.eligibleRows,
        prunedRows: record.prunedRows,
        remainingRows: record.remainingRows,
        percentLeft: record.percentLeft,
        durationMs: record.durationMs,
      };
    }
    if (
      type === 'maintenance.error' &&
      typeof record.runId === 'number' &&
      (record.phase === 'count' || record.phase === 'prune' || record.phase === 'compact') &&
      typeof record.message === 'string'
    ) {
      return {
        type,
        ts: record.ts,
        runId: record.runId,
        phase: record.phase,
        message: record.message,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function drainBufferLines(
  state: { buffer: string },
  chunk: string,
  onLine: (line: string) => void,
): void {
  state.buffer += chunk;
  while (true) {
    const newlineIndex = state.buffer.indexOf('\n');
    if (newlineIndex < 0) {
      break;
    }
    const line = state.buffer.slice(0, newlineIndex);
    state.buffer = state.buffer.slice(newlineIndex + 1);
    onLine(line);
  }
}

export class EventStoreMaintenanceSupervisor {
  private readonly spawnFn: SpawnLike;
  private readonly commandPath: string;
  private child: ChildProcess | null = null;
  private stopping = false;
  private forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  private stdoutState = { buffer: '' };
  private stderrState = { buffer: '' };

  constructor(private readonly options: EventStoreMaintenanceSupervisorOptions) {
    this.spawnFn = options.spawnFn ?? spawn;
    this.commandPath = options.commandPath ?? process.execPath;
  }

  start(): void {
    if (this.child !== null) {
      return;
    }
    const daemonArgv = [
      this.options.daemonScriptPath,
      '--store-path',
      this.options.daemonOptions.storePath,
      '--policy-json',
      JSON.stringify(this.options.daemonOptions.policy),
      '--parent-pid',
      String(process.pid),
    ];
    const child = this.spawnFn(this.commandPath, daemonArgv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;
    this.stopping = false;
    this.stdoutState.buffer = '';
    this.stderrState.buffer = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      drainBufferLines(this.stdoutState, text, (line) => {
        const message = parseMessageFromLine(line);
        if (message === null) {
          this.options.writeStderr(
            `[event-maintenance] ignoring malformed daemon message: ${line}\n`,
          );
          return;
        }
        this.options.onMessage(message);
      });
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      drainBufferLines(this.stderrState, text, (line) => {
        if (line.trim().length === 0) {
          return;
        }
        this.options.writeStderr(`[event-maintenance] ${line}\n`);
      });
    });

    child.on('exit', (code, signal) => {
      if (this.forceKillTimer !== null) {
        clearTimeout(this.forceKillTimer);
        this.forceKillTimer = null;
      }
      this.child = null;
      if (!this.stopping) {
        this.options.writeStderr(
          `[event-maintenance] daemon exited code=${String(code)} signal=${String(signal)}\n`,
        );
      }
      this.stopping = false;
    });
  }

  stop(): void {
    if (this.child === null) {
      return;
    }
    const child = this.child;
    this.stopping = true;
    try {
      child.kill('SIGTERM');
      const forceKillAfterMs = this.options.forceKillAfterMs ?? 1_500;
      this.forceKillTimer = setTimeout(() => {
        if (this.child !== child) {
          return;
        }
        try {
          child.kill('SIGKILL');
        } catch {
          // Best-effort force-kill only.
        }
      }, forceKillAfterMs);
      this.forceKillTimer.unref?.();
    } catch {
      // Best-effort stop only.
      this.stopping = false;
    }
  }
}
