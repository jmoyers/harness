import { handleHomePaneActionClick } from './home-pane-actions.ts';
import { handleHomePaneEntityClick } from './home-pane-entity-click.ts';

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

interface HandleHomePanePointerClickOptions {
  clickEligible: boolean;
  paneRows: number;
  rightCols: number;
  rightStartCol: number;
  pointerRow: number;
  pointerCol: number;
  actionAtCell: (rowIndex: number, colIndex: number) => string | null;
  actionAtRow: (rowIndex: number) => string | null;
  clearTaskEditClickState: () => void;
  clearRepositoryEditClickState: () => void;
  clearHomePaneDragState: () => void;
  getTaskRepositoryDropdownOpen: () => boolean;
  setTaskRepositoryDropdownOpen: (open: boolean) => void;
  taskIdAtRow: (rowIndex: number) => string | null;
  repositoryIdAtRow: (rowIndex: number) => string | null;
  rowTextAtRow?: (rowIndex: number) => string | null;
  selectTaskById: (taskId: string) => void;
  selectRepositoryById: (repositoryId: string) => void;
  runTaskPaneAction: (action: 'task.ready' | 'task.draft' | 'task.complete') => void;
  nowMs: number;
  homePaneEditDoubleClickWindowMs: number;
  taskEditClickState: EntityDoubleClickState | null;
  repositoryEditClickState: EntityDoubleClickState | null;
  clearTaskPaneNotice: () => void;
  setTaskEditClickState: (next: EntityDoubleClickState | null) => void;
  setRepositoryEditClickState: (next: EntityDoubleClickState | null) => void;
  setHomePaneDragState: (next: HomePaneDragState | null) => void;
  openTaskEditPrompt: (taskId: string) => void;
  openRepositoryPromptForEdit: (repositoryId: string) => void;
  markDirty: () => void;
}

export function handleHomePanePointerClick(options: HandleHomePanePointerClickOptions): boolean {
  if (!options.clickEligible) {
    return false;
  }
  const rowIndex = Math.max(0, Math.min(options.paneRows - 1, options.pointerRow - 1));
  const colIndex = Math.max(
    0,
    Math.min(options.rightCols - 1, options.pointerCol - options.rightStartCol),
  );
  const rowText = options.rowTextAtRow?.(rowIndex) ?? null;
  const isTaskEditorContentRow =
    options.taskIdAtRow(rowIndex) !== null &&
    rowText !== null &&
    rowText.trimEnd().startsWith(' │') &&
    rowText.trimEnd().includes('│');
  if (isTaskEditorContentRow) {
    return false;
  }
  const action = options.actionAtCell(rowIndex, colIndex) ?? options.actionAtRow(rowIndex);
  if (
    handleHomePaneActionClick({
      action,
      rowIndex,
      clearTaskEditClickState: options.clearTaskEditClickState,
      clearRepositoryEditClickState: options.clearRepositoryEditClickState,
      clearHomePaneDragState: options.clearHomePaneDragState,
      getTaskRepositoryDropdownOpen: options.getTaskRepositoryDropdownOpen,
      setTaskRepositoryDropdownOpen: options.setTaskRepositoryDropdownOpen,
      taskIdAtRow: options.taskIdAtRow,
      repositoryIdAtRow: options.repositoryIdAtRow,
      selectTaskById: options.selectTaskById,
      selectRepositoryById: options.selectRepositoryById,
      runTaskPaneAction: options.runTaskPaneAction,
      markDirty: options.markDirty,
    })
  ) {
    return true;
  }
  return handleHomePaneEntityClick({
    rowIndex,
    nowMs: options.nowMs,
    homePaneEditDoubleClickWindowMs: options.homePaneEditDoubleClickWindowMs,
    taskEditClickState: options.taskEditClickState,
    repositoryEditClickState: options.repositoryEditClickState,
    taskIdAtRow: options.taskIdAtRow,
    repositoryIdAtRow: options.repositoryIdAtRow,
    selectTaskById: options.selectTaskById,
    selectRepositoryById: options.selectRepositoryById,
    clearTaskPaneNotice: options.clearTaskPaneNotice,
    setTaskEditClickState: options.setTaskEditClickState,
    setRepositoryEditClickState: options.setRepositoryEditClickState,
    setHomePaneDragState: options.setHomePaneDragState,
    openTaskEditPrompt: options.openTaskEditPrompt,
    openRepositoryPromptForEdit: options.openRepositoryPromptForEdit,
    markDirty: options.markDirty,
  });
}
