interface HandleProjectPaneActionClickOptions<TSnapshot extends { directoryId: string }> {
  clickEligible: boolean;
  snapshot: TSnapshot | null;
  rightCols: number;
  paneRows: number;
  projectPaneScrollTop: number;
  rowIndex: number;
  projectPaneActionAtRow: (
    snapshot: TSnapshot,
    rightCols: number,
    paneRows: number,
    projectPaneScrollTop: number,
    rowIndex: number,
  ) => string | null;
  openNewThreadPrompt: (directoryId: string) => void;
  queueCloseDirectory: (directoryId: string) => void;
  handleProjectPaneAction?: (action: string, directoryId: string) => boolean;
  markDirty: () => void;
}

export function handleProjectPaneActionClick<TSnapshot extends { directoryId: string }>(
  options: HandleProjectPaneActionClickOptions<TSnapshot>,
): boolean {
  if (!options.clickEligible || options.snapshot === null) {
    return false;
  }
  const action = options.projectPaneActionAtRow(
    options.snapshot,
    options.rightCols,
    options.paneRows,
    options.projectPaneScrollTop,
    options.rowIndex,
  );
  if (action === 'conversation.new') {
    options.openNewThreadPrompt(options.snapshot.directoryId);
    options.markDirty();
    return true;
  }
  if (action === 'project.close') {
    options.queueCloseDirectory(options.snapshot.directoryId);
    options.markDirty();
    return true;
  }
  if (
    action !== null &&
    options.handleProjectPaneAction?.(action, options.snapshot.directoryId) === true
  ) {
    options.markDirty();
    return true;
  }
  return false;
}
