export interface StartupQueueConversationRecord {
  readonly live: boolean;
}

export interface StartupPersistedConversationQueueServiceOptions<
  TConversation extends StartupQueueConversationRecord,
> {
  readonly orderedConversationIds: () => readonly string[];
  readonly conversationById: (sessionId: string) => TConversation | undefined;
  readonly queueBackgroundOp: (task: () => Promise<void>, label: string) => void;
  readonly startConversation: (sessionId: string) => Promise<unknown>;
  readonly markDirty: () => void;
}

export interface StartupPersistedConversationQueueService {
  queuePersistedConversationsInBackground(activeSessionId: string | null): number;
}

export function createStartupPersistedConversationQueueService<
  TConversation extends StartupQueueConversationRecord,
>(
  options: StartupPersistedConversationQueueServiceOptions<TConversation>,
): StartupPersistedConversationQueueService {
  function queuePersistedConversationsInBackground(activeSessionId: string | null): number {
    const ordered = options.orderedConversationIds();
    let queued = 0;
    for (const sessionId of ordered) {
      if (activeSessionId !== null && sessionId === activeSessionId) {
        continue;
      }
      const conversation = options.conversationById(sessionId);
      if (conversation === undefined || conversation.live) {
        continue;
      }
      options.queueBackgroundOp(async () => {
        const latest = options.conversationById(sessionId);
        if (latest === undefined || latest.live) {
          return;
        }
        await options.startConversation(sessionId);
        options.markDirty();
      }, `background-start:${sessionId}`);
      queued += 1;
    }
    return queued;
  }

  return {
    queuePersistedConversationsInBackground,
  };
}
