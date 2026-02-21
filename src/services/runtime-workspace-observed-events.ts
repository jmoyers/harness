interface WorkspaceObservedReduction {
  readonly changed: boolean;
  readonly removedConversationIds: readonly string[];
  readonly removedDirectoryIds: readonly string[];
}

interface WorkspaceObservedReducer<TObservedEvent> {
  apply(observed: TObservedEvent): WorkspaceObservedReduction;
}

interface RuntimeWorkspaceStateLike {
  leftNavSelection:
    | {
        kind: 'home';
      }
    | {
        kind: 'tasks';
      }
    | {
        kind: 'project';
        directoryId: string;
      }
    | {
        kind: 'github';
        directoryId: string;
      }
    | {
        kind: 'repository';
        repositoryId: string;
      }
    | {
        kind: 'conversation';
        sessionId: string;
      };
  conversationTitleEdit: {
    conversationId: string;
  } | null;
  projectPaneSnapshot: {
    directoryId: string;
  } | null;
  projectPaneScrollTop: number;
  activeDirectoryId: string | null;
  visibleGitHubDirectoryIds?: Set<string>;
  selectLeftNavConversation(sessionId: string): void;
}

interface RuntimeWorkspaceObservedEventsOptions<TObservedEvent> {
  readonly reducer: WorkspaceObservedReducer<TObservedEvent>;
  readonly workspace: RuntimeWorkspaceStateLike;
  readonly orderedConversationIds: () => readonly string[];
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly hasConversation: (sessionId: string) => boolean;
  readonly getActiveConversationId: () => string | null;
  readonly setActiveConversationId: (sessionId: string | null) => void;
  readonly hasDirectory: (directoryId: string) => boolean;
  readonly resolveActiveDirectoryId: () => string | null;
  readonly unsubscribeConversationEvents: (sessionId: string) => Promise<void>;
  readonly stopConversationTitleEdit: (persistPending: boolean) => void;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly enterHomePane: () => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly activateConversation: (sessionId: string) => Promise<void>;
  readonly markDirty: () => void;
}

export class RuntimeWorkspaceObservedEvents<TObservedEvent> {
  constructor(private readonly options: RuntimeWorkspaceObservedEventsOptions<TObservedEvent>) {}

  apply(observed: TObservedEvent): void {
    const activeConversationIdBefore = this.options.getActiveConversationId();
    const leftNavConversationIdBefore =
      this.options.workspace.leftNavSelection.kind === 'conversation'
        ? this.options.workspace.leftNavSelection.sessionId
        : null;
    const previousConversationDirectoryById = new Map<string, string | null>();
    for (const sessionId of this.options.orderedConversationIds()) {
      previousConversationDirectoryById.set(
        sessionId,
        this.options.conversationDirectoryId(sessionId),
      );
    }

    const reduced = this.options.reducer.apply(observed);
    if (!reduced.changed) {
      return;
    }

    for (const sessionId of reduced.removedConversationIds) {
      void this.options.unsubscribeConversationEvents(sessionId);
      if (this.options.workspace.conversationTitleEdit?.conversationId === sessionId) {
        this.options.stopConversationTitleEdit(false);
      }
    }

    for (const directoryId of reduced.removedDirectoryIds) {
      this.options.workspace.visibleGitHubDirectoryIds?.delete(directoryId);
      if (this.options.workspace.projectPaneSnapshot?.directoryId === directoryId) {
        this.options.workspace.projectPaneSnapshot = null;
        this.options.workspace.projectPaneScrollTop = 0;
      }
    }

    if (
      this.options.workspace.activeDirectoryId !== null &&
      !this.options.hasDirectory(this.options.workspace.activeDirectoryId)
    ) {
      this.options.workspace.activeDirectoryId = this.options.resolveActiveDirectoryId();
    }

    const removedConversationIdSet = new Set(reduced.removedConversationIds);
    const activateFallbackConversationInDirectory = (
      preferredDirectoryId: string | null,
      label: string,
    ): boolean => {
      if (preferredDirectoryId === null) {
        return false;
      }
      const fallbackConversationId =
        this.options
          .orderedConversationIds()
          .find(
            (sessionId) => this.options.conversationDirectoryId(sessionId) === preferredDirectoryId,
          ) ?? null;
      if (fallbackConversationId === null) {
        return false;
      }
      this.options.queueControlPlaneOp(async () => {
        await this.options.activateConversation(fallbackConversationId);
      }, label);
      return true;
    };
    const fallbackToDirectoryOrHome = (): void => {
      const fallbackDirectoryId = this.options.resolveActiveDirectoryId();
      if (fallbackDirectoryId !== null) {
        this.options.enterProjectPane(fallbackDirectoryId);
        return;
      }
      this.options.enterHomePane();
    };

    if (
      activeConversationIdBefore !== null &&
      removedConversationIdSet.has(activeConversationIdBefore)
    ) {
      this.options.setActiveConversationId(null);
      const preferredDirectoryId =
        previousConversationDirectoryById.get(activeConversationIdBefore) ?? null;
      if (
        !activateFallbackConversationInDirectory(
          preferredDirectoryId,
          'observed-active-conversation-removed',
        )
      ) {
        fallbackToDirectoryOrHome();
      }
      this.options.markDirty();
      return;
    }

    if (
      leftNavConversationIdBefore !== null &&
      removedConversationIdSet.has(leftNavConversationIdBefore)
    ) {
      const currentActiveId = this.options.getActiveConversationId();
      if (currentActiveId !== null && this.options.hasConversation(currentActiveId)) {
        this.options.workspace.selectLeftNavConversation(currentActiveId);
        this.options.markDirty();
        return;
      }
      const preferredDirectoryId =
        previousConversationDirectoryById.get(leftNavConversationIdBefore) ?? null;
      if (
        !activateFallbackConversationInDirectory(
          preferredDirectoryId,
          'observed-selected-conversation-removed',
        )
      ) {
        fallbackToDirectoryOrHome();
      }
      this.options.markDirty();
      return;
    }

    if (
      (this.options.workspace.leftNavSelection.kind === 'project' ||
        this.options.workspace.leftNavSelection.kind === 'github') &&
      !this.options.hasDirectory(this.options.workspace.leftNavSelection.directoryId)
    ) {
      const fallbackDirectoryId = this.options.resolveActiveDirectoryId();
      if (fallbackDirectoryId !== null) {
        this.options.enterProjectPane(fallbackDirectoryId);
      } else {
        this.options.enterHomePane();
      }
      this.options.markDirty();
      return;
    }

    this.options.markDirty();
  }
}
