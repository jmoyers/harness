import {
  activateLeftNavTarget as activateLeftNavTargetFrame,
  cycleLeftNavSelection as cycleLeftNavSelectionFrame,
} from '../mux/live-mux/left-nav-activation.ts';
import {
  visibleLeftNavTargets as visibleLeftNavTargetsFrame,
  type LeftNavSelection,
} from '../mux/live-mux/left-nav.ts';
import type { buildWorkspaceRailViewRows } from '../mux/workspace-rail-model.ts';

interface LeftNavInputOptions {
  readonly getLatestRailRows: () => ReturnType<typeof buildWorkspaceRailViewRows>;
  readonly getCurrentSelection: () => LeftNavSelection;
  readonly enterHomePane: () => void;
  readonly enterTasksPane?: () => void;
  readonly firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly setMainPaneProjectMode: () => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly markDirty: () => void;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly activateConversation: (sessionId: string) => Promise<void>;
  readonly conversationsHas: (sessionId: string) => boolean;
}

interface LeftNavInputDependencies {
  readonly visibleLeftNavTargets?: typeof visibleLeftNavTargetsFrame;
  readonly activateLeftNavTarget?: typeof activateLeftNavTargetFrame;
  readonly cycleLeftNavSelection?: typeof cycleLeftNavSelectionFrame;
}

export class LeftNavInput {
  private readonly visibleLeftNavTargets: typeof visibleLeftNavTargetsFrame;
  private readonly activateLeftNavTargetFrame: typeof activateLeftNavTargetFrame;
  private readonly cycleLeftNavSelectionFrame: typeof cycleLeftNavSelectionFrame;

  constructor(
    private readonly options: LeftNavInputOptions,
    dependencies: LeftNavInputDependencies = {},
  ) {
    this.visibleLeftNavTargets = dependencies.visibleLeftNavTargets ?? visibleLeftNavTargetsFrame;
    this.activateLeftNavTargetFrame =
      dependencies.activateLeftNavTarget ?? activateLeftNavTargetFrame;
    this.cycleLeftNavSelectionFrame =
      dependencies.cycleLeftNavSelection ?? cycleLeftNavSelectionFrame;
  }

  visibleTargets(): readonly LeftNavSelection[] {
    return this.visibleLeftNavTargets(this.options.getLatestRailRows());
  }

  activateTarget(target: LeftNavSelection, direction: 'next' | 'previous'): void {
    this.activateLeftNavTargetFrame({
      target,
      direction,
      enterHomePane: this.options.enterHomePane,
      firstDirectoryForRepositoryGroup: this.options.firstDirectoryForRepositoryGroup,
      enterProjectPane: this.options.enterProjectPane,
      setMainPaneProjectMode: this.options.setMainPaneProjectMode,
      selectLeftNavRepository: this.options.selectLeftNavRepository,
      markDirty: this.options.markDirty,
      directoriesHas: this.options.directoriesHas,
      visibleTargetsForState: () => this.visibleTargets(),
      conversationDirectoryId: this.options.conversationDirectoryId,
      queueControlPlaneOp: this.options.queueControlPlaneOp,
      activateConversation: this.options.activateConversation,
      conversationsHas: this.options.conversationsHas,
      ...(this.options.enterTasksPane === undefined
        ? {}
        : {
            enterTasksPane: this.options.enterTasksPane,
          }),
    });
  }

  cycleSelection(direction: 'next' | 'previous'): boolean {
    return this.cycleLeftNavSelectionFrame({
      visibleTargets: this.visibleTargets(),
      currentSelection: this.options.getCurrentSelection(),
      direction,
      activateTarget: (target, nextDirection) => this.activateTarget(target, nextDirection),
    });
  }
}
