interface SessionSummaryLike {
  readonly sessionId: string;
  readonly live: boolean;
}

interface PerfSpanLike {
  end(input?: Record<string, unknown>): void;
}

interface ConversationStartupHydrationServiceOptions<TSessionSummary extends SessionSummaryLike> {
  readonly startHydrationSpan: () => PerfSpanLike;
  readonly hydrateDirectoryList: () => Promise<void>;
  readonly directoryIds: () => readonly string[];
  readonly hydratePersistedConversationsForDirectory: (directoryId: string) => Promise<number>;
  readonly listSessions: () => Promise<readonly TSessionSummary[]>;
  readonly upsertFromSessionSummary: (summary: TSessionSummary) => void;
  readonly subscribeConversationEvents: (sessionId: string) => Promise<void>;
}

export class ConversationStartupHydrationService<
  TSessionSummary extends SessionSummaryLike,
> {
  constructor(private readonly options: ConversationStartupHydrationServiceOptions<TSessionSummary>) {}

  async hydrateConversationList(): Promise<void> {
    const hydrateSpan = this.options.startHydrationSpan();
    await this.options.hydrateDirectoryList();
    let persistedCount = 0;
    for (const directoryId of this.options.directoryIds()) {
      persistedCount += await this.options.hydratePersistedConversationsForDirectory(directoryId);
    }

    const summaries = await this.options.listSessions();
    for (const summary of summaries) {
      this.options.upsertFromSessionSummary(summary);
      if (summary.live) {
        await this.options.subscribeConversationEvents(summary.sessionId);
      }
    }
    hydrateSpan.end({
      persisted: persistedCount,
      live: summaries.length,
    });
  }
}
