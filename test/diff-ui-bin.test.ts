import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';

interface PackageShape {
  readonly bin?: Record<string, string>;
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function createRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'diff-bin@example.com']);
  runGit(repo, ['config', 'user.name', 'Diff Bin']);
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\n', 'utf8');
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'initial']);
  return repo;
}

function runDiffBin(args: readonly string[], cwd: string): RunResult {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageShape;
  const binPath = packageJson.bin?.['harness-diff'];
  if (typeof binPath !== 'string') {
    throw new Error('missing harness-diff bin path');
  }
  const resolvedBinPath = resolve(process.cwd(), binPath);

  const command =
    process.platform === 'win32'
      ? {
          file: 'bun',
          argv: [resolvedBinPath, ...args],
        }
      : {
          file: resolvedBinPath,
          argv: [...args],
        };

  const result = spawnSync(command.file, command.argv, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: process.env,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test('harness-diff bin is bun-native and executable', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageShape;
  assert.equal(packageJson.bin?.['harness-diff'], 'scripts/harness-diff.ts');

  const scriptPath = resolve(process.cwd(), 'scripts/harness-diff.ts');
  chmodSync(scriptPath, 0o755);
  const scriptText = readFileSync(scriptPath, 'utf8');
  assert.equal(scriptText.startsWith('#!/usr/bin/env bun\n'), true);
});

test('harness-diff bin renders help and validates flags', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-diff-bin-help-'));

  const help = runDiffBin(['--help'], workspace);
  assert.equal(help.code, 0);
  assert.equal(help.stdout.includes('usage: harness-diff [options]'), true);

  const bad = runDiffBin(['--definitely-unknown-option'], workspace);
  assert.equal(bad.code, 1);
  assert.equal(bad.stderr.includes('unknown option'), true);
});

test('harness-diff bin runs against a git repository', () => {
  const repo = createRepo('harness-diff-bin-repo-');
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');

  const result = runDiffBin(['--width', '90', '--height', '10', '--theme', 'plain'], repo);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes('[diff] mode=unstaged'), true);
  assert.equal(result.stdout.includes('File 1/1: src.ts'), true);
});
