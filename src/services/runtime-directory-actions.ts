import {
  addDirectoryByPath as addDirectoryByPathFn,
  archiveConversation as archiveConversationFn,
  closeDirectory as closeDirectoryFn,
} from '../mux/live-mux/actions-conversation.ts';

interface RuntimeConversationStateLike {
  readonly directoryId: string | null;
  readonly live: boolean;
}

interface RuntimeDirectoryRecordLike {
  readonly directoryId: string;
}

export interface RuntimeDirectoryActionService<TDirectoryRecord extends RuntimeDirectoryRecordLike> {
  closePtySession(sessionId: string): Promise<void>;
  removeSession(sessionId: string): Promise<void>;
  archiveConversation(sessionId: string): Promise<void>;
  upsertDirectory(input: { directoryId: string; path: string }): Promise<TDirectoryRecord | null>;
  archiveDirectory(directoryId: string): Promise<void>;
}

export interface RuntimeDirectoryConversations<
  TConversationState extends RuntimeConversationStateLike,
> {
  readonly records: () => ReadonlyMap<string, TConversationState>;
  readonly orderedIds: () => readonly string[];
  readonly directoryIdOf: (sessionId: string) => string | null;
  readonly isLive: (sessionId: string) => boolean;
  readonly removeState: (sessionId: string) => void;
  readonly unsubscribeEvents: (sessionId: string) => Promise<void>;
  readonly activeId: () => string | null;
  readonly setActiveId: (sessionId: string | null) => void;
  readonly activate: (sessionId: string) => Promise<unknown>;
  readonly findIdByDirectory: (directoryId: string) => string | null;
}

export interface RuntimeDirectoryDomain<TDirectoryRecord extends RuntimeDirectoryRecordLike> {
  readonly createId: () => string;
  readonly resolveWorkspacePath: (rawPath: string) => string;
  readonly setRecord: (directory: TDirectoryRecord) => void;
  readonly idOf: (directory: TDirectoryRecord) => string;
  readonly setActiveId: (directoryId: string | null) => void;
  readonly activeId: () => string | null;
  readonly resolveActiveId: () => string | null;
  readonly has: (directoryId: string) => boolean;
  readonly remove: (directoryId: string) => void;
  readonly removeGitState: (directoryId: string) => void;
  readonly projectPaneSnapshotDirectoryId: () => string | null;
  readonly clearProjectPaneSnapshot: () => void;
  readonly size: () => number;
  readonly firstId: () => string | null;
  readonly syncGitStateWithDirectories: () => void;
  readonly noteGitActivity: (directoryId: string) => void;
  readonly hydratePersistedConversations: (directoryId: string) => Promise<unknown>;
}

export interface RuntimeDirectoryUi {
  readonly enterProjectPane: (directoryId: string) => void;
  readonly markDirty: () => void;
}

export interface RuntimeDirectoryErrors {
  readonly isSessionNotFoundError: (error: unknown) => boolean;
  readonly isConversationNotFoundError: (error: unknown) => boolean;
}

export interface RuntimeDirectoryActionsOptions<
  TDirectoryRecord extends RuntimeDirectoryRecordLike,
  TConversationState extends RuntimeConversationStateLike,
> {
  readonly controlPlaneService: RuntimeDirectoryActionService<TDirectoryRecord>;
  readonly conversations: RuntimeDirectoryConversations<TConversationState>;
  readonly directories: RuntimeDirectoryDomain<TDirectoryRecord>;
  readonly ui: RuntimeDirectoryUi;
  readonly errors: RuntimeDirectoryErrors;
  readonly invocationDirectory: string;
}

export interface RuntimeDirectoryActions {
  archiveConversation(sessionId: string): Promise<void>;
  addDirectoryByPath(rawPath: string): Promise<void>;
  closeDirectory(directoryId: string): Promise<void>;
}

export function createRuntimeDirectoryActions<
  TDirectoryRecord extends RuntimeDirectoryRecordLike,
  TConversationState extends RuntimeConversationStateLike,
>(
  options: RuntimeDirectoryActionsOptions<TDirectoryRecord, TConversationState>,
): RuntimeDirectoryActions {
  const archiveConversation = async (sessionId: string): Promise<void> => {
    await archiveConversationFn({
      sessionId,
      conversations: options.conversations.records(),
      closePtySession: options.controlPlaneService.closePtySession,
      removeSession: options.controlPlaneService.removeSession,
      isSessionNotFoundError: options.errors.isSessionNotFoundError,
      archiveConversationRecord: options.controlPlaneService.archiveConversation,
      isConversationNotFoundError: options.errors.isConversationNotFoundError,
      unsubscribeConversationEvents: options.conversations.unsubscribeEvents,
      removeConversationState: options.conversations.removeState,
      activeConversationId: options.conversations.activeId(),
      setActiveConversationId: options.conversations.setActiveId,
      orderedConversationIds: options.conversations.orderedIds,
      conversationDirectoryId: options.conversations.directoryIdOf,
      resolveActiveDirectoryId: options.directories.resolveActiveId,
      enterProjectPane: options.ui.enterProjectPane,
      activateConversation: options.conversations.activate,
      markDirty: options.ui.markDirty,
    });
  };

  const addDirectoryByPath = async (rawPath: string): Promise<void> => {
    await addDirectoryByPathFn({
      rawPath,
      resolveWorkspacePathForMux: options.directories.resolveWorkspacePath,
      upsertDirectory: async (path) => {
        return await options.controlPlaneService.upsertDirectory({
          directoryId: options.directories.createId(),
          path,
        });
      },
      setDirectory: options.directories.setRecord,
      directoryIdOf: options.directories.idOf,
      setActiveDirectoryId: (directoryId) => {
        options.directories.setActiveId(directoryId);
      },
      syncGitStateWithDirectories: options.directories.syncGitStateWithDirectories,
      noteGitActivity: options.directories.noteGitActivity,
      hydratePersistedConversationsForDirectory: options.directories.hydratePersistedConversations,
      findConversationIdByDirectory: options.conversations.findIdByDirectory,
      activateConversation: options.conversations.activate,
      enterProjectPane: options.ui.enterProjectPane,
      markDirty: options.ui.markDirty,
    });
  };

  const closeDirectory = async (directoryId: string): Promise<void> => {
    await closeDirectoryFn({
      directoryId,
      directoriesHas: options.directories.has,
      orderedConversationIds: options.conversations.orderedIds,
      conversationDirectoryId: options.conversations.directoryIdOf,
      conversationLive: options.conversations.isLive,
      closePtySession: options.controlPlaneService.closePtySession,
      archiveConversationRecord: options.controlPlaneService.archiveConversation,
      unsubscribeConversationEvents: options.conversations.unsubscribeEvents,
      removeConversationState: options.conversations.removeState,
      activeConversationId: options.conversations.activeId(),
      setActiveConversationId: options.conversations.setActiveId,
      archiveDirectory: options.controlPlaneService.archiveDirectory,
      deleteDirectory: options.directories.remove,
      deleteDirectoryGitState: options.directories.removeGitState,
      projectPaneSnapshotDirectoryId: options.directories.projectPaneSnapshotDirectoryId(),
      clearProjectPaneSnapshot: options.directories.clearProjectPaneSnapshot,
      directoriesSize: options.directories.size,
      addDirectoryByPath: async (path) => {
        await addDirectoryByPath(path);
      },
      invocationDirectory: options.invocationDirectory,
      activeDirectoryId: options.directories.activeId(),
      setActiveDirectoryId: options.directories.setActiveId,
      firstDirectoryId: options.directories.firstId,
      noteGitActivity: options.directories.noteGitActivity,
      resolveActiveDirectoryId: options.directories.resolveActiveId,
      activateConversation: options.conversations.activate,
      enterProjectPane: options.ui.enterProjectPane,
      markDirty: options.ui.markDirty,
    });
  };

  return {
    archiveConversation,
    addDirectoryByPath,
    closeDirectory,
  };
}
