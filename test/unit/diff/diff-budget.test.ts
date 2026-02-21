import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { DiffBudgetTracker } from '../../../src/diff/budget.ts';

void test('diff budget tracker enforces file/hunk/line/byte/runtime limits', () => {
  const tracker = new DiffBudgetTracker(
    {
      maxFiles: 1,
      maxHunks: 1,
      maxLines: 2,
      maxBytes: 5,
      maxRuntimeMs: 10,
    },
    1000,
  );

  assert.equal(tracker.takeFile().allowed, true);
  assert.equal(tracker.takeFile().allowed, false);
  assert.equal(tracker.limitReason(), 'max-files');

  const hunkTracker = new DiffBudgetTracker(
    {
      maxFiles: 10,
      maxHunks: 1,
      maxLines: 10,
      maxBytes: 100,
      maxRuntimeMs: 1000,
    },
    1000,
  );
  assert.equal(hunkTracker.takeHunk().allowed, true);
  assert.equal(hunkTracker.takeHunk().allowed, false);
  assert.equal(hunkTracker.limitReason(), 'max-hunks');

  const lineTracker = new DiffBudgetTracker(
    {
      maxFiles: 10,
      maxHunks: 10,
      maxLines: 2,
      maxBytes: 100,
      maxRuntimeMs: 1000,
    },
    1000,
  );
  assert.equal(lineTracker.takeLine().allowed, true);
  assert.equal(lineTracker.takeLine().allowed, true);
  assert.equal(lineTracker.takeLine().allowed, false);
  assert.equal(lineTracker.limitReason(), 'max-lines');

  const byteTracker = new DiffBudgetTracker(
    {
      maxFiles: 10,
      maxHunks: 10,
      maxLines: 10,
      maxBytes: 4,
      maxRuntimeMs: 1000,
    },
    1000,
  );
  assert.equal(byteTracker.addBytes(3).allowed, true);
  assert.equal(byteTracker.addBytes(2).allowed, false);
  assert.equal(byteTracker.limitReason(), 'max-bytes');

  const runtimeTracker = new DiffBudgetTracker(
    {
      maxFiles: 10,
      maxHunks: 10,
      maxLines: 10,
      maxBytes: 100,
      maxRuntimeMs: 10,
    },
    1000,
  );
  assert.equal(runtimeTracker.checkRuntime(1009).allowed, true);
  assert.equal(runtimeTracker.checkRuntime(1010).allowed, false);
  assert.equal(runtimeTracker.limitReason(), 'max-runtime-ms');
});

void test('diff budget tracker usage and elapsed are stable', () => {
  const tracker = new DiffBudgetTracker(
    {
      maxFiles: 5,
      maxHunks: 5,
      maxLines: 5,
      maxBytes: 20,
      maxRuntimeMs: 1000,
    },
    200,
  );
  tracker.takeFile();
  tracker.takeHunk();
  tracker.takeLine();
  tracker.addBytes(7);

  assert.deepEqual(tracker.usage(), {
    files: 1,
    hunks: 1,
    lines: 1,
    bytes: 7,
  });
  assert.equal(tracker.elapsedMs(250), 50);
});
