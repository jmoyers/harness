import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { computeDualPaneLayout } from '../src/mux/dual-pane-core.ts';
import { RuntimeInputPipeline } from '../src/services/runtime-input-pipeline.ts';

void test('runtime input pipeline forwards only sanitized preflight input', () => {
  const calls: string[] = [];
  const pipeline = new RuntimeInputPipeline(
    {
      preflight: {
        isShuttingDown: () => false,
        routeModalInput: () => false,
        handleEscapeInput: () => {},
        onFocusIn: () => {},
        onFocusOut: () => {},
        handleRepositoryFoldInput: () => false,
        handleGlobalShortcutInput: () => false,
        handleTaskPaneShortcutInput: () => false,
        handleCopyShortcutInput: () => false,
      },
      forwarder: {
        getInputRemainder: () => '',
        setInputRemainder: () => {},
        getMainPaneMode: () => 'conversation',
        getLayout: () => computeDualPaneLayout(120, 40),
        inputTokenRouter: {
          routeTokens: ({ tokens, snapshotForInput }) => ({
            routedTokens: [...tokens],
            snapshotForInput,
          }),
        },
        getActiveConversation: () => null,
        markDirty: () => {},
        isControlledByLocalHuman: () => true,
        controllerId: 'controller-1',
        sendInputToSession: () => {},
        noteGitActivity: () => {},
      },
    },
    {
      createInputPreflight: () => ({
        nextInput: (input) => {
          calls.push(`preflight:${input.toString('utf8')}`);
          return input[0] === 0x00 ? null : Buffer.from('sanitized', 'utf8');
        },
      }),
      createConversationInputForwarder: () => ({
        handleInput: (input) => {
          calls.push(`forward:${input.toString('utf8')}`);
        },
      }),
    },
  );

  pipeline.handleInput(Buffer.from([0x00]));
  pipeline.handleInput(Buffer.from('abc', 'utf8'));

  assert.deepEqual(calls, ['preflight:\u0000', 'preflight:abc', 'forward:sanitized']);
});

void test('runtime input pipeline default dependency path is usable', () => {
  const pipeline = new RuntimeInputPipeline({
    preflight: {
      isShuttingDown: () => true,
      routeModalInput: () => false,
      handleEscapeInput: () => {},
      onFocusIn: () => {},
      onFocusOut: () => {},
      handleRepositoryFoldInput: () => false,
      handleGlobalShortcutInput: () => false,
      handleTaskPaneShortcutInput: () => false,
      handleCopyShortcutInput: () => false,
    },
    forwarder: {
      getInputRemainder: () => '',
      setInputRemainder: () => {},
      getMainPaneMode: () => 'conversation',
      getLayout: () => computeDualPaneLayout(120, 40),
      inputTokenRouter: {
        routeTokens: ({ tokens, snapshotForInput }) => ({
          routedTokens: [...tokens],
          snapshotForInput,
        }),
      },
      getActiveConversation: () => null,
      markDirty: () => {},
      isControlledByLocalHuman: () => true,
      controllerId: 'controller-1',
      sendInputToSession: () => {},
      noteGitActivity: () => {},
    },
  });

  pipeline.handleInput(Buffer.from('ignored', 'utf8'));
});
