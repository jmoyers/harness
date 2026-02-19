import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const INSTALL_SCRIPT_PATH = resolve(process.cwd(), 'install.sh');

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function createStubCommand(dirPath: string, name: string, scriptBody: string): void {
  const commandPath = join(dirPath, name);
  writeFileSync(commandPath, ['#!/bin/sh', scriptBody].join('\n'), 'utf8');
  chmodSync(commandPath, 0o755);
}

function runInstallScript(
  args: readonly string[],
  commandDir: string,
  extraEnv: Record<string, string | undefined> = {},
): RunResult {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: commandDir,
    HOME: commandDir,
    BUN_INSTALL: `${commandDir}/.bun`,
    HARNESS_INSTALL_INCLUDE_SYSTEM_RUST_PATH: '0',
    ...extraEnv,
  };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) {
      delete env[key];
    }
  }
  const result = spawnSync('/bin/bash', [INSTALL_SCRIPT_PATH, ...args], {
    env,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test('install.sh dry-run detects existing Bun/Rust/Harness and skips install', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-install-script-'));
  try {
    createStubCommand(
      dirPath,
      'bun',
      `
if [ "$1" = "--version" ]; then
  echo "1.3.9"
  exit 0
fi
echo "bun stub called with $*" >&2
exit 0
`,
    );
    createStubCommand(dirPath, 'cargo', 'exit 0');
    createStubCommand(dirPath, 'rustc', 'exit 0');
    createStubCommand(dirPath, 'harness', 'exit 0');
    const result = runInstallScript(['--dry-run'], dirPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Bun 1\.3\.9 already installed\./u);
    assert.match(result.stdout, /Rust toolchain already installed\./u);
    assert.match(result.stdout, /Harness is already installed/u);
    assert.doesNotMatch(result.stdout, /bun add -g --trust/u);
  } finally {
    rmSync(dirPath, { recursive: true, force: true });
  }
});

test('install.sh dry-run emits Bun upgrade and Rust bootstrap commands when needed', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-install-script-'));
  try {
    createStubCommand(
      dirPath,
      'bun',
      `
if [ "$1" = "--version" ]; then
  echo "1.2.8"
  exit 0
fi
exit 0
`,
    );
    createStubCommand(dirPath, 'curl', 'exit 0');
    createStubCommand(dirPath, 'unzip', 'exit 0');
    createStubCommand(dirPath, 'xz', 'exit 0');
    const result = runInstallScript(['--dry-run', '--skip-harness-install'], dirPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Bun 1\.2\.8 is older than required 1\.3\.9; upgrading\./u);
    assert.match(result.stdout, /\[dry-run\] curl -fsSL https:\/\/bun\.sh\/install \| bash/u);
    assert.match(
      result.stdout,
      /\[dry-run\] curl --proto '=https' --tlsv1\.2 -sSf https:\/\/sh\.rustup\.rs \| sh -s -- -y/u,
    );
    assert.match(result.stdout, /Skipping Harness package install by request\./u);
  } finally {
    rmSync(dirPath, { recursive: true, force: true });
  }
});

test('install.sh dry-run upgrades Bun when below required minimum', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-install-script-'));
  try {
    createStubCommand(
      dirPath,
      'bun',
      `
if [ "$1" = "--version" ]; then
  echo "1.2.8"
  exit 0
fi
exit 0
`,
    );
    createStubCommand(dirPath, 'cargo', 'exit 0');
    createStubCommand(dirPath, 'rustc', 'exit 0');
    createStubCommand(dirPath, 'curl', 'exit 0');
    createStubCommand(dirPath, 'unzip', 'exit 0');
    createStubCommand(dirPath, 'xz', 'exit 0');
    const result = runInstallScript(['--dry-run', '--skip-harness-install'], dirPath);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Bun 1\.2\.8 is older than required 1\.3\.9; upgrading\./u);
    assert.match(result.stdout, /\[dry-run\] curl -fsSL https:\/\/bun\.sh\/install \| bash/u);
  } finally {
    rmSync(dirPath, { recursive: true, force: true });
  }
});

test('install.sh rejects unknown arguments', () => {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-install-script-'));
  try {
    const result = runInstallScript(['--wat'], dirPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown argument: --wat/u);
  } finally {
    rmSync(dirPath, { recursive: true, force: true });
  }
});
