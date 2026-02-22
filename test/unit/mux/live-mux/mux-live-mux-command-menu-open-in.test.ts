import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { RegisteredCommandMenuAction } from '../../../../src/mux/live-mux/command-menu.ts';
import {
  registerCommandMenuOpenInProvider,
  resolveCommandMenuOpenInCommand,
  resolveCommandMenuOpenInTargets,
  type ResolvedCommandMenuOpenInTarget,
} from '../../../../src/mux/live-mux/command-menu-open-in.ts';

void test('command menu open-in target resolution auto-detects mac apps and builds open -a launch commands', () => {
  const targets = resolveCommandMenuOpenInTargets({
    platform: 'darwin',
    overrides: {},
    isCommandAvailable: () => false,
    isMacApplicationInstalled: (appName) => appName === 'Cursor' || appName === 'Finder',
  });
  assert.deepEqual(
    targets.map((target) => target.id),
    ['cursor', 'finder'],
  );
  assert.deepEqual(targets[0]?.launchCommand, ['open', '-a', 'Cursor', '{path}']);
  assert.deepEqual(targets[1]?.launchCommand, ['open', '-a', 'Finder', '{path}']);
});

void test('command menu open-in target resolution auto-detects non-mac commands and honors overrides', () => {
  const targets = resolveCommandMenuOpenInTargets({
    platform: 'linux',
    overrides: {
      iterm2: {
        enabled: true,
        launchCommand: ['custom-iterm', '{path}'],
      },
      ghostty: {
        enabled: false,
      },
      vscode: {
        detectCommand: 'code-insiders',
      },
      warp: {
        detectCommand: null,
      },
      zed: {
        launchCommand: [],
      },
    },
    isCommandAvailable: (command) => command === 'code-insiders',
    isMacApplicationInstalled: () => false,
  });
  assert.deepEqual(
    targets.map((target) => target.id),
    ['iterm2', 'vscode'],
  );
  assert.deepEqual(targets[0]?.launchCommand, ['custom-iterm', '{path}']);
  assert.deepEqual(targets[1]?.launchCommand, ['code', '{path}']);
});

void test('command menu open-in command resolution replaces path token and appends when absent', () => {
  const withToken = resolveCommandMenuOpenInCommand(
    {
      id: 'cursor',
      title: 'Cursor',
      aliases: [],
      keywords: [],
      launchCommand: ['open', '-a', 'Cursor', '{path}'],
    },
    '/tmp/project-a',
  );
  assert.deepEqual(withToken, {
    command: 'open',
    args: ['-a', 'Cursor', '/tmp/project-a'],
  });

  const withoutToken = resolveCommandMenuOpenInCommand(
    {
      id: 'cursor',
      title: 'Cursor',
      aliases: [],
      keywords: [],
      launchCommand: ['cursor'],
    },
    '/tmp/project-b',
  );
  assert.deepEqual(withoutToken, {
    command: 'cursor',
    args: ['/tmp/project-b'],
  });

  const invalid = resolveCommandMenuOpenInCommand(
    {
      id: 'cursor',
      title: 'Cursor',
      aliases: [],
      keywords: [],
      launchCommand: [' '],
    },
    '/tmp/project-c',
  );
  assert.equal(invalid, null);
});

void test('command menu open-in provider registers actions for open and copy-path workflows', () => {
  const targets: readonly ResolvedCommandMenuOpenInTarget[] = [
    {
      id: 'cursor',
      title: 'Cursor',
      aliases: ['cursor'],
      keywords: ['cursor'],
      launchCommand: ['cursor', '{path}'],
    },
  ];
  const notices: string[] = [];
  const calls: string[] = [];
  const directories = [
    {
      directoryId: 'dir-1',
      path: '/tmp/alpha',
    },
    {
      directoryId: 'dir-2',
      path: '/tmp/beta',
    },
  ] as const;
  const providerHolder: {
    provider?: (context: {
      activeDirectoryId: string | null;
      scope: string;
    }) => readonly RegisteredCommandMenuAction<{
      activeDirectoryId: string | null;
      scope: string;
    }>[];
  } = {};
  const unregister = registerCommandMenuOpenInProvider<{
    activeDirectoryId: string | null;
    scope: string;
  }>({
    registerProvider: (providerId, registeredProvider) => {
      calls.push(`register:${providerId}`);
      providerHolder.provider = registeredProvider;
      return () => {
        calls.push(`unregister:${providerId}`);
      };
    },
    resolveDirectories: (context) =>
      directories.filter((directory) => directory.directoryId === context.activeDirectoryId),
    resolveTargets: () => targets,
    projectPathTail: (path) => path.split('/').pop() ?? path,
    openInTarget: (_target, path) => path.endsWith('/alpha'),
    copyPath: (path) => path.endsWith('/beta'),
    setNotice: (message) => {
      notices.push(message);
    },
  });
  assert.deepEqual(calls, ['register:project.open-in']);
  if (providerHolder.provider === undefined) {
    throw new Error('expected provider registration');
  }
  const actions = providerHolder.provider({ activeDirectoryId: 'dir-1', scope: 'all' });
  assert.deepEqual(
    actions.map((action) => action.id),
    ['project.open-in.cursor.dir-1', 'project.copy-path.dir-1'],
  );
  const openAlpha = actions.find((action) => action.id === 'project.open-in.cursor.dir-1');
  const copyAlpha = actions.find((action) => action.id === 'project.copy-path.dir-1');
  assert.equal(openAlpha?.detail, '/tmp/alpha');
  openAlpha?.run({ activeDirectoryId: 'dir-1', scope: 'all' });
  copyAlpha?.run({ activeDirectoryId: 'dir-1', scope: 'all' });
  const actionsForSecondDirectory = providerHolder.provider({
    activeDirectoryId: 'dir-2',
    scope: 'all',
  });
  const openBeta = actionsForSecondDirectory.find(
    (action) => action.id === 'project.open-in.cursor.dir-2',
  );
  openBeta?.run({ activeDirectoryId: 'dir-2', scope: 'all' });
  assert.deepEqual(notices, [
    'opened alpha in Cursor',
    'failed to copy path',
    'failed to open beta in Cursor',
  ]);
  unregister();
  assert.deepEqual(calls, ['register:project.open-in', 'unregister:project.open-in']);
});

void test('command menu open-in provider still registers copy-path actions when no open targets resolve', () => {
  const providerHolder: {
    provider?: (context: void) => readonly RegisteredCommandMenuAction<void>[];
  } = {};
  registerCommandMenuOpenInProvider<void>({
    registerProvider: (_providerId, registeredProvider) => {
      providerHolder.provider = registeredProvider;
      return () => {};
    },
    resolveDirectories: (_context) => [{ directoryId: 'dir-1', path: '/tmp/solo' }],
    resolveTargets: () => [],
    projectPathTail: (path) => path,
    openInTarget: () => false,
    copyPath: () => true,
    setNotice: () => {},
  });
  if (providerHolder.provider === undefined) {
    throw new Error('expected provider registration');
  }
  const actions = providerHolder.provider(undefined);
  assert.deepEqual(
    actions.map((action) => action.id),
    ['project.copy-path.dir-1'],
  );
});
