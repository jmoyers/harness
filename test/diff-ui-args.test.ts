import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { diffUiUsage, parseDiffUiArgs } from '../src/diff-ui/args.ts';

void test('parseDiffUiArgs resolves defaults', () => {
  const parsed = parseDiffUiArgs([], {
    cwd: '/repo',
    env: {},
    isStdoutTty: true,
  });
  assert.equal(parsed.cwd, '/repo');
  assert.equal(parsed.mode, 'unstaged');
  assert.equal(parsed.baseRef, null);
  assert.equal(parsed.headRef, null);
  assert.equal(parsed.color, true);
  assert.equal(parsed.viewMode, 'auto');
  assert.equal(parsed.syntaxMode, 'auto');
  assert.equal(parsed.wordDiffMode, 'auto');
  assert.equal(parsed.noRenames, true);
  assert.equal(parsed.renameLimit, null);
  assert.equal(parsed.width, null);
  assert.equal(parsed.height, null);
});

void test('parseDiffUiArgs parses range and runtime options', () => {
  const parsed = parseDiffUiArgs(
    [
      '--base',
      'origin/main',
      '--head',
      'HEAD~1',
      '--view',
      'split',
      '--syntax',
      'on',
      '--word-diff',
      'off',
      '--no-color',
      '--json-events',
      '--rpc-stdio',
      '--snapshot',
      '--watch',
      '--theme',
      'plain',
      '--width',
      '200',
      '--height',
      '60',
      '--max-files',
      '50',
      '--max-hunks',
      '100',
      '--max-lines',
      '1000',
      '--max-bytes',
      '2048',
      '--max-runtime-ms',
      '3000',
      '--include-generated',
      '--include-binary',
      '--renames',
      '--rename-limit',
      '123',
      '--cwd',
      './nested',
    ],
    {
      cwd: '/repo',
      env: {},
      isStdoutTty: true,
    },
  );

  assert.equal(parsed.cwd, '/repo/nested');
  assert.equal(parsed.mode, 'range');
  assert.equal(parsed.baseRef, 'origin/main');
  assert.equal(parsed.headRef, 'HEAD~1');
  assert.equal(parsed.viewMode, 'split');
  assert.equal(parsed.syntaxMode, 'on');
  assert.equal(parsed.wordDiffMode, 'off');
  assert.equal(parsed.color, false);
  assert.equal(parsed.jsonEvents, true);
  assert.equal(parsed.rpcStdio, true);
  assert.equal(parsed.snapshot, true);
  assert.equal(parsed.watch, true);
  assert.equal(parsed.theme, 'plain');
  assert.equal(parsed.width, 200);
  assert.equal(parsed.height, 60);
  assert.equal(parsed.includeGenerated, true);
  assert.equal(parsed.includeBinary, true);
  assert.equal(parsed.noRenames, false);
  assert.equal(parsed.renameLimit, 123);
  assert.equal(parsed.budget.maxFiles, 50);
  assert.equal(parsed.budget.maxHunks, 100);
  assert.equal(parsed.budget.maxLines, 1000);
  assert.equal(parsed.budget.maxBytes, 2048);
  assert.equal(parsed.budget.maxRuntimeMs, 3000);
});

void test('parseDiffUiArgs applies range defaults and validates incompatible options', () => {
  const withBaseOnly = parseDiffUiArgs(['--base', 'main'], {
    cwd: '/repo',
    env: {
      NO_COLOR: '1',
    },
    isStdoutTty: true,
  });
  assert.equal(withBaseOnly.mode, 'range');
  assert.equal(withBaseOnly.headRef, 'HEAD');
  assert.equal(withBaseOnly.color, false);

  const staged = parseDiffUiArgs(['--staged'], {
    cwd: '/repo',
    env: {},
    isStdoutTty: false,
  });
  assert.equal(staged.mode, 'staged');
  assert.equal(staged.color, false);

  assert.throws(
    () =>
      parseDiffUiArgs(['--head', 'HEAD'], {
        cwd: '/repo',
        env: {},
      }),
    /only valid for range mode/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--view', 'invalid'], {
        cwd: '/repo',
        env: {},
      }),
    /invalid --view value/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--syntax', 'invalid'], {
        cwd: '/repo',
        env: {},
      }),
    /invalid --syntax value/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--word-diff', 'invalid'], {
        cwd: '/repo',
        env: {},
      }),
    /invalid --word-diff value/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--max-lines', '0'], {
        cwd: '/repo',
        env: {},
      }),
    /greater than zero/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--unknown'], {
        cwd: '/repo',
        env: {},
      }),
    /unknown option/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--width'], {
        cwd: '/repo',
        env: {},
      }),
    /missing value for --width/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--rename-limit', 'abc'], {
        cwd: '/repo',
        env: {},
      }),
    /invalid --rename-limit value/u,
  );

  assert.throws(
    () =>
      parseDiffUiArgs(['--help'], {
        cwd: '/repo',
        env: {},
      }),
    /help requested/u,
  );
});

void test('diffUiUsage documents supported flags', () => {
  const usage = diffUiUsage();
  assert.equal(usage.includes('--view <auto|split|unified>'), true);
  assert.equal(usage.includes('--rpc-stdio'), true);
  assert.equal(usage.includes('--max-runtime-ms <n>'), true);
  assert.equal(
    parseDiffUiArgs(['--renames', '--no-renames'], { cwd: '/repo', env: {} }).noRenames,
    true,
  );
});
