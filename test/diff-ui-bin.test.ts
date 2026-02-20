import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

function runHarnessBin(
  args: readonly string[],
  cwd: string,
  envOverrides: Record<string, string | undefined> = {},
): RunResult {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageShape;
  const binPath = packageJson.bin?.['harness'];
  if (typeof binPath !== 'string') {
    throw new Error('missing harness bin path');
  }
  const resolvedBinPath = resolve(process.cwd(), binPath);
  const result = spawnSync(process.execPath, [resolvedBinPath, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: {
      ...process.env,
      HARNESS_BUN_COMMAND: process.execPath,
      HARNESS_SUPPRESS_BUN_MIGRATION_HINT: '1',
      ...envOverrides,
    },
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test('package bin exposes harness command with diff as a subcommand', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageShape;
  assert.equal(packageJson.bin?.['harness'], 'scripts/harness-bin.js');
  assert.equal(packageJson.bin?.['harness-diff'], undefined);
});

test('harness diff subcommand renders help and validates flags', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-diff-subcommand-help-'));

  const help = runHarnessBin(['diff', '--help'], workspace);
  assert.equal(help.code, 0);
  assert.equal(help.stdout.includes('usage: harness diff [options]'), true);

  const bad = runHarnessBin(['diff', '--definitely-unknown-option'], workspace);
  assert.equal(bad.code, 1);
  assert.equal(bad.stderr.includes('unknown option'), true);
});

test('harness diff subcommand runs against a git repository', () => {
  const repo = createRepo('harness-diff-subcommand-repo-');
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');

  const result = runHarnessBin(
    ['diff', '--width', '90', '--height', '10', '--theme', 'plain'],
    repo,
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes('[diff] mode=unstaged'), true);
  assert.equal(result.stdout.includes('File 1/1: src.ts'), true);
});

test('harness diff subcommand ignores stale inherited HARNESS_INVOKE_CWD', () => {
  const cleanRepo = createRepo('harness-diff-subcommand-clean-repo-');
  const dirtyRepo = createRepo('harness-diff-subcommand-dirty-repo-');
  writeFileSync(join(dirtyRepo, 'src.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');

  const result = runHarnessBin(
    ['diff', '--width', '90', '--height', '10', '--theme', 'plain'],
    cleanRepo,
    {
      HARNESS_INVOKE_CWD: dirtyRepo,
    },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes('files=0'), true);
});
