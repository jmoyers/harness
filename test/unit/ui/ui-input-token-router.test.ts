import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { classifyPaneAt, computeDualPaneLayout } from '../../../src/mux/dual-pane-core.ts';
import {
  hasAltModifier,
  isLeftButtonPress,
  isMotionMouseCode,
} from '../../../src/mux/live-mux/selection.ts';
import type { TerminalSnapshotFrameCore } from '../../../src/terminal/snapshot-oracle.ts';
import { InputTokenRouter } from '../../../packages/harness-ui/src/interaction/input-token-router.ts';

function createFrame(label: string): TerminalSnapshotFrameCore {
  return {
    rows: 4,
    cols: 8,
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
      row: 1,
      col: 1,
      visible: true,
      style: {
        shape: 'block',
        blinking: true,
      },
    },
    viewport: {
      top: 0,
      totalRows: 4,
      followOutput: true,
    },
    lines: [label],
    richLines: [],
  };
}

function mouseToken(code: number, col: number, row: number) {
  return {
    kind: 'mouse' as const,
    event: {
      sequence: `\u001b[<${code};${col};${row}M`,
      code,
      col,
      row,
      final: 'M' as const,
    },
  };
}

function mouseTokenWithFinal(code: number, col: number, row: number, final: 'M' | 'm') {
  return {
    kind: 'mouse' as const,
    event: {
      sequence: `\u001b[<${code};${col};${row}${final}`,
      code,
      col,
      row,
      final,
    },
  };
}

function defaultStrategies(): ConstructorParameters<typeof InputTokenRouter>[1] {
  return {
    classifyPaneAt: (layout, col, row) =>
      classifyPaneAt(layout as Parameters<typeof classifyPaneAt>[0], col, row),
    isLeftButtonPress,
    hasAltModifier,
    hasShiftModifier: (code) => (code & 0b0000_0100) !== 0,
    isMotionMouseCode,
  };
}

void test('input token router delegates staged mouse routing and preserves passthrough tokens', () => {
  const layout = computeDualPaneLayout(100, 24);
  const rightCol = layout.rightStartCol;
  const frameBefore = createFrame('before');
  const frameAfter = createFrame('after');
  const consumed = {
    divider: false,
    release: false,
    separator: false,
    wheel: false,
    move: false,
    project: false,
    home: false,
    leftRail: false,
    selectionTrue: false,
    selectionFalse: false,
  };
  let clearSelectionLength = 0;
  let wheelDelta = 0;
  let snapshotReadCount = 0;
  let selectionFrameLabel = '';
  let resolvedSelectionText = '';

  const router = new InputTokenRouter(
    {
      getMainPaneMode: () => 'conversation',
      pointerRoutingInput: {
        handlePaneDividerDrag: ({ code }) => {
          if (code === 11) {
            consumed.divider = true;
            return true;
          }
          return false;
        },
        handleHomePaneDragRelease: ({ rowIndex }) => {
          if (rowIndex === 1) {
            consumed.release = true;
            return true;
          }
          return false;
        },
        handleSeparatorPointerPress: ({ code }) => {
          if (code === 13) {
            consumed.separator = true;
            return true;
          }
          return false;
        },
        handleMainPaneWheel: ({ code }, onConversationWheel) => {
          if (code === 64) {
            consumed.wheel = true;
            onConversationWheel(3);
            return true;
          }
          return false;
        },
        handleHomePaneDragMove: ({ code }) => {
          if (code === 14) {
            consumed.move = true;
            return true;
          }
          return false;
        },
      },
      mainPanePointerInput: {
        handleProjectPanePointerClick: ({ code }) => {
          if (code === 15) {
            consumed.project = true;
            return true;
          }
          return false;
        },
        handleHomePanePointerClick: ({ code }) => {
          if (code === 16) {
            consumed.home = true;
            return true;
          }
          return false;
        },
      },
      leftRailPointerInput: {
        handlePointerClick: ({ clickEligible, pointerRow }) => {
          if (pointerRow === 8) {
            consumed.leftRail = clickEligible;
            return true;
          }
          return false;
        },
      },
      conversationSelectionInput: {
        clearSelectionOnTextToken: (textLength) => {
          clearSelectionLength += textLength;
          return false;
        },
        handleMouseSelection: ({ event, frame, resolveSelectionText }) => {
          selectionFrameLabel = frame.lines[0] ?? '';
          resolvedSelectionText =
            resolveSelectionText?.({
              anchor: { rowAbs: 0, col: 1 },
              focus: { rowAbs: 5, col: 3 },
              text: '',
            }) ?? '';
          if (event.code === 17) {
            consumed.selectionTrue = true;
            return true;
          }
          consumed.selectionFalse = true;
          return false;
        },
      },
    },
    defaultStrategies(),
  );

  const conversation = {
    oracle: {
      isMouseTrackingEnabled: () => false,
      scrollViewport: (delta: number) => {
        wheelDelta = delta;
      },
      snapshotWithoutHash: () => {
        snapshotReadCount += 1;
        return frameAfter;
      },
      selectionText: () => 'offscreen-copy',
    },
  };

  const tokenFinal = mouseToken(18, rightCol, 10);
  const result = router.routeTokens({
    tokens: [
      {
        kind: 'passthrough',
        text: 'abc',
      },
      mouseToken(11, rightCol, 1),
      mouseToken(12, rightCol, 2),
      mouseToken(13, layout.separatorCol, 3),
      mouseToken(64, rightCol, 4),
      mouseToken(14, rightCol, 5),
      mouseToken(15, rightCol, 6),
      mouseToken(16, rightCol, 7),
      mouseToken(0, 1, 8),
      mouseToken(17, rightCol, 9),
      tokenFinal,
    ],
    layout,
    conversation,
    snapshotForInput: frameBefore,
  });

  assert.equal(clearSelectionLength, 3);
  assert.equal(wheelDelta, 3);
  assert.equal(snapshotReadCount, 1);
  assert.equal(selectionFrameLabel, 'after');
  assert.equal(resolvedSelectionText, 'offscreen-copy');
  assert.equal(consumed.divider, true);
  assert.equal(consumed.release, true);
  assert.equal(consumed.separator, true);
  assert.equal(consumed.wheel, true);
  assert.equal(consumed.move, true);
  assert.equal(consumed.project, true);
  assert.equal(consumed.home, true);
  assert.equal(consumed.leftRail, true);
  assert.equal(consumed.selectionTrue, true);
  assert.equal(consumed.selectionFalse, true);
  assert.equal(result.snapshotForInput, frameAfter);
  assert.deepEqual(result.routedTokens, [
    {
      kind: 'passthrough',
      text: 'abc',
    },
    tokenFinal,
  ]);
});

void test('input token router bypasses local right-pane handlers when app mouse passthrough is active', () => {
  const layout = computeDualPaneLayout(100, 24);
  const rightCol = layout.rightStartCol + 4;
  const frame = createFrame('passthrough');
  frame.activeScreen = 'alternate';
  frame.viewport.followOutput = true;
  const calls: string[] = [];

  const router = new InputTokenRouter(
    {
      getMainPaneMode: () => 'conversation',
      pointerRoutingInput: {
        handlePaneDividerDrag: () => false,
        handleHomePaneDragRelease: () => false,
        handleSeparatorPointerPress: () => false,
        handleMainPaneWheel: () => {
          calls.push('wheel-consumed');
          return true;
        },
        handleHomePaneDragMove: () => false,
      },
      mainPanePointerInput: {
        handleProjectPanePointerClick: () => false,
        handleHomePanePointerClick: () => false,
      },
      leftRailPointerInput: {
        handlePointerClick: () => false,
      },
      conversationSelectionInput: {
        clearSelectionOnTextToken: () => false,
        handleMouseSelection: () => {
          calls.push('selection-consumed');
          return true;
        },
      },
    },
    defaultStrategies(),
  );

  const wheelToken = mouseToken(64, rightCol, 2);
  const clickToken = mouseToken(0, rightCol, 3);
  const shiftedWheelToken = mouseToken(68, rightCol, 4);
  const result = router.routeTokens({
    tokens: [wheelToken, clickToken, shiftedWheelToken],
    layout,
    conversation: {
      oracle: {
        isMouseTrackingEnabled: () => true,
        scrollViewport: () => {
          calls.push('scroll');
        },
        snapshotWithoutHash: () => frame,
        selectionText: () => '',
      },
    },
    snapshotForInput: frame,
  });

  assert.deepEqual(calls, ['wheel-consumed']);
  assert.deepEqual(result.routedTokens, [wheelToken, clickToken]);
  assert.equal(result.snapshotForInput, frame);
});

void test('input token router supports dependency overrides and null-conversation wheel path', () => {
  const layout = computeDualPaneLayout(80, 10);
  const calls: string[] = [];
  let selectionCalled = false;

  const router = new InputTokenRouter(
    {
      getMainPaneMode: () => 'home',
      pointerRoutingInput: {
        handlePaneDividerDrag: () => false,
        handleHomePaneDragRelease: () => false,
        handleSeparatorPointerPress: () => false,
        handleMainPaneWheel: ({ code }, onConversationWheel) => {
          if (code === 64) {
            calls.push('wheel');
            onConversationWheel(5);
            return true;
          }
          return false;
        },
        handleHomePaneDragMove: () => false,
      },
      mainPanePointerInput: {
        handleProjectPanePointerClick: () => false,
        handleHomePanePointerClick: () => false,
      },
      leftRailPointerInput: {
        handlePointerClick: ({ clickEligible }) => {
          calls.push(`left-rail:${clickEligible}`);
          return false;
        },
      },
      conversationSelectionInput: {
        clearSelectionOnTextToken: () => false,
        handleMouseSelection: () => {
          selectionCalled = true;
          return false;
        },
      },
    },
    {
      classifyPaneAt: () => 'left',
      isLeftButtonPress: () => true,
      hasAltModifier: () => true,
      hasShiftModifier: () => false,
      isMotionMouseCode: () => false,
    },
  );

  const tokenRouted = mouseToken(5, 1, 2);
  const result = router.routeTokens({
    tokens: [mouseToken(64, 1, 1), tokenRouted],
    layout,
    conversation: null,
    snapshotForInput: null,
  });

  assert.deepEqual(calls, ['wheel', 'left-rail:false']);
  assert.equal(selectionCalled, false);
  assert.deepEqual(result.routedTokens, [tokenRouted]);
  assert.equal(result.snapshotForInput, null);
});

void test('input token router routes home-pane mouse selection through shared selection reducer', () => {
  const layout = computeDualPaneLayout(100, 24);
  const rightCol = layout.rightStartCol + 4;
  const calls: string[] = [];
  let capturedText = '';
  const router = new InputTokenRouter(
    {
      getMainPaneMode: () => 'home',
      getHomePaneSelectionContext: () => ({
        viewportTop: 3,
        totalRows: 12,
        resolveSelectionText: (selection) => {
          capturedText = `rows:${selection.anchor.rowAbs}-${selection.focus.rowAbs}`;
          return capturedText;
        },
      }),
      pointerRoutingInput: {
        handlePaneDividerDrag: () => false,
        handleHomePaneDragRelease: () => false,
        handleSeparatorPointerPress: () => false,
        handleMainPaneWheel: () => false,
        handleHomePaneDragMove: () => false,
      },
      mainPanePointerInput: {
        handleProjectPanePointerClick: () => false,
        handleHomePanePointerClick: () => false,
      },
      leftRailPointerInput: {
        handlePointerClick: () => false,
      },
      conversationSelectionInput: {
        clearSelectionOnTextToken: () => false,
        handleMouseSelection: ({ frame, event, resolveSelectionText }) => {
          calls.push(`selection:${event.code}:${event.final}:${frame.viewport.top}`);
          const text =
            resolveSelectionText?.({
              anchor: { rowAbs: 3, col: 0 },
              focus: { rowAbs: 4, col: 5 },
              text: '',
            }) ?? '';
          calls.push(`text:${text}`);
          return true;
        },
      },
    },
    defaultStrategies(),
  );

  const result = router.routeTokens({
    tokens: [mouseToken(0, rightCol, 2), mouseTokenWithFinal(0, rightCol, 2, 'm')],
    layout,
    conversation: null,
    snapshotForInput: null,
  });

  assert.deepEqual(calls, ['selection:0:M:3', 'text:rows:3-4', 'selection:0:m:3', 'text:rows:3-4']);
  assert.equal(capturedText, 'rows:3-4');
  assert.deepEqual(result.routedTokens, []);
  assert.equal(result.snapshotForInput, null);
});
