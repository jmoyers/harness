import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { DiffBudgetTracker } from '../src/diff/budget.ts';
import type { DiffBudget } from '../src/diff/types.ts';
import { GitDiffPatchParser } from '../src/diff/git-parse.ts';

function createTracker(
  limitOverrides: Partial<DiffBudget> = {},
) {
  return new DiffBudgetTracker({
    maxFiles: limitOverrides.maxFiles ?? 100,
    maxHunks: limitOverrides.maxHunks ?? 100,
    maxLines: limitOverrides.maxLines ?? 1000,
    maxBytes: limitOverrides.maxBytes ?? 1024 * 1024,
    maxRuntimeMs: limitOverrides.maxRuntimeMs ?? 1000,
  });
}

void test('git diff patch parser normalizes file and hunk records with stable ids', () => {
  const seenHunks: string[] = [];
  const seenFiles: string[] = [];
  const parser = new GitDiffPatchParser({
    includeGenerated: true,
    includeBinary: true,
    budget: createTracker(),
    onHunk: (_fileId, hunk) => {
      seenHunks.push(hunk.hunkId);
    },
    onFile: (file) => {
      seenFiles.push(file.fileId);
    },
  });

  const lines = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,2 @@',
    ' const x = 1;',
    '+const y = 2;',
  ];
  for (const line of lines) {
    assert.equal(parser.pushLine(line), true);
  }
  const result = parser.finish();
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]?.newPath, 'src/a.ts');
  assert.equal(result.files[0]?.changeType, 'modified');
  assert.equal(result.files[0]?.hunks.length, 1);
  assert.equal(result.files[0]?.hunks[0]?.lineCount, 2);
  assert.equal(seenHunks.length, 1);
  assert.equal(seenFiles.length, 1);
  assert.equal(result.totals.filesChanged, 1);
  assert.equal(result.limitReason, 'none');
});

void test('git diff patch parser filters generated and binary files by option', () => {
  const parser = new GitDiffPatchParser({
    includeGenerated: false,
    includeBinary: false,
    budget: createTracker(),
  });

  const lines = [
    'diff --git a/dist/out.js b/dist/out.js',
    'index 1..2 100644',
    '--- a/dist/out.js',
    '+++ b/dist/out.js',
    '@@ -1,1 +1,2 @@',
    ' const x = 1;',
    '+const y = 2;',
    'diff --git a/assets/a.png b/assets/a.png',
    'index 1..2 100644',
    'Binary files a/assets/a.png and b/assets/a.png differ',
  ];
  for (const line of lines) {
    assert.equal(parser.pushLine(line), true);
  }
  const result = parser.finish();
  assert.equal(result.files.length, 0);
  assert.equal(result.skippedFiles, 2);
  assert.equal(result.limitReason, 'none');
});

void test('git diff patch parser halts when budget limit is reached', () => {
  const parser = new GitDiffPatchParser({
    includeGenerated: true,
    includeBinary: true,
    budget: createTracker({
      maxFiles: 1,
      maxHunks: 1,
      maxLines: 1,
    }),
  });

  const lines = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,2 @@',
    ' const x = 1;',
    '+const y = 2;',
  ];
  let keepGoing = true;
  for (const line of lines) {
    keepGoing = parser.pushLine(line);
    if (!keepGoing) {
      break;
    }
  }
  assert.equal(keepGoing, false);
  const result = parser.finish();
  assert.equal(result.limitReason, 'max-lines');
  assert.equal(result.truncatedFiles >= 1, true);
});

void test('git diff patch parser recognizes rename and type-change hints', () => {
  const parser = new GitDiffPatchParser({
    includeGenerated: true,
    includeBinary: true,
    budget: createTracker(),
  });
  const lines = [
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 100%',
    'rename from src/old.ts',
    'rename to src/new.ts',
    'old mode 100644',
    'new mode 100755',
    '@@ -1,1 +1,1 @@',
    '-const oldName = 1;',
    '+const newName = 1;',
  ];
  for (const line of lines) {
    assert.equal(parser.pushLine(line), true);
  }
  const result = parser.finish();
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]?.changeType, 'renamed');
  assert.equal(result.files[0]?.oldPath, 'src/old.ts');
  assert.equal(result.files[0]?.newPath, 'src/new.ts');
});
