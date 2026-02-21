export interface SelectionPoint {
  readonly rowAbs: number;
  readonly col: number;
}

export interface PaneSelection {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly text: string;
}

export interface PaneSelectionDrag {
  readonly anchor: SelectionPoint;
  readonly focus: SelectionPoint;
  readonly hasDragged: boolean;
}

export interface SelectionLayout {
  readonly paneRows: number;
  readonly rightCols: number;
  readonly rightStartCol: number;
}

export interface ConversationSelectionSnapshotFrame {
  readonly colorKind?: 'default' | 'indexed' | 'rgb';
  readonly rows: number;
  readonly cols: number;
  readonly activeScreen: 'primary' | 'alternate';
  readonly modes: {
    readonly bracketedPaste: boolean;
    readonly decMouseX10: boolean;
    readonly decMouseButtonEvent: boolean;
    readonly decMouseAnyEvent: boolean;
    readonly decFocusTracking: boolean;
    readonly decMouseSgrEncoding: boolean;
  };
  readonly cursor: {
    readonly row: number;
    readonly col: number;
    readonly visible: boolean;
    readonly style: {
      readonly shape: 'block' | 'bar' | 'underline';
      readonly blinking: boolean;
    };
  };
  readonly viewport: {
    readonly top: number;
    readonly totalRows: number;
    readonly followOutput: boolean;
  };
  readonly lines: string[];
  readonly richLines: Array<{
    readonly wrapped: boolean;
    readonly text: string;
    readonly cells: Array<{
      readonly glyph: string;
      readonly width: number;
      readonly continued: boolean;
      readonly style: {
        readonly bold: boolean;
        readonly dim: boolean;
        readonly italic: boolean;
        readonly underline: boolean;
        readonly inverse: boolean;
        readonly fg:
          | { readonly kind: 'default' }
          | { readonly kind: 'indexed'; readonly index: number }
          | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };
        readonly bg:
          | { readonly kind: 'default' }
          | { readonly kind: 'indexed'; readonly index: number }
          | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };
      };
    }>;
  }>;
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

export interface ConversationSelectionInputOptions {
  readonly getSelection: () => PaneSelection | null;
  readonly setSelection: (next: PaneSelection | null) => void;
  readonly getSelectionDrag: () => PaneSelectionDrag | null;
  readonly setSelectionDrag: (next: PaneSelectionDrag | null) => void;
  readonly pinViewportForSelection: () => void;
  readonly releaseViewportPinForSelection: () => void;
  readonly markDirty: () => void;
}

export interface ReduceConversationMouseSelectionInput {
  readonly selection: PaneSelection | null;
  readonly selectionDrag: PaneSelectionDrag | null;
  readonly point: SelectionPoint;
  readonly isMainPaneTarget: boolean;
  readonly isLeftButtonPress: boolean;
  readonly isSelectionDrag: boolean;
  readonly isMouseRelease: boolean;
  readonly isWheelMouseCode: boolean;
  readonly selectionTextForPane: (selection: PaneSelection) => string;
}

export interface ReduceConversationMouseSelectionResult {
  readonly selection: PaneSelection | null;
  readonly selectionDrag: PaneSelectionDrag | null;
  readonly pinViewport: boolean;
  readonly releaseViewportPin: boolean;
  readonly markDirty: boolean;
  readonly consumed: boolean;
}

export interface ConversationSelectionStrategies {
  pointFromMouseEvent(
    layout: SelectionLayout,
    frame: ConversationSelectionSnapshotFrame,
    event: { col: number; row: number },
  ): SelectionPoint;
  reduceConversationMouseSelection(
    options: ReduceConversationMouseSelectionInput,
  ): ReduceConversationMouseSelectionResult;
  selectionText(frame: ConversationSelectionSnapshotFrame, selection: PaneSelection | null): string;
}

interface MouseSelectionInput {
  readonly layout: SelectionLayout;
  readonly frame: ConversationSelectionSnapshotFrame;
  readonly isMainPaneTarget: boolean;
  readonly resolveSelectionText?: (selection: PaneSelection) => string;
  readonly event: {
    readonly col: number;
    readonly row: number;
    readonly code: number;
    readonly final: 'M' | 'm';
  };
}

export class ConversationSelectionInput {
  constructor(
    private readonly options: ConversationSelectionInputOptions,
    private readonly strategies: ConversationSelectionStrategies,
  ) {}

  clearSelectionOnTextToken(textLength: number): boolean {
    const hasSelection =
      this.options.getSelection() !== null || this.options.getSelectionDrag() !== null;
    if (textLength <= 0 || !hasSelection) {
      return false;
    }
    this.options.setSelection(null);
    this.options.setSelectionDrag(null);
    this.options.releaseViewportPinForSelection();
    this.options.markDirty();
    return true;
  }

  handleMouseSelection(input: MouseSelectionInput): boolean {
    const reduced = this.strategies.reduceConversationMouseSelection({
      selection: this.options.getSelection(),
      selectionDrag: this.options.getSelectionDrag(),
      point: this.strategies.pointFromMouseEvent(input.layout, input.frame, input.event),
      isMainPaneTarget: input.isMainPaneTarget,
      isLeftButtonPress:
        isLeftButtonPress(input.event.code, input.event.final) && !hasAltModifier(input.event.code),
      isSelectionDrag:
        isSelectionDrag(input.event.code, input.event.final) && !hasAltModifier(input.event.code),
      isMouseRelease: isMouseRelease(input.event.final),
      isWheelMouseCode: isWheelMouseCode(input.event.code),
      selectionTextForPane: (nextSelection) =>
        input.resolveSelectionText === undefined
          ? this.strategies.selectionText(input.frame, nextSelection)
          : input.resolveSelectionText(nextSelection),
    });
    this.options.setSelection(reduced.selection);
    this.options.setSelectionDrag(reduced.selectionDrag);
    if (reduced.pinViewport) {
      this.options.pinViewportForSelection();
    }
    if (reduced.releaseViewportPin) {
      this.options.releaseViewportPinForSelection();
    }
    if (reduced.markDirty) {
      this.options.markDirty();
    }
    return reduced.consumed;
  }
}
