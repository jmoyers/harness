import {
  ConversationStartupHydrationService,
  type ConversationStartupHydrationServiceOptions,
  type SessionSummaryLike,
} from './conversation-startup-hydration.ts';
import {
  RuntimeConversationStarter,
  type RuntimeConversationStarterConversationRecord,
  type RuntimeConversationStarterOptions,
} from './runtime-conversation-starter.ts';
import {
  RuntimeStreamSubscriptions,
  type RuntimeStreamSubscriptionsOptions,
} from './runtime-stream-subscriptions.ts';
import {
  StartupPersistedConversationQueueService,
  type StartupPersistedConversationQueueServiceOptions,
  type StartupQueueConversationRecord,
} from './startup-persisted-conversation-queue.ts';

interface ConversationLifecycleOptions<
  TConversation extends RuntimeConversationStarterConversationRecord &
    StartupQueueConversationRecord,
  TSessionSummary extends SessionSummaryLike,
> {
  readonly streamSubscriptions: RuntimeStreamSubscriptionsOptions;
  readonly starter: Omit<
    RuntimeConversationStarterOptions<TConversation, TSessionSummary>,
    'subscribeConversationEvents'
  >;
  readonly startupHydration: Omit<
    ConversationStartupHydrationServiceOptions<TSessionSummary>,
    'subscribeConversationEvents'
  >;
  readonly startupQueue: Omit<
    StartupPersistedConversationQueueServiceOptions<TConversation>,
    'startConversation'
  >;
}

export class ConversationLifecycle<
  TConversation extends RuntimeConversationStarterConversationRecord &
    StartupQueueConversationRecord,
  TSessionSummary extends SessionSummaryLike,
> {
  private readonly streamSubscriptions: RuntimeStreamSubscriptions;
  private readonly starter: RuntimeConversationStarter<TConversation, TSessionSummary>;
  private readonly startupHydration: ConversationStartupHydrationService<TSessionSummary>;
  private readonly startupQueue: StartupPersistedConversationQueueService<TConversation>;

  constructor(options: ConversationLifecycleOptions<TConversation, TSessionSummary>) {
    this.streamSubscriptions = new RuntimeStreamSubscriptions(options.streamSubscriptions);
    this.starter = new RuntimeConversationStarter({
      ...options.starter,
      subscribeConversationEvents: async (sessionId) => {
        await this.subscribeConversationEvents(sessionId);
      },
    });
    this.startupHydration = new ConversationStartupHydrationService({
      ...options.startupHydration,
      subscribeConversationEvents: async (sessionId) => {
        await this.subscribeConversationEvents(sessionId);
      },
    });
    this.startupQueue = new StartupPersistedConversationQueueService({
      ...options.startupQueue,
      startConversation: async (sessionId) => {
        await this.startConversation(sessionId);
      },
    });
  }

  async subscribeConversationEvents(sessionId: string): Promise<void> {
    await this.streamSubscriptions.subscribeConversationEvents(sessionId);
  }

  async unsubscribeConversationEvents(sessionId: string): Promise<void> {
    await this.streamSubscriptions.unsubscribeConversationEvents(sessionId);
  }

  async subscribeTaskPlanningEvents(afterCursor: number | null): Promise<void> {
    await this.streamSubscriptions.subscribeTaskPlanningEvents(afterCursor);
  }

  async unsubscribeTaskPlanningEvents(): Promise<void> {
    await this.streamSubscriptions.unsubscribeTaskPlanningEvents();
  }

  async startConversation(sessionId: string): Promise<TConversation> {
    return await this.starter.startConversation(sessionId);
  }

  async hydrateConversationList(): Promise<void> {
    await this.startupHydration.hydrateConversationList();
  }

  queuePersistedConversationsInBackground(activeSessionId: string | null): number {
    return this.startupQueue.queuePersistedConversationsInBackground(activeSessionId);
  }
}
