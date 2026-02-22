export interface SessionSummaryLike {
  readonly sessionId: string;
  readonly live: boolean;
}

interface PerfSpanLike {
  end(input?: Record<string, unknown>): void;
}

export interface ConversationStartupHydrationServiceOptions<
  TSessionSummary extends SessionSummaryLike,
> {
  readonly startHydrationSpan: () => PerfSpanLike;
  readonly hydrateDirectoryList: () => Promise<void>;
  readonly directoryIds: () => readonly string[];
  readonly hydratePersistedConversationsForDirectory: (directoryId: string) => Promise<number>;
  readonly listSessions: () => Promise<readonly TSessionSummary[]>;
  readonly upsertFromSessionSummary: (summary: TSessionSummary) => void;
  readonly subscribeConversationEvents: (sessionId: string) => Promise<void>;
}

export interface ConversationStartupHydrationService {
  hydrateConversationList(): Promise<void>;
}

export function createConversationStartupHydrationService<
  TSessionSummary extends SessionSummaryLike,
>(
  options: ConversationStartupHydrationServiceOptions<TSessionSummary>,
): ConversationStartupHydrationService {
  async function hydrateConversationList(): Promise<void> {
    const hydrateSpan = options.startHydrationSpan();
    await options.hydrateDirectoryList();
    let persistedCount = 0;
    for (const directoryId of options.directoryIds()) {
      persistedCount += await options.hydratePersistedConversationsForDirectory(directoryId);
    }

    const summaries = await options.listSessions();
    for (const summary of summaries) {
      options.upsertFromSessionSummary(summary);
      if (summary.live) {
        await options.subscribeConversationEvents(summary.sessionId);
      }
    }
    hydrateSpan.end({
      persisted: persistedCount,
      live: summaries.length,
    });
  }

  return {
    hydrateConversationList,
  };
}
