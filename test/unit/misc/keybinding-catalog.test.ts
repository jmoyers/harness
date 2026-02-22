import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { resolveMuxShortcutBindings } from '../../../src/mux/input-shortcuts.ts';
import { buildKeybindingCatalogEntries } from '../../../src/mux/keybinding-catalog.ts';
import { resolveTaskScreenKeybindings } from '../../../src/mux/task-screen-keybindings.ts';

void test('keybinding catalog builds entries from resolved global and home/task bindings', () => {
  const globalBindings = resolveMuxShortcutBindings({
    'mux.command-menu.toggle': ['ctrl+space'],
    'mux.app.quit': ['ctrl+q'],
  });
  const taskScreenKeybindings = resolveTaskScreenKeybindings({
    'mux.home.task.submit': ['ctrl+enter'],
  });
  const entries = buildKeybindingCatalogEntries({
    globalBindings,
    taskScreenKeybindings,
  });

  const toggleCommandMenu = entries.find((entry) => entry.actionId === 'mux.command-menu.toggle');
  assert.notEqual(toggleCommandMenu, undefined);
  assert.equal(toggleCommandMenu?.bindingHint, 'ctrl+space');
  assert.equal(toggleCommandMenu?.screenLabel, 'Global');
  assert.equal(toggleCommandMenu?.sectionLabel, 'Navigation');
  assert.equal(toggleCommandMenu?.aliases.includes('ctrl+space'), true);

  const taskSubmit = entries.find((entry) => entry.actionId === 'mux.home.task.submit');
  assert.notEqual(taskSubmit, undefined);
  assert.equal(taskSubmit?.bindingHint, 'ctrl+enter');
  assert.equal(taskSubmit?.screenLabel, 'Home');
  assert.equal(taskSubmit?.sectionLabel, 'Tasks');
  assert.equal(taskSubmit?.id.startsWith('shortcut.binding.'), true);
});

void test('keybinding catalog marks actions with no configured key as unbound', () => {
  const entries = buildKeybindingCatalogEntries({
    globalBindings: resolveMuxShortcutBindings(),
    taskScreenKeybindings: resolveTaskScreenKeybindings(),
  });
  const archiveConversation = entries.find(
    (entry) => entry.actionId === 'mux.conversation.archive',
  );
  assert.notEqual(archiveConversation, undefined);
  assert.equal(archiveConversation?.bindingHint, '(unbound)');
});
