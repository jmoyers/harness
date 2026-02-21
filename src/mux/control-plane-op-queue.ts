export type ControlPlaneOpPriority = 'interactive' | 'background';

export type ControlPlaneOpSupersedeMode = 'none' | 'pending' | 'pending-and-running';

interface ControlPlaneOpTaskOptions {
  readonly signal: AbortSignal;
}

type ControlPlaneOpTask = (options: ControlPlaneOpTaskOptions) => Promise<void>;

export interface ControlPlaneOpEnqueueOptions {
  readonly key?: string;
  readonly supersede?: ControlPlaneOpSupersedeMode;
}

interface QueuedControlPlaneOp {
  readonly id: number;
  readonly priority: ControlPlaneOpPriority;
  readonly label: string;
  readonly enqueuedAtMs: number;
  readonly key: string | null;
  readonly supersede: ControlPlaneOpSupersedeMode;
  readonly controller: AbortController;
  readonly task: ControlPlaneOpTask;
}

interface ControlPlaneOpQueueMetrics {
  readonly interactiveQueued: number;
  readonly backgroundQueued: number;
  readonly running: boolean;
}

interface ControlPlaneOpQueueEvent {
  readonly id: number;
  readonly priority: ControlPlaneOpPriority;
  readonly label: string;
  readonly enqueuedAtMs: number;
}

interface ControlPlaneOpQueueStartEvent extends ControlPlaneOpQueueEvent {
  readonly waitMs: number;
}

interface ControlPlaneOpQueueOptions {
  readonly nowMs?: () => number;
  readonly schedule?: (callback: () => void) => void;
  readonly onEnqueued?: (
    event: ControlPlaneOpQueueEvent,
    metrics: ControlPlaneOpQueueMetrics,
  ) => void;
  readonly onStart?: (
    event: ControlPlaneOpQueueStartEvent,
    metrics: ControlPlaneOpQueueMetrics,
  ) => void;
  readonly onSuccess?: (
    event: ControlPlaneOpQueueStartEvent,
    metrics: ControlPlaneOpQueueMetrics,
  ) => void;
  readonly onError?: (
    event: ControlPlaneOpQueueStartEvent,
    metrics: ControlPlaneOpQueueMetrics,
    error: unknown,
  ) => void;
  readonly onCanceled?: (
    event: ControlPlaneOpQueueStartEvent,
    metrics: ControlPlaneOpQueueMetrics,
    reason: 'pre-start-abort' | 'running-abort',
  ) => void;
  readonly onFatal?: (error: unknown) => void;
}

function defaultSchedule(callback: () => void): void {
  setImmediate(callback);
}

export class ControlPlaneOpQueue {
  private readonly nowMs: () => number;
  private readonly schedule: (callback: () => void) => void;
  private readonly onEnqueued: ControlPlaneOpQueueOptions['onEnqueued'];
  private readonly onStart: ControlPlaneOpQueueOptions['onStart'];
  private readonly onSuccess: ControlPlaneOpQueueOptions['onSuccess'];
  private readonly onError: ControlPlaneOpQueueOptions['onError'];
  private readonly onCanceled: ControlPlaneOpQueueOptions['onCanceled'];
  private readonly onFatal: ControlPlaneOpQueueOptions['onFatal'];

  private readonly interactiveQueue: QueuedControlPlaneOp[] = [];
  private readonly backgroundQueue: QueuedControlPlaneOp[] = [];
  private readonly drainWaiters: Array<() => void> = [];
  private nextId = 1;
  private running = false;
  private pumpScheduled = false;
  private runningOp: QueuedControlPlaneOp | null = null;

  constructor(options: ControlPlaneOpQueueOptions = {}) {
    this.nowMs = options.nowMs ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.onEnqueued = options.onEnqueued;
    this.onStart = options.onStart;
    this.onSuccess = options.onSuccess;
    this.onError = options.onError;
    this.onCanceled = options.onCanceled;
    this.onFatal = options.onFatal;
  }

  enqueueInteractive(
    task: ControlPlaneOpTask,
    label = 'interactive-op',
    options: ControlPlaneOpEnqueueOptions = {},
  ): void {
    this.enqueue(task, 'interactive', label, options);
  }

  enqueueBackground(
    task: ControlPlaneOpTask,
    label = 'background-op',
    options: ControlPlaneOpEnqueueOptions = {},
  ): void {
    this.enqueue(task, 'background', label, options);
  }

  async waitForDrain(): Promise<void> {
    if (!this.running && this.interactiveQueue.length === 0 && this.backgroundQueue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  metrics(): {
    readonly interactiveQueued: number;
    readonly backgroundQueued: number;
    readonly running: boolean;
  } {
    return this.metricsSnapshot();
  }

  private enqueue(
    task: ControlPlaneOpTask,
    priority: ControlPlaneOpPriority,
    label: string,
    options: ControlPlaneOpEnqueueOptions,
  ): void {
    const key = options.key?.trim() ?? null;
    const supersede = options.supersede ?? 'none';
    if (key !== null && (supersede === 'pending' || supersede === 'pending-and-running')) {
      this.abortPendingByKey(key);
    }
    if (
      key !== null &&
      supersede === 'pending-and-running' &&
      this.runningOp !== null &&
      this.runningOp.key === key
    ) {
      this.runningOp.controller.abort();
    }

    const op: QueuedControlPlaneOp = {
      id: this.nextId,
      priority,
      label,
      enqueuedAtMs: this.nowMs(),
      key,
      supersede,
      controller: new AbortController(),
      task,
    };
    this.nextId += 1;

    if (priority === 'interactive') {
      this.interactiveQueue.push(op);
    } else {
      this.backgroundQueue.push(op);
    }

    this.onEnqueued?.(
      {
        id: op.id,
        priority: op.priority,
        label: op.label,
        enqueuedAtMs: op.enqueuedAtMs,
      },
      this.metricsSnapshot(),
    );
    this.schedulePump();
  }

  private abortPendingByKey(key: string): void {
    const filterPending = (queue: QueuedControlPlaneOp[]): QueuedControlPlaneOp[] => {
      const kept: QueuedControlPlaneOp[] = [];
      for (const entry of queue) {
        if (entry.key === key) {
          entry.controller.abort();
          continue;
        }
        kept.push(entry);
      }
      return kept;
    };
    const nextInteractive = filterPending(this.interactiveQueue);
    const nextBackground = filterPending(this.backgroundQueue);
    this.interactiveQueue.length = 0;
    this.backgroundQueue.length = 0;
    this.interactiveQueue.push(...nextInteractive);
    this.backgroundQueue.push(...nextBackground);
  }

  private metricsSnapshot(): ControlPlaneOpQueueMetrics {
    return {
      interactiveQueued: this.interactiveQueue.length,
      backgroundQueued: this.backgroundQueue.length,
      running: this.running,
    };
  }

  private resolveDrainIfIdle(): void {
    if (this.running || this.interactiveQueue.length > 0 || this.backgroundQueue.length > 0) {
      return;
    }
    while (this.drainWaiters.length > 0) {
      const resolve = this.drainWaiters.shift();
      resolve?.();
    }
  }

  private pickNext(): QueuedControlPlaneOp | null {
    const interactive = this.interactiveQueue.shift();
    if (interactive !== undefined) {
      return interactive;
    }
    const background = this.backgroundQueue.shift();
    return background ?? null;
  }

  private schedulePump(): void {
    if (this.pumpScheduled) {
      return;
    }
    this.pumpScheduled = true;
    this.schedule(() => {
      this.pumpScheduled = false;
      void this.runQueue().catch((error: unknown) => {
        this.onFatal?.(error);
      });
    });
  }

  private async runQueue(): Promise<void> {
    if (this.running) {
      return;
    }
    const next = this.pickNext();
    if (next === null) {
      this.resolveDrainIfIdle();
      return;
    }

    this.running = true;
    const waitMs = Math.max(0, this.nowMs() - next.enqueuedAtMs);
    const startEvent: ControlPlaneOpQueueStartEvent = {
      id: next.id,
      priority: next.priority,
      label: next.label,
      enqueuedAtMs: next.enqueuedAtMs,
      waitMs,
    };

    try {
      this.onStart?.(startEvent, this.metricsSnapshot());
      if (next.controller.signal.aborted) {
        this.onCanceled?.(startEvent, this.metricsSnapshot(), 'pre-start-abort');
        return;
      }
      this.runningOp = next;
      try {
        await next.task({
          signal: next.controller.signal,
        });
        if (next.controller.signal.aborted) {
          this.onCanceled?.(startEvent, this.metricsSnapshot(), 'running-abort');
          return;
        }
        this.onSuccess?.(startEvent, this.metricsSnapshot());
      } catch (error: unknown) {
        if (next.controller.signal.aborted) {
          this.onCanceled?.(startEvent, this.metricsSnapshot(), 'running-abort');
          return;
        }
        this.onError?.(startEvent, this.metricsSnapshot(), error);
      }
    } finally {
      this.runningOp = null;
      this.running = false;
      this.resolveDrainIfIdle();
      this.schedulePump();
    }
  }
}
