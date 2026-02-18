import { classifyPaneAt as classifyPaneAtFrame, type computeDualPaneLayout, type parseMuxInputChunk } from '../mux/dual-pane-core.ts';
import {
  hasAltModifier as hasAltModifierFrame,
  isLeftButtonPress as isLeftButtonPressFrame,
  isMotionMouseCode as isMotionMouseCodeFrame,
} from '../mux/live-mux/selection.ts';
import type { TerminalSnapshotFrameCore } from '../terminal/snapshot-oracle.ts';

type MainPaneMode = 'conversation' | 'project' | 'home';
type DualPaneLayout = ReturnType<typeof computeDualPaneLayout>;
type MuxInputToken = ReturnType<typeof parseMuxInputChunk>['tokens'][number];
type PointerTarget = ReturnType<typeof classifyPaneAtFrame>;

interface MouseSelectionEvent {
  readonly col: number;
  readonly row: number;
  readonly code: number;
  readonly final: 'M' | 'm';
}

interface ConversationInputLike {
  readonly oracle: {
    scrollViewport: (delta: number) => void;
    snapshotWithoutHash: () => TerminalSnapshotFrameCore;
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
    layout: DualPaneLayout;
    frame: TerminalSnapshotFrameCore;
    isMainPaneTarget: boolean;
    event: MouseSelectionEvent;
  }): boolean;
}

interface InputTokenRouterOptions {
  readonly getMainPaneMode: () => MainPaneMode;
  readonly pointerRoutingInput: PointerRoutingInputLike;
  readonly mainPanePointerInput: MainPanePointerInputLike;
  readonly leftRailPointerInput: LeftRailPointerInputLike;
  readonly conversationSelectionInput: ConversationSelectionInputLike;
}

interface InputTokenRouterDependencies {
  readonly classifyPaneAt?: typeof classifyPaneAtFrame;
  readonly isLeftButtonPress?: typeof isLeftButtonPressFrame;
  readonly hasAltModifier?: typeof hasAltModifierFrame;
  readonly isMotionMouseCode?: typeof isMotionMouseCodeFrame;
}

interface RouteTokensInput {
  readonly tokens: readonly MuxInputToken[];
  readonly layout: DualPaneLayout;
  readonly conversation: ConversationInputLike | null;
  readonly snapshotForInput: TerminalSnapshotFrameCore | null;
}

interface RouteTokensResult {
  readonly routedTokens: MuxInputToken[];
  readonly snapshotForInput: TerminalSnapshotFrameCore | null;
}

export class InputTokenRouter {
  private readonly classifyPaneAt: typeof classifyPaneAtFrame;
  private readonly isLeftButtonPress: typeof isLeftButtonPressFrame;
  private readonly hasAltModifier: typeof hasAltModifierFrame;
  private readonly isMotionMouseCode: typeof isMotionMouseCodeFrame;

  constructor(
    private readonly options: InputTokenRouterOptions,
    dependencies: InputTokenRouterDependencies = {},
  ) {
    this.classifyPaneAt = dependencies.classifyPaneAt ?? classifyPaneAtFrame;
    this.isLeftButtonPress = dependencies.isLeftButtonPress ?? isLeftButtonPressFrame;
    this.hasAltModifier = dependencies.hasAltModifier ?? hasAltModifierFrame;
    this.isMotionMouseCode = dependencies.isMotionMouseCode ?? isMotionMouseCodeFrame;
  }

  routeTokens(input: RouteTokensInput): RouteTokensResult {
    let snapshotForInput = input.snapshotForInput;
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

      const target = this.classifyPaneAt(input.layout, token.event.col, token.event.row);
      const rowIndex = Math.max(0, Math.min(input.layout.paneRows - 1, token.event.row - 1));
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
        this.isLeftButtonPress(token.event.code, token.event.final) &&
        !this.hasAltModifier(token.event.code) &&
        !this.isMotionMouseCode(token.event.code);
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
      if (snapshotForInput === null || this.options.getMainPaneMode() !== 'conversation') {
        routedTokens.push(token);
        continue;
      }
      if (
        this.options.conversationSelectionInput.handleMouseSelection({
          layout: input.layout,
          frame: snapshotForInput,
          isMainPaneTarget,
          event: token.event,
        })
      ) {
        continue;
      }

      routedTokens.push(token);
    }
    return {
      routedTokens,
      snapshotForInput,
    };
  }
}
