import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createConcurrentCliTest,
  createStubCommand,
  createWorkspace,
  runHarness,
} from '../../../helpers/harness-cli-test-helpers.ts';

const concurrentCliTest = createConcurrentCliTest();

void concurrentCliTest('harness rejects invalid session names', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['--session', '../bad', 'gateway', 'status']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('invalid --session value'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest('harness update runs global latest install command via bun', async () => {
  const workspace = createWorkspace();
  const commandDir = join(workspace, 'bin');
  mkdirSync(commandDir, { recursive: true });
  const bunArgsPath = join(workspace, 'bun-args.txt');
  createStubCommand(
    commandDir,
    'bun',
    [
      'if [ -n "${HARNESS_TEST_BUN_ARGS_PATH:-}" ]; then',
      '  printf "%s\\n" "$@" > "$HARNESS_TEST_BUN_ARGS_PATH"',
      'fi',
      'if [ -n "${HARNESS_TEST_BUN_STDOUT:-}" ]; then',
      '  printf "%s\\n" "$HARNESS_TEST_BUN_STDOUT"',
      'fi',
      'exit "${HARNESS_TEST_BUN_EXIT_CODE:-0}"',
    ].join('\n'),
  );
  try {
    const result = await runHarness(workspace, ['update'], {
      PATH: commandDir,
      HARNESS_TEST_BUN_ARGS_PATH: bunArgsPath,
      HARNESS_TEST_BUN_STDOUT: 'bun install ok',
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('updating Harness package: @jmoyers/harness@latest'), true);
    assert.equal(result.stdout.includes('bun install ok'), true);
    assert.equal(result.stdout.includes('harness update complete: @jmoyers/harness@latest'), true);
    assert.equal(
      readFileSync(bunArgsPath, 'utf8'),
      ['add', '-g', '--trust', '@jmoyers/harness@latest'].join('\n') + '\n',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest(
  'harness upgrade aliases harness update and honors HARNESS_UPDATE_PACKAGE override',
  async () => {
    const workspace = createWorkspace();
    const commandDir = join(workspace, 'bin');
    mkdirSync(commandDir, { recursive: true });
    const bunArgsPath = join(workspace, 'bun-args.txt');
    createStubCommand(
      commandDir,
      'bun',
      [
        'if [ -n "${HARNESS_TEST_BUN_ARGS_PATH:-}" ]; then',
        '  printf "%s\\n" "$@" > "$HARNESS_TEST_BUN_ARGS_PATH"',
        'fi',
        'exit 0',
      ].join('\n'),
    );
    try {
      const result = await runHarness(workspace, ['upgrade'], {
        PATH: commandDir,
        HARNESS_TEST_BUN_ARGS_PATH: bunArgsPath,
        HARNESS_UPDATE_PACKAGE: '@jmoyers/harness@next',
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout.includes('updating Harness package: @jmoyers/harness@next'), true);
      assert.equal(result.stdout.includes('harness update complete: @jmoyers/harness@next'), true);
      assert.equal(
        readFileSync(bunArgsPath, 'utf8'),
        ['add', '-g', '--trust', '@jmoyers/harness@next'].join('\n') + '\n',
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

void concurrentCliTest('harness update rejects unknown options', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['update', '--bad-option']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown update option: --bad-option'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
