interface ConversationDoubleClickState {
  readonly conversationId: string;
  readonly atMs: number;
}

interface ConversationDoubleClickResult {
  readonly doubleClick: boolean;
  readonly nextState: ConversationDoubleClickState | null;
}

interface EntityDoubleClickState {
  readonly entityId: string;
  readonly atMs: number;
}

interface EntityDoubleClickResult {
  readonly doubleClick: boolean;
  readonly nextState: EntityDoubleClickState | null;
}

export function detectEntityDoubleClick(
  previous: EntityDoubleClickState | null,
  entityId: string,
  nowMs: number,
  windowMs: number
): EntityDoubleClickResult {
  const elapsedMs = previous === null ? Number.POSITIVE_INFINITY : nowMs - previous.atMs;
  if (
    previous !== null &&
    previous.entityId === entityId &&
    elapsedMs >= 0 &&
    elapsedMs <= windowMs
  ) {
    return {
      doubleClick: true,
      nextState: null
    };
  }
  return {
    doubleClick: false,
    nextState: {
      entityId,
      atMs: nowMs
    }
  };
}

export function detectConversationDoubleClick(
  previous: ConversationDoubleClickState | null,
  conversationId: string,
  nowMs: number,
  windowMs: number
): ConversationDoubleClickResult {
  const generic = detectEntityDoubleClick(
    previous === null
      ? null
      : {
          entityId: previous.conversationId,
          atMs: previous.atMs
        },
    conversationId,
    nowMs,
    windowMs
  );
  if (generic.nextState === null) {
    return {
      doubleClick: generic.doubleClick,
      nextState: null
    };
  }
  return {
    doubleClick: generic.doubleClick,
    nextState: {
      conversationId: generic.nextState.entityId,
      atMs: generic.nextState.atMs
    }
  };
}
