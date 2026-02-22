import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  buildFileLinkPathArgumentForTarget,
  prioritizeOpenInTargetsForFileLinks,
  resolveFileLinkPath,
  resolveLinkCommandFromTemplate,
  resolveTerminalLinkTargetAtCell,
} from '../../../../src/mux/live-mux/link-click.ts';

void test('resolveTerminalLinkTargetAtCell detects urls and file-like tokens at clicked cell', () => {
  const urlTarget = resolveTerminalLinkTargetAtCell({
    lines: ['check this (https://example.com/docs?q=1).'],
    row: 1,
    col: 20,
  });
  assert.deepEqual(urlTarget, {
    kind: 'url',
    url: 'https://example.com/docs?q=1',
  });

  const fileTarget = resolveTerminalLinkTargetAtCell({
    lines: ['src/mux/runtime-app/codex-live-mux-runtime.ts:4102:7'],
    row: 1,
    col: 15,
  });
  assert.deepEqual(fileTarget, {
    kind: 'file',
    path: 'src/mux/runtime-app/codex-live-mux-runtime.ts',
    line: 4102,
    column: 7,
  });

  const nullTarget = resolveTerminalLinkTargetAtCell({
    lines: ['plain text only'],
    row: 1,
    col: 2,
  });
  assert.equal(nullTarget, null);

  const implicitLineTarget = resolveTerminalLinkTargetAtCell({
    lines: ['README:12'],
    row: 1,
    col: 3,
  });
  assert.deepEqual(implicitLineTarget, {
    kind: 'file',
    path: 'README',
    line: 12,
    column: null,
  });

  const homePathTarget = resolveTerminalLinkTargetAtCell({
    lines: ['~/project/main.ts'],
    row: 1,
    col: 4,
  });
  assert.deepEqual(homePathTarget, {
    kind: 'file',
    path: '~/project/main.ts',
    line: null,
    column: null,
  });

  const invalidProtocolTarget = resolveTerminalLinkTargetAtCell({
    lines: ['blob://not-a-file'],
    row: 1,
    col: 5,
  });
  assert.equal(invalidProtocolTarget, null);

  const fileUrlTarget = resolveTerminalLinkTargetAtCell({
    lines: ['file:///tmp/example.ts'],
    row: 1,
    col: 6,
  });
  assert.deepEqual(fileUrlTarget, {
    kind: 'file',
    path: '/tmp/example.ts',
    line: null,
    column: null,
  });

  const malformedFileUrlTarget = resolveTerminalLinkTargetAtCell({
    lines: ['file://[::1'],
    row: 1,
    col: 8,
  });
  assert.equal(malformedFileUrlTarget, null);

  const wrappedPunctuationOnly = resolveTerminalLinkTargetAtCell({
    lines: [')'],
    row: 1,
    col: 1,
  });
  assert.equal(wrappedPunctuationOnly, null);

  assert.equal(
    resolveTerminalLinkTargetAtCell({
      lines: ['http://example.com'],
      row: 0,
      col: 1,
    }),
    null,
  );
  assert.equal(
    resolveTerminalLinkTargetAtCell({
      lines: ['http://example.com'],
      row: 1,
      col: 0,
    }),
    null,
  );
  assert.equal(
    resolveTerminalLinkTargetAtCell({
      lines: [''],
      row: 1,
      col: 1,
    }),
    null,
  );

  const invalidZeroLine = resolveTerminalLinkTargetAtCell({
    lines: ['foo.ts:0'],
    row: 1,
    col: 4,
  });
  assert.equal(invalidZeroLine, null);

  assert.equal(
    resolveTerminalLinkTargetAtCell({
      lines: ['https://%'],
      row: 1,
      col: 2,
    }),
    null,
  );

  assert.equal(
    resolveTerminalLinkTargetAtCell({
      lines: ['https://example.com trailing'],
      row: 1,
      col: 20,
    }),
    null,
  );
});

void test('resolveFileLinkPath handles home absolute and directory-relative paths', () => {
  assert.equal(
    resolveFileLinkPath({
      path: '~/project/src/main.ts',
      directoryPath: '/workspace/repo',
      homeDirectory: '/Users/tester',
    }),
    '/Users/tester/project/src/main.ts',
  );
  assert.equal(
    resolveFileLinkPath({
      path: '/tmp/absolute.ts',
      directoryPath: '/workspace/repo',
      homeDirectory: '/Users/tester',
    }),
    '/tmp/absolute.ts',
  );
  assert.equal(
    resolveFileLinkPath({
      path: 'src/main.ts',
      directoryPath: '/workspace/repo',
      homeDirectory: '/Users/tester',
    }),
    '/workspace/repo/src/main.ts',
  );
  assert.equal(
    resolveFileLinkPath({
      path: 'src/main.ts',
      directoryPath: null,
      homeDirectory: '/Users/tester',
    }),
    'src/main.ts',
  );
});

void test('buildFileLinkPathArgumentForTarget appends line+column for editor targets only', () => {
  assert.equal(
    buildFileLinkPathArgumentForTarget({
      targetId: 'zed',
      path: '/tmp/example.ts',
      line: 12,
      column: 3,
    }),
    '/tmp/example.ts:12:3',
  );
  assert.equal(
    buildFileLinkPathArgumentForTarget({
      targetId: 'finder',
      path: '/tmp/example.ts',
      line: 12,
      column: 3,
    }),
    '/tmp/example.ts',
  );
  assert.equal(
    buildFileLinkPathArgumentForTarget({
      targetId: 'zed',
      path: '/tmp/example.ts',
      line: 12,
      column: null,
    }),
    '/tmp/example.ts:12',
  );
});

void test('prioritizeOpenInTargetsForFileLinks prefers zed before remaining available targets', () => {
  const prioritized = prioritizeOpenInTargetsForFileLinks([
    {
      id: 'cursor',
      title: 'Cursor',
      aliases: [],
      keywords: [],
      launchCommand: ['cursor', '{path}'],
    },
    {
      id: 'zed',
      title: 'Zed',
      aliases: [],
      keywords: [],
      launchCommand: ['zed', '{path}'],
    },
    {
      id: 'vscode',
      title: 'VSCode',
      aliases: [],
      keywords: [],
      launchCommand: ['code', '{path}'],
    },
  ]);
  assert.deepEqual(
    prioritized.map((target) => target.id),
    ['zed', 'cursor', 'vscode'],
  );
});

void test('resolveLinkCommandFromTemplate injects placeholders and appends missing primary argument', () => {
  const browserCommand = resolveLinkCommandFromTemplate({
    template: ['open', '-a', 'Arc', '{url}'],
    values: {
      url: 'https://example.com',
    },
    appendPrimaryPlaceholder: '{url}',
  });
  assert.deepEqual(browserCommand, {
    command: 'open',
    args: ['-a', 'Arc', 'https://example.com'],
  });

  const fileCommandWithoutPlaceholder = resolveLinkCommandFromTemplate({
    template: ['zed'],
    values: {
      path: '/tmp/file.ts',
      line: 42,
      column: 2,
    },
    appendPrimaryPlaceholder: '{path}',
  });
  assert.deepEqual(fileCommandWithoutPlaceholder, {
    command: 'zed',
    args: ['/tmp/file.ts'],
  });

  const omittedLine = resolveLinkCommandFromTemplate({
    template: ['custom-open', '{path}', '--line', '{line}', '--column', '{column}'],
    values: {
      path: '/tmp/file.ts',
      line: null,
      column: null,
    },
    appendPrimaryPlaceholder: '{path}',
  });
  assert.deepEqual(omittedLine, {
    command: 'custom-open',
    args: ['/tmp/file.ts', '--line', '--column'],
  });

  assert.equal(
    resolveLinkCommandFromTemplate({
      template: null,
      values: {
        path: '/tmp/file.ts',
      },
      appendPrimaryPlaceholder: '{path}',
    }),
    null,
  );
  assert.equal(
    resolveLinkCommandFromTemplate({
      template: [' '],
      values: {
        path: '/tmp/file.ts',
      },
      appendPrimaryPlaceholder: '{path}',
    }),
    null,
  );
});
