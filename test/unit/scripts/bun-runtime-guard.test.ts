import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error runtime script is JavaScript-only by design
import * as bunRuntimeGuard from '../../../scripts/bun-runtime-guard.js';

const { BUN_INSTALL_DOCS_URL, ensureBunAvailable, formatBunRequiredMessage, isBunAvailable } =
  bunRuntimeGuard;

interface FakeStderr {
  text: string;
  write(value: string): boolean;
}

function createExecutableCommand(exitCode: number): { dirPath: string; commandPath: string } {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-bun-guard-'));
  const commandPath = join(dirPath, 'bun');
  writeFileSync(commandPath, ['#!/bin/sh', `exit ${String(exitCode)}`].join('\n'), 'utf8');
  chmodSync(commandPath, 0o755);
  return { dirPath, commandPath };
}

function createFakeStderr(): FakeStderr {
  return {
    text: '',
    write(value: string) {
      this.text += value;
      return true;
    },
  };
}

test('formatBunRequiredMessage returns the install guidance', () => {
  const message = formatBunRequiredMessage();
  assert.match(message, /\[harness\] Bun is required to install and run Harness\./u);
  assert.match(message, new RegExp(BUN_INSTALL_DOCS_URL.replaceAll('.', '\\.'), 'u'));
  assert.match(message, /then verify: bun --version/u);
});

test('isBunAvailable reports command availability from executable status', () => {
  const available = createExecutableCommand(0);
  const unavailable = createExecutableCommand(1);
  try {
    assert.equal(isBunAvailable(available.commandPath), true);
    assert.equal(isBunAvailable(unavailable.commandPath), false);
  } finally {
    rmSync(available.dirPath, { recursive: true, force: true });
    rmSync(unavailable.dirPath, { recursive: true, force: true });
  }
});

test('ensureBunAvailable succeeds without writing error output', () => {
  const available = createExecutableCommand(0);
  const stderr = createFakeStderr();
  let onMissingCalled = false;
  try {
    const result = ensureBunAvailable({
      command: available.commandPath,
      stderr,
      onMissing: () => {
        onMissingCalled = true;
      },
    });
    assert.equal(result, true);
    assert.equal(stderr.text, '');
    assert.equal(onMissingCalled, false);
  } finally {
    rmSync(available.dirPath, { recursive: true, force: true });
  }
});

test('ensureBunAvailable writes guidance and runs callback when missing', () => {
  const stderr = createFakeStderr();
  let onMissingCalled = false;
  const result = ensureBunAvailable({
    command: '/path/to/missing/bun',
    stderr,
    onMissing: () => {
      onMissingCalled = true;
    },
  });
  assert.equal(result, false);
  assert.equal(onMissingCalled, true);
  assert.equal(stderr.text, `${formatBunRequiredMessage()}\n`);
});
