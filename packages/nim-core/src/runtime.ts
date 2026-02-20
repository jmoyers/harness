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
  NimTelemetrySink,
  NimToolDefinition,
  NimToolPolicy,
  NimUiEvent,
  QueueFollowUpInput,
  QueueFollowUpResult,
  ReplayEventsInput,
  ReplayEventsResult,
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
import {
  NimProviderRouter,
  type NimProviderDriver,
  type NimProviderTurnEvent,
} from './provider-router.ts';
import { projectEventToUiEvents } from '../../nim-ui-core/src/projection.ts';
import { InMemoryNimEventStore, type NimEventStore } from './event-store.ts';
import {
  InMemoryNimSessionStore,
  type NimPersistedSession,
  type NimSessionStore,
} from './session-store.ts';

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
type ToolBlockReason = 'policy-deny' | 'policy-allow-miss' | 'tool-unavailable';

type RunState = {
  readonly runId: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly input: string;
  readonly traceId: string;
  readonly abortController: AbortController;
  readonly soulHash?: string;
  readonly skillsHash?: string;
  readonly skillsSnapshotVersion?: number;
  readonly memoryHash?: string;
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
const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;

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
  private providerRouter: NimProviderRouter;
  private tools: readonly NimToolDefinition[] = [];
  private toolPolicy: NimToolPolicy = {
    hash: 'policy-default',
    allow: [],
    deny: [],
  };
  private soulSources: SoulSource[] = [];
  private skillSources: SkillSource[] = [];
  private memoryStores: MemoryStore[] = [];
  private eventStore: NimEventStore;
  private sessionStore: NimSessionStore;
  private subscribers = new Map<string, EventSubscriber>();
  private telemetrySinks: NimTelemetrySink[] = [];
  private globalLane: Promise<void> = Promise.resolve();
  private sessionLanes = new Map<string, Promise<void>>();

  public constructor(input?: {
    providerRouter?: NimProviderRouter;
    telemetrySinks?: readonly NimTelemetrySink[];
    eventStore?: NimEventStore;
    sessionStore?: NimSessionStore;
  }) {
    this.providerRouter = input?.providerRouter ?? new NimProviderRouter();
    if (input?.telemetrySinks !== undefined) {
      this.telemetrySinks = [...input.telemetrySinks];
    }
    this.eventStore = input?.eventStore ?? new InMemoryNimEventStore();
    this.sessionStore = input?.sessionStore ?? new InMemoryNimSessionStore();
  }

  public async startSession(input: StartSessionInput): Promise<SessionHandle> {
    this.providerRouter.resolveModel(input.model);
    const sessionId = randomUUID();
    const lane = input.lane ?? `session:${sessionId}`;
    const soulHash = this.currentSoulHash();
    const skillsSnapshot = this.currentSkillsSnapshot();
    const next: SessionState = {
      sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      model: input.model,
      lane,
      ...(soulHash !== undefined ? { soulHash } : {}),
      ...(skillsSnapshot !== undefined ? { skillsSnapshotVersion: skillsSnapshot.version } : {}),
      eventSeq: 0,
      followups: [],
      idempotencyToRunId: new Map<string, string>(),
    };
    this.sessions.set(sessionId, next);
    this.persistSession(next);
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
    const state = this.requireSession(input.sessionId);
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
    const sessions = this.sessionStore
      .listSessions(input.tenantId, input.userId)
      .map((session) => this.toHandleFromPersisted(session));
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
    this.providerRouter.registerProvider(provider);
  }

  public registerTelemetrySink(sink: NimTelemetrySink): void {
    this.telemetrySinks.push(sink);
  }

  public registerProviderDriver(driver: NimProviderDriver): void {
    this.providerRouter.registerDriver(driver);
  }

  public async switchModel(input: SwitchModelInput): Promise<void> {
    this.providerRouter.resolveModel(input.model);
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
    const soulHash = this.currentSoulHash();
    for (const session of this.sessions.values()) {
      if (soulHash === undefined) {
        delete session.soulHash;
      } else {
        session.soulHash = soulHash;
      }
      this.persistSession(session);
    }
  }

  public registerSkillSource(source: SkillSource): void {
    this.skillSources.push(source);
    const snapshot = this.currentSkillsSnapshot();
    for (const session of this.sessions.values()) {
      if (snapshot === undefined) {
        delete session.skillsSnapshotVersion;
      } else {
        session.skillsSnapshotVersion = snapshot.version;
      }
      this.persistSession(session);
    }
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
    const currentSoulHash = this.currentSoulHash();
    const currentSkillsSnapshot = this.currentSkillsSnapshot();
    const currentMemoryHash = this.currentMemoryHash();
    if (currentSoulHash === undefined) {
      delete session.soulHash;
    } else {
      session.soulHash = currentSoulHash;
    }
    if (currentSkillsSnapshot === undefined) {
      delete session.skillsSnapshotVersion;
    } else {
      session.skillsSnapshotVersion = currentSkillsSnapshot.version;
    }

    const existingRunId =
      session.idempotencyToRunId.get(input.idempotencyKey) ??
      this.sessionStore.getRunIdByIdempotency(session.sessionId, input.idempotencyKey);
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
      session.idempotencyToRunId.set(input.idempotencyKey, existingRunId);
      this.sessionStore.upsertIdempotency(session.sessionId, input.idempotencyKey, existingRunId);
      this.appendSessionEvent(session, {
        type: 'turn.idempotency.reused',
        source: 'system',
        runId: existingRunId,
        turnId: existingRunId,
        stepId: 'step:idempotency-reused',
        idempotencyKey: input.idempotencyKey,
      });
      const resolved = this.resolveStoredTurnResult(session, existingRunId);
      return {
        runId: existingRunId,
        sessionId: session.sessionId,
        idempotencyKey: input.idempotencyKey,
        done: Promise.resolve(resolved),
      };
    }

    const runId = randomUUID();
    const turnDeferred = deferred<TurnResult>();
    const run: RunState = {
      runId,
      sessionId: session.sessionId,
      idempotencyKey: input.idempotencyKey,
      input: input.input,
      traceId: randomUUID(),
      abortController: new AbortController(),
      ...(session.soulHash !== undefined ? { soulHash: session.soulHash } : {}),
      ...(currentSkillsSnapshot?.hash !== undefined
        ? { skillsHash: currentSkillsSnapshot.hash }
        : {}),
      ...(session.skillsSnapshotVersion !== undefined
        ? { skillsSnapshotVersion: session.skillsSnapshotVersion }
        : {}),
      ...(currentMemoryHash !== undefined ? { memoryHash: currentMemoryHash } : {}),
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
    this.sessionStore.upsertIdempotency(session.sessionId, input.idempotencyKey, runId);
    this.persistSession(session);

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

    const sessionEvents = this.eventStore.list({
      tenantId: session.tenantId,
      sessionId: session.sessionId,
    });
    const summaryEventId = sessionEvents[sessionEvents.length - 1]?.event_id;
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

    const initialEvents = this.eventStore.list({
      tenantId: input.tenantId,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
    });
    for (const event of initialEvents) {
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

  public async replayEvents(input: ReplayEventsInput): Promise<ReplayEventsResult> {
    const fromEvent = this.resolveFromEvent(input.fromEventIdExclusive);
    const toEvent = this.resolveToEvent(input.toEventIdInclusive);
    const streamInput: StreamEventsInput = {
      tenantId: input.tenantId,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.fidelity !== undefined ? { fidelity: input.fidelity } : {}),
      ...(input.includeThoughtDeltas !== undefined
        ? { includeThoughtDeltas: input.includeThoughtDeltas }
        : {}),
      ...(input.includeToolArgumentDeltas !== undefined
        ? { includeToolArgumentDeltas: input.includeToolArgumentDeltas }
        : {}),
    };

    const events = this.eventStore.list({
      tenantId: input.tenantId,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
    });
    const filtered = events.filter((event) => {
      if (!this.matchesSubscriberEvent(streamInput, event)) {
        return false;
      }
      if (!this.matchesFidelityFilter(streamInput, event)) {
        return false;
      }
      if (!this.matchesReplayWindow(event, fromEvent, toEvent)) {
        return false;
      }
      return true;
    });

    return {
      events: filtered,
    };
  }

  private async executeRun(session: SessionState, run: RunState): Promise<void> {
    try {
      this.appendRunEvent(session, run, {
        type: 'turn.started',
        source: 'system',
        state: 'responding',
      });
      this.emitRunContextSnapshotEvents(session, run);

      const requestedToolName = this.requestedToolName(run.input);
      const exposedTools = this.resolveExposedTools();
      const blockedToolReason =
        requestedToolName === undefined
          ? undefined
          : this.resolveToolBlockReason(requestedToolName, exposedTools);
      if (requestedToolName !== undefined && blockedToolReason !== undefined) {
        this.appendRunEvent(session, run, {
          type: 'tool.policy.blocked',
          source: 'system',
          state: 'responding',
          data: {
            toolName: requestedToolName,
            reason: blockedToolReason,
          },
        });
      }

      const autoCompaction = await this.runAutoOverflowCompactionIfNeeded(session, run);
      let terminalState: 'completed' | 'aborted' | 'failed';
      if (autoCompaction === 'failed' || autoCompaction === 'aborted') {
        terminalState = autoCompaction;
      } else {
        const resolvedModel = this.providerRouter.resolveModel(session.model);
        terminalState =
          resolvedModel.driver === undefined
            ? await this.executeRunWithMockProvider(
                session,
                run,
                exposedTools,
                requestedToolName,
                blockedToolReason,
              )
            : await this.executeRunWithProviderDriver(
                session,
                run,
                resolvedModel.driver,
                resolvedModel.parsedModel.providerModelId,
                exposedTools,
              );
      }

      this.appendRunEvent(session, run, {
        type: 'assistant.state.changed',
        source: 'system',
        state: 'idle',
      });
      await this.finalizeRun(session, run, terminalState);
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

  private async executeRunWithMockProvider(
    session: SessionState,
    run: RunState,
    exposedTools: readonly NimToolDefinition[],
    requestedToolName?: string,
    blockedToolReason?: ToolBlockReason,
  ): Promise<'completed' | 'aborted'> {
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
      return 'aborted';
    }

    const shouldUseTool = run.input.includes('use-tool');
    if (shouldUseTool) {
      const toolCallId = randomUUID();
      const toolName = requestedToolName ?? exposedTools[0]?.name ?? 'mock-tool';
      const canInvokeTool =
        blockedToolReason === undefined && exposedTools.some((tool) => tool.name === toolName);

      if (canInvokeTool) {
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
          return 'aborted';
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
    }

    this.appendRunEvent(session, run, {
      type: 'provider.thinking.completed',
      source: 'provider',
      state: 'responding',
    });

    if (run.aborted) {
      return 'aborted';
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

    return 'completed';
  }

  private async executeRunWithProviderDriver(
    session: SessionState,
    run: RunState,
    driver: NimProviderDriver,
    providerModelId: string,
    exposedTools: readonly NimToolDefinition[],
  ): Promise<'completed' | 'aborted' | 'failed'> {
    let terminalState: 'completed' | 'aborted' | 'failed' = 'completed';
    for await (const providerEvent of driver.runTurn({
      modelRef: session.model,
      providerModelId,
      input: run.input,
      tools: exposedTools,
      abortSignal: run.abortController.signal,
    })) {
      if (run.aborted) {
        return 'aborted';
      }
      terminalState = this.appendProviderTurnEvent(session, run, providerEvent);
      if (terminalState === 'failed') {
        return terminalState;
      }
    }
    return run.aborted ? 'aborted' : terminalState;
  }

  private emitRunContextSnapshotEvents(session: SessionState, run: RunState): void {
    if (run.soulHash === undefined) {
      this.appendRunEvent(session, run, {
        type: 'soul.snapshot.missing',
        source: 'soul',
        state: 'responding',
        data: {
          reason: 'no-soul-source',
        },
      });
    } else {
      this.appendRunEvent(session, run, {
        type: 'soul.snapshot.loaded',
        source: 'soul',
        state: 'responding',
        data: {
          hash: run.soulHash,
        },
      });
    }

    if (run.skillsSnapshotVersion === undefined || run.skillsHash === undefined) {
      this.appendRunEvent(session, run, {
        type: 'skills.snapshot.missing',
        source: 'skill',
        state: 'responding',
        data: {
          reason: 'no-skill-source',
        },
      });
    } else {
      this.appendRunEvent(session, run, {
        type: 'skills.snapshot.loaded',
        source: 'skill',
        state: 'responding',
        data: {
          hash: run.skillsHash,
          version: run.skillsSnapshotVersion,
        },
      });
    }

    if (run.memoryHash === undefined) {
      this.appendRunEvent(session, run, {
        type: 'memory.snapshot.missing',
        source: 'memory',
        state: 'responding',
        data: {
          reason: 'no-memory-store',
        },
      });
    } else {
      this.appendRunEvent(session, run, {
        type: 'memory.snapshot.loaded',
        source: 'memory',
        state: 'responding',
        data: {
          hash: run.memoryHash,
        },
      });
    }
  }

  private resolveOverflowMode(input: string): 'none' | 'recoverable' | 'fatal' {
    if (input.includes('force-overflow-fail')) {
      return 'fatal';
    }
    if (input.includes('force-overflow-recover')) {
      return 'recoverable';
    }
    return 'none';
  }

  private async runAutoOverflowCompactionIfNeeded(
    session: SessionState,
    run: RunState,
  ): Promise<'continue' | 'aborted' | 'failed'> {
    const mode = this.resolveOverflowMode(run.input);
    if (mode === 'none') {
      return 'continue';
    }

    for (let attempt = 1; attempt <= MAX_OVERFLOW_COMPACTION_ATTEMPTS; attempt += 1) {
      this.appendRunEvent(session, run, {
        type: 'provider.context.compaction.started',
        source: 'provider',
        state: 'thinking',
        data: {
          trigger: 'overflow',
          attempt,
          maxAttempts: MAX_OVERFLOW_COMPACTION_ATTEMPTS,
        },
      });

      await sleep(1);
      if (run.aborted) {
        return 'aborted';
      }

      if (mode === 'recoverable') {
        this.appendRunEvent(session, run, {
          type: 'provider.context.compaction.completed',
          source: 'provider',
          state: 'responding',
          data: {
            trigger: 'overflow',
            attempt,
          },
        });
        return 'continue';
      }

      if (attempt < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {
        this.appendRunEvent(session, run, {
          type: 'provider.context.compaction.retry',
          source: 'provider',
          state: 'thinking',
          data: {
            trigger: 'overflow',
            attempt,
            nextAttempt: attempt + 1,
          },
        });
        continue;
      }

      this.appendRunEvent(session, run, {
        type: 'provider.context.compaction.failed',
        source: 'provider',
        state: 'idle',
        data: {
          trigger: 'overflow',
          attempt,
          reason: 'overflow-retries-exhausted',
        },
      });
      this.appendRunEvent(session, run, {
        type: 'turn.failed',
        source: 'system',
        state: 'idle',
        data: {
          message: 'context overflow after compaction retries',
        },
      });
      return 'failed';
    }

    return 'failed';
  }

  private appendProviderTurnEvent(
    session: SessionState,
    run: RunState,
    event: NimProviderTurnEvent,
  ): 'completed' | 'failed' {
    if (event.type === 'provider.thinking.started') {
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
      return 'completed';
    }

    if (event.type === 'provider.thinking.delta') {
      this.appendRunEvent(session, run, {
        type: 'provider.thinking.delta',
        source: 'provider',
        state: 'thinking',
        data: {
          text: event.text,
        },
      });
      return 'completed';
    }

    if (event.type === 'provider.thinking.completed') {
      this.appendRunEvent(session, run, {
        type: 'provider.thinking.completed',
        source: 'provider',
        state: 'responding',
      });
      this.appendRunEvent(session, run, {
        type: 'assistant.state.changed',
        source: 'system',
        state: 'responding',
      });
      return 'completed';
    }

    if (event.type === 'tool.call.started') {
      this.appendRunEvent(session, run, {
        type: 'assistant.state.changed',
        source: 'system',
        state: 'tool-calling',
        toolCallId: event.toolCallId,
      });
      this.appendRunEvent(session, run, {
        type: 'tool.call.started',
        source: 'tool',
        state: 'tool-calling',
        toolCallId: event.toolCallId,
        data: {
          toolName: event.toolName,
        },
      });
      return 'completed';
    }

    if (event.type === 'tool.call.arguments.delta') {
      this.appendRunEvent(session, run, {
        type: 'tool.call.arguments.delta',
        source: 'tool',
        state: 'tool-calling',
        toolCallId: event.toolCallId,
        data: {
          delta: event.delta,
        },
      });
      return 'completed';
    }

    if (event.type === 'tool.call.completed') {
      this.appendRunEvent(session, run, {
        type: 'tool.call.completed',
        source: 'tool',
        state: 'tool-calling',
        toolCallId: event.toolCallId,
        data: {
          toolName: event.toolName,
        },
      });
      this.appendRunEvent(session, run, {
        type: 'assistant.state.changed',
        source: 'system',
        state: 'responding',
      });
      return 'completed';
    }

    if (event.type === 'tool.call.failed') {
      this.appendRunEvent(session, run, {
        type: 'tool.call.failed',
        source: 'tool',
        state: 'responding',
        toolCallId: event.toolCallId,
        data: {
          toolName: event.toolName,
          error: event.error,
        },
      });
      this.appendRunEvent(session, run, {
        type: 'assistant.state.changed',
        source: 'system',
        state: 'responding',
      });
      return 'completed';
    }

    if (event.type === 'tool.result.emitted') {
      this.appendRunEvent(session, run, {
        type: 'tool.result.emitted',
        source: 'tool',
        state: 'responding',
        toolCallId: event.toolCallId,
        data: {
          toolName: event.toolName,
          ...(event.output !== undefined ? { output: event.output } : {}),
        },
      });
      return 'completed';
    }

    if (event.type === 'assistant.output.delta') {
      this.appendRunEvent(session, run, {
        type: 'assistant.output.delta',
        source: 'provider',
        state: 'responding',
        data: {
          text: event.text,
        },
      });
      return 'completed';
    }

    if (event.type === 'assistant.output.completed') {
      this.appendRunEvent(session, run, {
        type: 'assistant.output.completed',
        source: 'provider',
        state: 'responding',
      });
      return 'completed';
    }

    if (event.type === 'provider.turn.error') {
      this.appendRunEvent(session, run, {
        type: 'turn.failed',
        source: 'system',
        state: 'idle',
        data: {
          message: event.message,
        },
      });
      return 'failed';
    }

    if (event.type === 'provider.turn.finished' && event.finishReason === 'error') {
      this.appendRunEvent(session, run, {
        type: 'turn.failed',
        source: 'system',
        state: 'idle',
        data: {
          message: 'provider finished with error',
        },
      });
      return 'failed';
    }

    return 'completed';
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
    run.abortController.abort(reason);

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
      ...(run.skillsSnapshotVersion !== undefined
        ? { skills_snapshot_version: run.skillsSnapshotVersion }
        : {}),
      ...(run.soulHash !== undefined ? { soul_hash: run.soulHash } : {}),
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
    this.eventStore.append(finalized);
    this.persistSession(session);
    this.dispatchTelemetry(finalized);

    for (const subscriber of this.subscribers.values()) {
      if (!this.shouldDeliverEvent(subscriber.input, finalized, subscriber.fromEvent)) {
        continue;
      }
      subscriber.queue.push(finalized);
    }
  }

  private dispatchTelemetry(event: NimEventEnvelope): void {
    for (const sink of this.telemetrySinks) {
      sink.record(event);
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

  private currentSoulHash(): string | undefined {
    if (this.soulSources.length === 0) {
      return undefined;
    }
    return `soul:${this.soulSources.length}`;
  }

  private currentSkillsSnapshot(): { hash: string; version: number } | undefined {
    const version = this.skillSources.length;
    if (version === 0) {
      return undefined;
    }
    return {
      hash: `skills:${version}`,
      version,
    };
  }

  private currentMemoryHash(): string | undefined {
    if (this.memoryStores.length === 0) {
      return undefined;
    }
    return `memory:${this.memoryStores.length}`;
  }

  private requestedToolName(input: string): string | undefined {
    const match = /(?:^|\s)use-tool(?:\s+([A-Za-z0-9._:-]+))?/u.exec(input);
    if (match === null) {
      return undefined;
    }
    const namedTool = match[1];
    if (typeof namedTool === 'string' && namedTool.length > 0) {
      return namedTool;
    }
    return this.tools[0]?.name;
  }

  private resolveExposedTools(): readonly NimToolDefinition[] {
    const denySet = new Set(this.toolPolicy.deny);
    const hasAllowList = this.toolPolicy.allow.length > 0;
    const allowSet = new Set(this.toolPolicy.allow);
    return this.tools.filter((tool) => {
      if (denySet.has(tool.name)) {
        return false;
      }
      if (hasAllowList && !allowSet.has(tool.name)) {
        return false;
      }
      return true;
    });
  }

  private resolveToolBlockReason(
    requestedToolName: string,
    exposedTools: readonly NimToolDefinition[],
  ): ToolBlockReason | undefined {
    const isRegistered = this.tools.some((tool) => tool.name === requestedToolName);
    if (!isRegistered) {
      return 'tool-unavailable';
    }
    if (this.toolPolicy.deny.includes(requestedToolName)) {
      return 'policy-deny';
    }
    if (this.toolPolicy.allow.length > 0 && !this.toolPolicy.allow.includes(requestedToolName)) {
      return 'policy-allow-miss';
    }
    const isExposed = exposedTools.some((tool) => tool.name === requestedToolName);
    return isExposed ? undefined : 'tool-unavailable';
  }

  private resolveFromEvent(fromEventIdExclusive?: string): NimEventEnvelope | undefined {
    if (fromEventIdExclusive === undefined) {
      return undefined;
    }
    return this.eventStore.getById(fromEventIdExclusive);
  }

  private resolveToEvent(toEventIdInclusive?: string): NimEventEnvelope | undefined {
    if (toEventIdInclusive === undefined) {
      return undefined;
    }
    return this.eventStore.getById(toEventIdInclusive);
  }

  private matchesReplayWindow(
    event: NimEventEnvelope,
    fromEvent?: NimEventEnvelope,
    toEvent?: NimEventEnvelope,
  ): boolean {
    if (fromEvent !== undefined && event.session_id === fromEvent.session_id) {
      if (event.event_seq <= fromEvent.event_seq) {
        return false;
      }
    }
    if (toEvent !== undefined && event.session_id === toEvent.session_id) {
      if (event.event_seq > toEvent.event_seq) {
        return false;
      }
    }
    return true;
  }

  private resolveStoredTurnResult(session: SessionState, runId: string): TurnResult {
    const events = this.eventStore.list({
      tenantId: session.tenantId,
      sessionId: session.sessionId,
      runId,
    });
    let completion: NimEventEnvelope | undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const candidate = events[index];
      if (candidate?.type === 'turn.completed') {
        completion = candidate;
        break;
      }
    }
    if (completion?.data !== undefined) {
      const terminalState = completion.data.terminalState;
      if (
        terminalState === 'completed' ||
        terminalState === 'aborted' ||
        terminalState === 'failed'
      ) {
        return {
          runId,
          terminalState,
        };
      }
    }
    return {
      runId,
      terminalState: 'completed',
    };
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) {
      return session;
    }
    const persisted = this.sessionStore.getSession(sessionId);
    if (persisted === undefined) {
      throw new Error(`session not found: ${sessionId}`);
    }
    const hydrated = this.hydrateSessionState(persisted);
    this.sessions.set(sessionId, hydrated);
    return hydrated;
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

  private toHandleFromPersisted(state: NimPersistedSession): SessionHandle {
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

  private persistSession(state: SessionState): void {
    this.sessionStore.upsertSession({
      sessionId: state.sessionId,
      tenantId: state.tenantId,
      userId: state.userId,
      model: state.model,
      lane: state.lane,
      ...(state.soulHash !== undefined ? { soulHash: state.soulHash } : {}),
      ...(state.skillsSnapshotVersion !== undefined
        ? { skillsSnapshotVersion: state.skillsSnapshotVersion }
        : {}),
      eventSeq: state.eventSeq,
      ...(state.lastRunId !== undefined ? { lastRunId: state.lastRunId } : {}),
    });
  }

  private hydrateSessionState(state: NimPersistedSession): SessionState {
    const idempotencyToRunId = new Map<string, string>();
    for (const entry of this.sessionStore.listIdempotency(state.sessionId)) {
      idempotencyToRunId.set(entry.idempotencyKey, entry.runId);
    }
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
      eventSeq: state.eventSeq,
      ...(state.lastRunId !== undefined ? { lastRunId: state.lastRunId } : {}),
      followups: [],
      idempotencyToRunId,
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
