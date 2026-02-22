import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { detectMuxGlobalShortcut, resolveMuxShortcutBindings } from '../../../src/mux/input-shortcuts.ts';
import { handleGlobalShortcut } from '../../../src/mux/live-mux/global-shortcut-handlers.ts';
import {
  GlobalShortcutInput,
  type GlobalShortcutActions,
  type GlobalShortcutState,
} from '../../../packages/harness-ui/src/interaction/global-shortcut-input.ts';

function createState(overrides: Partial<GlobalShortcutState> = {}): GlobalShortcutState {
  return {
    mainPaneMode: () => 'conversation',
    activeConversationId: () => 'session-a',
    conversationsHas: () => true,
    activeDirectoryId: () => null,
    directoryExists: () => false,
    ...overrides,
  };
}

function createActions(overrides: Partial<GlobalShortcutActions> = {}): GlobalShortcutActions {
  return {
    requestStop: () => {},
    resolveDirectoryForAction: () => null,
    openNewThreadPrompt: () => {},
    toggleCommandMenu: () => {},
    openOrCreateCritiqueConversationInDirectory: async () => {},
    toggleGatewayProfile: async () => {},
    toggleGatewayStatusTimeline: async () => {},
    toggleGatewayRenderTrace: async () => {},
    queueControlPlaneOp: () => {},
    archiveConversation: async () => {},
    refreshAllConversationTitles: async () => {},
    interruptConversation: async () => {},
    takeoverConversation: async () => {},
    openAddDirectoryPrompt: () => {},
    closeDirectory: async () => {},
    cycleLeftNavSelection: () => {},
    ...overrides,
  };
}

void test('global shortcut input delegates detection and handler wiring', () => {
  const calls: string[] = [];
  let mode: 'conversation' | 'project' | 'home' = 'project';
  let activeDirectoryId: string | null = 'dir-a';
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState({
      mainPaneMode: () => mode,
      activeConversationId: () => 'session-a',
      conversationsHas: (sessionId) => {
        calls.push(`has-conversation:${sessionId}`);
        return true;
      },
      activeDirectoryId: () => activeDirectoryId,
      directoryExists: (directoryId) => {
        calls.push(`directory-exists:${directoryId}`);
        return true;
      },
    }),
    createActions({
      requestStop: () => {
        calls.push('request-stop');
      },
      resolveDirectoryForAction: () => 'dir-a',
      openNewThreadPrompt: (directoryId) => {
        calls.push(`new-thread:${directoryId}`);
      },
      toggleCommandMenu: () => {
        calls.push('toggle-command-menu');
      },
      openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
        calls.push(`critique:${directoryId}`);
      },
      toggleGatewayProfile: async () => {
        calls.push('toggle-gateway-profile');
      },
      toggleGatewayStatusTimeline: async () => {
        calls.push('toggle-gateway-status-timeline');
      },
      toggleGatewayRenderTrace: async (conversationId) => {
        calls.push(`toggle-gateway-render-trace:${conversationId ?? 'none'}`);
      },
      queueControlPlaneOp: async (task, label) => {
        calls.push(`queue:${label}`);
        await task();
      },
      archiveConversation: async (sessionId) => {
        calls.push(`archive:${sessionId}`);
      },
      refreshAllConversationTitles: async () => {
        calls.push('refresh-all-titles');
      },
      interruptConversation: async (sessionId) => {
        calls.push(`interrupt:${sessionId}`);
      },
      takeoverConversation: async (sessionId) => {
        calls.push(`takeover:${sessionId}`);
      },
      openAddDirectoryPrompt: () => {
        calls.push('open-add-directory');
      },
      closeDirectory: async (directoryId) => {
        calls.push(`close-directory:${directoryId}`);
      },
      cycleLeftNavSelection: (direction) => {
        calls.push(`cycle:${direction}`);
      },
    }),
    {
      detectShortcut: () => 'mux.directory.close',
      handleShortcut: (options) => {
        calls.push(`shortcut:${options.shortcut}`);
        calls.push(`conversation:${options.resolveConversationForAction() ?? 'none'}`);
        calls.push(`closable:${options.resolveClosableDirectoryId() ?? 'none'}`);
        options.openAddDirectoryPrompt();
        options.cycleLeftNavSelection('previous');
        mode = 'home';
        activeDirectoryId = null;
        calls.push(`conversation-after-mode:${options.resolveConversationForAction() ?? 'none'}`);
        calls.push(`closable-after-mode:${options.resolveClosableDirectoryId() ?? 'none'}`);
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x01])), true);
  assert.deepEqual(calls, [
    'shortcut:mux.directory.close',
    'conversation:none',
    'directory-exists:dir-a',
    'closable:dir-a',
    'open-add-directory',
    'cycle:previous',
    'conversation-after-mode:none',
    'closable-after-mode:none',
  ]);
});

void test('global shortcut input honors custom conversation resolver when pane mode is not conversation', () => {
  const calls: string[] = [];
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState({
      mainPaneMode: () => 'project',
      activeConversationId: () => 'session-active',
      resolveConversationForAction: () => 'session-github',
    }),
    createActions(),
    {
      detectShortcut: () => 'mux.conversation.archive',
      handleShortcut: (options) => {
        calls.push(options.resolveConversationForAction() ?? 'none');
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x18])), true);
  assert.deepEqual(calls, ['session-github']);
});

void test('global shortcut input default dependencies return false when no shortcut matches', () => {
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState({
      mainPaneMode: () => 'home',
      activeConversationId: () => null,
      conversationsHas: () => false,
    }),
    createActions(),
    {
      detectShortcut: detectMuxGlobalShortcut,
      handleShortcut: handleGlobalShortcut,
    },
  );

  assert.equal(input.handleInput(Buffer.from('z')), false);
});

void test('global shortcut input routes each interrupt-all shortcut through the shared handler', () => {
  const calls: string[] = [];
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState(),
    createActions({
      requestStop: () => {
        calls.push('request-stop');
      },
    }),
    {
      detectShortcut: () => 'mux.app.interrupt-all',
      handleShortcut: (options) => {
        calls.push(`handler:${options.shortcut}`);
        options.requestStop();
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x03])), true);
  assert.equal(input.handleInput(Buffer.from([0x03])), true);
  assert.deepEqual(calls, [
    'handler:mux.app.interrupt-all',
    'request-stop',
    'handler:mux.app.interrupt-all',
    'request-stop',
  ]);
});

void test('global shortcut input preserves interrupt-all handler return value', () => {
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState(),
    createActions(),
    {
      detectShortcut: () => 'mux.app.interrupt-all',
      handleShortcut: () => false,
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x03])), false);
});

void test('global shortcut input bypasses ctrl-only shortcuts for terminal conversations', () => {
  const calls: string[] = [];
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState({
      mainPaneMode: () => 'conversation',
      activeConversationId: () => 'session-terminal',
      activeConversationAgentType: () => 'terminal',
    }),
    createActions(),
    {
      detectShortcut: () => 'mux.conversation.titles.refresh-all',
      handleShortcut: (options) => {
        calls.push(`handled:${options.shortcut}`);
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x12])), false);
  assert.equal(input.handleInput(Buffer.from('\u001b[114;5u', 'utf8')), false);
  assert.equal(input.handleInput(Buffer.from('\u001b[27;5;114~', 'utf8')), false);
  assert.deepEqual(calls, []);
});

void test('global shortcut input still handles archive/delete ctrl-only shortcuts for terminal conversations', () => {
  const calls: string[] = [];
  const shortcuts: Array<'mux.conversation.archive' | 'mux.conversation.delete'> = [
    'mux.conversation.archive',
    'mux.conversation.delete',
  ];
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState({
      mainPaneMode: () => 'conversation',
      activeConversationId: () => 'session-terminal',
      activeConversationAgentType: () => 'terminal',
    }),
    createActions(),
    {
      detectShortcut: () => shortcuts.shift() ?? 'mux.conversation.delete',
      handleShortcut: (options) => {
        calls.push(`handled:${options.shortcut}`);
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x18])), true);
  assert.equal(input.handleInput(Buffer.from([0x18])), true);
  assert.deepEqual(calls, ['handled:mux.conversation.archive', 'handled:mux.conversation.delete']);
});

void test('global shortcut input still handles thread navigation ctrl-only shortcuts for terminal conversations', () => {
  const calls: string[] = [];
  const shortcuts: Array<'mux.conversation.next' | 'mux.conversation.previous'> = [
    'mux.conversation.next',
    'mux.conversation.previous',
  ];
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState({
      mainPaneMode: () => 'conversation',
      activeConversationId: () => 'session-terminal',
      activeConversationAgentType: () => 'terminal',
    }),
    createActions(),
    {
      detectShortcut: () => shortcuts.shift() ?? 'mux.conversation.previous',
      handleShortcut: (options) => {
        calls.push(`handled:${options.shortcut}`);
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x0a])), true);
  assert.equal(input.handleInput(Buffer.from([0x0b])), true);
  assert.deepEqual(calls, ['handled:mux.conversation.next', 'handled:mux.conversation.previous']);
});

void test('global shortcut input still handles non-ctrl shortcuts for terminal conversations', () => {
  const calls: string[] = [];
  const input = new GlobalShortcutInput(
    resolveMuxShortcutBindings(),
    createState({
      mainPaneMode: () => 'conversation',
      activeConversationId: () => 'session-terminal',
      activeConversationAgentType: () => 'terminal',
    }),
    createActions(),
    {
      detectShortcut: () => 'mux.command-menu.toggle',
      handleShortcut: (options) => {
        calls.push(`handled:${options.shortcut}`);
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from('\u001b[112;9u', 'utf8')), true);
  assert.deepEqual(calls, ['handled:mux.command-menu.toggle']);
});
