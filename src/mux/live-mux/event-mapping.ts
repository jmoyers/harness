import type { EventScope, NormalizedEventEnvelope } from '../../events/normalized-events.ts';
import { createNormalizedEvent } from '../../events/normalized-events.ts';
import type { PtyExit } from '../../pty/pty_host.ts';
import type { StreamSessionEvent } from '../../control-plane/stream-protocol.ts';

export function normalizeExitCode(exit: PtyExit): number {
  if (exit.code !== null) {
    return exit.code;
  }
  if (exit.signal !== null) {
    return 128;
  }
  return 1;
}

export function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /session not found/i.test(error.message);
}

export function isSessionNotLiveError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /session is not live/i.test(error.message);
}

export function isConversationNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /conversation not found/i.test(error.message);
}

export function mapTerminalOutputToNormalizedEvent(
  chunk: Buffer,
  scope: EventScope,
  idFactory: () => string
): NormalizedEventEnvelope {
  return createNormalizedEvent(
    'provider',
    'provider-text-delta',
    scope,
    {
      kind: 'text-delta',
      threadId: scope.conversationId,
      turnId: scope.turnId ?? 'turn-live',
      delta: chunk.toString('utf8')
    },
    () => new Date(),
    idFactory
  );
}

export function mapSessionEventToNormalizedEvent(
  event: StreamSessionEvent,
  scope: EventScope,
  idFactory: () => string
): NormalizedEventEnvelope | null {
  if (event.type === 'session-exit') {
    return createNormalizedEvent(
      'meta',
      'meta-attention-cleared',
      scope,
      {
        kind: 'attention',
        threadId: scope.conversationId,
        turnId: scope.turnId ?? 'turn-live',
        reason: 'stalled',
        detail: 'session-exit'
      },
      () => new Date(),
      idFactory
    );
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function observedAtFromSessionEvent(event: StreamSessionEvent): string {
  if (event.type === 'session-exit') {
    return new Date().toISOString();
  }
  const record = asRecord((event as { record?: unknown }).record);
  const ts = record?.['ts'];
  return typeof ts === 'string' ? ts : new Date().toISOString();
}
