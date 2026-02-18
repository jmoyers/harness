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

export interface PersistedConversationRecord {
  conversationId: string;
  directoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  agentType: string;
  adapterState: Record<string, unknown>;
  runtimeStatus: ConversationState['status'];
  runtimeLive: boolean;
}

interface EnsureConversationInput {
  sessionId: string;
  seed?: ConversationSeed;
  resolveDefaultDirectoryId: () => string | null;
  normalizeAdapterState: (value: Record<string, unknown> | undefined) => Record<string, unknown>;
  createConversation: (input: {
    sessionId: string;
    directoryId: string | null;
    title: string;
    agentType: string;
    adapterState: Record<string, unknown>;
  }) => ConversationState;
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
  readonly conversations = new Map<string, ConversationState>();
  readonly startInFlightBySessionId = new Map<string, Promise<ConversationState>>();
  readonly removedConversationIds = new Set<string>();

  activeConversationId: string | null = null;

  get(sessionId: string): ConversationState | undefined {
    return this.conversations.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.conversations.has(sessionId);
  }

  set(state: ConversationState): void {
    this.conversations.set(state.sessionId, state);
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
    this.conversations.delete(sessionId);
    this.startInFlightBySessionId.delete(sessionId);
    if (this.activeConversationId === sessionId) {
      this.activeConversationId = null;
    }
  }

  orderedIds(): readonly string[] {
    return [...this.conversations.keys()];
  }

  setActiveConversationId(sessionId: string | null): void {
    this.activeConversationId = sessionId;
  }

  ensureActiveConversationId(): string | null {
    if (this.activeConversationId === null) {
      this.activeConversationId = this.orderedIds()[0] ?? null;
    }
    return this.activeConversationId;
  }

  ensure(input: EnsureConversationInput): ConversationState {
    const existing = this.conversations.get(input.sessionId);
    if (existing !== undefined) {
      if (input.seed?.directoryId !== undefined) {
        existing.directoryId = input.seed.directoryId;
      }
      if (input.seed?.title !== undefined) {
        existing.title = input.seed.title;
      }
      if (input.seed?.agentType !== undefined) {
        existing.agentType = input.seed.agentType;
      }
      if (input.seed?.adapterState !== undefined) {
        existing.adapterState = input.normalizeAdapterState(input.seed.adapterState);
      }
      return existing;
    }

    this.clearRemoved(input.sessionId);
    const directoryId = input.seed?.directoryId ?? input.resolveDefaultDirectoryId();
    const state = input.createConversation({
      sessionId: input.sessionId,
      directoryId,
      title: input.seed?.title ?? '',
      agentType: input.seed?.agentType ?? 'codex',
      adapterState: input.normalizeAdapterState(input.seed?.adapterState),
    });
    this.set(state);
    return state;
  }

  requireActiveConversation(): ConversationState {
    if (this.activeConversationId === null) {
      throw new Error('active thread is not set');
    }
    const state = this.conversations.get(this.activeConversationId);
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
    const conversation = input.ensureConversation(record.conversationId, {
      directoryId: record.directoryId,
      title: record.title,
      agentType: record.agentType,
      adapterState: record.adapterState,
    });
    conversation.scope.tenantId = record.tenantId;
    conversation.scope.userId = record.userId;
    conversation.scope.workspaceId = record.workspaceId;
    conversation.status =
      !record.runtimeLive &&
      (record.runtimeStatus === 'running' || record.runtimeStatus === 'needs-input')
        ? 'completed'
        : record.runtimeStatus;
    // Persisted runtime flags are advisory; session.list is authoritative for live sessions.
    conversation.live = false;
    return conversation;
  }

  upsertFromSessionSummary(input: UpsertSessionSummaryInput): ConversationState {
    const conversation = input.ensureConversation(input.summary.sessionId);
    applySummaryToConversation(conversation, input.summary);
    return conversation;
  }

  markSessionExited(input: MarkSessionExitedInput): ConversationState | null {
    const conversation = this.conversations.get(input.sessionId);
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
    const conversation = this.conversations.get(sessionId);
    if (conversation === undefined) {
      return null;
    }
    conversation.attached = attached;
    return conversation;
  }

  markSessionUnavailable(sessionId: string): ConversationState | null {
    const conversation = this.conversations.get(sessionId);
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
    const conversation = this.conversations.get(input.sessionId);
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
    const conversation = this.conversations.get(input.sessionId);
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
