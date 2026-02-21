import { ControlPlaneOpQueue } from '../mux/control-plane-op-queue.ts';

type PerfAttrValue = boolean | number | string;
type PerfAttrs = Readonly<Record<string, PerfAttrValue>>;

interface RuntimeControlPlaneOpEvent {
  readonly id: number;
  readonly priority: 'interactive' | 'background';
  readonly label: string;
  readonly waitMs: number;
}

interface RuntimeControlPlaneOpsOptions {
  readonly onFatal: (error: unknown) => void;
  readonly startPerfSpan: (
    name: string,
    attrs?: PerfAttrs,
    parentSpanId?: string,
  ) => { end: (attrs?: PerfAttrs) => void };
  readonly recordPerfEvent: (name: string, attrs?: PerfAttrs) => void;
  readonly writeStderr: (text: string) => void;
  readonly nowMs?: () => number;
  readonly schedule?: (callback: () => void) => void;
}

export class RuntimeControlPlaneOps {
  private readonly opSpans = new Map<
    number,
    {
      end: (attrs?: PerfAttrs) => void;
    }
  >();

  private readonly queue: ControlPlaneOpQueue;

  constructor(private readonly options: RuntimeControlPlaneOpsOptions) {
    this.queue = new ControlPlaneOpQueue({
      ...(options.nowMs === undefined
        ? {}
        : {
            nowMs: options.nowMs,
          }),
      ...(options.schedule === undefined
        ? {}
        : {
            schedule: options.schedule,
          }),
      onFatal: (error: unknown) => {
        this.options.onFatal(error);
      },
      onEnqueued: (event, metrics) => {
        this.options.recordPerfEvent('mux.control-plane.op.enqueued', {
          id: event.id,
          label: event.label,
          priority: event.priority,
          interactiveQueued: metrics.interactiveQueued,
          backgroundQueued: metrics.backgroundQueued,
        });
      },
      onStart: (event, metrics) => {
        const opSpan = this.options.startPerfSpan('mux.control-plane.op', {
          id: event.id,
          label: event.label,
          priority: event.priority,
          waitMs: event.waitMs,
        });
        this.opSpans.set(event.id, opSpan);
        this.options.recordPerfEvent('mux.control-plane.op.start', {
          id: event.id,
          label: event.label,
          priority: event.priority,
          waitMs: event.waitMs,
          interactiveQueued: metrics.interactiveQueued,
          backgroundQueued: metrics.backgroundQueued,
        });
      },
      onSuccess: (event) => {
        this.endSpan(event, 'ok');
      },
      onError: (event, _metrics, error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.endSpan(event, 'error', message);
        this.options.writeStderr(`[mux] control-plane error ${message}\n`);
      },
      onCanceled: (event) => {
        this.endSpan(event, 'canceled');
      },
    });
  }

  enqueueInteractive(task: () => Promise<void>, label = 'interactive-op'): void {
    this.queue.enqueueInteractive(async () => {
      await task();
    }, label);
  }

  enqueueInteractiveLatest(
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label = 'interactive-op',
  ): void {
    this.queue.enqueueInteractive(task, label, {
      key,
      supersede: 'pending-and-running',
    });
  }

  enqueueBackgroundLatest(
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label = 'background-op',
  ): void {
    this.queue.enqueueBackground(task, label, {
      key,
      supersede: 'pending-and-running',
    });
  }

  enqueueBackground(task: () => Promise<void>, label = 'background-op'): void {
    this.queue.enqueueBackground(async () => {
      await task();
    }, label);
  }

  async waitForDrain(): Promise<void> {
    await this.queue.waitForDrain();
  }

  metrics(): {
    readonly interactiveQueued: number;
    readonly backgroundQueued: number;
    readonly running: boolean;
  } {
    return this.queue.metrics();
  }

  private endSpan(
    event: RuntimeControlPlaneOpEvent,
    status: 'ok' | 'error' | 'canceled',
    message?: string,
  ): void {
    const opSpan = this.opSpans.get(event.id);
    if (opSpan === undefined) {
      return;
    }
    opSpan.end({
      id: event.id,
      label: event.label,
      priority: event.priority,
      status,
      waitMs: event.waitMs,
      ...(message === undefined
        ? {}
        : {
            message,
          }),
    });
    this.opSpans.delete(event.id);
  }
}
