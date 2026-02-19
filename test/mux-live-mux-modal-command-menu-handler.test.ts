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
      calls.push(
        `setMenu:${next === null ? 'null' : `${next.query}:${String(next.selectedIndex)}`}`,
      );
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

void test('command menu handler down-arrow navigation moves beyond first result page', () => {
  let menu: CommandMenuState | null = createCommandMenuState({
    query: 'action',
  });
  const actions = Array.from({ length: 12 }, (_, index) => ({
    id: `action.${String(index)}`,
    title: `Action ${String(index).padStart(2, '0')}`,
  }));
  const executed: string[] = [];
  const common = {
    resolveActions: () => actions,
    executeAction: (actionId: string) => {
      executed.push(actionId);
    },
    setMenu: (next: ReturnType<typeof createCommandMenuState> | null) => {
      menu = next;
    },
    markDirty: () => {},
    buildCommandMenuModalOverlay: () => ({ top: 1 }),
  };

  for (let index = 0; index < 9; index += 1) {
    const handled = handleCommandMenuInput({
      input: Buffer.from('\u001b[B', 'utf8'),
      menu,
      isQuitShortcut: () => false,
      isToggleShortcut: () => false,
      dismissOnOutsideClick: () => false,
      ...common,
    });
    assert.equal(handled, true);
  }

  assert.equal(menu?.selectedIndex, 9);
  const handledSubmit = handleCommandMenuInput({
    input: Buffer.from('\n', 'utf8'),
    menu,
    isQuitShortcut: () => false,
    isToggleShortcut: () => false,
    dismissOnOutsideClick: () => false,
    ...common,
  });
  assert.equal(handledSubmit, true);
  assert.deepEqual(executed, ['action.9']);
});

void test('command menu handler executes theme selection before menu teardown on enter', () => {
  let menu: CommandMenuState | null = createCommandMenuState({
    scope: 'theme-select',
  });
  const callOrder: string[] = [];

  const handled = handleCommandMenuInput({
    input: Buffer.from('\n', 'utf8'),
    menu,
    isQuitShortcut: () => false,
    isToggleShortcut: () => false,
    dismissOnOutsideClick: () => false,
    buildCommandMenuModalOverlay: () => ({ top: 1 }),
    resolveActions: () => [{ id: 'theme.set.github', title: 'github' }],
    executeAction: (actionId) => {
      callOrder.push(`execute:${actionId}:${menu?.scope ?? 'null'}`);
    },
    setMenu: (next) => {
      menu = next;
      callOrder.push(`set:${next?.scope ?? 'null'}`);
    },
    markDirty: () => {
      callOrder.push('dirty');
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(callOrder, ['execute:theme.set.github:theme-select', 'set:null', 'dirty']);
});

void test('command menu handler executes theme selection before menu teardown on click', () => {
  let menu: CommandMenuState | null = createCommandMenuState({
    scope: 'theme-select',
  });
  const callOrder: string[] = [];

  const handled = handleCommandMenuInput({
    input: Buffer.from('\u001b[<0;8;6M', 'utf8'),
    menu,
    isQuitShortcut: () => false,
    isToggleShortcut: () => false,
    dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) =>
      onInsidePointerPress?.(8, 6) === true,
    buildCommandMenuModalOverlay: () => ({ top: 1 }),
    resolveActions: () => [{ id: 'theme.set.github', title: 'github' }],
    executeAction: (actionId) => {
      callOrder.push(`execute:${actionId}:${menu?.scope ?? 'null'}`);
    },
    setMenu: (next) => {
      menu = next;
      callOrder.push(`set:${next?.scope ?? 'null'}`);
    },
    markDirty: () => {
      callOrder.push('dirty');
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(callOrder, ['execute:theme.set.github:theme-select', 'set:null', 'dirty']);
});

void test('command menu handler mouse click executes clicked action row', () => {
  let menu: CommandMenuState | null = createCommandMenuState();
  const actions = [
    { id: 'thread.start.cursor', title: 'Start Cursor thread' },
    { id: 'thread.start.codex', title: 'Start Codex thread' },
  ];
  const executed: string[] = [];
  let dirtyCount = 0;

  const handled = handleCommandMenuInput({
    input: Buffer.from('\u001b[<0;8;7M', 'utf8'),
    menu,
    isQuitShortcut: () => false,
    isToggleShortcut: () => false,
    dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) =>
      onInsidePointerPress?.(8, 7) === true,
    buildCommandMenuModalOverlay: () => ({ top: 1 }),
    resolveActions: () => actions,
    executeAction: (actionId: string) => {
      executed.push(actionId);
    },
    setMenu: (next) => {
      menu = next;
    },
    markDirty: () => {
      dirtyCount += 1;
    },
  });

  assert.equal(handled, true);
  assert.equal(menu, null);
  assert.deepEqual(executed, ['thread.start.codex']);
  assert.equal(dirtyCount, 1);
});

void test('command menu handler mouse click resolves paged rows for thread-start menu', () => {
  let menu: CommandMenuState | null = {
    scope: 'thread-start',
    query: 'action',
    selectedIndex: 9,
  };
  const actions = Array.from({ length: 12 }, (_, index) => ({
    id: `action.${String(index)}`,
    title: `Action ${String(index).padStart(2, '0')}`,
  }));
  const executed: string[] = [];

  const handled = handleCommandMenuInput({
    input: Buffer.from('\u001b[<0;8;7M', 'utf8'),
    menu,
    isQuitShortcut: () => false,
    isToggleShortcut: () => false,
    dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) =>
      onInsidePointerPress?.(8, 7) === true,
    buildCommandMenuModalOverlay: () => ({ top: 1 }),
    resolveActions: () => actions,
    executeAction: (actionId: string) => {
      executed.push(actionId);
    },
    setMenu: (next) => {
      menu = next;
    },
    markDirty: () => {},
  });

  assert.equal(handled, true);
  assert.equal(menu, null);
  assert.deepEqual(executed, ['action.9']);
});

void test('command menu handler mouse click guards overlay, empty matches, and out-of-range rows', () => {
  const executed: string[] = [];
  const setMenuCalls: string[] = [];
  const common = {
    input: Buffer.from('\u001b[<0;8;6M', 'utf8'),
    isQuitShortcut: () => false,
    isToggleShortcut: () => false,
    executeAction: (actionId: string) => {
      executed.push(actionId);
    },
    setMenu: (next: CommandMenuState | null) => {
      setMenuCalls.push(next === null ? 'null' : 'set');
    },
    markDirty: () => {},
  };

  assert.equal(
    handleCommandMenuInput({
      menu: createCommandMenuState(),
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        assert.equal(onInsidePointerPress?.(8, 6), false);
        return true;
      },
      buildCommandMenuModalOverlay: () => ({ top: 1 }),
      resolveActions: () => [{ id: 'thread.start.codex', title: 'Start Codex thread' }],
      ...common,
    }),
    true,
  );

  assert.equal(
    handleCommandMenuInput({
      menu: createCommandMenuState(),
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        assert.equal(onInsidePointerPress?.(8, 6), false);
        return true;
      },
      buildCommandMenuModalOverlay: () => null,
      resolveActions: () => [{ id: 'start.codex', title: 'Start Codex thread' }],
      ...common,
    }),
    true,
  );

  assert.equal(
    handleCommandMenuInput({
      menu: createCommandMenuState({
        query: 'missing',
      }),
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        assert.equal(onInsidePointerPress?.(8, 6), false);
        return true;
      },
      buildCommandMenuModalOverlay: () => ({ top: 1 }),
      resolveActions: () => [{ id: 'start.codex', title: 'Start Codex thread' }],
      ...common,
    }),
    true,
  );

  assert.equal(
    handleCommandMenuInput({
      menu: createCommandMenuState(),
      dismissOnOutsideClick: (_input, _dismiss, onInsidePointerPress) => {
        assert.equal(onInsidePointerPress?.(8, 40), false);
        return true;
      },
      buildCommandMenuModalOverlay: () => ({ top: 1 }),
      resolveActions: () => [{ id: 'start.codex', title: 'Start Codex thread' }],
      ...common,
    }),
    true,
  );

  assert.deepEqual(executed, []);
  assert.deepEqual(setMenuCalls, []);
});
