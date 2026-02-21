type MainPaneMode = 'conversation' | 'project' | 'home' | 'nim';
type PointerTarget = 'left' | 'right' | 'separator' | 'status' | 'outside';

interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}

function isWheelMouseCode(code: number): boolean {
  return (code & 0b0100_0000) !== 0;
}

function hasAltModifier(code: number): boolean {
  return (code & 0b0000_1000) !== 0;
}

function isMotionMouseCode(code: number): boolean {
  return (code & 0b0010_0000) !== 0;
}

function isLeftButtonPress(code: number, final: 'M' | 'm'): boolean {
  if (final !== 'M') {
    return false;
  }
  if (isWheelMouseCode(code) || isMotionMouseCode(code)) {
    return false;
  }
  return (code & 0b0000_0011) === 0;
}

function isMouseRelease(final: 'M' | 'm'): boolean {
  return final === 'm';
}

function isSelectionDrag(code: number, final: 'M' | 'm'): boolean {
  return final === 'M' && isMotionMouseCode(code);
}

function wheelDeltaRowsFromCode(code: number): number | null {
  if (!isWheelMouseCode(code)) {
    return null;
  }
  return (code & 0b0000_0001) === 0 ? -1 : 1;
}

export interface PointerRoutingInputOptions {
  readonly getPaneDividerDragActive: () => boolean;
  readonly setPaneDividerDragActive: (active: boolean) => void;
  readonly applyPaneDividerAtCol: (col: number) => void;
  readonly getHomePaneDragState: () => HomePaneDragState | null;
  readonly setHomePaneDragState: (next: HomePaneDragState | null) => void;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly taskIdAtRow: (index: number) => string | null;
  readonly repositoryIdAtRow: (index: number) => string | null;
  readonly reorderTaskByDrop: (draggedTaskId: string, targetTaskId: string) => void;
  readonly reorderRepositoryByDrop: (
    draggedRepositoryId: string,
    targetRepositoryId: string,
  ) => void;
  readonly onProjectWheel: (delta: number) => void;
  readonly onHomeWheel: (delta: number) => void;
  readonly onNimWheel: (delta: number) => void;
  readonly markDirty: () => void;
}

export interface HandlePaneDividerDragInput {
  readonly paneDividerDragActive: boolean;
  readonly isMouseRelease: boolean;
  readonly isWheelMouseCode: boolean;
  readonly mouseCol: number;
  readonly setPaneDividerDragActive: (active: boolean) => void;
  readonly applyPaneDividerAtCol: (col: number) => void;
  readonly markDirty: () => void;
}

export interface HandleHomePaneDragReleaseInput {
  readonly homePaneDragState: HomePaneDragState | null;
  readonly isMouseRelease: boolean;
  readonly mainPaneMode: MainPaneMode;
  readonly target: PointerTarget;
  readonly rowIndex: number;
  readonly taskIdAtRow: (rowIndex: number) => string | null;
  readonly repositoryIdAtRow: (rowIndex: number) => string | null;
  readonly reorderTaskByDrop: (draggedTaskId: string, targetTaskId: string) => void;
  readonly reorderRepositoryByDrop: (
    draggedRepositoryId: string,
    targetRepositoryId: string,
  ) => void;
  readonly setHomePaneDragState: (next: HomePaneDragState | null) => void;
  readonly markDirty: () => void;
}

export interface HandleSeparatorPointerPressInput {
  readonly target: PointerTarget;
  readonly isLeftButtonPress: boolean;
  readonly hasAltModifier: boolean;
  readonly mouseCol: number;
  readonly setPaneDividerDragActive: (active: boolean) => void;
  readonly applyPaneDividerAtCol: (col: number) => void;
}

export interface HandleMainPaneWheelInput {
  readonly target: PointerTarget;
  readonly wheelDelta: number | null;
  readonly mainPaneMode: MainPaneMode;
  readonly onProjectWheel: (delta: number) => void;
  readonly onHomeWheel: (delta: number) => void;
  readonly onNimWheel: (delta: number) => void;
  readonly onConversationWheel: (delta: number) => void;
  readonly markDirty: () => void;
}

export interface HandleHomePaneDragMoveInput {
  readonly homePaneDragState: HomePaneDragState | null;
  readonly mainPaneMode: MainPaneMode;
  readonly target: PointerTarget;
  readonly isSelectionDrag: boolean;
  readonly hasAltModifier: boolean;
  readonly rowIndex: number;
  readonly setHomePaneDragState: (next: HomePaneDragState) => void;
  readonly markDirty: () => void;
}

export interface PointerRoutingStrategies {
  handlePaneDividerDragInput(options: HandlePaneDividerDragInput): boolean;
  handleHomePaneDragRelease(options: HandleHomePaneDragReleaseInput): boolean;
  handleSeparatorPointerPress(options: HandleSeparatorPointerPressInput): boolean;
  handleMainPaneWheelInput(options: HandleMainPaneWheelInput): boolean;
  handleHomePaneDragMove(options: HandleHomePaneDragMoveInput): boolean;
}

interface PointerEventInput {
  readonly code: number;
  readonly final: 'M' | 'm';
  readonly col: number;
  readonly target: PointerTarget;
  readonly rowIndex: number;
}

export class PointerRoutingInput {
  constructor(
    private readonly options: PointerRoutingInputOptions,
    private readonly strategies: PointerRoutingStrategies,
  ) {}

  handlePaneDividerDrag(event: Pick<PointerEventInput, 'code' | 'final' | 'col'>): boolean {
    return this.strategies.handlePaneDividerDragInput({
      paneDividerDragActive: this.options.getPaneDividerDragActive(),
      isMouseRelease: isMouseRelease(event.final),
      isWheelMouseCode: isWheelMouseCode(event.code),
      mouseCol: event.col,
      setPaneDividerDragActive: this.options.setPaneDividerDragActive,
      applyPaneDividerAtCol: this.options.applyPaneDividerAtCol,
      markDirty: this.options.markDirty,
    });
  }

  handleHomePaneDragRelease(
    event: Pick<PointerEventInput, 'final' | 'target' | 'rowIndex'>,
  ): boolean {
    return this.strategies.handleHomePaneDragRelease({
      homePaneDragState: this.options.getHomePaneDragState(),
      isMouseRelease: isMouseRelease(event.final),
      mainPaneMode: this.options.getMainPaneMode(),
      target: event.target,
      rowIndex: event.rowIndex,
      taskIdAtRow: this.options.taskIdAtRow,
      repositoryIdAtRow: this.options.repositoryIdAtRow,
      reorderTaskByDrop: this.options.reorderTaskByDrop,
      reorderRepositoryByDrop: this.options.reorderRepositoryByDrop,
      setHomePaneDragState: this.options.setHomePaneDragState,
      markDirty: this.options.markDirty,
    });
  }

  handleSeparatorPointerPress(
    event: Pick<PointerEventInput, 'target' | 'code' | 'final' | 'col'>,
  ): boolean {
    return this.strategies.handleSeparatorPointerPress({
      target: event.target,
      isLeftButtonPress: isLeftButtonPress(event.code, event.final),
      hasAltModifier: hasAltModifier(event.code),
      mouseCol: event.col,
      setPaneDividerDragActive: this.options.setPaneDividerDragActive,
      applyPaneDividerAtCol: this.options.applyPaneDividerAtCol,
    });
  }

  handleMainPaneWheel(
    event: Pick<PointerEventInput, 'target' | 'code'>,
    onConversationWheel: (delta: number) => void,
  ): boolean {
    return this.strategies.handleMainPaneWheelInput({
      target: event.target,
      wheelDelta: wheelDeltaRowsFromCode(event.code),
      mainPaneMode: this.options.getMainPaneMode(),
      onProjectWheel: this.options.onProjectWheel,
      onHomeWheel: this.options.onHomeWheel,
      onNimWheel: this.options.onNimWheel,
      onConversationWheel,
      markDirty: this.options.markDirty,
    });
  }

  handleHomePaneDragMove(
    event: Pick<PointerEventInput, 'target' | 'code' | 'final' | 'rowIndex'>,
  ): boolean {
    return this.strategies.handleHomePaneDragMove({
      homePaneDragState: this.options.getHomePaneDragState(),
      mainPaneMode: this.options.getMainPaneMode(),
      target: event.target,
      isSelectionDrag: isSelectionDrag(event.code, event.final),
      hasAltModifier: hasAltModifier(event.code),
      rowIndex: event.rowIndex,
      setHomePaneDragState: this.options.setHomePaneDragState,
      markDirty: this.options.markDirty,
    });
  }
}
