interface DirectoryRecordLike {
  readonly directoryId: string;
}

interface ConversationRecordLike {
  readonly conversationId: string;
  readonly directoryId: string;
}

interface WorkspaceObservedApplyResult {
  readonly changed: boolean;
  readonly removedConversationIds: readonly string[];
  readonly removedDirectoryIds: readonly string[];
}

interface WorkspaceSyncedProjectionState<
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
> {
  readonly directoriesById: Readonly<Record<string, TDirectoryRecord>>;
  readonly conversationsById: Readonly<Record<string, TConversationRecord>>;
}

interface WorkspaceSyncedProjectionInput<
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
> {
  readonly changed: boolean;
  readonly state: WorkspaceSyncedProjectionState<TDirectoryRecord, TConversationRecord>;
  readonly removedConversationIds: readonly string[];
  readonly removedDirectoryIds: readonly string[];
  readonly upsertedDirectoryIds: readonly string[];
  readonly upsertedConversationIds: readonly string[];
}

interface WorkspaceSyncedProjectionOptions<
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
> {
  readonly setDirectory: (directoryId: string, directory: TDirectoryRecord) => void;
  readonly deleteDirectory: (directoryId: string) => boolean;
  readonly deleteDirectoryGitState: (directoryId: string) => void;
  readonly syncGitStateWithDirectories: () => void;
  readonly upsertConversationFromPersistedRecord: (record: TConversationRecord) => void;
  readonly removeConversation: (sessionId: string) => boolean;
}

export class WorkspaceSyncedProjection<
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
> {
  constructor(
    private readonly options: WorkspaceSyncedProjectionOptions<TDirectoryRecord, TConversationRecord>,
  ) {}

  apply(
    reduction: WorkspaceSyncedProjectionInput<TDirectoryRecord, TConversationRecord>,
  ): WorkspaceObservedApplyResult {
    if (!reduction.changed) {
      return {
        changed: false,
        removedConversationIds: [],
        removedDirectoryIds: [],
      };
    }

    let changed = false;
    const removedConversationIds: string[] = [];
    const removedDirectoryIds: string[] = [];

    for (const directoryId of reduction.upsertedDirectoryIds) {
      const directory = reduction.state.directoriesById[directoryId];
      if (directory === undefined) {
        continue;
      }
      this.options.setDirectory(directoryId, directory);
      changed = true;
    }
    for (const conversationId of reduction.upsertedConversationIds) {
      const conversation = reduction.state.conversationsById[conversationId];
      if (conversation === undefined) {
        continue;
      }
      this.options.upsertConversationFromPersistedRecord(conversation);
      changed = true;
    }

    for (const sessionId of reduction.removedConversationIds) {
      if (!this.options.removeConversation(sessionId)) {
        continue;
      }
      removedConversationIds.push(sessionId);
      changed = true;
    }

    for (const directoryId of reduction.removedDirectoryIds) {
      if (this.options.deleteDirectory(directoryId)) {
        removedDirectoryIds.push(directoryId);
        changed = true;
      }
      this.options.deleteDirectoryGitState(directoryId);
    }
    if (reduction.upsertedDirectoryIds.length > 0 || reduction.removedDirectoryIds.length > 0) {
      this.options.syncGitStateWithDirectories();
    }

    return {
      changed,
      removedConversationIds,
      removedDirectoryIds,
    };
  }
}
