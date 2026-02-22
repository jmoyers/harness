import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createDiffChunker } from '../../../src/diff/chunker.ts';
import type { DiffHunk, NormalizedDiff } from '../../../src/diff/types.ts';

function hunk(id: string, addCount = 1, delCount = 0): DiffHunk {
  return {
    hunkId: id,
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1 + addCount,
    header: '@@ -1,1 +1,2 @@',
    lines: [
      {
        kind: 'context',
        oldLine: 1,
        newLine: 1,
        text: 'const x = 1;',
      },
      {
        kind: 'add',
        oldLine: null,
        newLine: 2,
        text: 'const y = 2;',
      },
    ],
    lineCount: 2,
    addCount,
    delCount,
  };
}

function diffWithHunks(fileHunks: readonly DiffHunk[]): NormalizedDiff {
  return {
    spec: {
      diffId: 'diff-1',
      mode: 'unstaged',
      baseRef: null,
      headRef: null,
      generatedAt: new Date(0).toISOString(),
    },
    files: [
      {
        fileId: 'file-1',
        changeType: 'modified',
        oldPath: 'src/a.ts',
        newPath: 'src/a.ts',
        language: 'typescript',
        isBinary: false,
        isGenerated: false,
        isTooLarge: false,
        additions: fileHunks.reduce((sum, entry) => sum + entry.addCount, 0),
        deletions: fileHunks.reduce((sum, entry) => sum + entry.delCount, 0),
        hunks: fileHunks,
      },
      {
        fileId: 'file-binary',
        changeType: 'binary',
        oldPath: 'a.png',
        newPath: 'a.png',
        language: null,
        isBinary: true,
        isGenerated: false,
        isTooLarge: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      },
    ],
    totals: {
      filesChanged: 2,
      additions: 1,
      deletions: 0,
      binaryFiles: 1,
      generatedFiles: 0,
      hunks: fileHunks.length,
      lines: fileHunks.reduce((sum, entry) => sum + entry.lineCount, 0),
    },
    coverage: {
      complete: true,
      truncated: false,
      skippedFiles: 0,
      truncatedFiles: 0,
      reason: 'none',
    },
  };
}

void test('diff chunker creates deterministic chunk sets and skips binary files', async () => {
  const chunker = createDiffChunker();
  const diff = diffWithHunks([hunk('h1'), hunk('h2'), hunk('h3')]);
  const chunks = chunker.chunk(diff, {
    maxHunksPerChunk: 2,
    maxLinesPerChunk: 99,
    maxApproxTokensPerChunk: 999,
  });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.hunkIds.join(','), 'h1,h2');
  assert.equal(chunks[1]?.hunkIds.join(','), 'h3');
  assert.equal(chunks[0]?.totalForFile, 2);
  assert.equal(chunks[0]?.path, 'src/a.ts');

  const streamed: string[] = [];
  for await (const chunk of chunker.streamChunks(diff, {
    maxHunksPerChunk: 2,
    maxLinesPerChunk: 99,
    maxApproxTokensPerChunk: 999,
  })) {
    streamed.push(chunk.chunkId);
  }
  assert.deepEqual(
    streamed,
    chunks.map((entry) => entry.chunkId),
  );
});

void test('diff chunker flushes by lines/tokens and normalizes non-positive policy values', () => {
  const chunker = createDiffChunker();
  const diff = diffWithHunks([hunk('h1'), hunk('h2'), hunk('h3')]);
  const chunks = chunker.chunk(diff, {
    maxHunksPerChunk: 0,
    maxLinesPerChunk: 1,
    maxApproxTokensPerChunk: 1,
  });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]?.sequence, 1);
  assert.equal(chunks[1]?.sequence, 2);
  assert.equal(chunks[2]?.sequence, 3);
});

void test('diff chunker falls back to fileId path when paths are unavailable', () => {
  const chunker = createDiffChunker();
  const diff = diffWithHunks([hunk('h1')]);
  const file = diff.files[0]!;
  const withNullPath = {
    ...diff,
    files: [
      {
        ...file,
        oldPath: null,
        newPath: null,
      },
    ],
  };
  const chunks = chunker.chunk(withNullPath, {
    maxHunksPerChunk: 1,
    maxLinesPerChunk: 999,
    maxApproxTokensPerChunk: 999,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.path, file.fileId);
});

void test('diff chunker flushes pre-existing chunk when next hunk exceeds line budget', () => {
  const chunker = createDiffChunker();
  const diff = diffWithHunks([hunk('h1'), hunk('h2')]);
  const chunks = chunker.chunk(diff, {
    maxHunksPerChunk: 10,
    maxLinesPerChunk: 3,
    maxApproxTokensPerChunk: 9999,
  });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.hunkIds.join(','), 'h1');
  assert.equal(chunks[1]?.hunkIds.join(','), 'h2');
});
