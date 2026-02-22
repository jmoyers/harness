export interface ObservedStreamCursorState {
  readonly lastCursorBySubscriptionId: ReadonlyMap<string, number>;
}

interface ObserveStreamCursorInput {
  readonly subscriptionId: string;
  readonly cursor: number;
}

interface ObserveStreamCursorResult {
  readonly accepted: boolean;
  readonly previousCursor: number | null;
  readonly state: ObservedStreamCursorState;
}

export function createObservedStreamCursorState(): ObservedStreamCursorState {
  return {
    lastCursorBySubscriptionId: new Map<string, number>(),
  };
}

export function observeStreamCursor(
  state: ObservedStreamCursorState,
  input: ObserveStreamCursorInput,
): ObserveStreamCursorResult {
  const previousCursor = state.lastCursorBySubscriptionId.get(input.subscriptionId) ?? null;
  if (previousCursor !== null && input.cursor <= previousCursor) {
    return {
      accepted: false,
      previousCursor,
      state,
    };
  }
  const next = new Map(state.lastCursorBySubscriptionId);
  next.set(input.subscriptionId, input.cursor);
  return {
    accepted: true,
    previousCursor,
    state: {
      lastCursorBySubscriptionId: next,
    },
  };
}
