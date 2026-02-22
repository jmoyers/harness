import { cycleConversationId } from '../conversation-rail.ts';
import { leftNavTargetKey, type LeftNavSelection } from './left-nav.ts';

interface ActivateLeftNavTargetOptions {
  target: LeftNavSelection;
  direction: 'next' | 'previous';
  enterHomePane: () => void;
  enterNimPane?: () => void;
  enterTasksPane?: () => void;
  firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  enterProjectPane: (directoryId: string) => void;
  enterGitHubPane?: (directoryId: string) => void;
  setMainPaneProjectMode: () => void;
  selectLeftNavRepository: (repositoryGroupId: string) => void;
  selectLeftNavConversation?: (sessionId: string) => void;
  markDirty: () => void;
  directoriesHas: (directoryId: string) => boolean;
  visibleTargetsForState: () => readonly LeftNavSelection[];
  conversationDirectoryId: (sessionId: string) => string | null;
  queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  queueLatestControlPlaneOp?: (
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label: string,
  ) => void;
  activateConversation: (
    sessionId: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
  conversationsHas: (sessionId: string) => boolean;
}

const LEFT_NAV_ACTIVATION_KEY = 'left-nav:activate-conversation';

function queueLeftNavConversationActivation(
  options: Pick<
    ActivateLeftNavTargetOptions,
    'queueControlPlaneOp' | 'queueLatestControlPlaneOp' | 'activateConversation'
  > & {
    readonly sessionId: string;
    readonly label: string;
  },
): void {
  if (options.queueLatestControlPlaneOp !== undefined) {
    options.queueLatestControlPlaneOp(
      LEFT_NAV_ACTIVATION_KEY,
      async ({ signal }) => {
        if (signal.aborted) {
          return;
        }
        await options.activateConversation(options.sessionId, {
          signal,
        });
      },
      options.label,
    );
    return;
  }
  options.queueControlPlaneOp(async () => {
    await options.activateConversation(options.sessionId);
  }, options.label);
}

export function activateLeftNavTarget(options: ActivateLeftNavTargetOptions): void {
  const {
    target,
    direction,
    enterHomePane,
    enterNimPane,
    enterTasksPane,
    firstDirectoryForRepositoryGroup,
    enterProjectPane,
    enterGitHubPane,
    setMainPaneProjectMode,
    selectLeftNavRepository,
    selectLeftNavConversation,
    markDirty,
    directoriesHas,
    visibleTargetsForState,
    conversationDirectoryId,
    queueControlPlaneOp,
    queueLatestControlPlaneOp,
    activateConversation,
    conversationsHas,
  } = options;
  if (target.kind === 'home') {
    enterHomePane();
    return;
  }
  if (target.kind === 'nim') {
    if (enterNimPane !== undefined) {
      enterNimPane();
      return;
    }
    enterHomePane();
    return;
  }
  if (target.kind === 'tasks') {
    if (enterTasksPane !== undefined) {
      enterTasksPane();
      return;
    }
    enterHomePane();
    return;
  }
  if (target.kind === 'repository') {
    const firstDirectoryId = firstDirectoryForRepositoryGroup(target.repositoryId);
    if (firstDirectoryId !== null) {
      enterProjectPane(firstDirectoryId);
    } else {
      setMainPaneProjectMode();
    }
    selectLeftNavRepository(target.repositoryId);
    markDirty();
    return;
  }
  if (target.kind === 'project') {
    if (directoriesHas(target.directoryId)) {
      enterProjectPane(target.directoryId);
      markDirty();
      return;
    }
    const visibleTargets = visibleTargetsForState();
    const fallbackConversation = visibleTargets.find(
      (entry): entry is Extract<LeftNavSelection, { kind: 'conversation' }> =>
        entry.kind === 'conversation' &&
        conversationDirectoryId(entry.sessionId) === target.directoryId,
    );
    if (fallbackConversation !== undefined) {
      selectLeftNavConversation?.(fallbackConversation.sessionId);
      markDirty();
      queueLeftNavConversationActivation({
        queueControlPlaneOp,
        ...(queueLatestControlPlaneOp === undefined
          ? {}
          : {
              queueLatestControlPlaneOp,
            }),
        activateConversation,
        sessionId: fallbackConversation.sessionId,
        label: `shortcut-activate-${direction}-directory-fallback`,
      });
    }
    return;
  }
  if (target.kind === 'github') {
    if (directoriesHas(target.directoryId)) {
      if (enterGitHubPane !== undefined) {
        enterGitHubPane(target.directoryId);
      } else {
        enterProjectPane(target.directoryId);
      }
      markDirty();
      return;
    }
    const visibleTargets = visibleTargetsForState();
    const fallbackConversation = visibleTargets.find(
      (entry): entry is Extract<LeftNavSelection, { kind: 'conversation' }> =>
        entry.kind === 'conversation' &&
        conversationDirectoryId(entry.sessionId) === target.directoryId,
    );
    if (fallbackConversation !== undefined) {
      selectLeftNavConversation?.(fallbackConversation.sessionId);
      markDirty();
      queueLeftNavConversationActivation({
        queueControlPlaneOp,
        ...(queueLatestControlPlaneOp === undefined
          ? {}
          : {
              queueLatestControlPlaneOp,
            }),
        activateConversation,
        sessionId: fallbackConversation.sessionId,
        label: `shortcut-activate-${direction}-github-fallback`,
      });
    }
    return;
  }
  if (!conversationsHas(target.sessionId)) {
    return;
  }
  selectLeftNavConversation?.(target.sessionId);
  markDirty();
  queueLeftNavConversationActivation({
    queueControlPlaneOp,
    ...(queueLatestControlPlaneOp === undefined
      ? {}
      : {
          queueLatestControlPlaneOp,
        }),
    activateConversation,
    sessionId: target.sessionId,
    label: `shortcut-activate-${direction}`,
  });
}

interface CycleLeftNavSelectionOptions {
  visibleTargets: readonly LeftNavSelection[];
  currentSelection: LeftNavSelection;
  direction: 'next' | 'previous';
  activateTarget: (target: LeftNavSelection, direction: 'next' | 'previous') => void;
}

export function cycleLeftNavSelection(options: CycleLeftNavSelectionOptions): boolean {
  const { visibleTargets, currentSelection, direction, activateTarget } = options;
  if (visibleTargets.length === 0) {
    return false;
  }
  const targetKeys = visibleTargets.map((target) => leftNavTargetKey(target));
  const targetKey = cycleConversationId(targetKeys, leftNavTargetKey(currentSelection), direction);
  if (targetKey === null) {
    return false;
  }
  const target = visibleTargets.find((entry) => leftNavTargetKey(entry) === targetKey);
  if (target === undefined) {
    return false;
  }
  activateTarget(target, direction);
  return true;
}
