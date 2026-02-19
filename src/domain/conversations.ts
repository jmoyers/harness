import {
  applySummaryToConversation,
  type ConversationState,
} from '../mux/live-mux/conversation-state.ts';
import type { PtyExit } from '../pty/pty_host.ts';

export interface ConversationSeed {
  directoryId?: string | null;
  title?: string;
  agentType?: string;
  adapterState?: Record<string, unknown>;
}

interface PersistedConversationRecord {
  conversationId: string;
  directoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  agentType: string;
  adapterState: Record<string, unknown>;
  runtimeStatus: ConversationState['status'];
  runtimeStatusModel: ConversationState['statusModel'];
  runtimeLive: boolean;
}

interface CreateConversationInput {
  sessionId: string;
  directoryId: string | null;
  title: string;
  agentType: string;
  adapterState: Record<string, unknown>;
}

interface EnsureConversationDependencies {
  resolveDefaultDirectoryId: () => string | null;
  normalizeAdapterState: (value: Record<string, unknown> | undefined) => Record<string, unknown>;
  createConversation: (input: CreateConversationInput) => ConversationState;
}

interface UpsertPersistedConversationInput {
  record: PersistedConversationRecord;
  ensureConversation: (sessionId: string, seed?: ConversationSeed) => ConversationState;
}

type SessionSummaryRecord = NonNullable<Parameters<typeof applySummaryToConversation>[1]>;

interface UpsertSessionSummaryInput {
  summary: SessionSummaryRecord;
  ensureConversation: (sessionId: string, seed?: ConversationSeed) => ConversationState;
}

interface MarkSessionExitedInput {
  sessionId: string;
  exit: PtyExit;
  exitedAt: string;
}

interface IngestOutputChunkInput {
  sessionId: string;
  cursor: number;
  chunk: Buffer;
  ensureConversation: (sessionId: string, seed?: ConversationSeed) => ConversationState;
}

interface IngestOutputChunkResult {
  conversation: ConversationState;
  cursorRegressed: boolean;
  previousCursor: number;
}

interface IsControlledByLocalHumanInput {
  conversation: ConversationState;
  controllerId: string;
}

interface AttachIfLiveInput {
  sessionId: string;
  attach: (sinceCursor: number) => Promise<void>;
}

interface AttachIfLiveResult {
  attached: boolean;
  conversation: ConversationState | null;
  sinceCursor: number | null;
}

interface DetachIfAttachedInput {
  sessionId: string;
  detach: () => Promise<void>;
}

interface DetachIfAttachedResult {
  detached: boolean;
  conversation: ConversationState | null;
}

export class ConversationManager {
  private readonly conversationsBySessionId = new Map<string, ConversationState>();
  readonly startInFlightBySessionId = new Map<string, Promise<ConversationState>>();
  readonly removedConversationIds = new Set<string>();
  private ensureDependencies: EnsureConversationDependencies | null = null;

  activeConversationId: string | null = null;

  constructor() {}

  get(sessionId: string): ConversationState | undefined {
    return this.conversationsBySessionId.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.conversationsBySessionId.has(sessionId);
  }

  set(state: ConversationState): void {
    this.conversationsBySessionId.set(state.sessionId, state);
  }

  readonlyConversations(): ReadonlyMap<string, ConversationState> {
    return this.conversationsBySessionId;
  }

  values(): IterableIterator<ConversationState> {
    return this.conversationsBySessionId.values();
  }

  size(): number {
    return this.conversationsBySessionId.size;
  }

  getActiveConversation(): ConversationState | null {
    if (this.activeConversationId === null) {
      return null;
    }
    return this.conversationsBySessionId.get(this.activeConversationId) ?? null;
  }

  clearRemoved(sessionId: string): void {
    this.removedConversationIds.delete(sessionId);
  }

  isRemoved(sessionId: string): boolean {
    return this.removedConversationIds.has(sessionId);
  }

  getStartInFlight(sessionId: string): Promise<ConversationState> | undefined {
    return this.startInFlightBySessionId.get(sessionId);
  }

  setStartInFlight(sessionId: string, task: Promise<ConversationState>): void {
    this.startInFlightBySessionId.set(sessionId, task);
  }

  clearStartInFlight(sessionId: string): void {
    this.startInFlightBySessionId.delete(sessionId);
  }

  remove(sessionId: string): void {
    this.removedConversationIds.add(sessionId);
    this.conversationsBySessionId.delete(sessionId);
    this.startInFlightBySessionId.delete(sessionId);
    if (this.activeConversationId === sessionId) {
      this.activeConversationId = null;
    }
  }

  orderedIds(): readonly string[] {
    return [...this.conversationsBySessionId.keys()];
  }

  directoryIdOf(sessionId: string): string | null {
    return this.conversationsBySessionId.get(sessionId)?.directoryId ?? null;
  }

  isLive(sessionId: string): boolean {
    return this.conversationsBySessionId.get(sessionId)?.live === true;
  }

  setController(
    sessionId: string,
    controller: ConversationState['controller'],
  ): ConversationState | null {
    const conversation = this.conversationsBySessionId.get(sessionId);
    if (conversation === undefined) {
      return null;
    }
    conversation.controller = controller;
    return conversation;
  }

  setLastEventAt(sessionId: string, lastEventAt: string): ConversationState | null {
    const conversation = this.conversationsBySessionId.get(sessionId);
    if (conversation === undefined) {
      return null;
    }
    conversation.lastEventAt = lastEventAt;
    return conversation;
  }

  findConversationIdByDirectory(
    directoryId: string,
    orderedIds: readonly string[] = this.orderedIds(),
  ): string | null {
    for (const sessionId of orderedIds) {
      if (this.directoryIdOf(sessionId) === directoryId) {
        return sessionId;
      }
    }
    return null;
  }

  setActiveConversationId(sessionId: string | null): void {
    this.activeConversationId = sessionId;
  }

  configureEnsureDependencies(dependencies: EnsureConversationDependencies): void {
    this.ensureDependencies = dependencies;
  }

  ensureActiveConversationId(): string | null {
    if (this.activeConversationId === null) {
      this.activeConversationId = this.orderedIds()[0] ?? null;
    }
    return this.activeConversationId;
  }

  ensure(sessionId: string, seed?: ConversationSeed): ConversationState {
    if (this.ensureDependencies === null) {
      throw new Error('conversation ensure dependencies are not configured');
    }
    const existing = this.conversationsBySessionId.get(sessionId);
    if (existing !== undefined) {
      if (seed?.directoryId !== undefined) {
        existing.directoryId = seed.directoryId;
      }
      if (seed?.title !== undefined) {
        existing.title = seed.title;
      }
      if (seed?.agentType !== undefined) {
        existing.agentType = seed.agentType;
      }
      if (seed?.adapterState !== undefined) {
        existing.adapterState = this.ensureDependencies.normalizeAdapterState(seed.adapterState);
      }
      return existing;
    }

    this.clearRemoved(sessionId);
    const directoryId = seed?.directoryId ?? this.ensureDependencies.resolveDefaultDirectoryId();
    const state = this.ensureDependencies.createConversation({
      sessionId,
      directoryId,
      title: seed?.title ?? '',
      agentType: seed?.agentType ?? 'codex',
      adapterState: this.ensureDependencies.normalizeAdapterState(seed?.adapterState),
    });
    this.set(state);
    return state;
  }

  requireActiveConversation(): ConversationState {
    if (this.activeConversationId === null) {
      throw new Error('active thread is not set');
    }
    const state = this.conversationsBySessionId.get(this.activeConversationId);
    if (state === undefined) {
      throw new Error(`active thread missing: ${this.activeConversationId}`);
    }
    return state;
  }

  async runWithStartInFlight(
    sessionId: string,
    factory: () => Promise<ConversationState>,
  ): Promise<ConversationState> {
    const inFlight = this.getStartInFlight(sessionId);
    if (inFlight !== undefined) {
      return await inFlight;
    }
    const task = factory();
    this.setStartInFlight(sessionId, task);
    try {
      return await task;
    } finally {
      this.clearStartInFlight(sessionId);
    }
  }

  upsertFromPersistedRecord(input: UpsertPersistedConversationInput): ConversationState {
    const { record } = input;
    const existing = this.conversationsBySessionId.get(record.conversationId);
    const preserveLiveRuntime = existing?.live === true;
    const conversation = input.ensureConversation(record.conversationId, {
      directoryId: record.directoryId,
      title: record.title,
      agentType: record.agentType,
      adapterState: record.adapterState,
    });
    conversation.scope.tenantId = record.tenantId;
    conversation.scope.userId = record.userId;
    conversation.scope.workspaceId = record.workspaceId;
    if (!preserveLiveRuntime) {
      const runtimeStatusModel = record.runtimeStatusModel;
      conversation.status = record.runtimeStatus;
      conversation.statusModel = runtimeStatusModel;
      conversation.attentionReason = runtimeStatusModel?.attentionReason ?? null;
      conversation.lastKnownWork = runtimeStatusModel?.lastKnownWork ?? null;
      conversation.lastKnownWorkAt = runtimeStatusModel?.lastKnownWorkAt ?? null;
    }
    // Persisted runtime flags are advisory; session.list is authoritative for live sessions.
    conversation.live = preserveLiveRuntime ? true : false;
    return conversation;
  }

  upsertFromSessionSummary(input: UpsertSessionSummaryInput): ConversationState {
    const conversation = input.ensureConversation(input.summary.sessionId);
    applySummaryToConversation(conversation, input.summary);
    return conversation;
  }

  markSessionExited(input: MarkSessionExitedInput): ConversationState | null {
    const conversation = this.conversationsBySessionId.get(input.sessionId);
    if (conversation === undefined) {
      return null;
    }
    conversation.status = 'exited';
    conversation.live = false;
    conversation.attentionReason = null;
    conversation.lastExit = input.exit;
    conversation.exitedAt = input.exitedAt;
    conversation.attached = false;
    return conversation;
  }

  ingestOutputChunk(input: IngestOutputChunkInput): IngestOutputChunkResult {
    const conversation = input.ensureConversation(input.sessionId);
    const previousCursor = conversation.lastOutputCursor;
    const cursorRegressed = input.cursor < previousCursor;
    if (cursorRegressed) {
      conversation.lastOutputCursor = 0;
    }
    conversation.oracle.ingest(input.chunk);
    conversation.lastOutputCursor = input.cursor;
    return {
      conversation,
      cursorRegressed,
      previousCursor,
    };
  }

  setAttached(sessionId: string, attached: boolean): ConversationState | null {
    const conversation = this.conversationsBySessionId.get(sessionId);
    if (conversation === undefined) {
      return null;
    }
    conversation.attached = attached;
    return conversation;
  }

  markSessionUnavailable(sessionId: string): ConversationState | null {
    const conversation = this.conversationsBySessionId.get(sessionId);
    if (conversation === undefined) {
      return null;
    }
    conversation.live = false;
    conversation.attached = false;
    if (conversation.status === 'running' || conversation.status === 'needs-input') {
      conversation.status = 'completed';
      conversation.attentionReason = null;
    }
    return conversation;
  }

  isControlledByLocalHuman(input: IsControlledByLocalHumanInput): boolean {
    return (
      input.conversation.controller !== null &&
      input.conversation.controller.controllerType === 'human' &&
      input.conversation.controller.controllerId === input.controllerId
    );
  }

  async attachIfLive(input: AttachIfLiveInput): Promise<AttachIfLiveResult> {
    const conversation = this.conversationsBySessionId.get(input.sessionId);
    if (conversation === undefined || !conversation.live || conversation.attached) {
      return {
        attached: false,
        conversation: conversation ?? null,
        sinceCursor: null,
      };
    }
    const sinceCursor = Math.max(0, conversation.lastOutputCursor);
    await input.attach(sinceCursor);
    conversation.attached = true;
    return {
      attached: true,
      conversation,
      sinceCursor,
    };
  }

  async detachIfAttached(input: DetachIfAttachedInput): Promise<DetachIfAttachedResult> {
    const conversation = this.conversationsBySessionId.get(input.sessionId);
    if (conversation === undefined || !conversation.attached) {
      return {
        detached: false,
        conversation: conversation ?? null,
      };
    }
    await input.detach();
    conversation.attached = false;
    return {
      detached: true,
      conversation,
    };
  }
}
