import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { computeDualPaneLayout } from '../../../src/mux/dual-pane-core.ts';
import type { ConversationState } from '../../../src/mux/live-mux/conversation-state.ts';
import { ConversationInputForwarder } from '../../../packages/harness-ui/src/interaction/conversation-input-forwarder.ts';

function createConversation(controller: string | null): ConversationState {
  let viewportScroll = 0;
  return {
    sessionId: 'session-a',
    directoryId: 'dir-a',
    title: 'thread',
    adapterState: {},
    runtimeStatus: 'running',
    controller,
    startedAt: null,
    startedAtMs: 0,
    lastEventAt: null,
    detailText: '',
    detailStatus: 'idle',
    streamCursor: null,
    attached: false,
    process: null,
    oracle: {
      apply: () => {},
      reset: () => {},
      snapshot: () => {
        throw new Error('unused');
      },
      snapshotWithoutHash: () => ({
        rows: 1,
        cols: 1,
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
          totalRows: 1,
          followOutput: true,
        },
        lines: ['x'],
        richLines: [],
      }),
      isMouseTrackingEnabled: () => false,
      clearViewportPin: () => {},
      pinViewport: () => {},
      scrollViewport: (delta: number) => {
        viewportScroll += delta;
      },
    },
    setCursorStyle: () => {},
    getCursorStyle: () => ({
      shape: 'block',
      blinking: true,
    }),
    statusBadgeText: '',
    statusText: '',
    statusTextUpdatedAtMs: 0,
    needsInput: false,
    waitingForTurnCompletion: false,
    turnCompletionLabel: null,
    turnCompletionAtMs: null,
    telemetryStatusHint: null,
    provider: null,
    providerSessionId: null,
    isCritique: false,
    launchCommand: [],
    debugFooterText: null,
    visibleRows: 0,
    viewportScrollTop: 0,
    terminalStyleKnown: false,
    terminalStylePending: false,
    terminalPalette: null,
    pendingOutputBytes: 0,
    lastOutputAtMs: 0,
    outputBytesThisSecond: 0,
    outputRateWindowStartedAtMs: 0,
    statusOutputActivityAtMs: null,
    statusPromptAtMs: null,
    statusPromptPreview: null,
    statusPromptCount: 0,
    statusPromptDismissedAtMs: null,
    _viewPortScroll: viewportScroll,
  } as unknown as ConversationState;
}

void test('conversation input forwarder routes tokens scrolls and forwards session input', () => {
  let inputRemainder = 'previous';
  const calls: string[] = [];
  const conversation = createConversation(null);
  const forwarder = new ConversationInputForwarder({
    getInputRemainder: () => inputRemainder,
    setInputRemainder: (next) => {
      inputRemainder = next;
    },
    getMainPaneMode: () => 'conversation',
    getLayout: () => computeDualPaneLayout(80, 24),
    inputTokenRouter: {
      routeTokens: (input) => {
        calls.push(`token-count:${input.tokens.length}`);
        calls.push(`snapshot-lines:${input.snapshotForInput?.lines.length ?? 0}`);
        return {
          routedTokens: [
            {
              kind: 'passthrough',
              text: 'abc',
            },
          ],
          snapshotForInput: input.snapshotForInput,
        };
      },
    },
    getActiveConversation: () => conversation,
    markDirty: () => {
      calls.push('mark-dirty');
    },
    isControlledByLocalHuman: () => true,
    controllerId: 'mux',
    sendInputToSession: (sessionId, chunk) => {
      calls.push(`send:${sessionId}:${chunk.toString('utf8')}`);
    },
    noteGitActivity: (directoryId) => {
      calls.push(`git:${directoryId ?? 'null'}`);
    },
    parseMuxInputChunk: (previous, input) => {
      calls.push(`parse:${previous}:${input.toString('utf8')}`);
      return {
        tokens: [
          {
            kind: 'passthrough',
            text: 'token',
          },
        ],
        remainder: 'next',
      };
    },
    routeInputTokensForConversation: (input) => {
      calls.push(`route:${input.mainPaneMode}`);
      calls.push(`classified:${input.classifyPaneAt(1, 1)}`);
      calls.push(`wheel:${input.wheelDeltaRowsFromCode(64)}`);
      calls.push(`shift:${input.hasShiftModifier(0b0000_0100)}`);
      return {
        mainPaneScrollRows: 2,
        forwardToSession: [Buffer.from('payload')],
      };
    },
    classifyPaneAt: () => 'left',
    normalizeMuxKeyboardInputForPty: () => {
      throw new Error('unused');
    },
  });

  forwarder.handleInput(Buffer.from('input'));

  assert.equal(inputRemainder, 'next');
  assert.deepEqual(calls, [
    'parse:previous:input',
    'token-count:1',
    'snapshot-lines:1',
    'route:conversation',
    'classified:left',
    'wheel:-1',
    'shift:true',
    'mark-dirty',
    'send:session-a:payload',
    'git:dir-a',
  ]);
});

void test('conversation input forwarder blocks forwarding when controller is non-local', () => {
  let inputRemainder = '';
  const calls: string[] = [];
  const forwarder = new ConversationInputForwarder({
    getInputRemainder: () => inputRemainder,
    setInputRemainder: (next) => {
      inputRemainder = next;
    },
    getMainPaneMode: () => 'conversation',
    getLayout: () => computeDualPaneLayout(80, 24),
    inputTokenRouter: {
      routeTokens: (input) => ({
        routedTokens: [...input.tokens],
        snapshotForInput: input.snapshotForInput,
      }),
    },
    getActiveConversation: () => createConversation('other'),
    markDirty: () => {
      calls.push('mark-dirty');
    },
    isControlledByLocalHuman: ({ controllerId }) => {
      calls.push(`controlled:${controllerId}`);
      return false;
    },
    controllerId: 'mux',
    sendInputToSession: () => {
      calls.push('send');
    },
    noteGitActivity: () => {
      calls.push('git');
    },
    parseMuxInputChunk: () => ({
      tokens: [],
      remainder: '',
    }),
    routeInputTokensForConversation: () => ({
      mainPaneScrollRows: 0,
      forwardToSession: [Buffer.from('payload')],
    }),
    classifyPaneAt: () => 'left',
    normalizeMuxKeyboardInputForPty: (input) => input,
  });

  forwarder.handleInput(Buffer.from('x'));

  assert.deepEqual(calls, ['controlled:mux']);
});

void test('conversation input forwarder can forward controlled session and skip git activity with no chunks', () => {
  const calls: string[] = [];
  const forwarder = new ConversationInputForwarder({
    getInputRemainder: () => '',
    setInputRemainder: () => {},
    getMainPaneMode: () => 'conversation',
    getLayout: () => computeDualPaneLayout(80, 24),
    inputTokenRouter: {
      routeTokens: (input) => ({
        routedTokens: [...input.tokens],
        snapshotForInput: input.snapshotForInput,
      }),
    },
    getActiveConversation: () => createConversation('mux'),
    markDirty: () => {},
    isControlledByLocalHuman: ({ controllerId }) => {
      calls.push(`controlled:${controllerId}`);
      return true;
    },
    controllerId: 'mux',
    sendInputToSession: () => {
      calls.push('send');
    },
    noteGitActivity: () => {
      calls.push('git');
    },
    parseMuxInputChunk: () => ({
      tokens: [],
      remainder: '',
    }),
    routeInputTokensForConversation: () => ({
      mainPaneScrollRows: 0,
      forwardToSession: [],
    }),
    classifyPaneAt: () => 'left',
    normalizeMuxKeyboardInputForPty: (input) => input,
  });

  forwarder.handleInput(Buffer.from('x'));

  assert.deepEqual(calls, ['controlled:mux']);
});

void test('conversation input forwarder supports null conversation with explicit strategies', () => {
  let remainder = '';
  const passthrough: string[] = [];
  const forwarder = new ConversationInputForwarder({
    getInputRemainder: () => remainder,
    setInputRemainder: (next) => {
      remainder = next;
    },
    getMainPaneMode: () => 'nim',
    getLayout: () => computeDualPaneLayout(80, 24),
    inputTokenRouter: {
      routeTokens: (input) => ({
        routedTokens: [
          ...input.tokens,
          {
            kind: 'passthrough',
            text: 'abc',
          },
        ],
        snapshotForInput: input.snapshotForInput,
      }),
    },
    getActiveConversation: () => null,
    markDirty: () => {},
    isControlledByLocalHuman: () => true,
    controllerId: 'mux',
    sendInputToSession: () => {},
    noteGitActivity: () => {},
    parseMuxInputChunk: () => ({
      tokens: [],
      remainder: '',
    }),
    routeInputTokensForConversation: () => ({
      mainPaneScrollRows: 0,
      forwardToSession: [],
    }),
    classifyPaneAt: () => 'left',
    normalizeMuxKeyboardInputForPty: (input) => input,
    handlePassthroughTextInMainPaneMode: (input) => {
      passthrough.push(`${input.mainPaneMode}:${input.text}`);
    },
  });

  forwarder.handleInput(Buffer.from('z'));
  assert.equal(remainder, '');
  assert.deepEqual(passthrough, ['nim:abc']);
});
