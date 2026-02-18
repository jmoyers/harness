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

export class StartupPersistedConversationQueueService<
  TConversation extends StartupQueueConversationRecord,
> {
  constructor(
    private readonly options: StartupPersistedConversationQueueServiceOptions<TConversation>,
  ) {}

  queuePersistedConversationsInBackground(activeSessionId: string | null): number {
    const ordered = this.options.orderedConversationIds();
    let queued = 0;
    for (const sessionId of ordered) {
      if (activeSessionId !== null && sessionId === activeSessionId) {
        continue;
      }
      const conversation = this.options.conversationById(sessionId);
      if (conversation === undefined || conversation.live) {
        continue;
      }
      this.options.queueBackgroundOp(async () => {
        const latest = this.options.conversationById(sessionId);
        if (latest === undefined || latest.live) {
          return;
        }
        await this.options.startConversation(sessionId);
        this.options.markDirty();
      }, `background-start:${sessionId}`);
      queued += 1;
    }
    return queued;
  }
}
