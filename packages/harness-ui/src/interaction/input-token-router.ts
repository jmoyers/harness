import type {
  ConversationSelectionSnapshotFrame,
  PaneSelection,
} from './conversation-selection-input.ts';

type MainPaneMode = 'conversation' | 'project' | 'home' | 'nim';
type PointerTarget = 'left' | 'right' | 'separator' | 'status' | 'outside';

interface MouseSelectionEvent {
  readonly sequence: string;
  readonly col: number;
  readonly row: number;
  readonly code: number;
  readonly final: 'M' | 'm';
}

export interface InputTokenRouterLayout {
  readonly paneRows: number;
  readonly leftCols: number;
  readonly rightCols: number;
  readonly rightStartCol: number;
}

export interface InputTokenRouterMouseToken {
  readonly kind: 'mouse';
  readonly event: MouseSelectionEvent;
}

export interface InputTokenRouterPassthroughToken {
  readonly kind: 'passthrough';
  readonly text: string;
}

type MuxInputToken = InputTokenRouterMouseToken | InputTokenRouterPassthroughToken;

interface HomePaneSelectionContext {
  readonly viewportTop: number;
  readonly totalRows: number;
  readonly resolveSelectionText: (selection: PaneSelection) => string;
}

interface ConversationInputLike {
  readonly oracle: {
    isMouseTrackingEnabled: () => boolean;
    scrollViewport: (delta: number) => void;
    snapshotWithoutHash: () => ConversationSelectionSnapshotFrame;
    selectionText: (anchor: PaneSelection['anchor'], focus: PaneSelection['focus']) => string;
  };
}

interface PointerRoutingInputLike {
  handlePaneDividerDrag(event: { code: number; final: 'M' | 'm'; col: number }): boolean;
  handleHomePaneDragRelease(event: {
    final: 'M' | 'm';
    target: PointerTarget;
    rowIndex: number;
  }): boolean;
  handleSeparatorPointerPress(event: {
    target: PointerTarget;
    code: number;
    final: 'M' | 'm';
    col: number;
  }): boolean;
  handleMainPaneWheel(
    event: { target: PointerTarget; code: number },
    onConversationWheel: (delta: number) => void,
  ): boolean;
  handleHomePaneDragMove(event: {
    target: PointerTarget;
    code: number;
    final: 'M' | 'm';
    rowIndex: number;
  }): boolean;
}

interface MainPanePointerInputLike {
  handleProjectPanePointerClick(event: {
    target: PointerTarget;
    code: number;
    final: 'M' | 'm';
    row: number;
    col: number;
    rightCols: number;
    paneRows: number;
    rightStartCol: number;
  }): boolean;
  handleHomePanePointerClick(event: {
    target: PointerTarget;
    code: number;
    final: 'M' | 'm';
    row: number;
    col: number;
    rightCols: number;
    paneRows: number;
    rightStartCol: number;
  }): boolean;
}

interface LeftRailPointerInputLike {
  handlePointerClick(input: {
    clickEligible: boolean;
    paneRows: number;
    leftCols: number;
    pointerRow: number;
    pointerCol: number;
  }): boolean;
}

interface ConversationSelectionInputLike {
  clearSelectionOnTextToken(textLength: number): boolean;
  handleMouseSelection(input: {
    layout: InputTokenRouterLayout;
    frame: ConversationSelectionSnapshotFrame;
    isMainPaneTarget: boolean;
    resolveSelectionText?: (selection: PaneSelection) => string;
    event: MouseSelectionEvent;
  }): boolean;
}

export interface InputTokenRouterOptions {
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getHomePaneSelectionContext?: () => HomePaneSelectionContext | null;
  readonly pointerRoutingInput: PointerRoutingInputLike;
  readonly mainPanePointerInput: MainPanePointerInputLike;
  readonly leftRailPointerInput: LeftRailPointerInputLike;
  readonly conversationSelectionInput: ConversationSelectionInputLike;
}

export interface InputTokenRouterStrategies {
  classifyPaneAt(layout: InputTokenRouterLayout, col: number, row: number): PointerTarget;
  isLeftButtonPress(code: number, final: 'M' | 'm'): boolean;
  hasAltModifier(code: number): boolean;
  hasShiftModifier(code: number): boolean;
  isMotionMouseCode(code: number): boolean;
}

interface RouteTokensInput {
  readonly tokens: readonly MuxInputToken[];
  readonly layout: InputTokenRouterLayout;
  readonly conversation: ConversationInputLike | null;
  readonly snapshotForInput: ConversationSelectionSnapshotFrame | null;
}

interface RouteTokensResult {
  readonly routedTokens: MuxInputToken[];
  readonly snapshotForInput: ConversationSelectionSnapshotFrame | null;
}

export class InputTokenRouter {
  constructor(
    private readonly options: InputTokenRouterOptions,
    private readonly strategies: InputTokenRouterStrategies,
  ) {}

  private buildHomeSelectionFrame(
    layout: InputTokenRouterLayout,
    context: HomePaneSelectionContext | null,
  ): ConversationSelectionSnapshotFrame | null {
    if (context === null) {
      return null;
    }
    return {
      rows: Math.max(1, layout.paneRows),
      cols: Math.max(1, layout.rightCols),
      activeScreen: 'primary',
      modes: {
        bracketedPaste: false,
        decMouseX10: false,
        decMouseButtonEvent: false,
        decMouseAnyEvent: false,
        decFocusTracking: false,
        decMouseSgrEncoding: false,
      },
      cursor: {
        row: 0,
        col: 0,
        visible: false,
        style: {
          shape: 'block',
          blinking: false,
        },
      },
      viewport: {
        top: Math.max(0, context.viewportTop),
        totalRows: Math.max(1, context.totalRows),
        followOutput: true,
      },
      lines: [],
      richLines: [],
    };
  }

  routeTokens(input: RouteTokensInput): RouteTokensResult {
    let snapshotForInput = input.snapshotForInput;
    const conversation = input.conversation;
    const resolveSelectionText =
      conversation === null
        ? null
        : (selection: PaneSelection): string =>
            conversation.oracle.selectionText(selection.anchor, selection.focus);
    const routedTokens: MuxInputToken[] = [];
    for (const token of input.tokens) {
      if (token.kind !== 'mouse') {
        this.options.conversationSelectionInput.clearSelectionOnTextToken(token.text.length);
        routedTokens.push(token);
        continue;
      }

      if (
        this.options.pointerRoutingInput.handlePaneDividerDrag({
          code: token.event.code,
          final: token.event.final,
          col: token.event.col,
        })
      ) {
        continue;
      }

      const target = this.strategies.classifyPaneAt(input.layout, token.event.col, token.event.row);
      const rowIndex = Math.max(0, Math.min(input.layout.paneRows - 1, token.event.row - 1));
      const passThroughConversationMouse =
        input.conversation !== null &&
        this.options.getMainPaneMode() === 'conversation' &&
        target === 'right' &&
        snapshotForInput !== null &&
        snapshotForInput.activeScreen === 'alternate' &&
        snapshotForInput.viewport.followOutput &&
        input.conversation.oracle.isMouseTrackingEnabled() &&
        !this.strategies.hasShiftModifier(token.event.code);
      if (
        this.options.pointerRoutingInput.handleHomePaneDragRelease({
          final: token.event.final,
          target,
          rowIndex,
        })
      ) {
        continue;
      }
      if (
        this.options.pointerRoutingInput.handleSeparatorPointerPress({
          target,
          code: token.event.code,
          final: token.event.final,
          col: token.event.col,
        })
      ) {
        continue;
      }
      if (passThroughConversationMouse) {
        routedTokens.push(token);
        continue;
      }
      const isMainPaneTarget = target === 'right';
      if (
        this.options.pointerRoutingInput.handleMainPaneWheel(
          {
            target,
            code: token.event.code,
          },
          (delta) => {
            if (input.conversation !== null) {
              input.conversation.oracle.scrollViewport(delta);
              snapshotForInput = input.conversation.oracle.snapshotWithoutHash();
            }
          },
        )
      ) {
        continue;
      }
      if (
        this.options.pointerRoutingInput.handleHomePaneDragMove({
          target,
          code: token.event.code,
          final: token.event.final,
          rowIndex,
        })
      ) {
        continue;
      }
      if (
        this.options.mainPanePointerInput.handleProjectPanePointerClick({
          target,
          code: token.event.code,
          final: token.event.final,
          row: token.event.row,
          col: token.event.col,
          rightCols: input.layout.rightCols,
          paneRows: input.layout.paneRows,
          rightStartCol: input.layout.rightStartCol,
        })
      ) {
        continue;
      }
      if (
        this.options.mainPanePointerInput.handleHomePanePointerClick({
          target,
          code: token.event.code,
          final: token.event.final,
          row: token.event.row,
          col: token.event.col,
          paneRows: input.layout.paneRows,
          rightCols: input.layout.rightCols,
          rightStartCol: input.layout.rightStartCol,
        })
      ) {
        continue;
      }
      const leftPaneConversationSelect =
        target === 'left' &&
        this.strategies.isLeftButtonPress(token.event.code, token.event.final) &&
        !this.strategies.hasAltModifier(token.event.code) &&
        !this.strategies.isMotionMouseCode(token.event.code);
      if (
        this.options.leftRailPointerInput.handlePointerClick({
          clickEligible: leftPaneConversationSelect,
          paneRows: input.layout.paneRows,
          leftCols: input.layout.leftCols,
          pointerRow: token.event.row,
          pointerCol: token.event.col,
        })
      ) {
        continue;
      }
      const mainPaneMode = this.options.getMainPaneMode();
      const homeSelectionContext =
        mainPaneMode === 'home' ? (this.options.getHomePaneSelectionContext?.() ?? null) : null;
      const selectionFrame =
        mainPaneMode === 'conversation'
          ? snapshotForInput
          : this.buildHomeSelectionFrame(input.layout, homeSelectionContext);
      const selectionResolver =
        mainPaneMode === 'conversation'
          ? resolveSelectionText
          : (homeSelectionContext?.resolveSelectionText ?? null);
      if (selectionFrame !== null) {
        const mouseSelectionInput =
          selectionResolver === null
            ? {
                layout: input.layout,
                frame: selectionFrame,
                isMainPaneTarget,
                event: token.event,
              }
            : {
                layout: input.layout,
                frame: selectionFrame,
                isMainPaneTarget,
                resolveSelectionText: selectionResolver,
                event: token.event,
              };
        if (this.options.conversationSelectionInput.handleMouseSelection(mouseSelectionInput)) {
          continue;
        }
      }

      routedTokens.push(token);
    }
    return {
      routedTokens,
      snapshotForInput,
    };
  }
}
