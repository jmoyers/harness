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
  RuntimeConversationActivation,
  type RuntimeConversationActivationOptions,
} from './runtime-conversation-activation.ts';
import {
  RuntimeConversationActions,
  type RuntimeConversationActionsOptions,
} from './runtime-conversation-actions.ts';
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
  TControllerRecord,
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
  readonly activation: Omit<RuntimeConversationActivationOptions, 'startConversation'>;
  readonly actions: Omit<
    RuntimeConversationActionsOptions<TControllerRecord>,
    'startConversation' | 'activateConversation'
  >;
}

export class ConversationLifecycle<
  TConversation extends RuntimeConversationStarterConversationRecord &
    StartupQueueConversationRecord,
  TSessionSummary extends SessionSummaryLike,
  TControllerRecord,
> {
  private readonly streamSubscriptions: RuntimeStreamSubscriptions;
  private readonly starter: RuntimeConversationStarter<TConversation, TSessionSummary>;
  private readonly startupHydration: ConversationStartupHydrationService<TSessionSummary>;
  private readonly startupQueue: StartupPersistedConversationQueueService<TConversation>;
  private readonly activation: RuntimeConversationActivation;
  private readonly actions: RuntimeConversationActions<TControllerRecord>;

  constructor(options: ConversationLifecycleOptions<TConversation, TSessionSummary, TControllerRecord>) {
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
    this.activation = new RuntimeConversationActivation({
      ...options.activation,
      startConversation: async (sessionId) => {
        await this.startConversation(sessionId);
      },
    });
    this.actions = new RuntimeConversationActions({
      ...options.actions,
      startConversation: async (sessionId) => {
        await this.startConversation(sessionId);
      },
      activateConversation: async (sessionId) => {
        await this.activateConversation(sessionId);
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

  async activateConversation(sessionId: string): Promise<void> {
    await this.activation.activateConversation(sessionId);
  }

  async createAndActivateConversationInDirectory(
    directoryId: string,
    agentType: string,
  ): Promise<void> {
    await this.actions.createAndActivateConversationInDirectory(directoryId, agentType);
  }

  async openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void> {
    await this.actions.openOrCreateCritiqueConversationInDirectory(directoryId);
  }

  async takeoverConversation(sessionId: string): Promise<void> {
    await this.actions.takeoverConversation(sessionId);
  }

  async hydrateConversationList(): Promise<void> {
    await this.startupHydration.hydrateConversationList();
  }

  queuePersistedConversationsInBackground(activeSessionId: string | null): number {
    return this.startupQueue.queuePersistedConversationsInBackground(activeSessionId);
  }
}
