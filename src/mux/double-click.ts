interface ConversationDoubleClickState {
  readonly conversationId: string;
  readonly atMs: number;
}

interface ConversationDoubleClickResult {
  readonly doubleClick: boolean;
  readonly nextState: ConversationDoubleClickState | null;
}

export function detectConversationDoubleClick(
  previous: ConversationDoubleClickState | null,
  conversationId: string,
  nowMs: number,
  windowMs: number
): ConversationDoubleClickResult {
  const elapsedMs = previous === null ? Number.POSITIVE_INFINITY : nowMs - previous.atMs;
  if (
    previous !== null &&
    previous.conversationId === conversationId &&
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
      conversationId,
      atMs: nowMs
    }
  };
}
