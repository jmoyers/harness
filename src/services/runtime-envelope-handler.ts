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

interface RuntimeEnvelopeHandlerOptions<
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

export class RuntimeEnvelopeHandler<
  TConversation extends RuntimeEnvelopeConversationLike,
  TNormalizedEvent extends { ts: string },
> {
  constructor(
    private readonly options: RuntimeEnvelopeHandlerOptions<TConversation, TNormalizedEvent>,
  ) {}

  handleEnvelope(envelope: StreamServerEnvelope): void {
    if (envelope.kind === 'pty.output') {
      const outputHandledStartedAtNs = this.options.perfNowNs();
      if (this.options.isRemoved(envelope.sessionId)) {
        return;
      }
      const chunk = Buffer.from(envelope.chunkBase64, 'base64');
      const outputIngest = this.options.ingestOutputChunk({
        sessionId: envelope.sessionId,
        cursor: envelope.cursor,
        chunk,
        ensureConversation: this.options.ensureConversation,
      });
      const conversation = outputIngest.conversation;
      this.options.noteGitActivity(conversation.directoryId);
      this.options.recordOutputChunk({
        sessionId: envelope.sessionId,
        chunkLength: chunk.length,
        active: this.options.activeConversationId() === envelope.sessionId,
      });
      this.options.startupOutputChunk(envelope.sessionId, chunk.length);
      this.options.startupPaintOutputChunk(envelope.sessionId);
      if (outputIngest.cursorRegressed) {
        this.options.recordPerfEvent('mux.output.cursor-regression', {
          sessionId: envelope.sessionId,
          previousCursor: outputIngest.previousCursor,
          cursor: envelope.cursor,
        });
      }

      const normalized = this.options.mapTerminalOutputToNormalizedEvent(
        chunk,
        conversation.scope,
        this.options.idFactory,
      );
      this.options.enqueueEvent(normalized);
      conversation.lastEventAt = normalized.ts;
      if (this.options.activeConversationId() === envelope.sessionId) {
        this.options.markDirty();
      }
      const outputHandledDurationMs =
        Number(this.options.perfNowNs() - outputHandledStartedAtNs) / 1e6;
      this.options.recordOutputHandled(outputHandledDurationMs);
      return;
    }

    if (envelope.kind === 'pty.event') {
      if (this.options.isRemoved(envelope.sessionId)) {
        return;
      }
      const conversation = this.options.ensureConversation(envelope.sessionId);
      this.options.noteGitActivity(conversation.directoryId);
      const observedAt = this.options.observedAtFromSessionEvent(envelope.event);
      const updatedAdapterState = this.options.mergeAdapterStateFromSessionEvent(
        conversation.agentType,
        conversation.adapterState,
        envelope.event,
        observedAt,
      );
      if (updatedAdapterState !== null) {
        conversation.adapterState = updatedAdapterState;
      }
      const normalized = this.options.mapSessionEventToNormalizedEvent(
        envelope.event,
        conversation.scope,
        this.options.idFactory,
      );
      if (normalized !== null) {
        this.options.enqueueEvent(normalized);
      }
      if (envelope.event.type === 'session-exit') {
        this.options.setExit(envelope.event.exit);
        this.options.markSessionExited({
          sessionId: envelope.sessionId,
          exit: envelope.event.exit,
          exitedAt: this.options.nowIso(),
        });
        this.options.deletePtySize(envelope.sessionId);
      }
      this.options.markDirty();
      return;
    }

    if (envelope.kind === 'pty.exit') {
      if (this.options.isRemoved(envelope.sessionId)) {
        return;
      }
      const conversation = this.options.conversationById(envelope.sessionId);
      if (conversation !== undefined) {
        this.options.noteGitActivity(conversation.directoryId);
        this.options.setExit(envelope.exit);
        this.options.markSessionExited({
          sessionId: envelope.sessionId,
          exit: envelope.exit,
          exitedAt: this.options.nowIso(),
        });
        this.options.deletePtySize(envelope.sessionId);
      }
      this.options.markDirty();
      return;
    }

    if (envelope.kind === 'stream.event') {
      this.options.applyObservedEvent({
        subscriptionId: envelope.subscriptionId,
        cursor: envelope.cursor,
        event: envelope.event,
      });
    }
  }
}
