import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { streamServerInternalsForTest } from '../src/control-plane/stream-server.ts';

void test('stream server internals runWithConcurrencyLimit handles sparse values and empty lists', async () => {
  let emptyCallCount = 0;
  await streamServerInternalsForTest.runWithConcurrencyLimit([], 2, () => {
    emptyCallCount += 1;
    return Promise.resolve();
  });
  assert.equal(emptyCallCount, 0);

  const observed: number[] = [];
  await streamServerInternalsForTest.runWithConcurrencyLimit([1, undefined, 3], 2, (value) => {
    if (value !== undefined) {
      observed.push(value);
    }
    return Promise.resolve();
  });
  observed.sort((left, right) => left - right);
  assert.deepEqual(observed, [1, 3]);
});

void test('stream server internals gitSummaryEqual compares all summary fields', () => {
  const left = {
    branch: 'main',
    changedFiles: 2,
    additions: 3,
    deletions: 4
  };
  const right = {
    branch: 'main',
    changedFiles: 2,
    additions: 3,
    deletions: 4
  };
  const different = {
    branch: 'main',
    changedFiles: 9,
    additions: 3,
    deletions: 4
  };
  assert.equal(streamServerInternalsForTest.gitSummaryEqual(left, right), true);
  assert.equal(streamServerInternalsForTest.gitSummaryEqual(left, different), false);
});

void test('stream server internals gitRepositorySnapshotEqual compares all repository snapshot fields', () => {
  const left = {
    normalizedRemoteUrl: 'https://github.com/example/harness',
    commitCount: 10,
    lastCommitAt: '2026-01-01T00:00:00.000Z',
    shortCommitHash: 'abc1234',
    inferredName: 'harness',
    defaultBranch: 'main'
  };
  const right = {
    normalizedRemoteUrl: 'https://github.com/example/harness',
    commitCount: 10,
    lastCommitAt: '2026-01-01T00:00:00.000Z',
    shortCommitHash: 'abc1234',
    inferredName: 'harness',
    defaultBranch: 'main'
  };
  const different = {
    normalizedRemoteUrl: 'https://github.com/example/harness',
    commitCount: 11,
    lastCommitAt: '2026-01-01T00:00:00.000Z',
    shortCommitHash: 'abc1234',
    inferredName: 'harness',
    defaultBranch: 'main'
  };
  assert.equal(streamServerInternalsForTest.gitRepositorySnapshotEqual(left, right), true);
  assert.equal(streamServerInternalsForTest.gitRepositorySnapshotEqual(left, different), false);
});
