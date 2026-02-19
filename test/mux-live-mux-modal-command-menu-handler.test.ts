import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createCommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import type { CommandMenuState } from '../src/mux/live-mux/command-menu.ts';
import { handleCommandMenuInput } from '../src/mux/live-mux/modal-command-menu-handler.ts';

void test('command menu handler short-circuits null menu and ctrl+c passthrough', () => {
  const calls: string[] = [];
  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from('x', 'utf8'),
      menu: null,
      isQuitShortcut: () => false,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildCommandMenuModalOverlay: () => null,
      resolveActions: () => [],
      executeAction: () => {
        calls.push('execute');
      },
      setMenu: () => {
        calls.push('set-menu');
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
    }),
    false,
  );

  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from([0x03]),
      menu: createCommandMenuState(),
      isQuitShortcut: () => false,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: () => false,
      buildCommandMenuModalOverlay: () => null,
      resolveActions: () => [],
      executeAction: () => {
        calls.push('execute');
      },
      setMenu: () => {
        calls.push('set-menu');
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
    }),
    false,
  );
  assert.deepEqual(calls, []);
});

void test('command menu handler covers dismiss toggle submit and mutation flows', () => {
  const calls: string[] = [];
  let menu: CommandMenuState | null = createCommandMenuState();
  const actions = [
    {
      id: 'start.cursor',
      title: 'Start Cursor thread',
      aliases: ['cur'],
    },
    {
      id: 'start.codex',
      title: 'Start Codex thread',
    },
  ];
  const common = {
    resolveActions: () => actions,
    executeAction: (actionId: string) => {
      calls.push(`execute:${actionId}`);
    },
    setMenu: (next: ReturnType<typeof createCommandMenuState> | null) => {
      menu = next;
      calls.push(`setMenu:${next === null ? 'null' : `${next.query}:${String(next.selectedIndex)}`}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    buildCommandMenuModalOverlay: () => ({ top: 1 }),
  };

  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from('q', 'utf8'),
      menu,
      isQuitShortcut: () => true,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(menu, null);

  menu = createCommandMenuState();
  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from('p', 'utf8'),
      menu,
      isQuitShortcut: () => false,
      isToggleShortcut: () => true,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(menu, null);

  menu = createCommandMenuState();
  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from('\u001b[<0;1;1M', 'utf8'),
      menu,
      isQuitShortcut: () => false,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: (_input, dismiss) => {
        dismiss();
        return true;
      },
      ...common,
    }),
    true,
  );
  assert.equal(menu, null);

  menu = createCommandMenuState();
  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from('\u001b[<0;1;1M', 'utf8'),
      menu,
      isQuitShortcut: () => false,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        onInsidePointerPress?.(1, 1);
        return true;
      },
      ...common,
    }),
    true,
  );
  assert.notEqual(menu, null);

  menu = createCommandMenuState();
  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from('cur', 'utf8'),
      menu,
      isQuitShortcut: () => false,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.notEqual(menu, null);
  assert.equal(menu?.query, 'cur');
  assert.equal(menu?.selectedIndex, 0);

  assert.equal(
    handleCommandMenuInput({
      input: Buffer.from('\n', 'utf8'),
      menu,
      isQuitShortcut: () => false,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    }),
    true,
  );
  assert.equal(menu, null);
  assert.equal(calls.includes('execute:start.cursor'), true);
  assert.equal(calls.includes('markDirty'), true);
});
