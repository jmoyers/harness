import type { NormalizedEventEnvelope } from '../events/normalized-events.ts';

type PerfAttrs = Record<string, boolean | number | string>;

type FlushReason = 'timer' | 'immediate' | 'shutdown';

interface PerfSpanLike {
  end(attrs: PerfAttrs): void;
}

type StartPerfSpanLike = (name: string, attrs: PerfAttrs) => PerfSpanLike;

interface EventPersistenceOptions {
  readonly appendEvents: (events: readonly NormalizedEventEnvelope[]) => void;
  readonly startPerfSpan: StartPerfSpanLike;
  readonly writeStderr: (text: string) => void;
  readonly flushDelayMs?: number;
  readonly flushMaxBatch?: number;
  readonly setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_FLUSH_DELAY_MS = 12;
const DEFAULT_FLUSH_MAX_BATCH = 64;

function shouldPersistEvent(event: NormalizedEventEnvelope): boolean {
  return !(event.source === 'provider' && event.type === 'provider-text-delta');
}

export class EventPersistence {
  private readonly flushDelayMs: number;
  private readonly flushMaxBatch: number;
  private readonly setTimeoutFn: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void;
  private pendingEvents: NormalizedEventEnvelope[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: EventPersistenceOptions) {
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.flushMaxBatch = options.flushMaxBatch ?? DEFAULT_FLUSH_MAX_BATCH;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  pendingCount(): number {
    return this.pendingEvents.length;
  }

  enqueue(event: NormalizedEventEnvelope): void {
    if (!shouldPersistEvent(event)) {
      return;
    }
    this.pendingEvents.push(event);
    if (this.pendingEvents.length >= this.flushMaxBatch) {
      this.flush('immediate');
      return;
    }
    this.scheduleFlush();
  }

  flush(reason: FlushReason): void {
    this.clearScheduledFlush();
    if (this.pendingEvents.length === 0) {
      return;
    }
    const batch = this.pendingEvents;
    this.pendingEvents = [];
    const flushSpan = this.options.startPerfSpan('mux.events.flush', {
      reason,
      count: batch.length,
    });
    try {
      this.options.appendEvents(batch);
      flushSpan.end({
        reason,
        status: 'ok',
        count: batch.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      flushSpan.end({
        reason,
        status: 'error',
        count: batch.length,
        message,
      });
      this.options.writeStderr(`[mux] event-store error ${message}\n`);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = this.setTimeoutFn(() => {
      this.flushTimer = null;
      this.flush('timer');
    }, this.flushDelayMs);
  }

  private clearScheduledFlush(): void {
    if (this.flushTimer === null) {
      return;
    }
    this.clearTimeoutFn(this.flushTimer);
    this.flushTimer = null;
  }
}
