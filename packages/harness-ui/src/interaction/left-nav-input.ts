export type LeftNavSelection =
  | {
      readonly kind: 'home';
    }
  | {
      readonly kind: 'nim';
    }
  | {
      readonly kind: 'tasks';
    }
  | {
      readonly kind: 'repository';
      readonly repositoryId: string;
    }
  | {
      readonly kind: 'project';
      readonly directoryId: string;
    }
  | {
      readonly kind: 'github';
      readonly directoryId: string;
    }
  | {
      readonly kind: 'conversation';
      readonly sessionId: string;
    };

export interface LeftNavState {
  readonly latestRailRows: () => unknown;
  readonly currentSelection: () => LeftNavSelection;
}

export interface LeftNavActions {
  readonly enterHomePane: () => void;
  readonly enterNimPane?: () => void;
  readonly enterTasksPane?: () => void;
  readonly firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly enterGitHubPane?: (directoryId: string) => void;
  readonly setMainPaneProjectMode: () => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly selectLeftNavConversation?: (sessionId: string) => void;
  readonly markDirty: () => void;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly queueLatestControlPlaneOp?: (
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label: string,
  ) => void;
  readonly activateConversation: (
    sessionId: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
  readonly conversationsHas: (sessionId: string) => boolean;
}

export interface ActivateLeftNavTargetInput {
  readonly target: LeftNavSelection;
  readonly direction: 'next' | 'previous';
  readonly enterHomePane: () => void;
  readonly enterNimPane?: () => void;
  readonly enterTasksPane?: () => void;
  readonly firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly enterGitHubPane?: (directoryId: string) => void;
  readonly setMainPaneProjectMode: () => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly selectLeftNavConversation?: (sessionId: string) => void;
  readonly markDirty: () => void;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly visibleTargetsForState: () => readonly LeftNavSelection[];
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly queueLatestControlPlaneOp?: (
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label: string,
  ) => void;
  readonly activateConversation: (
    sessionId: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<void>;
  readonly conversationsHas: (sessionId: string) => boolean;
}

export interface CycleLeftNavSelectionInput {
  readonly visibleTargets: readonly LeftNavSelection[];
  readonly currentSelection: LeftNavSelection;
  readonly direction: 'next' | 'previous';
  readonly activateTarget: (target: LeftNavSelection, direction: 'next' | 'previous') => void;
}

export interface LeftNavStrategies {
  visibleTargets(rows: unknown): readonly LeftNavSelection[];
  activateTarget(input: ActivateLeftNavTargetInput): void;
  cycleSelection(input: CycleLeftNavSelectionInput): boolean;
}

export class LeftNavInput {
  constructor(
    private readonly state: LeftNavState,
    private readonly actions: LeftNavActions,
    private readonly strategies: LeftNavStrategies,
  ) {}

  visibleTargets(): readonly LeftNavSelection[] {
    return this.strategies.visibleTargets(this.state.latestRailRows());
  }

  activateTarget(target: LeftNavSelection, direction: 'next' | 'previous'): void {
    this.strategies.activateTarget({
      target,
      direction,
      enterHomePane: this.actions.enterHomePane,
      ...(this.actions.enterNimPane === undefined
        ? {}
        : {
            enterNimPane: this.actions.enterNimPane,
          }),
      firstDirectoryForRepositoryGroup: this.actions.firstDirectoryForRepositoryGroup,
      enterProjectPane: this.actions.enterProjectPane,
      ...(this.actions.enterGitHubPane === undefined
        ? {}
        : {
            enterGitHubPane: this.actions.enterGitHubPane,
          }),
      setMainPaneProjectMode: this.actions.setMainPaneProjectMode,
      selectLeftNavRepository: this.actions.selectLeftNavRepository,
      ...(this.actions.selectLeftNavConversation === undefined
        ? {}
        : {
            selectLeftNavConversation: this.actions.selectLeftNavConversation,
          }),
      markDirty: this.actions.markDirty,
      directoriesHas: this.actions.directoriesHas,
      visibleTargetsForState: () => this.visibleTargets(),
      conversationDirectoryId: this.actions.conversationDirectoryId,
      queueControlPlaneOp: this.actions.queueControlPlaneOp,
      ...(this.actions.queueLatestControlPlaneOp === undefined
        ? {}
        : {
            queueLatestControlPlaneOp: this.actions.queueLatestControlPlaneOp,
          }),
      activateConversation: this.actions.activateConversation,
      conversationsHas: this.actions.conversationsHas,
      ...(this.actions.enterTasksPane === undefined
        ? {}
        : {
            enterTasksPane: this.actions.enterTasksPane,
          }),
    });
  }

  cycleSelection(direction: 'next' | 'previous'): boolean {
    return this.strategies.cycleSelection({
      visibleTargets: this.visibleTargets(),
      currentSelection: this.state.currentSelection(),
      direction,
      activateTarget: (target, nextDirection) => this.activateTarget(target, nextDirection),
    });
  }
}
