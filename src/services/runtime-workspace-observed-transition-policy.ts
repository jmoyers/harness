import type { HarnessSyncedState } from '../core/state/synced-observed-state.ts';

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
  selectLeftNavConversation(sessionId: string): void;
}

export interface RuntimeWorkspaceObservedTransition {
  readonly previous: HarnessSyncedState;
  readonly current: HarnessSyncedState;
  readonly orderedConversationIds: readonly string[];
}

export interface RuntimeWorkspaceObservedQueuedReaction {
  readonly kind: 'unsubscribe-conversation' | 'activate-conversation';
  readonly sessionId: string;
  readonly label: string;
}

export interface RuntimeWorkspaceObservedTransitionPolicyResult {
  readonly reactions: readonly RuntimeWorkspaceObservedQueuedReaction[];
}

export interface RuntimeWorkspaceObservedTransitionPolicyOptions {
  readonly workspace: RuntimeWorkspaceStateLike;
  readonly getActiveConversationId: () => string | null;
  readonly setActiveConversationId: (sessionId: string | null) => void;
  readonly resolveActiveDirectoryId: () => string | null;
  readonly stopConversationTitleEdit: (persistPending: boolean) => void;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly enterHomePane: () => void;
}

function conversationDirectoryIdOf(state: HarnessSyncedState, sessionId: string): string | null {
  return state.conversationsById[sessionId]?.directoryId ?? null;
}

function hasConversation(state: HarnessSyncedState, sessionId: string): boolean {
  return state.conversationsById[sessionId] !== undefined;
}

function hasDirectory(state: HarnessSyncedState, directoryId: string): boolean {
  return state.directoriesById[directoryId] !== undefined;
}

function removedIds(
  previous: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
): readonly string[] {
  const removed: string[] = [];
  for (const id of Object.keys(previous)) {
    if (current[id] !== undefined) {
      continue;
    }
    removed.push(id);
  }
  return removed;
}

export class RuntimeWorkspaceObservedTransitionPolicy {
  constructor(private readonly options: RuntimeWorkspaceObservedTransitionPolicyOptions) {}

  apply(transition: RuntimeWorkspaceObservedTransition): RuntimeWorkspaceObservedTransitionPolicyResult {
    const reactions: RuntimeWorkspaceObservedQueuedReaction[] = [];
    const removedConversationIds = removedIds(
      transition.previous.conversationsById,
      transition.current.conversationsById,
    );
    const removedDirectoryIds = removedIds(
      transition.previous.directoriesById,
      transition.current.directoriesById,
    );
    const activeConversationIdBefore = this.options.getActiveConversationId();
    const leftNavConversationIdBefore =
      this.options.workspace.leftNavSelection.kind === 'conversation'
        ? this.options.workspace.leftNavSelection.sessionId
        : null;

    for (const sessionId of removedConversationIds) {
      reactions.push({
        kind: 'unsubscribe-conversation',
        sessionId,
        label: `observed-unsubscribe-conversation:${sessionId}`,
      });
      if (this.options.workspace.conversationTitleEdit?.conversationId === sessionId) {
        this.options.stopConversationTitleEdit(false);
      }
    }

    for (const directoryId of removedDirectoryIds) {
      if (this.options.workspace.projectPaneSnapshot?.directoryId === directoryId) {
        this.options.workspace.projectPaneSnapshot = null;
        this.options.workspace.projectPaneScrollTop = 0;
      }
    }

    if (
      this.options.workspace.activeDirectoryId !== null &&
      !hasDirectory(transition.current, this.options.workspace.activeDirectoryId)
    ) {
      this.options.workspace.activeDirectoryId = this.options.resolveActiveDirectoryId();
    }

    const removedConversationIdSet = new Set(removedConversationIds);
    const activateFallbackConversationInDirectory = (
      preferredDirectoryId: string | null,
      label: string,
    ): boolean => {
      if (preferredDirectoryId === null) {
        return false;
      }
      const fallbackConversationId =
        transition.orderedConversationIds.find(
          (sessionId) =>
            conversationDirectoryIdOf(transition.current, sessionId) === preferredDirectoryId,
        ) ?? null;
      if (fallbackConversationId === null) {
        return false;
      }
      reactions.push({
        kind: 'activate-conversation',
        sessionId: fallbackConversationId,
        label,
      });
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
      const preferredDirectoryId = conversationDirectoryIdOf(
        transition.previous,
        activeConversationIdBefore,
      );
      if (
        !activateFallbackConversationInDirectory(
          preferredDirectoryId,
          'observed-active-conversation-removed',
        )
      ) {
        fallbackToDirectoryOrHome();
      }
      return { reactions };
    }

    if (
      leftNavConversationIdBefore !== null &&
      removedConversationIdSet.has(leftNavConversationIdBefore)
    ) {
      const currentActiveId = this.options.getActiveConversationId();
      if (currentActiveId !== null && hasConversation(transition.current, currentActiveId)) {
        this.options.workspace.selectLeftNavConversation(currentActiveId);
        return { reactions };
      }
      const preferredDirectoryId = conversationDirectoryIdOf(
        transition.previous,
        leftNavConversationIdBefore,
      );
      if (
        !activateFallbackConversationInDirectory(
          preferredDirectoryId,
          'observed-selected-conversation-removed',
        )
      ) {
        fallbackToDirectoryOrHome();
      }
      return { reactions };
    }

    if (
      this.options.workspace.leftNavSelection.kind === 'project' &&
      !hasDirectory(transition.current, this.options.workspace.leftNavSelection.directoryId)
    ) {
      const fallbackDirectoryId = this.options.resolveActiveDirectoryId();
      if (fallbackDirectoryId !== null) {
        this.options.enterProjectPane(fallbackDirectoryId);
      } else {
        this.options.enterHomePane();
      }
      return { reactions };
    }

    return { reactions };
  }
}
