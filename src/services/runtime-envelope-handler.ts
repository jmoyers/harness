import type {
  StreamObservedEvent,
  StreamServerEnvelope,
} from '../control-plane/stream-protocol.ts';
import type { PtyExit } from '../pty/pty_host.ts';

interface RuntimeEnvelopeConversationLike {
  directoryId: string | null;
  agentType: string;
  adapterState: Record<string, unknown>;
  scope: unknown;
  lastEventAt: string | null;
}

interface RuntimeEnvelopeOutputIngestResult<TConversation extends RuntimeEnvelopeConversationLike> {
  readonly conversation: TConversation;
  readonly cursorRegressed: boolean;
  readonly previousCursor: number;
}

interface RuntimeObservedEventEnvelopeInput {
  readonly subscriptionId: string;
  readonly cursor: number;
  readonly event: StreamObservedEvent;
}

export interface RuntimeEnvelopeHandlerOptions<
  TConversation extends RuntimeEnvelopeConversationLike,
  TNormalizedEvent extends { ts: string },
> {
  readonly perfNowNs: () => bigint;
  readonly isRemoved: (sessionId: string) => boolean;
  readonly ensureConversation: (sessionId: string) => TConversation;
  readonly ingestOutputChunk: (input: {
    sessionId: string;
    cursor: number;
    chunk: Buffer;
    ensureConversation: (sessionId: string) => TConversation;
  }) => RuntimeEnvelopeOutputIngestResult<TConversation>;
  readonly noteGitActivity: (directoryId: string | null) => void;
  readonly recordOutputChunk: (input: {
    sessionId: string;
    chunkLength: number;
    active: boolean;
  }) => void;
  readonly startupOutputChunk: (sessionId: string, chunkLength: number) => void;
  readonly startupPaintOutputChunk: (sessionId: string) => void;
  readonly recordPerfEvent: (
    name: string,
    attrs: Record<string, string | number | boolean>,
  ) => void;
  readonly mapTerminalOutputToNormalizedEvent: (
    chunk: Buffer,
    scope: unknown,
    idFactory: () => string,
  ) => TNormalizedEvent;
  readonly mapSessionEventToNormalizedEvent: (
    event: unknown,
    scope: unknown,
    idFactory: () => string,
  ) => TNormalizedEvent | null;
  readonly observedAtFromSessionEvent: (event: unknown) => string;
  readonly mergeAdapterStateFromSessionEvent: (
    agentType: string,
    adapterState: Record<string, unknown>,
    event: unknown,
    observedAt: string,
  ) => Record<string, unknown> | null;
  readonly enqueueEvent: (event: TNormalizedEvent) => void;
  readonly activeConversationId: () => string | null;
  readonly markSessionExited: (input: {
    sessionId: string;
    exit: PtyExit;
    exitedAt: string;
  }) => void;
  readonly deletePtySize: (sessionId: string) => void;
  readonly setExit: (exit: PtyExit) => void;
  readonly markDirty: () => void;
  readonly nowIso: () => string;
  readonly recordOutputHandled: (durationMs: number) => void;
  readonly conversationById: (sessionId: string) => TConversation | undefined;
  readonly applyObservedEvent: (input: RuntimeObservedEventEnvelopeInput) => void;
  readonly idFactory: () => string;
}

export function handleRuntimeEnvelope<
  TConversation extends RuntimeEnvelopeConversationLike,
  TNormalizedEvent extends { ts: string },
>(
  options: RuntimeEnvelopeHandlerOptions<TConversation, TNormalizedEvent>,
  envelope: StreamServerEnvelope,
): void {
  if (envelope.kind === 'pty.output') {
    const outputHandledStartedAtNs = options.perfNowNs();
    if (options.isRemoved(envelope.sessionId)) {
      return;
    }
    const chunk = Buffer.from(envelope.chunkBase64, 'base64');
    const outputIngest = options.ingestOutputChunk({
      sessionId: envelope.sessionId,
      cursor: envelope.cursor,
      chunk,
      ensureConversation: options.ensureConversation,
    });
    const conversation = outputIngest.conversation;
    options.noteGitActivity(conversation.directoryId);
    options.recordOutputChunk({
      sessionId: envelope.sessionId,
      chunkLength: chunk.length,
      active: options.activeConversationId() === envelope.sessionId,
    });
    options.startupOutputChunk(envelope.sessionId, chunk.length);
    options.startupPaintOutputChunk(envelope.sessionId);
    if (outputIngest.cursorRegressed) {
      options.recordPerfEvent('mux.output.cursor-regression', {
        sessionId: envelope.sessionId,
        previousCursor: outputIngest.previousCursor,
        cursor: envelope.cursor,
      });
    }

    const normalized = options.mapTerminalOutputToNormalizedEvent(
      chunk,
      conversation.scope,
      options.idFactory,
    );
    options.enqueueEvent(normalized);
    conversation.lastEventAt = normalized.ts;
    if (options.activeConversationId() === envelope.sessionId) {
      options.markDirty();
    }
    const outputHandledDurationMs = Number(options.perfNowNs() - outputHandledStartedAtNs) / 1e6;
    options.recordOutputHandled(outputHandledDurationMs);
    return;
  }

  if (envelope.kind === 'pty.event') {
    if (options.isRemoved(envelope.sessionId)) {
      return;
    }
    const conversation = options.ensureConversation(envelope.sessionId);
    options.noteGitActivity(conversation.directoryId);
    const observedAt = options.observedAtFromSessionEvent(envelope.event);
    const updatedAdapterState = options.mergeAdapterStateFromSessionEvent(
      conversation.agentType,
      conversation.adapterState,
      envelope.event,
      observedAt,
    );
    if (updatedAdapterState !== null) {
      conversation.adapterState = updatedAdapterState;
    }
    const normalized = options.mapSessionEventToNormalizedEvent(
      envelope.event,
      conversation.scope,
      options.idFactory,
    );
    if (normalized !== null) {
      options.enqueueEvent(normalized);
    }
    if (envelope.event.type === 'session-exit') {
      options.setExit(envelope.event.exit);
      options.markSessionExited({
        sessionId: envelope.sessionId,
        exit: envelope.event.exit,
        exitedAt: options.nowIso(),
      });
      options.deletePtySize(envelope.sessionId);
    }
    options.markDirty();
    return;
  }

  if (envelope.kind === 'pty.exit') {
    if (options.isRemoved(envelope.sessionId)) {
      return;
    }
    const conversation = options.conversationById(envelope.sessionId);
    if (conversation !== undefined) {
      options.noteGitActivity(conversation.directoryId);
      options.setExit(envelope.exit);
      options.markSessionExited({
        sessionId: envelope.sessionId,
        exit: envelope.exit,
        exitedAt: options.nowIso(),
      });
      options.deletePtySize(envelope.sessionId);
    }
    options.markDirty();
    return;
  }

  if (envelope.kind === 'stream.event') {
    options.applyObservedEvent({
      subscriptionId: envelope.subscriptionId,
      cursor: envelope.cursor,
      event: envelope.event,
    });
  }
}
