import { ControlPlaneOpQueue } from '../mux/control-plane-op-queue.ts';

type PerfAttrValue = boolean | number | string;
type PerfAttrs = Readonly<Record<string, PerfAttrValue>>;

interface RuntimeControlPlaneOpEvent {
  readonly id: number;
  readonly priority: 'interactive' | 'background';
  readonly label: string;
  readonly waitMs: number;
}

export interface RuntimeControlPlaneOpsOptions {
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

export interface RuntimeControlPlaneOps {
  enqueueInteractive(task: () => Promise<void>, label?: string): void;
  enqueueInteractiveLatest(
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label?: string,
  ): void;
  enqueueBackgroundLatest(
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label?: string,
  ): void;
  enqueueBackground(task: () => Promise<void>, label?: string): void;
  waitForDrain(): Promise<void>;
  metrics(): {
    readonly interactiveQueued: number;
    readonly backgroundQueued: number;
    readonly running: boolean;
  };
}

export function createRuntimeControlPlaneOps(
  options: RuntimeControlPlaneOpsOptions,
): RuntimeControlPlaneOps {
  const opSpans = new Map<
    number,
    {
      end: (attrs?: PerfAttrs) => void;
    }
  >();

  const endSpan = (
    event: RuntimeControlPlaneOpEvent,
    status: 'ok' | 'error' | 'canceled',
    message?: string,
  ): void => {
    const opSpan = opSpans.get(event.id);
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
    opSpans.delete(event.id);
  };

  const queue = new ControlPlaneOpQueue({
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
      options.onFatal(error);
    },
    onEnqueued: (event, metrics) => {
      options.recordPerfEvent('mux.control-plane.op.enqueued', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        interactiveQueued: metrics.interactiveQueued,
        backgroundQueued: metrics.backgroundQueued,
      });
    },
    onStart: (event, metrics) => {
      const opSpan = options.startPerfSpan('mux.control-plane.op', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        waitMs: event.waitMs,
      });
      opSpans.set(event.id, opSpan);
      options.recordPerfEvent('mux.control-plane.op.start', {
        id: event.id,
        label: event.label,
        priority: event.priority,
        waitMs: event.waitMs,
        interactiveQueued: metrics.interactiveQueued,
        backgroundQueued: metrics.backgroundQueued,
      });
    },
    onSuccess: (event) => {
      endSpan(event, 'ok');
    },
    onError: (event, _metrics, error) => {
      const message = error instanceof Error ? error.message : String(error);
      endSpan(event, 'error', message);
      options.writeStderr(`[mux] control-plane error ${message}\n`);
    },
    onCanceled: (event) => {
      endSpan(event, 'canceled');
    },
  });

  return {
    enqueueInteractive: (task: () => Promise<void>, label = 'interactive-op'): void => {
      queue.enqueueInteractive(async () => {
        await task();
      }, label);
    },
    enqueueInteractiveLatest: (
      key: string,
      task: (options: { readonly signal: AbortSignal }) => Promise<void>,
      label = 'interactive-op',
    ): void => {
      queue.enqueueInteractive(task, label, {
        key,
        supersede: 'pending-and-running',
      });
    },
    enqueueBackgroundLatest: (
      key: string,
      task: (options: { readonly signal: AbortSignal }) => Promise<void>,
      label = 'background-op',
    ): void => {
      queue.enqueueBackground(task, label, {
        key,
        supersede: 'pending-and-running',
      });
    },
    enqueueBackground: (task: () => Promise<void>, label = 'background-op'): void => {
      queue.enqueueBackground(async () => {
        await task();
      }, label);
    },
    waitForDrain: async (): Promise<void> => {
      await queue.waitForDrain();
    },
    metrics: () => queue.metrics(),
  };
}
