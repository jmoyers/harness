interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}

interface HandleHomePaneDragReleaseOptions {
  homePaneDragState: HomePaneDragState | null;
  isMouseRelease: boolean;
  mainPaneMode: 'conversation' | 'project' | 'home' | 'nim';
  target: string;
  rowIndex: number;
  taskIdAtRow: (rowIndex: number) => string | null;
  repositoryIdAtRow: (rowIndex: number) => string | null;
  reorderTaskByDrop: (draggedTaskId: string, targetTaskId: string) => void;
  reorderRepositoryByDrop: (draggedRepositoryId: string, targetRepositoryId: string) => void;
  setHomePaneDragState: (next: HomePaneDragState | null) => void;
  markDirty: () => void;
}

export function handleHomePaneDragRelease(options: HandleHomePaneDragReleaseOptions): boolean {
  if (options.homePaneDragState === null || !options.isMouseRelease) {
    return false;
  }
  const drag = options.homePaneDragState;
  options.setHomePaneDragState(null);
  if (options.mainPaneMode === 'home' && options.target === 'right' && drag.hasDragged) {
    if (drag.kind === 'task') {
      const targetTaskId = options.taskIdAtRow(options.rowIndex);
      if (targetTaskId !== null) {
        options.reorderTaskByDrop(drag.itemId, targetTaskId);
      }
    } else {
      const targetRepositoryId = options.repositoryIdAtRow(options.rowIndex);
      if (targetRepositoryId !== null) {
        options.reorderRepositoryByDrop(drag.itemId, targetRepositoryId);
      }
    }
  }
  options.markDirty();
  return true;
}
