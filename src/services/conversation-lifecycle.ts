import {
  createConversationStartupHydrationService,
  type ConversationStartupHydrationService,
  type ConversationStartupHydrationServiceOptions,
  type SessionSummaryLike,
} from './conversation-startup-hydration.ts';
import {
  createRuntimeConversationStarter,
  type RuntimeConversationStarter,
  type RuntimeConversationStarterConversationRecord,
  type RuntimeConversationStarterOptions,
} from './runtime-conversation-starter.ts';
import {
  createRuntimeConversationActivation,
  type RuntimeConversationActivation,
  type RuntimeConversationActivationOptions,
} from './runtime-conversation-activation.ts';
import {
  createRuntimeConversationActions,
  type RuntimeConversationActions,
  type RuntimeConversationActionsOptions,
} from './runtime-conversation-actions.ts';
import {
  createRuntimeConversationTitleEditService,
  type RuntimeConversationTitleEditServiceOptions,
} from './runtime-conversation-title-edit.ts';
import {
  createRuntimeStreamSubscriptions,
  type RuntimeStreamSubscriptionsOptions,
} from './runtime-stream-subscriptions.ts';
import {
  createStartupPersistedConversationQueueService,
  type StartupPersistedConversationQueueService,
  type StartupPersistedConversationQueueServiceOptions,
  type StartupQueueConversationRecord,
} from './startup-persisted-conversation-queue.ts';

export interface ConversationLifecycleOptions<
  TConversation extends RuntimeConversationStarterConversationRecord &
    StartupQueueConversationRecord & { title: string },
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
  readonly titleEdit: RuntimeConversationTitleEditServiceOptions<TConversation>;
}

export interface ConversationLifecycle<TConversation> {
  subscribeConversationEvents(sessionId: string): Promise<void>;
  unsubscribeConversationEvents(sessionId: string): Promise<void>;
  subscribeTaskPlanningEvents(afterCursor: number | null): Promise<void>;
  unsubscribeTaskPlanningEvents(): Promise<void>;
  startConversation(sessionId: string): Promise<TConversation>;
  activateConversation(
    sessionId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>;
  createAndActivateConversationInDirectory(directoryId: string, agentType: string): Promise<void>;
  openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void>;
  takeoverConversation(sessionId: string): Promise<void>;
  scheduleConversationTitlePersist(): void;
  stopConversationTitleEdit(persistPending: boolean): void;
  beginConversationTitleEdit(conversationId: string): void;
  clearConversationTitleEditTimer(): void;
  hydrateConversationList(): Promise<void>;
  queuePersistedConversationsInBackground(activeSessionId: string | null): number;
}

export function createConversationLifecycle<
  TConversation extends RuntimeConversationStarterConversationRecord &
    StartupQueueConversationRecord & { title: string },
  TSessionSummary extends SessionSummaryLike,
  TControllerRecord,
>(
  options: ConversationLifecycleOptions<TConversation, TSessionSummary, TControllerRecord>,
): ConversationLifecycle<TConversation> {
  const streamSubscriptions = createRuntimeStreamSubscriptions(options.streamSubscriptions);
  let starter: RuntimeConversationStarter<TConversation>;
  let activation: RuntimeConversationActivation;
  let startupHydration: ConversationStartupHydrationService;
  let startupQueue: StartupPersistedConversationQueueService;
  let actions: RuntimeConversationActions;
  const titleEdit = createRuntimeConversationTitleEditService(options.titleEdit);

  async function subscribeConversationEvents(sessionId: string): Promise<void> {
    await streamSubscriptions.subscribeConversationEvents(sessionId);
  }

  async function unsubscribeConversationEvents(sessionId: string): Promise<void> {
    await streamSubscriptions.unsubscribeConversationEvents(sessionId);
  }

  async function subscribeTaskPlanningEvents(afterCursor: number | null): Promise<void> {
    await streamSubscriptions.subscribeTaskPlanningEvents(afterCursor);
  }

  async function unsubscribeTaskPlanningEvents(): Promise<void> {
    await streamSubscriptions.unsubscribeTaskPlanningEvents();
  }

  async function startConversation(sessionId: string): Promise<TConversation> {
    return await starter.startConversation(sessionId);
  }

  async function activateConversation(
    sessionId: string,
    activateOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    await activation.activateConversation(sessionId, activateOptions);
  }

  async function createAndActivateConversationInDirectory(
    directoryId: string,
    agentType: string,
  ): Promise<void> {
    await actions.createAndActivateConversationInDirectory(directoryId, agentType);
  }

  async function openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void> {
    await actions.openOrCreateCritiqueConversationInDirectory(directoryId);
  }

  async function takeoverConversation(sessionId: string): Promise<void> {
    await actions.takeoverConversation(sessionId);
  }

  function scheduleConversationTitlePersist(): void {
    titleEdit.schedulePersist();
  }

  function stopConversationTitleEdit(persistPending: boolean): void {
    titleEdit.stop(persistPending);
  }

  function beginConversationTitleEdit(conversationId: string): void {
    titleEdit.begin(conversationId);
  }

  function clearConversationTitleEditTimer(): void {
    titleEdit.clearCurrentTimer();
  }

  async function hydrateConversationList(): Promise<void> {
    await startupHydration.hydrateConversationList();
  }

  function queuePersistedConversationsInBackground(activeSessionId: string | null): number {
    return startupQueue.queuePersistedConversationsInBackground(activeSessionId);
  }

  starter = createRuntimeConversationStarter({
    ...options.starter,
    subscribeConversationEvents,
  });
  startupHydration = createConversationStartupHydrationService({
    ...options.startupHydration,
    subscribeConversationEvents,
  });
  startupQueue = createStartupPersistedConversationQueueService({
    ...options.startupQueue,
    startConversation,
  });
  activation = createRuntimeConversationActivation({
    ...options.activation,
    startConversation,
  });
  actions = createRuntimeConversationActions({
    ...options.actions,
    startConversation,
    activateConversation,
  });

  return {
    subscribeConversationEvents,
    unsubscribeConversationEvents,
    subscribeTaskPlanningEvents,
    unsubscribeTaskPlanningEvents,
    startConversation,
    activateConversation,
    createAndActivateConversationInDirectory,
    openOrCreateCritiqueConversationInDirectory,
    takeoverConversation,
    scheduleConversationTitlePersist,
    stopConversationTitleEdit,
    beginConversationTitleEdit,
    clearConversationTitleEditTimer,
    hydrateConversationList,
    queuePersistedConversationsInBackground,
  };
}
