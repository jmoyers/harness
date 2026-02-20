import assert from 'node:assert/strict';
import { test } from 'bun:test';
import * as diff from '../src/diff/index.ts';

void test('diff public api exports builders and defaults', async () => {
  assert.equal(typeof diff.createDiffBuilder, 'function');
  assert.equal(typeof diff.createDiffChunker, 'function');
  assert.equal(diff.DEFAULT_DIFF_BUDGET.maxFiles > 0, true);
  assert.equal(diff.DEFAULT_CHUNK_POLICY.maxHunksPerChunk > 0, true);

  const builder = diff.createDiffBuilder();
  assert.equal(typeof builder.build, 'function');
  assert.equal(typeof builder.stream, 'function');

  const chunker = diff.createDiffChunker();
  assert.equal(typeof chunker.chunk, 'function');
  assert.equal(typeof chunker.streamChunks, 'function');
});
