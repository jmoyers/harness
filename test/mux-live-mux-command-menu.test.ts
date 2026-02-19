import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  clampCommandMenuState,
  CommandMenuRegistry,
  createCommandMenuState,
  filterThemePresetActionsForScope,
  reduceCommandMenuInput,
  resolveCommandMenuPage,
  resolveCommandMenuMatches,
  resolveSelectedCommandMenuActionId,
  type RegisteredCommandMenuAction,
} from '../src/mux/live-mux/command-menu.ts';

void test('command menu state helpers initialize and clamp selection', () => {
  assert.deepEqual(createCommandMenuState(), {
    scope: 'all',
    query: '',
    selectedIndex: 0,
  });
  assert.deepEqual(clampCommandMenuState({ scope: 'all', query: 'abc', selectedIndex: 4 }, 0), {
    scope: 'all',
    query: 'abc',
    selectedIndex: 0,
  });
  assert.deepEqual(clampCommandMenuState({ scope: 'all', query: 'abc', selectedIndex: 4 }, 2), {
    scope: 'all',
    query: 'abc',
    selectedIndex: 1,
  });
  assert.deepEqual(createCommandMenuState({ scope: 'thread-start', query: 'start' }), {
    scope: 'thread-start',
    query: 'start',
    selectedIndex: 0,
  });
});

void test('command menu matcher filters and ranks title alias and keyword matches', () => {
  const actions = [
    {
      id: 'cursor.start',
      title: 'Start Cursor thread',
      aliases: ['cur', 'cursor'],
      keywords: ['thread', 'start'],
    },
    {
      id: 'codex.start',
      title: 'Start Codex thread',
      aliases: ['codex'],
      keywords: ['thread', 'start'],
    },
    {
      id: 'project.open',
      title: 'Go to project /tmp/harness',
      aliases: ['project'],
      keywords: ['go', 'project'],
    },
  ] as const;

  const cursorMatches = resolveCommandMenuMatches(actions, 'cur');
  assert.equal(cursorMatches.length > 0, true);
  assert.equal(cursorMatches[0]?.action.id, 'cursor.start');

  const projectMatches = resolveCommandMenuMatches(actions, 'go project');
  assert.equal(projectMatches.length, 1);
  assert.equal(projectMatches[0]?.action.id, 'project.open');

  assert.deepEqual(resolveCommandMenuMatches(actions, 'no-match'), []);
});

void test('command menu matcher supports unbounded result resolution for paged overlays', () => {
  const actions = Array.from({ length: 12 }, (_, index) => ({
    id: `action-${String(index)}`,
    title: `Action ${String(index).padStart(2, '0')}`,
  }));
  const limited = resolveCommandMenuMatches(actions, 'action');
  assert.equal(limited.length, 8);
  const unbounded = resolveCommandMenuMatches(actions, 'action', null);
  assert.equal(unbounded.length, 12);
});

void test('command menu empty query groups agent types first and prefers codex by default', () => {
  const actions = [
    { id: 'project.open.repo-a', title: 'Project repo-a' },
    { id: 'thread.start.cursor', title: 'Start Cursor thread' },
    { id: 'thread.start.codex', title: 'Start Codex thread' },
    { id: 'thread.start.claude', title: 'Start Claude thread' },
    { id: 'thread.start.terminal', title: 'Start Terminal thread' },
    { id: 'thread.start.critique', title: 'Start Critique thread (diff)' },
  ] as const;

  const emptyQueryMatches = resolveCommandMenuMatches(actions, '', null);
  assert.deepEqual(
    emptyQueryMatches.slice(0, 5).map((match) => match.action.id),
    [
      'thread.start.codex',
      'thread.start.claude',
      'thread.start.cursor',
      'thread.start.terminal',
      'thread.start.critique',
    ],
  );
  assert.equal(emptyQueryMatches[0]?.action.id, 'thread.start.codex');

  const page = resolveCommandMenuPage(actions, createCommandMenuState());
  assert.deepEqual(
    page.displayEntries.map((entry) => entry.action.id),
    [
      'thread.start.codex',
      'thread.start.claude',
      'thread.start.cursor',
      'thread.start.terminal',
      'thread.start.critique',
      'project.open.repo-a',
    ],
  );
});

void test('command menu typed query uses normal score+alpha sorting with no type delimiters', () => {
  const actions = [
    { id: 'thread.start.cursor', title: 'Start Cursor thread' },
    { id: 'thread.start.codex', title: 'Start Codex thread' },
    { id: 'thread.start.claude', title: 'Start Claude thread' },
  ] as const;

  const matches = resolveCommandMenuMatches(actions, 'start', null);
  assert.deepEqual(
    matches.map((match) => match.action.id),
    ['thread.start.claude', 'thread.start.codex', 'thread.start.cursor'],
  );

  const page = resolveCommandMenuPage(
    actions,
    createCommandMenuState({
      query: 'start',
    }),
  );
  assert.deepEqual(
    page.displayEntries.map((entry) => entry.action.id),
    ['thread.start.claude', 'thread.start.codex', 'thread.start.cursor'],
  );
});

void test('command menu selected action resolution supports paged selections', () => {
  const actions = Array.from({ length: 12 }, (_, index) => ({
    id: `action-${String(index)}`,
    title: `Action ${String(index).padStart(2, '0')}`,
  }));
  assert.equal(
    resolveSelectedCommandMenuActionId(actions, {
      scope: 'theme-select',
      query: 'action',
      selectedIndex: 9,
    }),
    'action-9',
  );
});

void test('command menu input reducer covers typing navigation and submit branches', () => {
  const start = createCommandMenuState();
  const typed = reduceCommandMenuInput(start, Buffer.from('cur', 'utf8'), 3);
  assert.deepEqual(typed, {
    nextState: {
      scope: 'all',
      query: 'cur',
      selectedIndex: 0,
    },
    submit: false,
  });

  const backspaced = reduceCommandMenuInput(
    {
      scope: 'all',
      query: 'cur',
      selectedIndex: 1,
    },
    Buffer.from([0x7f]),
    3,
  );
  assert.deepEqual(backspaced, {
    nextState: {
      scope: 'all',
      query: 'cu',
      selectedIndex: 0,
    },
    submit: false,
  });

  const downArrow = reduceCommandMenuInput(
    {
      scope: 'all',
      query: 'cu',
      selectedIndex: 0,
    },
    Buffer.from('\u001b[B', 'utf8'),
    3,
  );
  assert.equal(downArrow.nextState.selectedIndex, 1);

  const upArrow = reduceCommandMenuInput(
    {
      scope: 'all',
      query: 'cu',
      selectedIndex: 0,
    },
    Buffer.from('\u001b[A', 'utf8'),
    3,
  );
  assert.equal(upArrow.nextState.selectedIndex, 2);

  const ctrlN = reduceCommandMenuInput(
    {
      scope: 'all',
      query: 'cu',
      selectedIndex: 1,
    },
    Buffer.from([0x0e]),
    3,
  );
  assert.equal(ctrlN.nextState.selectedIndex, 2);

  const ctrlP = reduceCommandMenuInput(
    {
      scope: 'all',
      query: 'cu',
      selectedIndex: 1,
    },
    Buffer.from([0x10]),
    3,
  );
  assert.equal(ctrlP.nextState.selectedIndex, 0);

  const submitted = reduceCommandMenuInput(
    {
      scope: 'all',
      query: 'cu',
      selectedIndex: 0,
    },
    Buffer.from('\n', 'utf8'),
    3,
  );
  assert.equal(submitted.submit, true);
});

void test('command menu registry resolves static and provider actions with when filters', () => {
  interface Context {
    readonly enabled: boolean;
  }
  const registry = new CommandMenuRegistry<Context>();
  const staticAction: RegisteredCommandMenuAction<Context> = {
    id: 'always',
    title: 'Always',
    run: () => {},
  };
  const unregisterAlways = registry.registerAction(staticAction);
  const unregisterConditional = registry.registerAction({
    id: 'conditional',
    title: 'Conditional',
    when: (context) => context.enabled,
    run: () => {},
  });
  const unregisterProvider = registry.registerProvider('provider', (context) => [
    {
      id: 'provider.action',
      title: context.enabled ? 'Provider enabled' : 'Provider disabled',
      run: () => {},
    },
    {
      id: 'always',
      title: 'Duplicate static id should be ignored',
      run: () => {},
    },
  ]);

  const disabled = registry.resolveActions({
    enabled: false,
  });
  assert.deepEqual(
    disabled.map((action) => action.id),
    ['always', 'provider.action'],
  );

  const enabled = registry.resolveActions({
    enabled: true,
  });
  assert.deepEqual(
    enabled.map((action) => action.id),
    ['always', 'conditional', 'provider.action'],
  );

  unregisterConditional();
  unregisterProvider();
  assert.deepEqual(
    registry
      .resolveActions({
        enabled: true,
      })
      .map((action) => action.id),
    ['always'],
  );
  unregisterAlways();
  assert.deepEqual(
    registry.resolveActions({
      enabled: true,
    }),
    [],
  );
});

void test('command menu theme scope hides preset actions in main scope and only shows them in theme picker scope', () => {
  const actions = [
    { id: 'theme.choose', title: 'Set a Theme' },
    { id: 'theme.set.github', title: 'github' },
    { id: 'project.open.repo-a', title: 'Project repo-a' },
  ] as const;

  const mainScope = filterThemePresetActionsForScope(actions, 'all', 'theme.set.');
  assert.deepEqual(
    mainScope.map((action) => action.id),
    ['theme.choose', 'project.open.repo-a'],
  );

  const themePickerScope = filterThemePresetActionsForScope(actions, 'theme-select', 'theme.set.');
  assert.deepEqual(
    themePickerScope.map((action) => action.id),
    ['theme.set.github'],
  );
});
