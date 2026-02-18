interface ResolveDirectoryForActionConversationState {
  readonly directoryId: string | null;
}

interface ResolveDirectoryForActionOptions {
  mainPaneMode: 'conversation' | 'project' | 'home';
  activeDirectoryId: string | null;
  activeConversationId: string | null;
  conversations: ReadonlyMap<string, ResolveDirectoryForActionConversationState>;
  directoriesHas: (directoryId: string) => boolean;
}

export function resolveDirectoryForAction(options: ResolveDirectoryForActionOptions): string | null {
  if (options.mainPaneMode === 'project') {
    if (options.activeDirectoryId !== null && options.directoriesHas(options.activeDirectoryId)) {
      return options.activeDirectoryId;
    }
    return null;
  }
  if (options.activeConversationId !== null) {
    const conversation = options.conversations.get(options.activeConversationId);
    if (conversation?.directoryId !== null && conversation?.directoryId !== undefined) {
      if (options.directoriesHas(conversation.directoryId)) {
        return conversation.directoryId;
      }
    }
  }
  if (options.activeDirectoryId !== null && options.directoriesHas(options.activeDirectoryId)) {
    return options.activeDirectoryId;
  }
  return null;
}
