import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { RegisteredCommandMenuAction } from '../src/mux/live-mux/command-menu.ts';
import {
  registerCommandMenuOpenInProvider,
  resolveCommandMenuOpenInCommand,
  resolveCommandMenuOpenInTargets,
  type ResolvedCommandMenuOpenInTarget,
} from '../src/mux/live-mux/command-menu-open-in.ts';

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
      title: 'Cursor IDE',
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
      title: 'Cursor IDE',
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
      title: 'Cursor IDE',
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
      title: 'Cursor IDE',
      aliases: ['cursor'],
      keywords: ['cursor'],
      launchCommand: ['cursor', '{path}'],
    },
  ];
  const notices: string[] = [];
  const calls: string[] = [];
  const providerHolder: {
    provider?: (context: {
      scope: string;
    }) => readonly RegisteredCommandMenuAction<{ scope: string }>[];
  } = {};
  const unregister = registerCommandMenuOpenInProvider<{ scope: string }>({
    registerProvider: (providerId, registeredProvider) => {
      calls.push(`register:${providerId}`);
      providerHolder.provider = registeredProvider;
      return () => {
        calls.push(`unregister:${providerId}`);
      };
    },
    resolveDirectories: () => [
      {
        directoryId: 'dir-1',
        path: '/tmp/alpha',
      },
      {
        directoryId: 'dir-2',
        path: '/tmp/beta',
      },
    ],
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
  const actions = providerHolder.provider({ scope: 'all' });
  assert.deepEqual(
    actions.map((action) => action.id),
    [
      'project.open-in.cursor.dir-1',
      'project.copy-path.dir-1',
      'project.open-in.cursor.dir-2',
      'project.copy-path.dir-2',
    ],
  );
  const openAlpha = actions.find((action) => action.id === 'project.open-in.cursor.dir-1');
  const openBeta = actions.find((action) => action.id === 'project.open-in.cursor.dir-2');
  const copyAlpha = actions.find((action) => action.id === 'project.copy-path.dir-1');
  const copyBeta = actions.find((action) => action.id === 'project.copy-path.dir-2');
  assert.equal(openAlpha?.detail, '/tmp/alpha');
  assert.equal(openBeta?.detail, '/tmp/beta');
  openAlpha?.run({ scope: 'all' });
  openBeta?.run({ scope: 'all' });
  copyAlpha?.run({ scope: 'all' });
  copyBeta?.run({ scope: 'all' });
  assert.deepEqual(notices, [
    'opened alpha in Cursor IDE',
    'failed to open beta in Cursor IDE',
    'failed to copy path',
    'copied path: /tmp/beta',
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
    resolveDirectories: () => [{ directoryId: 'dir-1', path: '/tmp/solo' }],
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
