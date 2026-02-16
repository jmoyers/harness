interface SelectorIndexDirectory {
  readonly directoryId: string;
}

interface SelectorIndexConversation {
  readonly sessionId: string;
  readonly directoryId: string | null;
  readonly title: string;
  readonly agentType: string;
}

interface SelectorIndexEntry {
  readonly selectorIndex: number;
  readonly directoryIndex: number;
  readonly directoryId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly agentType: string;
}

function normalizedDirectoryId(directoryId: string | null): string {
  if (directoryId === null) {
    return 'directory-missing';
  }
  const trimmed = directoryId.trim();
  return trimmed.length === 0 ? 'directory-missing' : trimmed;
}

export function buildSelectorIndexEntries(
  directories: ReadonlyMap<string, SelectorIndexDirectory>,
  conversationById: ReadonlyMap<string, SelectorIndexConversation>,
  orderedSessionIds: readonly string[]
): readonly SelectorIndexEntry[] {
  const orderedDirectoryIds: string[] = [...directories.keys()];
  const seenDirectoryIds = new Set(orderedDirectoryIds);

  for (const sessionId of orderedSessionIds) {
    const conversation = conversationById.get(sessionId);
    if (conversation === undefined) {
      continue;
    }
    const directoryId = normalizedDirectoryId(conversation.directoryId);
    if (seenDirectoryIds.has(directoryId)) {
      continue;
    }
    seenDirectoryIds.add(directoryId);
    orderedDirectoryIds.push(directoryId);
  }

  const entries: SelectorIndexEntry[] = [];
  let selectorIndex = 1;
  for (const directoryId of orderedDirectoryIds) {
    let directoryIndex = 0;
    for (const sessionId of orderedSessionIds) {
      const conversation = conversationById.get(sessionId);
      if (conversation === undefined) {
        continue;
      }
      if (normalizedDirectoryId(conversation.directoryId) !== directoryId) {
        continue;
      }
      directoryIndex += 1;
      entries.push({
        selectorIndex,
        directoryIndex,
        directoryId,
        sessionId: conversation.sessionId,
        title: conversation.title,
        agentType: conversation.agentType
      });
      selectorIndex += 1;
    }
  }
  return entries;
}

export function visualConversationOrder(
  directories: ReadonlyMap<string, SelectorIndexDirectory>,
  conversationById: ReadonlyMap<string, SelectorIndexConversation>,
  orderedSessionIds: readonly string[]
): readonly string[] {
  return buildSelectorIndexEntries(directories, conversationById, orderedSessionIds).map(
    (entry) => entry.sessionId
  );
}
