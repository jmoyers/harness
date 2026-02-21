import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { GlobalShortcutInput } from '../src/ui/global-shortcut-input.ts';

void test('global shortcut input delegates detection and handler wiring', () => {
  const calls: string[] = [];
  let mode: 'conversation' | 'project' | 'home' = 'project';
  let activeDirectoryId: string | null = 'dir-a';
  const input = new GlobalShortcutInput(
    {
      shortcutBindings: resolveMuxShortcutBindings(),
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
      toggleDebugBar: () => {},
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
      getMainPaneMode: () => mode,
      getActiveConversationId: () => 'session-a',
      conversationsHas: (sessionId) => {
        calls.push(`has-conversation:${sessionId}`);
        return true;
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
      getActiveDirectoryId: () => activeDirectoryId,
      directoryExists: (directoryId) => {
        calls.push(`directory-exists:${directoryId}`);
        return true;
      },
      closeDirectory: async (directoryId) => {
        calls.push(`close-directory:${directoryId}`);
      },
      cycleLeftNavSelection: (direction) => {
        calls.push(`cycle:${direction}`);
      },
    },
    {
      detectMuxGlobalShortcut: () => 'mux.directory.close',
      handleGlobalShortcut: (options) => {
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

void test('global shortcut input default dependencies return false when no shortcut matches', () => {
  const input = new GlobalShortcutInput({
    shortcutBindings: resolveMuxShortcutBindings(),
    requestStop: () => {},
    resolveDirectoryForAction: () => null,
    openNewThreadPrompt: () => {},
    toggleCommandMenu: () => {},
    toggleDebugBar: () => {},
    openOrCreateCritiqueConversationInDirectory: async () => {},
    toggleGatewayProfile: async () => {},
    toggleGatewayStatusTimeline: async () => {},
    toggleGatewayRenderTrace: async () => {},
    getMainPaneMode: () => 'home',
    getActiveConversationId: () => null,
    conversationsHas: () => false,
    queueControlPlaneOp: () => {},
    archiveConversation: async () => {},
    refreshAllConversationTitles: async () => {},
    interruptConversation: async () => {},
    takeoverConversation: async () => {},
    openAddDirectoryPrompt: () => {},
    getActiveDirectoryId: () => null,
    directoryExists: () => false,
    closeDirectory: async () => {},
    cycleLeftNavSelection: () => {},
  });

  assert.equal(input.handleInput(Buffer.from('z')), false);
});

void test('global shortcut input routes each interrupt-all shortcut through the shared handler', () => {
  const calls: string[] = [];
  const input = new GlobalShortcutInput(
    {
      shortcutBindings: resolveMuxShortcutBindings(),
      requestStop: () => {
        calls.push('request-stop');
      },
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: () => {},
      toggleCommandMenu: () => {},
      toggleDebugBar: () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      getMainPaneMode: () => 'conversation',
      getActiveConversationId: () => 'session-a',
      conversationsHas: () => true,
      queueControlPlaneOp: () => {},
      archiveConversation: async () => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async () => {},
      takeoverConversation: async () => {},
      openAddDirectoryPrompt: () => {},
      getActiveDirectoryId: () => null,
      directoryExists: () => false,
      closeDirectory: async () => {},
      cycleLeftNavSelection: () => {},
    },
    {
      detectMuxGlobalShortcut: () => 'mux.app.interrupt-all',
      handleGlobalShortcut: (options) => {
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
    {
      shortcutBindings: resolveMuxShortcutBindings(),
      requestStop: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: () => {},
      toggleCommandMenu: () => {},
      toggleDebugBar: () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      getMainPaneMode: () => 'conversation',
      getActiveConversationId: () => 'session-a',
      conversationsHas: () => true,
      queueControlPlaneOp: () => {},
      archiveConversation: async () => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async () => {},
      takeoverConversation: async () => {},
      openAddDirectoryPrompt: () => {},
      getActiveDirectoryId: () => null,
      directoryExists: () => false,
      closeDirectory: async () => {},
      cycleLeftNavSelection: () => {},
    },
    {
      detectMuxGlobalShortcut: () => 'mux.app.interrupt-all',
      handleGlobalShortcut: () => false,
    },
  );

  assert.equal(input.handleInput(Buffer.from([0x03])), false);
});

void test('global shortcut input bypasses ctrl-only shortcuts for terminal conversations', () => {
  const calls: string[] = [];
  const input = new GlobalShortcutInput(
    {
      shortcutBindings: resolveMuxShortcutBindings(),
      requestStop: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: () => {},
      toggleCommandMenu: () => {},
      toggleDebugBar: () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      getMainPaneMode: () => 'conversation',
      getActiveConversationId: () => 'session-terminal',
      getActiveConversationAgentType: () => 'terminal',
      conversationsHas: () => true,
      queueControlPlaneOp: () => {},
      archiveConversation: async () => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async () => {},
      takeoverConversation: async () => {},
      openAddDirectoryPrompt: () => {},
      getActiveDirectoryId: () => null,
      directoryExists: () => false,
      closeDirectory: async () => {},
      cycleLeftNavSelection: () => {},
    },
    {
      detectMuxGlobalShortcut: () => 'mux.conversation.titles.refresh-all',
      handleGlobalShortcut: (options) => {
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
    {
      shortcutBindings: resolveMuxShortcutBindings(),
      requestStop: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: () => {},
      toggleCommandMenu: () => {},
      toggleDebugBar: () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      getMainPaneMode: () => 'conversation',
      getActiveConversationId: () => 'session-terminal',
      getActiveConversationAgentType: () => 'terminal',
      conversationsHas: () => true,
      queueControlPlaneOp: () => {},
      archiveConversation: async () => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async () => {},
      takeoverConversation: async () => {},
      openAddDirectoryPrompt: () => {},
      getActiveDirectoryId: () => null,
      directoryExists: () => false,
      closeDirectory: async () => {},
      cycleLeftNavSelection: () => {},
    },
    {
      detectMuxGlobalShortcut: () => shortcuts.shift() ?? 'mux.conversation.delete',
      handleGlobalShortcut: (options) => {
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
    {
      shortcutBindings: resolveMuxShortcutBindings(),
      requestStop: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: () => {},
      toggleCommandMenu: () => {},
      toggleDebugBar: () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      getMainPaneMode: () => 'conversation',
      getActiveConversationId: () => 'session-terminal',
      getActiveConversationAgentType: () => 'terminal',
      conversationsHas: () => true,
      queueControlPlaneOp: () => {},
      archiveConversation: async () => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async () => {},
      takeoverConversation: async () => {},
      openAddDirectoryPrompt: () => {},
      getActiveDirectoryId: () => null,
      directoryExists: () => false,
      closeDirectory: async () => {},
      cycleLeftNavSelection: () => {},
    },
    {
      detectMuxGlobalShortcut: () => shortcuts.shift() ?? 'mux.conversation.previous',
      handleGlobalShortcut: (options) => {
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
    {
      shortcutBindings: resolveMuxShortcutBindings(),
      requestStop: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: () => {},
      toggleCommandMenu: () => {},
      toggleDebugBar: () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      getMainPaneMode: () => 'conversation',
      getActiveConversationId: () => 'session-terminal',
      getActiveConversationAgentType: () => 'terminal',
      conversationsHas: () => true,
      queueControlPlaneOp: () => {},
      archiveConversation: async () => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async () => {},
      takeoverConversation: async () => {},
      openAddDirectoryPrompt: () => {},
      getActiveDirectoryId: () => null,
      directoryExists: () => false,
      closeDirectory: async () => {},
      cycleLeftNavSelection: () => {},
    },
    {
      detectMuxGlobalShortcut: () => 'mux.command-menu.toggle',
      handleGlobalShortcut: (options) => {
        calls.push(`handled:${options.shortcut}`);
        return true;
      },
    },
  );

  assert.equal(input.handleInput(Buffer.from('\u001b[112;9u', 'utf8')), true);
  assert.deepEqual(calls, ['handled:mux.command-menu.toggle']);
});
