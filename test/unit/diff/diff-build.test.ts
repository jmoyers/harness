import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { createDiffBuilder } from '../../../src/diff/build.ts';

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function createRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'diff-build@example.com']);
  runGit(repo, ['config', 'user.name', 'Diff Build']);
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\n', 'utf8');
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'initial']);
  return repo;
}

void test('diff builder build returns normalized diff and diagnostics', async () => {
  const repo = createRepo('harness-diff-build-');
  mkdirSync(join(repo, 'dist'), {
    recursive: true,
  });
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');
  writeFileSync(join(repo, 'dist', 'bundle.min.js'), 'console.log(1)\n', 'utf8');

  const builder = createDiffBuilder();
  const result = await builder.build({
    cwd: repo,
    mode: 'unstaged',
    includeGenerated: false,
    includeBinary: false,
    budget: {
      maxFiles: 100,
      maxHunks: 100,
      maxLines: 1000,
      maxBytes: 1024 * 1024,
      maxRuntimeMs: 30_000,
    },
  });

  assert.equal(result.diff.files.length, 1);
  assert.equal(result.diff.files[0]?.newPath, 'src.ts');
  assert.equal(result.diff.coverage.complete, true);
  assert.equal(result.diff.spec.mode, 'unstaged');
  assert.equal(result.diff.spec.diffId.length > 10, true);
  assert.equal(result.diagnostics.elapsedMs >= 0, true);
});

void test('diff builder stream emits lifecycle, hunk/file events, and complete envelope', async () => {
  const repo = createRepo('harness-diff-stream-');
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');

  const builder = createDiffBuilder();
  const seen: string[] = [];
  for await (const event of builder.stream({
    cwd: repo,
    mode: 'unstaged',
    includeGenerated: true,
    includeBinary: true,
    budget: {
      maxFiles: 100,
      maxHunks: 100,
      maxLines: 1000,
      maxBytes: 1024 * 1024,
      maxRuntimeMs: 30_000,
    },
  })) {
    seen.push(event.type);
  }
  assert.equal(seen[0], 'start');
  assert.equal(seen.includes('hunk'), true);
  assert.equal(seen.includes('file'), true);
  assert.equal(seen.includes('coverage'), true);
  assert.equal(seen.at(-1), 'complete');
});

void test('diff builder marks truncated coverage when budget is tight', async () => {
  const repo = createRepo('harness-diff-budget-');
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\nconst y = 2;\nconst z = 3;\n', 'utf8');
  const builder = createDiffBuilder();
  const result = await builder.build({
    cwd: repo,
    mode: 'unstaged',
    budget: {
      maxFiles: 1,
      maxHunks: 1,
      maxLines: 1,
      maxBytes: 1024,
      maxRuntimeMs: 30_000,
    },
  });
  assert.equal(result.diff.coverage.truncated, true);
  assert.notEqual(result.diff.coverage.reason, 'none');
});

void test('diff builder supports range mode refs', async () => {
  const repo = createRepo('harness-diff-range-');
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');
  runGit(repo, ['add', 'src.ts']);
  runGit(repo, ['commit', '-m', 'second']);

  const builder = createDiffBuilder();
  const result = await builder.build({
    cwd: repo,
    mode: 'range',
    baseRef: 'HEAD~1',
    headRef: 'HEAD',
    budget: {
      maxFiles: 100,
      maxHunks: 100,
      maxLines: 1000,
      maxBytes: 1024 * 1024,
      maxRuntimeMs: 30_000,
    },
  });
  assert.equal(result.diff.spec.mode, 'range');
  assert.equal(result.diff.spec.baseRef, 'HEAD~1');
  assert.equal(result.diff.spec.headRef, 'HEAD');
  assert.equal(result.diff.files.length >= 1, true);
});

void test('diff builder resolves merge-base when range mode omits explicit base ref', async () => {
  const repo = createRepo('harness-diff-range-auto-base-');
  runGit(repo, ['branch', '-M', 'main']);
  runGit(repo, ['checkout', '-b', 'feature/diff-auto-base']);
  writeFileSync(join(repo, 'src.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');
  runGit(repo, ['add', 'src.ts']);
  runGit(repo, ['commit', '-m', 'feature-update']);

  const expectedMergeBase = runGit(repo, ['merge-base', 'main', 'HEAD']);
  const builder = createDiffBuilder();
  const result = await builder.build({
    cwd: repo,
    mode: 'range',
    headRef: 'HEAD',
    budget: {
      maxFiles: 100,
      maxHunks: 100,
      maxLines: 1000,
      maxBytes: 1024 * 1024,
      maxRuntimeMs: 30_000,
    },
  });
  assert.equal(result.diff.spec.mode, 'range');
  assert.equal(result.diff.spec.baseRef, expectedMergeBase);
  assert.equal(result.diff.spec.headRef, 'HEAD');
  assert.equal(result.diff.files.length >= 1, true);
});

void test('diff builder stream surfaces failures through async iterator', async () => {
  const builder = createDiffBuilder();
  let thrown: unknown = null;
  try {
    for await (const _event of builder.stream({
      cwd: '/definitely/missing/path',
      mode: 'unstaged',
      budget: {
        maxFiles: 10,
        maxHunks: 10,
        maxLines: 10,
        maxBytes: 1024,
        maxRuntimeMs: 1000,
      },
    })) {
      // no-op
    }
  } catch (error: unknown) {
    thrown = error;
  }
  assert.notEqual(thrown, null);
});
