interface ConversationStateLike {
  readonly directoryId: string | null;
  readonly live: boolean;
}

interface OpenNewThreadPromptOptions<TNewThreadPromptState> {
  directoryId: string;
  directoriesHas: (directoryId: string) => boolean;
  clearAddDirectoryPrompt: () => void;
  clearRepositoryPrompt: () => void;
  hasConversationTitleEdit: boolean;
  stopConversationTitleEdit: () => void;
  clearConversationTitleEditClickState: () => void;
  createNewThreadPromptState: (directoryId: string) => TNewThreadPromptState;
  setNewThreadPrompt: (prompt: TNewThreadPromptState) => void;
  markDirty: () => void;
}

export function openNewThreadPrompt<TNewThreadPromptState>(
  options: OpenNewThreadPromptOptions<TNewThreadPromptState>,
): void {
  if (!options.directoriesHas(options.directoryId)) {
    return;
  }
  options.clearAddDirectoryPrompt();
  options.clearRepositoryPrompt();
  if (options.hasConversationTitleEdit) {
    options.stopConversationTitleEdit();
  }
  options.clearConversationTitleEditClickState();
  options.setNewThreadPrompt(options.createNewThreadPromptState(options.directoryId));
  options.markDirty();
}

interface CreateAndActivateConversationInDirectoryOptions<TAgentType> {
  directoryId: string;
  agentType: TAgentType;
  createConversationId: () => string;
  createConversationRecord: (
    sessionId: string,
    directoryId: string,
    agentType: TAgentType,
  ) => Promise<void>;
  ensureConversation: (
    sessionId: string,
    seed: {
      directoryId: string;
      title: string;
      agentType: string;
      adapterState: Record<string, unknown>;
    },
  ) => void;
  noteGitActivity: (directoryId: string) => void;
  startConversation: (sessionId: string) => Promise<unknown>;
  activateConversation: (sessionId: string) => Promise<unknown>;
}

export async function createAndActivateConversationInDirectory<TAgentType>(
  options: CreateAndActivateConversationInDirectoryOptions<TAgentType>,
): Promise<void> {
  const sessionId = options.createConversationId();
  const title = '';
  await options.createConversationRecord(sessionId, options.directoryId, options.agentType);
  options.ensureConversation(sessionId, {
    directoryId: options.directoryId,
    title,
    agentType: String(options.agentType),
    adapterState: {},
  });
  options.noteGitActivity(options.directoryId);
  await options.startConversation(sessionId);
  await options.activateConversation(sessionId);
}

interface ArchiveConversationOptions {
  sessionId: string;
  conversations: ReadonlyMap<string, ConversationStateLike>;
  closePtySession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  isSessionNotFoundError: (error: unknown) => boolean;
  archiveConversationRecord: (sessionId: string) => Promise<void>;
  isConversationNotFoundError: (error: unknown) => boolean;
  unsubscribeConversationEvents: (sessionId: string) => Promise<void>;
  removeConversationState: (sessionId: string) => void;
  activeConversationId: string | null;
  setActiveConversationId: (sessionId: string | null) => void;
  orderedConversationIds: () => readonly string[];
  conversationDirectoryId: (sessionId: string) => string | null;
  resolveActiveDirectoryId: () => string | null;
  enterProjectPane: (directoryId: string) => void;
  activateConversation: (sessionId: string) => Promise<unknown>;
  markDirty: () => void;
}

export async function archiveConversation(options: ArchiveConversationOptions): Promise<void> {
  const target = options.conversations.get(options.sessionId);
  if (target === undefined) {
    return;
  }
  if (target.live) {
    try {
      await options.closePtySession(options.sessionId);
    } catch {
      // Best-effort close only.
    }
  }

  try {
    await options.removeSession(options.sessionId);
  } catch (error: unknown) {
    if (!options.isSessionNotFoundError(error)) {
      throw error;
    }
  }

  try {
    await options.archiveConversationRecord(options.sessionId);
  } catch (error: unknown) {
    if (!options.isConversationNotFoundError(error)) {
      throw error;
    }
  }
  await options.unsubscribeConversationEvents(options.sessionId);
  options.removeConversationState(options.sessionId);

  if (options.activeConversationId === options.sessionId) {
    const archivedDirectoryId = target.directoryId;
    const ordered = options.orderedConversationIds();
    const nextConversationId =
      ordered.find((candidateId) => options.conversationDirectoryId(candidateId) === archivedDirectoryId) ??
      ordered[0] ??
      null;
    options.setActiveConversationId(null);
    if (nextConversationId !== null) {
      await options.activateConversation(nextConversationId);
      return;
    }
    const fallbackDirectoryId = options.resolveActiveDirectoryId();
    if (fallbackDirectoryId !== null) {
      options.enterProjectPane(fallbackDirectoryId);
      options.markDirty();
      return;
    }
    options.markDirty();
    return;
  }

  options.markDirty();
}

interface TakeoverConversationOptions<TControllerRecord> {
  sessionId: string;
  conversationsHas: (sessionId: string) => boolean;
  claimSession: (sessionId: string) => Promise<TControllerRecord | null>;
  applyController: (sessionId: string, controller: TControllerRecord) => void;
  setLastEventNow: (sessionId: string) => void;
  markDirty: () => void;
}

export async function takeoverConversation<TControllerRecord>(
  options: TakeoverConversationOptions<TControllerRecord>,
): Promise<void> {
  if (!options.conversationsHas(options.sessionId)) {
    return;
  }
  const controller = await options.claimSession(options.sessionId);
  if (controller !== null) {
    options.applyController(options.sessionId, controller);
  }
  options.setLastEventNow(options.sessionId);
  options.markDirty();
}

interface AddDirectoryByPathOptions<TDirectoryRecord extends { directoryId: string }> {
  rawPath: string;
  resolveWorkspacePathForMux: (rawPath: string) => string;
  upsertDirectory: (path: string) => Promise<TDirectoryRecord | null>;
  setDirectory: (directory: TDirectoryRecord) => void;
  directoryIdOf: (directory: TDirectoryRecord) => string;
  setActiveDirectoryId: (directoryId: string) => void;
  syncGitStateWithDirectories: () => void;
  noteGitActivity: (directoryId: string) => void;
  hydratePersistedConversationsForDirectory: (directoryId: string) => Promise<unknown>;
  findConversationIdByDirectory: (directoryId: string) => string | null;
  activateConversation: (sessionId: string) => Promise<unknown>;
  enterProjectPane: (directoryId: string) => void;
  markDirty: () => void;
}

export async function addDirectoryByPath<TDirectoryRecord extends { directoryId: string }>(
  options: AddDirectoryByPathOptions<TDirectoryRecord>,
): Promise<void> {
  const normalizedPath = options.resolveWorkspacePathForMux(options.rawPath);
  const directory = await options.upsertDirectory(normalizedPath);
  if (directory === null) {
    throw new Error('control-plane directory.upsert returned malformed directory record');
  }
  options.setDirectory(directory);
  const directoryId = options.directoryIdOf(directory);
  options.setActiveDirectoryId(directoryId);
  options.syncGitStateWithDirectories();
  options.noteGitActivity(directoryId);
  await options.hydratePersistedConversationsForDirectory(directoryId);
  const targetConversationId = options.findConversationIdByDirectory(directoryId);
  if (targetConversationId !== null) {
    await options.activateConversation(targetConversationId);
    return;
  }
  options.enterProjectPane(directoryId);
  options.markDirty();
}

interface CloseDirectoryOptions {
  directoryId: string;
  directoriesHas: (directoryId: string) => boolean;
  orderedConversationIds: () => readonly string[];
  conversationDirectoryId: (sessionId: string) => string | null;
  conversationLive: (sessionId: string) => boolean;
  closePtySession: (sessionId: string) => Promise<void>;
  archiveConversationRecord: (sessionId: string) => Promise<void>;
  unsubscribeConversationEvents: (sessionId: string) => Promise<void>;
  removeConversationState: (sessionId: string) => void;
  activeConversationId: string | null;
  setActiveConversationId: (sessionId: string | null) => void;
  archiveDirectory: (directoryId: string) => Promise<void>;
  deleteDirectory: (directoryId: string) => void;
  deleteDirectoryGitState: (directoryId: string) => void;
  projectPaneSnapshotDirectoryId: string | null;
  clearProjectPaneSnapshot: () => void;
  directoriesSize: () => number;
  addDirectoryByPath: (path: string) => Promise<void>;
  invocationDirectory: string;
  activeDirectoryId: string | null;
  setActiveDirectoryId: (directoryId: string | null) => void;
  firstDirectoryId: () => string | null;
  noteGitActivity: (directoryId: string) => void;
  resolveActiveDirectoryId: () => string | null;
  activateConversation: (sessionId: string) => Promise<unknown>;
  enterProjectPane: (directoryId: string) => void;
  markDirty: () => void;
}

export async function closeDirectory(options: CloseDirectoryOptions): Promise<void> {
  if (!options.directoriesHas(options.directoryId)) {
    return;
  }
  const sessionIds = options
    .orderedConversationIds()
    .filter((sessionId) => options.conversationDirectoryId(sessionId) === options.directoryId);

  for (const sessionId of sessionIds) {
    if (options.conversationLive(sessionId)) {
      try {
        await options.closePtySession(sessionId);
      } catch {
        // Best-effort close only.
      }
    }
    await options.archiveConversationRecord(sessionId);
    await options.unsubscribeConversationEvents(sessionId);
    options.removeConversationState(sessionId);
    if (options.activeConversationId === sessionId) {
      options.setActiveConversationId(null);
    }
  }

  await options.archiveDirectory(options.directoryId);
  options.deleteDirectory(options.directoryId);
  options.deleteDirectoryGitState(options.directoryId);
  if (options.projectPaneSnapshotDirectoryId === options.directoryId) {
    options.clearProjectPaneSnapshot();
  }

  if (options.directoriesSize() === 0) {
    await options.addDirectoryByPath(options.invocationDirectory);
    return;
  }

  if (
    options.activeDirectoryId === options.directoryId ||
    options.activeDirectoryId === null ||
    !options.directoriesHas(options.activeDirectoryId)
  ) {
    options.setActiveDirectoryId(options.firstDirectoryId());
  }
  if (options.activeDirectoryId !== null) {
    options.noteGitActivity(options.activeDirectoryId);
  }

  const fallbackDirectoryId = options.resolveActiveDirectoryId();
  const fallbackConversationId =
    options
      .orderedConversationIds()
      .find((sessionId) => options.conversationDirectoryId(sessionId) === fallbackDirectoryId) ??
    options.orderedConversationIds()[0] ??
    null;
  if (fallbackConversationId !== null) {
    await options.activateConversation(fallbackConversationId);
    return;
  }
  if (fallbackDirectoryId !== null) {
    options.enterProjectPane(fallbackDirectoryId);
    options.markDirty();
    return;
  }

  options.markDirty();
}
