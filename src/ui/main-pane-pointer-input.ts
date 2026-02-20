import { hasAltModifier, isLeftButtonPress, isMotionMouseCode } from '../mux/live-mux/selection.ts';
import { handleHomePanePointerClick } from '../mux/live-mux/home-pane-pointer.ts';
import { handleProjectPaneActionClick } from '../mux/live-mux/project-pane-pointer.ts';

interface EntityDoubleClickState {
  readonly entityId: string;
  readonly atMs: number;
}

interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}

type MainPaneMode = 'conversation' | 'project' | 'home';
type PointerTarget = 'left' | 'right' | 'separator' | 'status' | 'outside';

interface MainPanePointerInputOptions<TProjectSnapshot extends { directoryId: string }> {
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getProjectPaneSnapshot: () => TProjectSnapshot | null;
  readonly getProjectPaneScrollTop: () => number;
  readonly projectPaneActionAtRow: (
    snapshot: TProjectSnapshot,
    rightCols: number,
    paneRows: number,
    projectPaneScrollTop: number,
    rowIndex: number,
  ) => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly queueCloseDirectory: (directoryId: string) => void;
  readonly actionAtCell: (rowIndex: number, colIndex: number) => string | null;
  readonly actionAtRow: (rowIndex: number) => string | null;
  readonly clearTaskEditClickState: () => void;
  readonly clearRepositoryEditClickState: () => void;
  readonly clearHomePaneDragState: () => void;
  readonly getTaskRepositoryDropdownOpen: () => boolean;
  readonly setTaskRepositoryDropdownOpen: (open: boolean) => void;
  readonly taskIdAtRow: (rowIndex: number) => string | null;
  readonly repositoryIdAtRow: (rowIndex: number) => string | null;
  readonly rowTextAtRow?: (rowIndex: number) => string | null;
  readonly selectTaskById: (taskId: string) => void;
  readonly selectRepositoryById: (repositoryId: string) => void;
  readonly runTaskPaneAction: (action: 'task.ready' | 'task.draft' | 'task.complete') => void;
  readonly nowMs: () => number;
  readonly homePaneEditDoubleClickWindowMs: number;
  readonly getTaskEditClickState: () => EntityDoubleClickState | null;
  readonly getRepositoryEditClickState: () => EntityDoubleClickState | null;
  readonly clearTaskPaneNotice: () => void;
  readonly setTaskEditClickState: (next: EntityDoubleClickState | null) => void;
  readonly setRepositoryEditClickState: (next: EntityDoubleClickState | null) => void;
  readonly setHomePaneDragState: (next: HomePaneDragState | null) => void;
  readonly openTaskEditPrompt: (taskId: string) => void;
  readonly openRepositoryPromptForEdit: (repositoryId: string) => void;
  readonly markDirty: () => void;
}

interface MainPanePointerInputDependencies {
  readonly handleProjectPaneActionClick?: typeof handleProjectPaneActionClick;
  readonly handleHomePanePointerClick?: typeof handleHomePanePointerClick;
}

interface PointerEventInput {
  readonly target: PointerTarget;
  readonly code: number;
  readonly final: 'M' | 'm';
  readonly row: number;
  readonly col: number;
  readonly paneRows: number;
  readonly rightCols: number;
  readonly rightStartCol: number;
}

export class MainPanePointerInput<TProjectSnapshot extends { directoryId: string }> {
  private readonly projectPaneActionClick: typeof handleProjectPaneActionClick<TProjectSnapshot>;
  private readonly homePanePointerClick: typeof handleHomePanePointerClick;

  constructor(
    private readonly options: MainPanePointerInputOptions<TProjectSnapshot>,
    dependencies: MainPanePointerInputDependencies = {},
  ) {
    this.projectPaneActionClick =
      dependencies.handleProjectPaneActionClick ?? handleProjectPaneActionClick;
    this.homePanePointerClick =
      dependencies.handleHomePanePointerClick ?? handleHomePanePointerClick;
  }

  handleProjectPanePointerClick(input: PointerEventInput): boolean {
    const clickEligible =
      input.target === 'right' &&
      this.options.getMainPaneMode() === 'project' &&
      isLeftButtonPress(input.code, input.final) &&
      !hasAltModifier(input.code) &&
      !isMotionMouseCode(input.code);
    const rowIndex = Math.max(0, Math.min(input.paneRows - 1, input.row - 1));
    return this.projectPaneActionClick({
      clickEligible,
      snapshot: this.options.getProjectPaneSnapshot(),
      rightCols: input.rightCols,
      paneRows: input.paneRows,
      projectPaneScrollTop: this.options.getProjectPaneScrollTop(),
      rowIndex,
      projectPaneActionAtRow: this.options.projectPaneActionAtRow,
      openNewThreadPrompt: this.options.openNewThreadPrompt,
      queueCloseDirectory: this.options.queueCloseDirectory,
      markDirty: this.options.markDirty,
    });
  }

  handleHomePanePointerClick(input: PointerEventInput): boolean {
    const clickEligible =
      input.target === 'right' &&
      this.options.getMainPaneMode() === 'home' &&
      isLeftButtonPress(input.code, input.final) &&
      !hasAltModifier(input.code) &&
      !isMotionMouseCode(input.code);
    const homePointerInput = {
      clickEligible,
      paneRows: input.paneRows,
      rightCols: input.rightCols,
      rightStartCol: input.rightStartCol,
      pointerRow: input.row,
      pointerCol: input.col,
      actionAtCell: this.options.actionAtCell,
      actionAtRow: this.options.actionAtRow,
      clearTaskEditClickState: this.options.clearTaskEditClickState,
      clearRepositoryEditClickState: this.options.clearRepositoryEditClickState,
      clearHomePaneDragState: this.options.clearHomePaneDragState,
      getTaskRepositoryDropdownOpen: this.options.getTaskRepositoryDropdownOpen,
      setTaskRepositoryDropdownOpen: this.options.setTaskRepositoryDropdownOpen,
      taskIdAtRow: this.options.taskIdAtRow,
      repositoryIdAtRow: this.options.repositoryIdAtRow,
      selectTaskById: this.options.selectTaskById,
      selectRepositoryById: this.options.selectRepositoryById,
      runTaskPaneAction: this.options.runTaskPaneAction,
      nowMs: this.options.nowMs(),
      homePaneEditDoubleClickWindowMs: this.options.homePaneEditDoubleClickWindowMs,
      taskEditClickState: this.options.getTaskEditClickState(),
      repositoryEditClickState: this.options.getRepositoryEditClickState(),
      clearTaskPaneNotice: this.options.clearTaskPaneNotice,
      setTaskEditClickState: this.options.setTaskEditClickState,
      setRepositoryEditClickState: this.options.setRepositoryEditClickState,
      setHomePaneDragState: this.options.setHomePaneDragState,
      openTaskEditPrompt: this.options.openTaskEditPrompt,
      openRepositoryPromptForEdit: this.options.openRepositoryPromptForEdit,
      markDirty: this.options.markDirty,
      ...(this.options.rowTextAtRow === undefined
        ? {}
        : {
            rowTextAtRow: this.options.rowTextAtRow,
          }),
    };
    return this.homePanePointerClick(homePointerInput);
  }
}
