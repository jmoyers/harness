import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createConcurrentCliTest,
  createWorkspace,
  runHarness,
  workspaceRuntimeRoot,
} from '../../../helpers/harness-cli-test-helpers.ts';

const concurrentCliTest = createConcurrentCliTest();

void concurrentCliTest(
  'harness cursor-hooks install creates managed cursor hooks in user scope',
  async () => {
    const workspace = createWorkspace();
    const fakeHome = join(workspace, 'fake-home');
    const hooksFilePath = join(fakeHome, '.cursor/hooks.json');
    try {
      const result = await runHarness(workspace, ['cursor-hooks', 'install'], {
        HOME: fakeHome,
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout.includes('cursor hooks install:'), true);
      assert.equal(existsSync(hooksFilePath), true);
      const parsed = JSON.parse(readFileSync(hooksFilePath, 'utf8')) as Record<string, unknown>;
      const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
      const managedBeforeSubmit = hooks['beforeSubmitPrompt'] ?? [];
      assert.equal(
        managedBeforeSubmit.some(
          (entry) =>
            typeof entry['command'] === 'string' &&
            (entry['command'] as string).includes('harness-cursor-hook-v1:beforeSubmitPrompt'),
        ),
        true,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

void concurrentCliTest(
  'harness cursor-hooks uninstall removes only managed cursor entries',
  async () => {
    const workspace = createWorkspace();
    const fakeHome = join(workspace, 'fake-home');
    const hooksFilePath = join(fakeHome, '.cursor/hooks.json');
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    writeFileSync(
      hooksFilePath,
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [
            { command: 'echo user-hook' },
            {
              command:
                "/usr/bin/env node /tmp/cursor-hook-relay.ts --managed-hook-id 'harness-cursor-hook-v1:beforeSubmitPrompt'",
            },
          ],
        },
      }),
      'utf8',
    );
    try {
      const result = await runHarness(workspace, ['cursor-hooks', 'uninstall'], {
        HOME: fakeHome,
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout.includes('cursor hooks uninstall:'), true);
      const parsed = JSON.parse(readFileSync(hooksFilePath, 'utf8')) as Record<string, unknown>;
      const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
      assert.equal(
        hooks['beforeSubmitPrompt']?.some((entry) => entry['command'] === 'echo user-hook'),
        true,
      );
      assert.equal(
        hooks['beforeSubmitPrompt']?.some(
          (entry) =>
            typeof entry['command'] === 'string' &&
            (entry['command'] as string).includes('harness-cursor-hook-v1'),
        ),
        false,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

void concurrentCliTest('harness animate --help prints usage', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate', '--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('harness animate [--fps <fps>]'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest('harness nim --help prints usage', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['nim', '--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('harness nim [options]'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest('harness --help prints oclif root command menu', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('USAGE'), true);
    assert.equal(result.stdout.includes('COMMANDS'), true);
    assert.equal(result.stdout.includes('gateway'), true);
    assert.equal(result.stdout.includes('status-timeline'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest('harness nim rejects unknown arguments', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['nim', '--bad']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('unknown argument: --bad'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest('harness gateway --help prints standardized command usage', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['gateway', '--help']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('USAGE'), true);
    assert.equal(result.stdout.includes('harness gateway'), true);
    assert.equal(result.stdout.includes('--session'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest('harness animate requires explicit bounds in non-tty mode', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes('harness animate requires a TTY'), true);
    assert.equal(result.stderr.includes('--frames/--duration-ms'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void concurrentCliTest(
  'harness animate renders bounded frames without starting gateway',
  async () => {
    const workspace = createWorkspace();
    const recordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
    try {
      const result = await runHarness(workspace, [
        'animate',
        '--frames',
        '1',
        '--seed',
        '7',
        '--no-color',
      ]);
      assert.equal(result.code, 0);
      assert.equal(result.stdout.includes('HARNESS'), true);
      assert.equal(existsSync(recordPath), false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

void concurrentCliTest('harness animate default color output uses muted palette', async () => {
  const workspace = createWorkspace();
  try {
    const result = await runHarness(workspace, ['animate', '--frames', '1', '--seed', '7']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.includes('\u001b[38;5;109m'), true);
    assert.equal(result.stdout.includes('\u001b[38;5;46m'), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
