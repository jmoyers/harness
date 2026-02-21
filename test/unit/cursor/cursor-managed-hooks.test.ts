import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import {
  buildCursorManagedHookRelayCommand,
  CURSOR_MANAGED_HOOK_ID_PREFIX,
  ensureManagedCursorHooksInstalled,
  uninstallManagedCursorHooks,
} from '../../../src/cursor/managed-hooks.ts';

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

void test('cursor managed hooks install is merge-only and preserves non-managed entries', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      version: 1,
      hooks: {
        beforeSubmitPrompt: [
          { command: 'echo user-before' },
          {
            command: `/usr/bin/env node /old/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:beforeSubmitPrompt'`,
          },
        ],
        stop: [
          {
            command: `/usr/bin/env node /old/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:stop'`,
          },
        ],
        customEvent: [{ command: 'echo custom' }],
      },
    }),
    'utf8',
  );

  try {
    const result = ensureManagedCursorHooksInstalled({
      hooksFilePath,
      relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
      managedEvents: ['beforeSubmitPrompt', 'stop'],
    });
    assert.equal(result.changed, true);
    assert.equal(result.removedCount, 2);
    assert.equal(result.addedCount, 2);

    const parsed = readJson(hooksFilePath);
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(Array.isArray(hooks['beforeSubmitPrompt']), true);
    assert.equal(Array.isArray(hooks['stop']), true);
    assert.equal(Array.isArray(hooks['customEvent']), true);
    assert.equal(
      hooks['beforeSubmitPrompt']?.some((entry) => entry['command'] === 'echo user-before'),
      true,
    );
    assert.equal(
      hooks['beforeSubmitPrompt']?.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes(
            `/new/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:beforeSubmitPrompt'`,
          ),
      ),
      true,
    );
    assert.equal(
      hooks['stop']?.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes(
            `/new/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:stop'`,
          ),
      ),
      true,
    );
    assert.equal(hooks['customEvent']?.[0]?.['command'], 'echo custom');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks uninstall removes only managed entries', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-uninstall-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      version: 1,
      hooks: {
        beforeSubmitPrompt: [
          { command: 'echo user-before' },
          {
            command: `/usr/bin/env node /new/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:beforeSubmitPrompt'`,
          },
        ],
        stop: [
          {
            command: `/usr/bin/env node /new/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:stop'`,
          },
        ],
      },
    }),
    'utf8',
  );

  try {
    const result = uninstallManagedCursorHooks({
      hooksFilePath,
    });
    assert.equal(result.changed, true);
    assert.equal(result.removedCount, 2);
    assert.equal(result.addedCount, 0);

    const parsed = readJson(hooksFilePath);
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(
      hooks['beforeSubmitPrompt']?.some((entry) => entry['command'] === 'echo user-before'),
      true,
    );
    assert.equal(
      hooks['beforeSubmitPrompt']?.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes(CURSOR_MANAGED_HOOK_ID_PREFIX),
      ),
      false,
    );
    assert.equal(
      hooks['stop']?.some(
        (entry) =>
          typeof entry['command'] === 'string' &&
          (entry['command'] as string).includes(CURSOR_MANAGED_HOOK_ID_PREFIX),
      ),
      false,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks refuses malformed hooks schema without rewriting file', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-malformed-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      hooks: {
        beforeSubmitPrompt: 'invalid',
      },
    }),
    'utf8',
  );
  const before = readFileSync(hooksFilePath, 'utf8');

  try {
    assert.throws(
      () =>
        ensureManagedCursorHooksInstalled({
          hooksFilePath,
          relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
        }),
      /must be an array/,
    );
    assert.equal(readFileSync(hooksFilePath, 'utf8'), before);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks install handles missing files and empty managed event overrides', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-missing-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  try {
    const result = ensureManagedCursorHooksInstalled({
      hooksFilePath: `  ${hooksFilePath}  `,
      relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
      managedEvents: ['   ', ''],
    });
    assert.equal(result.changed, true);
    assert.equal(result.removedCount, 0);
    assert.equal(result.addedCount > 0, true);
    const parsed = readJson(hooksFilePath);
    assert.equal(parsed['version'], 1);
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(Array.isArray(hooks['beforeMCPExecution']), true);
    assert.equal(Array.isArray(hooks['afterMCPExecution']), true);
    assert.equal(hooks['beforeMCPTool'] === undefined, true);
    assert.equal(hooks['afterMCPTool'] === undefined, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks install migrates legacy mcp tool event names', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-legacy-mcp-tool-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      version: 1,
      hooks: {
        beforeMCPTool: [
          {
            command: `/usr/bin/env node /old/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:beforeMCPTool'`,
          },
          { command: 'echo keep-before' },
        ],
        afterMCPTool: [
          {
            command: `/usr/bin/env node /old/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:afterMCPTool'`,
          },
          { command: 'echo keep-after' },
        ],
      },
    }),
    'utf8',
  );

  try {
    const result = ensureManagedCursorHooksInstalled({
      hooksFilePath,
      relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
    });
    assert.equal(result.changed, true);
    const parsed = readJson(hooksFilePath);
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(hooks['beforeMCPTool'] === undefined, true);
    assert.equal(hooks['afterMCPTool'] === undefined, true);
    assert.equal(
      hooks['beforeMCPExecution']?.some((entry) => entry['command'] === 'echo keep-before'),
      true,
    );
    assert.equal(
      hooks['afterMCPExecution']?.some((entry) => entry['command'] === 'echo keep-after'),
      true,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks install supports explicit hooks path and root without hooks key', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-root-no-hooks-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      version: 7,
    }),
    'utf8',
  );
  try {
    const result = ensureManagedCursorHooksInstalled({
      hooksFilePath,
      relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
    });
    assert.equal(result.filePath, hooksFilePath);
    assert.equal(result.changed, true);
    const parsed = readJson(hooksFilePath);
    assert.equal(parsed['version'], 7);
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(Array.isArray(hooks['beforeSubmitPrompt']), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks parser rejects non-object roots and invalid hook entry shapes', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-parse-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  try {
    writeFileSync(hooksFilePath, JSON.stringify([]), 'utf8');
    assert.throws(
      () =>
        ensureManagedCursorHooksInstalled({
          hooksFilePath,
          relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
        }),
      /must contain a JSON object/,
    );

    writeFileSync(
      hooksFilePath,
      JSON.stringify({
        hooks: [],
      }),
      'utf8',
    );
    assert.throws(
      () =>
        ensureManagedCursorHooksInstalled({
          hooksFilePath,
          relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
        }),
      /invalid hooks shape/,
    );

    writeFileSync(
      hooksFilePath,
      JSON.stringify({
        hooks: {
          beforeSubmitPrompt: [123],
        },
      }),
      'utf8',
    );
    assert.throws(
      () =>
        ensureManagedCursorHooksInstalled({
          hooksFilePath,
          relayCommand: '/usr/bin/env node /new/cursor-hook-relay.ts',
        }),
      /must be an object/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks preserves entries without string commands while removing managed commands', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'cursor-managed-hooks-non-string-'));
  const hooksFilePath = join(workspace, 'hooks.json');
  writeFileSync(
    hooksFilePath,
    JSON.stringify({
      version: 1,
      hooks: {
        beforeSubmitPrompt: [
          { command: 123 },
          {
            command: `/usr/bin/env node /old/cursor-hook-relay.ts --managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:beforeSubmitPrompt'`,
          },
        ],
      },
    }),
    'utf8',
  );
  try {
    const result = uninstallManagedCursorHooks({
      hooksFilePath,
    });
    assert.equal(result.changed, true);
    assert.equal(result.removedCount, 1);
    const parsed = readJson(hooksFilePath);
    const hooks = parsed['hooks'] as Record<string, Array<Record<string, unknown>>>;
    assert.equal(hooks['beforeSubmitPrompt']?.[0]?.['command'], 123);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('cursor managed hooks relay command escapes empty process exec path and resolves script path', () => {
  const originalExecPath = process.execPath;
  try {
    Object.defineProperty(process, 'execPath', { value: '', configurable: true });
    const command = buildCursorManagedHookRelayCommand('cursor-hook-relay.ts');
    assert.equal(command.includes("/usr/bin/env ''"), true);
    assert.equal(command.includes('cursor-hook-relay.ts'), true);
  } finally {
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true });
  }
});
