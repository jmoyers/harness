import { randomUUID } from 'node:crypto';
import type {
  AbortTurnInput,
  CompactSessionInput,
  CompactionResult,
  ListSessionsInput,
  ListSessionsResult,
  MemorySnapshot,
  MemoryStore,
  NimModelRef,
  NimProvider,
  NimRuntime,
  NimToolDefinition,
  NimToolPolicy,
  NimUiEvent,
  QueueFollowUpInput,
  QueueFollowUpResult,
  ResumeSessionInput,
  SendTurnInput,
  SessionHandle,
  SkillSource,
  SkillsSnapshot,
  SoulSnapshot,
  SoulSource,
  StartSessionInput,
  SteerTurnInput,
  SteerTurnResult,
  StreamEventsInput,
  StreamUiInput,
  SwitchModelInput,
  TurnHandle,
  TurnResult,
} from './contracts.ts';
import type { NimEventEnvelope } from './events.ts';
import { projectEventToUiEvents } from '../../nim-ui-core/src/projection.ts';

type SessionState = {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  model: NimModelRef;
  lane: string;
  soulHash?: string;
  skillsSnapshotVersion?: number;
  eventSeq: number;
  lastRunId?: string;
  activeRunId?: string;
  followups: QueueItem[];
  idempotencyToRunId: Map<string, string>;
};

type QueueItem = {
  readonly queueId: string;
  readonly text: string;
  readonly priority: 'normal' | 'high';
  readonly dedupeKey: string;
};

type AbortReason = 'manual' | 'timeout' | 'policy' | 'signal';

type RunState = {
  readonly runId: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly input: string;
  readonly traceId: string;
  stepCounter: number;
  active: boolean;
  streaming: boolean;
  compacting: boolean;
  aborted: boolean;
  abortReason?: AbortReason;
  abortSignalCleanup?: () => void;
  steers: string[];
  resolveDone: (result: TurnResult) => void;
  done: Promise<TurnResult>;
};

type EventSubscriber = {
  readonly input: StreamEventsInput;
  readonly fromEvent?: NimEventEnvelope;
  readonly queue: AsyncPushQueue<NimEventEnvelope>;
};

const MAX_FOLLOWUPS_PER_SESSION = 64;

class AsyncPushQueue<T> {
  private values: T[] = [];
  private waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  public push(value: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  public close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ done: true, value: undefined });
    }
  }

  public async next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      const value = this.values.shift() as T;
      return { done: false, value };
    }
    if (this.closed) {
      return { done: true, value: undefined };
    }
    return await new Promise<IteratorResult<T>>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class InMemoryNimRuntime implements NimRuntime {
  private sessions = new Map<string, SessionState>();
  private runs = new Map<string, RunState>();
  private providers = new Map<string, NimProvider>();
  private tools: readonly NimToolDefinition[] = [];
  private toolPolicy: NimToolPolicy = {
    hash: 'policy-default',
    allow: [],
    deny: [],
  };
  private soulSources: SoulSource[] = [];
  private skillSources: SkillSource[] = [];
  private memoryStores: MemoryStore[] = [];
  private events: NimEventEnvelope[] = [];
  private eventById = new Map<string, NimEventEnvelope>();
  private subscribers = new Map<string, EventSubscriber>();
  private globalLane: Promise<void> = Promise.resolve();
  private sessionLanes = new Map<string, Promise<void>>();

  public async startSession(input: StartSessionInput): Promise<SessionHandle> {
    const sessionId = randomUUID();
    const lane = input.lane ?? `session:${sessionId}`;
    const next: SessionState = {
      sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      model: input.model,
      lane,
      eventSeq: 0,
      followups: [],
      idempotencyToRunId: new Map<string, string>(),
    };
    this.sessions.set(sessionId, next);
    this.appendSessionEvent(next, {
      type: 'session.started',
      runId: '',
      turnId: '',
      stepId: 'step:session-started',
      source: 'system',
      idempotencyKey: 'session-started',
      data: {
        model: input.model,
      },
    });
    return this.toHandle(next);
  }

  public async resumeSession(input: ResumeSessionInput): Promise<SessionHandle> {
    const state = this.sessions.get(input.sessionId);
    if (state === undefined) {
      throw new Error(`session not found: ${input.sessionId}`);
    }
    if (state.tenantId !== input.tenantId || state.userId !== input.userId) {
      throw new Error('session access denied');
    }
    this.appendSessionEvent(state, {
      type: 'session.resumed',
      runId: state.lastRunId ?? '',
      turnId: '',
      stepId: 'step:session-resumed',
      source: 'system',
      idempotencyKey: 'session-resumed',
    });
    return this.toHandle(state);
  }

  public async listSessions(input: ListSessionsInput): Promise<ListSessionsResult> {
    const sessions = Array.from(this.sessions.values())
      .filter((session) => session.tenantId === input.tenantId && session.userId === input.userId)
      .map((session) => this.toHandle(session));
    return {
      sessions,
    };
  }

  public registerTools(tools: readonly NimToolDefinition[]): void {
    this.tools = tools.slice();
  }

  public setToolPolicy(policy: NimToolPolicy): void {
    this.toolPolicy = policy;
  }

  public registerProvider(provider: NimProvider): void {
    this.providers.set(provider.id, provider);
  }

  public async switchModel(input: SwitchModelInput): Promise<void> {
    const session = this.requireSession(input.sessionId);
    session.model = input.model;
    this.appendSessionEvent(session, {
      type: 'provider.model.switch.completed',
      source: 'system',
      runId: session.lastRunId ?? '',
      turnId: '',
      stepId: 'step:model-switch',
      idempotencyKey: 'model-switch',
      data: {
        model: input.model,
        reason: input.reason,
      },
    });
  }

  public registerSoulSource(source: SoulSource): void {
    this.soulSources.push(source);
  }

  public registerSkillSource(source: SkillSource): void {
    this.skillSources.push(source);
  }

  public registerMemoryStore(store: MemoryStore): void {
    this.memoryStores.push(store);
  }

  public async loadSoul(): Promise<SoulSnapshot> {
    return {
      hash: `soul:${this.soulSources.length}`,
    };
  }

  public async loadSkills(): Promise<SkillsSnapshot> {
    return {
      hash: `skills:${this.skillSources.length}`,
      version: this.skillSources.length,
    };
  }

  public async loadMemory(): Promise<MemorySnapshot> {
    return {
      hash: `memory:${this.memoryStores.length}`,
    };
  }

  public async sendTurn(input: SendTurnInput): Promise<TurnHandle> {
    const session = this.requireSession(input.sessionId);
    const existingRunId = session.idempotencyToRunId.get(input.idempotencyKey);
    if (existingRunId !== undefined) {
      const existing = this.runs.get(existingRunId);
      if (existing !== undefined) {
        this.appendSessionEvent(session, {
          type: 'turn.idempotency.reused',
          source: 'system',
          runId: existingRunId,
          turnId: existingRunId,
          stepId: 'step:idempotency-reused',
          idempotencyKey: input.idempotencyKey,
        });
        return {
          runId: existing.runId,
          sessionId: existing.sessionId,
          idempotencyKey: existing.idempotencyKey,
          done: existing.done,
        };
      }
    }

    const runId = randomUUID();
    const turnDeferred = deferred<TurnResult>();
    const run: RunState = {
      runId,
      sessionId: session.sessionId,
      idempotencyKey: input.idempotencyKey,
      input: input.input,
      traceId: randomUUID(),
      stepCounter: 0,
      active: true,
      streaming: true,
      compacting: false,
      aborted: false,
      steers: [],
      resolveDone: turnDeferred.resolve,
      done: turnDeferred.promise,
    };

    if (input.abortSignal !== undefined) {
      const onAbort = () => {
        this.requestAbort(session, run, 'signal');
      };
      if (input.abortSignal.aborted) {
        onAbort();
      } else {
        input.abortSignal.addEventListener('abort', onAbort, { once: true });
        run.abortSignalCleanup = () => {
          input.abortSignal?.removeEventListener('abort', onAbort);
        };
      }
    }

    this.runs.set(runId, run);
    session.lastRunId = runId;
    session.activeRunId = runId;
    session.idempotencyToRunId.set(input.idempotencyKey, runId);

    void this.enqueueSessionAndGlobal(session.sessionId, async () => {
      await this.executeRun(session, run);
    });

    return {
      runId: run.runId,
      sessionId: run.sessionId,
      idempotencyKey: run.idempotencyKey,
      done: run.done,
    };
  }

  public async abortTurn(input: AbortTurnInput): Promise<void> {
    const run = this.runs.get(input.runId);
    if (run === undefined) {
      return;
    }
    const session = this.requireSession(run.sessionId);
    this.requestAbort(session, run, input.reason ?? 'manual');
  }

  public async steerTurn(input: SteerTurnInput): Promise<SteerTurnResult> {
    const session = this.requireSession(input.sessionId);
    const activeRun =
      input.runId !== undefined
        ? this.runs.get(input.runId)
        : session.activeRunId !== undefined
          ? this.runs.get(session.activeRunId)
          : undefined;

    if (activeRun === undefined || !activeRun.active) {
      return {
        accepted: false,
        reason: 'no-active-run',
      };
    }
    if (!activeRun.streaming) {
      return {
        accepted: false,
        reason: 'not-streaming',
      };
    }
    if (activeRun.compacting) {
      return {
        accepted: false,
        reason: 'compacting',
      };
    }

    this.appendRunEvent(session, activeRun, {
      type: 'turn.steer.requested',
      source: 'system',
      data: {
        strategy: input.strategy,
      },
    });

    if (input.strategy === 'inject') {
      activeRun.steers.push(input.text);
      this.appendRunEvent(session, activeRun, {
        type: 'turn.steer.accepted',
        source: 'system',
        data: {
          strategy: input.strategy,
        },
      });
      return {
        accepted: true,
      };
    }

    this.requestAbort(session, activeRun, 'manual');
    const replacement = await this.sendTurn({
      sessionId: input.sessionId,
      input: input.text,
      idempotencyKey: `restart:${randomUUID()}`,
    });
    this.appendRunEvent(session, activeRun, {
      type: 'turn.steer.accepted',
      source: 'system',
      data: {
        strategy: input.strategy,
        replacedRunId: replacement.runId,
      },
    });
    return {
      accepted: true,
      replacedRunId: replacement.runId,
    };
  }

  public async queueFollowUp(input: QueueFollowUpInput): Promise<QueueFollowUpResult> {
    const session = this.requireSession(input.sessionId);
    if (input.text.trim().length === 0) {
      return {
        queued: false,
        reason: 'invalid-state',
      };
    }

    if (session.followups.length >= MAX_FOLLOWUPS_PER_SESSION) {
      return {
        queued: false,
        reason: 'queue-full',
      };
    }

    const dedupeKey = input.dedupeKey ?? input.text;
    const duplicate = session.followups.some((item) => item.dedupeKey === dedupeKey);
    if (duplicate) {
      return {
        queued: false,
        reason: 'duplicate',
      };
    }

    const queueItem: QueueItem = {
      queueId: randomUUID(),
      text: input.text,
      priority: input.priority ?? 'normal',
      dedupeKey,
    };

    let position = 0;
    if (queueItem.priority === 'high') {
      session.followups.unshift(queueItem);
      position = 0;
    } else {
      session.followups.push(queueItem);
      position = session.followups.length - 1;
    }

    const run = session.activeRunId !== undefined ? this.runs.get(session.activeRunId) : undefined;
    this.appendSessionEvent(session, {
      type: 'turn.followup.queued',
      source: 'system',
      runId: run?.runId ?? '',
      turnId: run?.runId ?? '',
      stepId: 'step:followup-queued',
      idempotencyKey: run?.idempotencyKey ?? 'followup',
      queueId: queueItem.queueId,
      queuePosition: position,
    });

    return {
      queued: true,
      queueId: queueItem.queueId,
      position,
    };
  }

  public async compactSession(input: CompactSessionInput): Promise<CompactionResult> {
    const session = this.requireSession(input.sessionId);
    const run = session.activeRunId !== undefined ? this.runs.get(session.activeRunId) : undefined;

    if (run !== undefined && run.active) {
      run.compacting = true;
      this.appendRunEvent(session, run, {
        type: 'provider.context.compaction.started',
        source: 'provider',
        state: 'thinking',
        data: {
          trigger: input.trigger,
          includeMemoryFlush: input.includeMemoryFlush ?? false,
        },
      });
    } else {
      this.appendSessionEvent(session, {
        type: 'provider.context.compaction.started',
        source: 'provider',
        runId: session.lastRunId ?? '',
        turnId: session.lastRunId ?? '',
        stepId: 'step:compaction-started',
        idempotencyKey: 'compaction',
        data: {
          trigger: input.trigger,
          includeMemoryFlush: input.includeMemoryFlush ?? false,
        },
      });
    }

    await sleep(1);

    if (run !== undefined && run.active) {
      this.appendRunEvent(session, run, {
        type: 'provider.context.compaction.completed',
        source: 'provider',
        state: 'thinking',
        data: {
          trigger: input.trigger,
        },
      });
      run.compacting = false;
    } else {
      this.appendSessionEvent(session, {
        type: 'provider.context.compaction.completed',
        source: 'provider',
        runId: session.lastRunId ?? '',
        turnId: session.lastRunId ?? '',
        stepId: 'step:compaction-completed',
        idempotencyKey: 'compaction',
        data: {
          trigger: input.trigger,
        },
      });
    }

    const summaryEventId = this.events[this.events.length - 1]?.event_id;
    if (summaryEventId === undefined) {
      return {
        compacted: true,
      };
    }
    return {
      compacted: true,
      summaryEventId,
    };
  }

  public streamEvents(input: StreamEventsInput): AsyncIterable<NimEventEnvelope> {
    const queue = new AsyncPushQueue<NimEventEnvelope>();
    const id = randomUUID();
    const subscribers = this.subscribers;
    const fromEvent = this.resolveFromEvent(input.fromEventIdExclusive);
    const subscriber: EventSubscriber = {
      input,
      ...(fromEvent !== undefined ? { fromEvent } : {}),
      queue,
    };

    this.subscribers.set(id, subscriber);

    for (const event of this.events) {
      if (!this.shouldDeliverEvent(input, event, fromEvent)) {
        continue;
      }
      queue.push(event);
    }

    return {
      [Symbol.asyncIterator]: () => {
        return {
          async next() {
            return await queue.next();
          },
          async return() {
            subscribers.delete(id);
            queue.close();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  public streamUi(input: StreamUiInput): AsyncIterable<NimUiEvent> {
    const source = this.streamEvents({
      tenantId: input.tenantId,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      fidelity: 'semantic',
    });
    const mode = input.mode;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const event of source) {
          const projected = projectEventToUiEvents(event, mode);
          for (const item of projected) {
            yield item;
          }
        }
      },
    };
  }

  private async executeRun(session: SessionState, run: RunState): Promise<void> {
    try {
      this.appendRunEvent(session, run, {
        type: 'turn.started',
        source: 'system',
        state: 'responding',
      });
      this.appendRunEvent(session, run, {
        type: 'assistant.state.changed',
        source: 'system',
        state: 'thinking',
      });
      this.appendRunEvent(session, run, {
        type: 'provider.thinking.started',
        source: 'provider',
        state: 'thinking',
      });

      await sleep(15);
      if (run.aborted) {
        await this.finalizeRun(session, run, 'aborted');
        return;
      }

      const shouldUseTool = run.input.includes('use-tool');
      if (shouldUseTool) {
        const toolCallId = randomUUID();
        const toolName = this.tools[0]?.name ?? 'mock-tool';

        this.appendRunEvent(session, run, {
          type: 'assistant.state.changed',
          source: 'system',
          state: 'tool-calling',
          toolCallId,
        });
        this.appendRunEvent(session, run, {
          type: 'tool.call.started',
          source: 'tool',
          state: 'tool-calling',
          toolCallId,
          data: {
            toolName,
          },
        });

        await sleep(1);
        if (run.aborted) {
          await this.finalizeRun(session, run, 'aborted');
          return;
        }

        this.appendRunEvent(session, run, {
          type: 'tool.call.completed',
          source: 'tool',
          state: 'tool-calling',
          toolCallId,
          data: {
            toolName,
          },
        });
        this.appendRunEvent(session, run, {
          type: 'tool.result.emitted',
          source: 'tool',
          state: 'responding',
          toolCallId,
        });
      }

      this.appendRunEvent(session, run, {
        type: 'provider.thinking.completed',
        source: 'provider',
        state: 'responding',
      });

      if (run.aborted) {
        await this.finalizeRun(session, run, 'aborted');
        return;
      }

      const steerSuffix = run.steers.length > 0 ? ` [steer:${run.steers.join(' | ')}]` : '';
      this.appendRunEvent(session, run, {
        type: 'assistant.output.delta',
        source: 'provider',
        state: 'responding',
        data: {
          text: `echo:${run.input}${steerSuffix}`,
        },
      });
      this.appendRunEvent(session, run, {
        type: 'assistant.output.completed',
        source: 'provider',
        state: 'responding',
      });
      this.appendRunEvent(session, run, {
        type: 'assistant.state.changed',
        source: 'system',
        state: 'idle',
      });

      await this.finalizeRun(session, run, 'completed');
    } catch (error) {
      if (run.active) {
        this.appendRunEvent(session, run, {
          type: 'turn.failed',
          source: 'system',
          state: 'idle',
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
        await this.finalizeRun(session, run, 'failed');
      }
    }
  }

  private async finalizeRun(
    session: SessionState,
    run: RunState,
    state: 'completed' | 'aborted' | 'failed',
  ): Promise<void> {
    if (!run.active) {
      return;
    }

    run.active = false;
    run.streaming = false;
    run.compacting = false;
    run.abortSignalCleanup?.();
    delete run.abortSignalCleanup;

    if (session.activeRunId === run.runId) {
      delete session.activeRunId;
    }

    if (state === 'aborted') {
      this.appendRunEvent(session, run, {
        type: 'turn.abort.completed',
        source: 'system',
        state: 'idle',
        data: {
          reason: run.abortReason ?? 'manual',
        },
      });
    }

    this.appendRunEvent(session, run, {
      type: 'turn.completed',
      source: 'system',
      state: 'idle',
      data: {
        terminalState: state,
      },
    });

    run.resolveDone({
      runId: run.runId,
      terminalState: state,
    });

    if (session.followups.length > 0) {
      const queueItem = session.followups.shift() as QueueItem;
      this.appendSessionEvent(session, {
        type: 'turn.followup.dequeued',
        source: 'system',
        runId: run.runId,
        turnId: run.runId,
        stepId: 'step:followup-dequeued',
        idempotencyKey: run.idempotencyKey,
        queueId: queueItem.queueId,
        queuePosition: 0,
      });
      await this.sendTurn({
        sessionId: session.sessionId,
        input: queueItem.text,
        idempotencyKey: `followup:${queueItem.queueId}`,
      });
    }
  }

  private requestAbort(session: SessionState, run: RunState, reason: AbortReason): void {
    if (run.aborted) {
      return;
    }

    run.aborted = true;
    run.abortReason = reason;

    this.appendRunEvent(session, run, {
      type: 'turn.abort.requested',
      source: 'system',
      state: 'responding',
      data: {
        reason,
      },
    });

    this.appendRunEvent(session, run, {
      type: 'turn.abort.propagated',
      source: 'system',
      state: 'responding',
      data: {
        reason,
      },
    });
  }

  private appendRunEvent(
    session: SessionState,
    run: RunState,
    input: {
      type: string;
      source: NimEventEnvelope['source'];
      state?: NimEventEnvelope['state'];
      toolCallId?: string;
      data?: Record<string, unknown>;
    },
  ): void {
    run.stepCounter += 1;
    const event: NimEventEnvelope = {
      event_id: randomUUID(),
      event_seq: session.eventSeq + 1,
      ts: new Date().toISOString(),
      tenant_id: session.tenantId,
      user_id: session.userId,
      workspace_id: 'workspace-local',
      session_id: session.sessionId,
      run_id: run.runId,
      turn_id: run.runId,
      step_id: `step:${run.stepCounter}`,
      ...(input.toolCallId !== undefined ? { tool_call_id: input.toolCallId } : {}),
      source: input.source,
      type: input.type,
      payload_hash: `hash:${run.runId}:${run.stepCounter}`,
      idempotency_key: run.idempotencyKey,
      lane: session.lane,
      policy_hash: this.toolPolicy.hash,
      trace_id: run.traceId,
      span_id: randomUUID(),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.data !== undefined ? { data: input.data } : {}),
    };
    this.emitEvent(session, event);
  }

  private appendSessionEvent(
    session: SessionState,
    input: {
      type: string;
      source: NimEventEnvelope['source'];
      runId: string;
      turnId: string;
      stepId: string;
      idempotencyKey: string;
      queueId?: string;
      queuePosition?: number;
      data?: Record<string, unknown>;
    },
  ): void {
    const event: NimEventEnvelope = {
      event_id: randomUUID(),
      event_seq: session.eventSeq + 1,
      ts: new Date().toISOString(),
      tenant_id: session.tenantId,
      user_id: session.userId,
      workspace_id: 'workspace-local',
      session_id: session.sessionId,
      run_id: input.runId,
      turn_id: input.turnId,
      step_id: input.stepId,
      source: input.source,
      type: input.type,
      payload_hash: `hash:${input.stepId}:${session.eventSeq + 1}`,
      idempotency_key: input.idempotencyKey,
      lane: session.lane,
      policy_hash: this.toolPolicy.hash,
      trace_id: input.runId.length > 0 ? input.runId : 'trace:session',
      span_id: randomUUID(),
      ...(input.queueId !== undefined ? { queue_id: input.queueId } : {}),
      ...(input.queuePosition !== undefined ? { queue_position: input.queuePosition } : {}),
      ...(input.data !== undefined ? { data: input.data } : {}),
    };
    this.emitEvent(session, event);
  }

  private emitEvent(session: SessionState, event: NimEventEnvelope): void {
    session.eventSeq += 1;
    const finalized: NimEventEnvelope = {
      ...event,
      event_seq: session.eventSeq,
    };
    this.events.push(finalized);
    this.eventById.set(finalized.event_id, finalized);

    for (const subscriber of this.subscribers.values()) {
      if (!this.shouldDeliverEvent(subscriber.input, finalized, subscriber.fromEvent)) {
        continue;
      }
      subscriber.queue.push(finalized);
    }
  }

  private shouldDeliverEvent(
    input: StreamEventsInput,
    event: NimEventEnvelope,
    fromEvent?: NimEventEnvelope,
  ): boolean {
    if (!this.matchesSubscriberEvent(input, event)) {
      return false;
    }
    if (!this.matchesFidelityFilter(input, event)) {
      return false;
    }

    if (fromEvent === undefined) {
      return true;
    }

    if (event.session_id !== fromEvent.session_id) {
      return true;
    }

    return event.event_seq > fromEvent.event_seq;
  }

  private matchesFidelityFilter(input: StreamEventsInput, event: NimEventEnvelope): boolean {
    if (event.type === 'provider.thinking.delta' && input.includeThoughtDeltas !== true) {
      return false;
    }
    if (event.type === 'tool.call.arguments.delta' && input.includeToolArgumentDeltas !== true) {
      return false;
    }
    if (input.fidelity === 'semantic' && event.type === 'provider.raw.delta') {
      return false;
    }
    return true;
  }

  private matchesSubscriberEvent(input: StreamEventsInput, event: NimEventEnvelope): boolean {
    if (event.tenant_id !== input.tenantId) {
      return false;
    }
    if (input.sessionId !== undefined && event.session_id !== input.sessionId) {
      return false;
    }
    if (input.runId !== undefined && event.run_id !== input.runId) {
      return false;
    }
    return true;
  }

  private resolveFromEvent(fromEventIdExclusive?: string): NimEventEnvelope | undefined {
    if (fromEventIdExclusive === undefined) {
      return undefined;
    }
    return this.eventById.get(fromEventIdExclusive);
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return session;
  }

  private toHandle(state: SessionState): SessionHandle {
    return {
      sessionId: state.sessionId,
      tenantId: state.tenantId,
      userId: state.userId,
      model: state.model,
      lane: state.lane,
      ...(state.soulHash !== undefined ? { soulHash: state.soulHash } : {}),
      ...(state.skillsSnapshotVersion !== undefined
        ? { skillsSnapshotVersion: state.skillsSnapshotVersion }
        : {}),
    };
  }

  private async enqueueSessionAndGlobal(
    sessionId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const sessionLane = this.sessionLanes.get(sessionId) ?? Promise.resolve();
    const nextSessionLane = sessionLane
      .catch(() => undefined)
      .then(async () => {
        const nextGlobal = this.globalLane.catch(() => undefined).then(task);
        this.globalLane = nextGlobal;
        await nextGlobal;
      });

    this.sessionLanes.set(sessionId, nextSessionLane);
    await nextSessionLane;
  }
}
