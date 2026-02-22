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

export function planRuntimeWorkspaceObservedTransition(input: {
  readonly transition: RuntimeWorkspaceObservedTransition;
  readonly options: RuntimeWorkspaceObservedTransitionPolicyOptions;
}): RuntimeWorkspaceObservedTransitionPolicyResult {
  const reactions: RuntimeWorkspaceObservedQueuedReaction[] = [];
  const removedConversationIds = removedIds(
    input.transition.previous.conversationsById,
    input.transition.current.conversationsById,
  );
  const removedDirectoryIds = removedIds(
    input.transition.previous.directoriesById,
    input.transition.current.directoriesById,
  );
  const activeConversationIdBefore = input.options.getActiveConversationId();
  const leftNavConversationIdBefore =
    input.options.workspace.leftNavSelection.kind === 'conversation'
      ? input.options.workspace.leftNavSelection.sessionId
      : null;

  for (const sessionId of removedConversationIds) {
    reactions.push({
      kind: 'unsubscribe-conversation',
      sessionId,
      label: `observed-unsubscribe-conversation:${sessionId}`,
    });
    if (input.options.workspace.conversationTitleEdit?.conversationId === sessionId) {
      input.options.stopConversationTitleEdit(false);
    }
  }

  for (const directoryId of removedDirectoryIds) {
    if (input.options.workspace.projectPaneSnapshot?.directoryId === directoryId) {
      input.options.workspace.projectPaneSnapshot = null;
      input.options.workspace.projectPaneScrollTop = 0;
    }
  }

  if (
    input.options.workspace.activeDirectoryId !== null &&
    !hasDirectory(input.transition.current, input.options.workspace.activeDirectoryId)
  ) {
    input.options.workspace.activeDirectoryId = input.options.resolveActiveDirectoryId();
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
      input.transition.orderedConversationIds.find(
        (sessionId) =>
          conversationDirectoryIdOf(input.transition.current, sessionId) === preferredDirectoryId,
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
    const fallbackDirectoryId = input.options.resolveActiveDirectoryId();
    if (fallbackDirectoryId !== null) {
      input.options.enterProjectPane(fallbackDirectoryId);
      return;
    }
    input.options.enterHomePane();
  };

  if (activeConversationIdBefore !== null && removedConversationIdSet.has(activeConversationIdBefore)) {
    input.options.setActiveConversationId(null);
    const preferredDirectoryId = conversationDirectoryIdOf(
      input.transition.previous,
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

  if (leftNavConversationIdBefore !== null && removedConversationIdSet.has(leftNavConversationIdBefore)) {
    const currentActiveId = input.options.getActiveConversationId();
    if (currentActiveId !== null && hasConversation(input.transition.current, currentActiveId)) {
      input.options.workspace.selectLeftNavConversation(currentActiveId);
      return { reactions };
    }
    const preferredDirectoryId = conversationDirectoryIdOf(
      input.transition.previous,
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
    input.options.workspace.leftNavSelection.kind === 'project' &&
    !hasDirectory(input.transition.current, input.options.workspace.leftNavSelection.directoryId)
  ) {
    const fallbackDirectoryId = input.options.resolveActiveDirectoryId();
    if (fallbackDirectoryId !== null) {
      input.options.enterProjectPane(fallbackDirectoryId);
    } else {
      input.options.enterHomePane();
    }
    return { reactions };
  }

  return { reactions };
}
