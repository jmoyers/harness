import {
  hasAltModifier,
  isLeftButtonPress,
  isMouseRelease,
  isSelectionDrag,
  isWheelMouseCode,
  pointFromMouseEvent as pointFromMouseEventFrame,
  reduceConversationMouseSelection as reduceConversationMouseSelectionFrame,
  selectionText as selectionTextFrame,
  type PaneSelection,
  type PaneSelectionDrag,
  type SelectionLayout,
} from '../mux/live-mux/selection.ts';
import type { TerminalSnapshotFrameCore } from '../terminal/snapshot-oracle.ts';

interface ConversationSelectionInputOptions {
  readonly getSelection: () => PaneSelection | null;
  readonly setSelection: (next: PaneSelection | null) => void;
  readonly getSelectionDrag: () => PaneSelectionDrag | null;
  readonly setSelectionDrag: (next: PaneSelectionDrag | null) => void;
  readonly pinViewportForSelection: () => void;
  readonly releaseViewportPinForSelection: () => void;
  readonly markDirty: () => void;
}

interface ConversationSelectionInputDependencies {
  readonly pointFromMouseEvent?: typeof pointFromMouseEventFrame;
  readonly reduceConversationMouseSelection?: typeof reduceConversationMouseSelectionFrame;
  readonly selectionText?: typeof selectionTextFrame;
}

interface MouseSelectionInput {
  readonly layout: SelectionLayout;
  readonly frame: TerminalSnapshotFrameCore;
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
  private readonly pointFromMouseEvent: typeof pointFromMouseEventFrame;
  private readonly reduceConversationMouseSelection: typeof reduceConversationMouseSelectionFrame;
  private readonly selectionText: typeof selectionTextFrame;

  constructor(
    private readonly options: ConversationSelectionInputOptions,
    dependencies: ConversationSelectionInputDependencies = {},
  ) {
    this.pointFromMouseEvent = dependencies.pointFromMouseEvent ?? pointFromMouseEventFrame;
    this.reduceConversationMouseSelection =
      dependencies.reduceConversationMouseSelection ?? reduceConversationMouseSelectionFrame;
    this.selectionText = dependencies.selectionText ?? selectionTextFrame;
  }

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
    const reduced = this.reduceConversationMouseSelection({
      selection: this.options.getSelection(),
      selectionDrag: this.options.getSelectionDrag(),
      point: this.pointFromMouseEvent(input.layout, input.frame, input.event),
      isMainPaneTarget: input.isMainPaneTarget,
      isLeftButtonPress:
        isLeftButtonPress(input.event.code, input.event.final) && !hasAltModifier(input.event.code),
      isSelectionDrag:
        isSelectionDrag(input.event.code, input.event.final) && !hasAltModifier(input.event.code),
      isMouseRelease: isMouseRelease(input.event.final),
      isWheelMouseCode: isWheelMouseCode(input.event.code),
      selectionTextForPane: (nextSelection) =>
        input.resolveSelectionText === undefined
          ? this.selectionText(input.frame, nextSelection)
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
