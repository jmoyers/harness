export type LeftNavSelection =
  | {
      readonly kind: 'home';
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
      readonly kind: 'conversation';
      readonly sessionId: string;
    };

export interface LeftNavState {
  readonly latestRailRows: () => unknown;
  readonly currentSelection: () => LeftNavSelection;
}

export interface LeftNavActions {
  readonly enterHomePane: () => void;
  readonly enterTasksPane?: () => void;
  readonly firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly setMainPaneProjectMode: () => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly selectLeftNavConversation?: (sessionId: string) => void;
  readonly markDirty: () => void;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly activateConversation: (sessionId: string) => Promise<void>;
  readonly shouldActivateConversation?: (sessionId: string) => boolean;
  readonly conversationsHas: (sessionId: string) => boolean;
}

export interface ActivateLeftNavTargetInput {
  readonly target: LeftNavSelection;
  readonly direction: 'next' | 'previous';
  readonly enterHomePane: () => void;
  readonly enterTasksPane?: () => void;
  readonly firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly setMainPaneProjectMode: () => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly selectLeftNavConversation?: (sessionId: string) => void;
  readonly markDirty: () => void;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly visibleTargetsForState: () => readonly LeftNavSelection[];
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly activateConversation: (sessionId: string) => Promise<void>;
  readonly shouldActivateConversation?: (sessionId: string) => boolean;
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
      firstDirectoryForRepositoryGroup: this.actions.firstDirectoryForRepositoryGroup,
      enterProjectPane: this.actions.enterProjectPane,
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
      activateConversation: this.actions.activateConversation,
      ...(this.actions.shouldActivateConversation === undefined
        ? {}
        : {
            shouldActivateConversation: this.actions.shouldActivateConversation,
          }),
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
