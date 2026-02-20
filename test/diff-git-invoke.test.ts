import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { buildGitDiffArgs, readGitDiffPreflight, streamGitLines } from '../src/diff/git-invoke.ts';
import type { GitDiffInvocationOptions } from '../src/diff/git-invoke.ts';

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function createTempRepository(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'diff-test@example.com']);
  runGit(repo, ['config', 'user.name', 'Diff Test']);
  writeFileSync(join(repo, 'file.txt'), 'line-1\n', 'utf8');
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'initial']);
  return repo;
}

function createLargeRepositoryForTimeout(prefix: string): string {
  const repo = createTempRepository(prefix);
  const largePayload = `${'a'.repeat(1024)}\n`.repeat(20_000);
  writeFileSync(join(repo, 'large.txt'), largePayload, 'utf8');
  return repo;
}

void test('buildGitDiffArgs resolves mode-specific arguments and validation', () => {
  const unstaged = buildGitDiffArgs(
    {
      cwd: '/tmp',
      mode: 'unstaged',
      baseRef: null,
      headRef: null,
      noRenames: true,
      renameLimit: null,
    },
    'patch',
  );
  assert.equal(unstaged.includes('--patch'), true);
  assert.equal(unstaged.includes('--no-renames'), true);

  const staged = buildGitDiffArgs(
    {
      cwd: '/tmp',
      mode: 'staged',
      baseRef: null,
      headRef: null,
      noRenames: false,
      renameLimit: 50,
    },
    'name-status',
  );
  assert.equal(staged.includes('--cached'), true);
  assert.equal(staged.includes('-l50'), true);

  assert.throws(
    () =>
      buildGitDiffArgs(
        {
          cwd: '/tmp',
          mode: 'range',
          baseRef: null,
          headRef: 'HEAD',
          noRenames: true,
          renameLimit: null,
        },
        'numstat',
      ),
    /range diff requires baseRef and headRef/u,
  );
});

void test('streamGitLines reads git stdout and supports callback abort', async () => {
  const lines: string[] = [];
  const normal = await streamGitLines({
    cwd: process.cwd(),
    args: ['--version'],
    timeoutMs: 5000,
    onLine: (line) => {
      lines.push(line);
    },
  });
  assert.equal(normal.exitCode, 0);
  assert.equal(lines.length >= 1, true);
  assert.equal(normal.bytesRead > 0, true);

  const aborted = await streamGitLines({
    cwd: process.cwd(),
    args: ['--version'],
    timeoutMs: 5000,
    onLine: () => false,
  });
  assert.equal(aborted.aborted, true);

  const abortedByBytes = await streamGitLines({
    cwd: process.cwd(),
    args: ['--version'],
    timeoutMs: 5000,
    onBytes: () => false,
  });
  assert.equal(abortedByBytes.aborted, true);

  const invalid = await streamGitLines({
    cwd: process.cwd(),
    args: ['definitely-invalid-subcommand'],
    timeoutMs: 5000,
  });
  assert.equal(invalid.exitCode !== 0, true);
  assert.equal(invalid.stderr.length > 0, true);
});

void test('readGitDiffPreflight reports unstaged, staged, and range metadata', async () => {
  const repo = createTempRepository('harness-diff-preflight-');

  writeFileSync(join(repo, 'file.txt'), 'line-1\nline-2\n', 'utf8');
  const unstagedOptions: GitDiffInvocationOptions = {
    cwd: repo,
    mode: 'unstaged',
    baseRef: null,
    headRef: null,
    noRenames: true,
    renameLimit: null,
  };
  const unstaged = await readGitDiffPreflight(unstagedOptions, 5000);
  assert.equal(unstaged.filesChanged, 1);
  assert.equal(unstaged.additions >= 1, true);

  runGit(repo, ['add', 'file.txt']);
  const staged = await readGitDiffPreflight(
    {
      ...unstagedOptions,
      mode: 'staged',
    },
    5000,
  );
  assert.equal(staged.filesChanged, 1);

  runGit(repo, ['commit', '-m', 'update']);
  writeFileSync(join(repo, 'file.txt'), 'line-1\nline-2\nline-3\n', 'utf8');
  runGit(repo, ['add', 'file.txt']);
  runGit(repo, ['commit', '-m', 'update-2']);
  const range = await readGitDiffPreflight(
    {
      ...unstagedOptions,
      mode: 'range',
      baseRef: 'HEAD~1',
      headRef: 'HEAD',
    },
    5000,
  );
  assert.equal(range.filesChanged, 1);
  assert.equal(range.additions >= 1, true);
});

void test('readGitDiffPreflight tracks binary entries and surfaces git invocation failures', async () => {
  const repo = createTempRepository('harness-diff-preflight-binary-');
  writeFileSync(join(repo, 'image.bin'), Buffer.from([0, 1, 2, 3, 4]));
  runGit(repo, ['add', 'image.bin']);

  const staged = await readGitDiffPreflight(
    {
      cwd: repo,
      mode: 'staged',
      baseRef: null,
      headRef: null,
      noRenames: true,
      renameLimit: null,
    },
    5000,
  );
  assert.equal(staged.filesChanged >= 1, true);
  assert.equal(staged.binaryFiles >= 1, true);

  await assert.rejects(
    () =>
      readGitDiffPreflight(
        {
          cwd: '/definitely/missing/path',
          mode: 'unstaged',
          baseRef: null,
          headRef: null,
          noRenames: true,
          renameLimit: null,
        },
        5000,
      ),
    /ENOENT|spawn/u,
  );

  await assert.rejects(
    () =>
      readGitDiffPreflight(
        {
          cwd: repo,
          mode: 'range',
          baseRef: 'this-ref-does-not-exist',
          headRef: 'HEAD',
          noRenames: true,
          renameLimit: null,
        },
        5000,
      ),
    /git diff --name-status failed/u,
  );
});

void test('streamGitLines marks timedOut when timeout budget is exhausted', async () => {
  const repo = createLargeRepositoryForTimeout('harness-diff-timeout-');
  const result = await streamGitLines({
    cwd: repo,
    args: ['diff', '--patch'],
    timeoutMs: 1,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, true);
});
