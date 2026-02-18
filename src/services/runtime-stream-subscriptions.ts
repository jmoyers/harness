export interface RuntimeStreamSubscriptionsOptions {
  readonly subscribePtyEvents: (sessionId: string) => Promise<void>;
  readonly unsubscribePtyEvents: (sessionId: string) => Promise<void>;
  readonly isSessionNotFoundError: (error: unknown) => boolean;
  readonly isSessionNotLiveError: (error: unknown) => boolean;
  readonly subscribeObservedStream: (afterCursor: number | null) => Promise<string>;
  readonly unsubscribeObservedStream: (subscriptionId: string) => Promise<void>;
}

export class RuntimeStreamSubscriptions {
  private observedStreamSubscriptionId: string | null = null;

  constructor(private readonly options: RuntimeStreamSubscriptionsOptions) {}

  async subscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await this.options.subscribePtyEvents(sessionId);
    } catch (error: unknown) {
      if (
        !this.options.isSessionNotFoundError(error) &&
        !this.options.isSessionNotLiveError(error)
      ) {
        throw error;
      }
    }
  }

  async unsubscribeConversationEvents(sessionId: string): Promise<void> {
    try {
      await this.options.unsubscribePtyEvents(sessionId);
    } catch (error: unknown) {
      if (
        !this.options.isSessionNotFoundError(error) &&
        !this.options.isSessionNotLiveError(error)
      ) {
        throw error;
      }
    }
  }

  async subscribeTaskPlanningEvents(afterCursor: number | null): Promise<void> {
    if (this.observedStreamSubscriptionId !== null) {
      return;
    }
    this.observedStreamSubscriptionId = await this.options.subscribeObservedStream(afterCursor);
  }

  async unsubscribeTaskPlanningEvents(): Promise<void> {
    if (this.observedStreamSubscriptionId === null) {
      return;
    }
    const subscriptionId = this.observedStreamSubscriptionId;
    this.observedStreamSubscriptionId = null;
    await this.options.unsubscribeObservedStream(subscriptionId);
  }
}
