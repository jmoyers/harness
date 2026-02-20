import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  computeDiffChunkId,
  computeDiffFileId,
  computeDiffHunkId,
  computeDiffId,
  serializeHunkLinesForHash,
} from '../src/diff/hash.ts';
import type { DiffFile } from '../src/diff/types.ts';

void test('hash helpers are deterministic and sensitive to changes', () => {
  const fileIdA = computeDiffFileId('modified', 'src/a.ts', 'src/a.ts');
  const fileIdB = computeDiffFileId('modified', 'src/a.ts', 'src/a.ts');
  const fileIdC = computeDiffFileId('modified', 'src/a.ts', 'src/b.ts');
  assert.equal(fileIdA, fileIdB);
  assert.notEqual(fileIdA, fileIdC);

  const lines = serializeHunkLinesForHash([
    {
      kind: 'context',
      oldLine: 1,
      newLine: 1,
      text: 'x',
    },
    {
      kind: 'add',
      oldLine: null,
      newLine: 2,
      text: 'y',
    },
  ]);
  const hunkA = computeDiffHunkId(fileIdA, '@@ -1,1 +1,2 @@', lines);
  const hunkB = computeDiffHunkId(fileIdA, '@@ -1,1 +1,2 @@', lines);
  const hunkC = computeDiffHunkId(fileIdA, '@@ -1,1 +1,3 @@', lines);
  assert.equal(hunkA, hunkB);
  assert.notEqual(hunkA, hunkC);

  const chunkA = computeDiffChunkId(fileIdA, 1, [hunkA], '8:800:4000');
  const chunkB = computeDiffChunkId(fileIdA, 1, [hunkA], '8:800:4000');
  const chunkC = computeDiffChunkId(fileIdA, 2, [hunkA], '8:800:4000');
  assert.equal(chunkA, chunkB);
  assert.notEqual(chunkA, chunkC);
});

void test('computeDiffId tracks mode refs and file/hunk identity', () => {
  const files: DiffFile[] = [
    {
      fileId: 'file-1',
      changeType: 'modified',
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
      language: 'typescript',
      isBinary: false,
      isGenerated: false,
      isTooLarge: false,
      additions: 1,
      deletions: 0,
      hunks: [
        {
          hunkId: 'hunk-1',
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 2,
          header: '@@ -1,1 +1,2 @@',
          lines: [],
          lineCount: 0,
          addCount: 0,
          delCount: 0,
        },
      ],
    },
  ];
  const a = computeDiffId('range', 'main', 'HEAD', files);
  const b = computeDiffId('range', 'main', 'HEAD', files);
  const c = computeDiffId('range', 'develop', 'HEAD', files);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
