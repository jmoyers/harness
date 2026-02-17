interface RefreshProcessUsageSnapshotsOptions<TConversation, TSample> {
  conversations: ReadonlyMap<string, TConversation>;
  processUsageBySessionId: Map<string, TSample>;
  readProcessUsageSample: (processId: number | null) => Promise<TSample>;
  processIdForConversation: (conversation: TConversation) => number | null;
  processUsageEqual: (left: TSample, right: TSample) => boolean;
}

interface RefreshProcessUsageSnapshotsResult {
  readonly samples: number;
  readonly changed: boolean;
}

export async function refreshProcessUsageSnapshots<TConversation, TSample>(
  options: RefreshProcessUsageSnapshotsOptions<TConversation, TSample>,
): Promise<RefreshProcessUsageSnapshotsResult> {
  const {
    conversations,
    processUsageBySessionId,
    readProcessUsageSample,
    processIdForConversation,
    processUsageEqual,
  } = options;
  const entries = await Promise.all(
    [...conversations.entries()].map(async ([sessionId, conversation]) => ({
      sessionId,
      sample: await readProcessUsageSample(processIdForConversation(conversation)),
    })),
  );

  let changed = false;
  const observedSessionIds = new Set<string>();
  for (const entry of entries) {
    observedSessionIds.add(entry.sessionId);
    const previous = processUsageBySessionId.get(entry.sessionId);
    if (previous === undefined || !processUsageEqual(previous, entry.sample)) {
      processUsageBySessionId.set(entry.sessionId, entry.sample);
      changed = true;
    }
  }
  for (const sessionId of processUsageBySessionId.keys()) {
    if (observedSessionIds.has(sessionId)) {
      continue;
    }
    processUsageBySessionId.delete(sessionId);
    changed = true;
  }

  return {
    samples: entries.length,
    changed,
  };
}
