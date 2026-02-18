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
      openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
        calls.push(`critique:${directoryId}`);
      },
      toggleGatewayProfile: async () => {
        calls.push('toggle-gateway-profile');
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
    openOrCreateCritiqueConversationInDirectory: async () => {},
    toggleGatewayProfile: async () => {},
    getMainPaneMode: () => 'home',
    getActiveConversationId: () => null,
    conversationsHas: () => false,
    queueControlPlaneOp: () => {},
    archiveConversation: async () => {},
    takeoverConversation: async () => {},
    openAddDirectoryPrompt: () => {},
    getActiveDirectoryId: () => null,
    directoryExists: () => false,
    closeDirectory: async () => {},
    cycleLeftNavSelection: () => {},
  });

  assert.equal(input.handleInput(Buffer.from('z')), false);
});
