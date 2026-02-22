export interface RuntimeStreamSubscriptionsOptions {
  readonly subscribePtyEvents: (sessionId: string) => Promise<void>;
  readonly unsubscribePtyEvents: (sessionId: string) => Promise<void>;
  readonly isSessionNotFoundError: (error: unknown) => boolean;
  readonly isSessionNotLiveError: (error: unknown) => boolean;
  readonly subscribeObservedStream: (afterCursor: number | null) => Promise<string>;
  readonly unsubscribeObservedStream: (subscriptionId: string) => Promise<void>;
}

export interface RuntimeStreamSubscriptions {
  subscribeConversationEvents(sessionId: string): Promise<void>;
  unsubscribeConversationEvents(sessionId: string): Promise<void>;
  subscribeTaskPlanningEvents(afterCursor: number | null): Promise<void>;
  unsubscribeTaskPlanningEvents(): Promise<void>;
}

export function createRuntimeStreamSubscriptions(
  options: RuntimeStreamSubscriptionsOptions,
): RuntimeStreamSubscriptions {
  let observedStreamSubscriptionId: string | null = null;

  const subscribeConversationEvents = async (sessionId: string): Promise<void> => {
    try {
      await options.subscribePtyEvents(sessionId);
    } catch (error: unknown) {
      if (!options.isSessionNotFoundError(error) && !options.isSessionNotLiveError(error)) {
        throw error;
      }
    }
  };

  const unsubscribeConversationEvents = async (sessionId: string): Promise<void> => {
    try {
      await options.unsubscribePtyEvents(sessionId);
    } catch (error: unknown) {
      if (!options.isSessionNotFoundError(error) && !options.isSessionNotLiveError(error)) {
        throw error;
      }
    }
  };

  const subscribeTaskPlanningEvents = async (afterCursor: number | null): Promise<void> => {
    if (observedStreamSubscriptionId !== null) {
      return;
    }
    observedStreamSubscriptionId = await options.subscribeObservedStream(afterCursor);
  };

  const unsubscribeTaskPlanningEvents = async (): Promise<void> => {
    if (observedStreamSubscriptionId === null) {
      return;
    }
    const subscriptionId = observedStreamSubscriptionId;
    observedStreamSubscriptionId = null;
    await options.unsubscribeObservedStream(subscriptionId);
  };

  return {
    subscribeConversationEvents,
    unsubscribeConversationEvents,
    subscribeTaskPlanningEvents,
    unsubscribeTaskPlanningEvents,
  };
}
