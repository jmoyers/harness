interface HandlePaneDividerDragInputOptions {
  paneDividerDragActive: boolean;
  isMouseRelease: boolean;
  isWheelMouseCode: boolean;
  mouseCol: number;
  setPaneDividerDragActive: (active: boolean) => void;
  applyPaneDividerAtCol: (col: number) => void;
  markDirty: () => void;
}

export function handlePaneDividerDragInput(options: HandlePaneDividerDragInputOptions): boolean {
  if (!options.paneDividerDragActive) {
    return false;
  }
  if (options.isMouseRelease) {
    options.setPaneDividerDragActive(false);
    options.markDirty();
    return true;
  }
  if (!options.isWheelMouseCode) {
    options.applyPaneDividerAtCol(options.mouseCol);
    return true;
  }
  return false;
}

interface HandleSeparatorPointerPressOptions {
  target: string;
  isLeftButtonPress: boolean;
  hasAltModifier: boolean;
  mouseCol: number;
  setPaneDividerDragActive: (active: boolean) => void;
  applyPaneDividerAtCol: (col: number) => void;
}

export function handleSeparatorPointerPress(options: HandleSeparatorPointerPressOptions): boolean {
  if (options.target !== 'separator' || !options.isLeftButtonPress || options.hasAltModifier) {
    return false;
  }
  options.setPaneDividerDragActive(true);
  options.applyPaneDividerAtCol(options.mouseCol);
  return true;
}

interface HandleMainPaneWheelInputOptions {
  target: string;
  wheelDelta: number | null;
  mainPaneMode: 'conversation' | 'project' | 'home' | 'nim';
  onProjectWheel: (delta: number) => void;
  onHomeWheel: (delta: number) => void;
  onNimWheel: (delta: number) => void;
  onConversationWheel: (delta: number) => void;
  markDirty: () => void;
}

export function handleMainPaneWheelInput(options: HandleMainPaneWheelInputOptions): boolean {
  if (options.wheelDelta === null || options.target !== 'right') {
    return false;
  }
  if (options.mainPaneMode === 'project') {
    options.onProjectWheel(options.wheelDelta);
  } else if (options.mainPaneMode === 'home') {
    options.onHomeWheel(options.wheelDelta);
  } else if (options.mainPaneMode === 'nim') {
    options.onNimWheel(options.wheelDelta);
  } else {
    options.onConversationWheel(options.wheelDelta);
  }
  options.markDirty();
  return true;
}

interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}

interface HandleHomePaneDragMoveOptions {
  homePaneDragState: HomePaneDragState | null;
  mainPaneMode: 'conversation' | 'project' | 'home' | 'nim';
  target: string;
  isSelectionDrag: boolean;
  hasAltModifier: boolean;
  rowIndex: number;
  setHomePaneDragState: (next: HomePaneDragState) => void;
  markDirty: () => void;
}

export function handleHomePaneDragMove(options: HandleHomePaneDragMoveOptions): boolean {
  if (
    options.homePaneDragState === null ||
    options.mainPaneMode !== 'home' ||
    options.target !== 'right' ||
    !options.isSelectionDrag ||
    options.hasAltModifier
  ) {
    return false;
  }
  options.setHomePaneDragState({
    ...options.homePaneDragState,
    latestRowIndex: options.rowIndex,
    hasDragged:
      options.homePaneDragState.hasDragged ||
      options.rowIndex !== options.homePaneDragState.startedRowIndex,
  });
  options.markDirty();
  return true;
}
