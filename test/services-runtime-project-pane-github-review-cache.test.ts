import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { ProjectPaneGitHubReviewSummary } from '../src/mux/project-pane-github-review.ts';
import { RuntimeProjectPaneGitHubReviewCache } from '../src/services/runtime-project-pane-github-review-cache.ts';

interface QueuedLatestOp {
  readonly key: string;
  readonly label: string;
  readonly task: (options: { readonly signal: AbortSignal }) => Promise<void>;
}

function readySummary(branchName: string): ProjectPaneGitHubReviewSummary {
  return {
    status: 'ready',
    branchName,
    branchSource: 'current',
    pr: null,
    openThreads: [],
    resolvedThreads: [],
    errorMessage: null,
  };
}

void test('runtime project pane GitHub review cache serves loading then ready and skips fresh TTL hits', async () => {
  let nowMs = 1_000;
  const queued: QueuedLatestOp[] = [];
  const updates: Array<{ directoryId: string; review: ProjectPaneGitHubReviewSummary }> = [];
  const loadCalls: Array<{ directoryId: string; forceRefresh: boolean | undefined }> = [];

  const cache = new RuntimeProjectPaneGitHubReviewCache({
    ttlMs: 1_000,
    refreshIntervalMs: 0,
    queueLatestControlPlaneOp: (key, task, label) => {
      queued.push({ key, task, label });
    },
    loadReview: async (directoryId, options) => {
      loadCalls.push({
        directoryId,
        forceRefresh: options.forceRefresh,
      });
      return readySummary(`branch-${String(loadCalls.length)}`);
    },
    onUpdate: (directoryId, review) => {
      updates.push({ directoryId, review });
    },
    formatErrorMessage: (error) => String(error),
    nowMs: () => nowMs,
  });

  cache.request('dir-a');
  assert.equal(queued.length, 1);
  assert.deepEqual(
    updates.map((entry) => entry.review.status),
    ['loading'],
  );
  assert.equal(queued[0]?.key, 'project-pane-github-review:dir-a');
  assert.equal(queued[0]?.label, 'project-pane-github-review');

  await queued[0]!.task({
    signal: new AbortController().signal,
  });
  assert.deepEqual(loadCalls, [
    {
      directoryId: 'dir-a',
      forceRefresh: false,
    },
  ]);
  assert.deepEqual(
    updates.map((entry) => entry.review.status),
    ['loading', 'ready'],
  );
  assert.equal(updates[1]?.review.branchName, 'branch-1');

  nowMs += 200;
  cache.request('dir-a');
  assert.equal(queued.length, 1);
  assert.deepEqual(loadCalls, [
    {
      directoryId: 'dir-a',
      forceRefresh: false,
    },
  ]);
});

void test('runtime project pane GitHub review cache deduplicates in-flight requests and refreshes after TTL expiry', async () => {
  let nowMs = 10_000;
  const queued: QueuedLatestOp[] = [];
  const updates: Array<{ directoryId: string; review: ProjectPaneGitHubReviewSummary }> = [];
  let resolveLoad = (_value: ProjectPaneGitHubReviewSummary): void => {};
  let loadCount = 0;

  const cache = new RuntimeProjectPaneGitHubReviewCache({
    ttlMs: 100,
    refreshIntervalMs: 0,
    queueLatestControlPlaneOp: (key, task, label) => {
      queued.push({ key, task, label });
    },
    loadReview: async (_directoryId, _options) =>
      await new Promise<ProjectPaneGitHubReviewSummary>((resolve) => {
        loadCount += 1;
        resolveLoad = (value) => {
          resolve(value);
        };
      }),
    onUpdate: (directoryId, review) => {
      updates.push({ directoryId, review });
    },
    formatErrorMessage: (error) => String(error),
    nowMs: () => nowMs,
  });

  cache.request('dir-a');
  cache.request('dir-a');
  assert.equal(queued.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.review.status, 'loading');

  const runFirst = queued[0]?.task({
    signal: new AbortController().signal,
  });
  resolveLoad(readySummary('stable-branch'));
  await runFirst;
  assert.equal(loadCount, 1);
  assert.equal(updates.at(-1)?.review.status, 'ready');

  nowMs += 250;
  cache.request('dir-a');
  assert.equal(queued.length, 2);
  assert.equal(updates.at(-1)?.review.status, 'loading');
});

void test('runtime project pane GitHub review cache emits error state and preserves previous branch context', async () => {
  const queued: QueuedLatestOp[] = [];
  const updates: Array<{ directoryId: string; review: ProjectPaneGitHubReviewSummary }> = [];
  const forceRefreshFlags: Array<boolean | undefined> = [];
  let shouldThrow = false;

  const cache = new RuntimeProjectPaneGitHubReviewCache({
    ttlMs: 1_000,
    refreshIntervalMs: 0,
    queueLatestControlPlaneOp: (key, task, label) => {
      queued.push({ key, task, label });
    },
    loadReview: async (_directoryId, options) => {
      forceRefreshFlags.push(options.forceRefresh);
      if (shouldThrow) {
        throw new Error('api failed');
      }
      return readySummary('main');
    },
    onUpdate: (directoryId, review) => {
      updates.push({ directoryId, review });
    },
    formatErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
  });

  cache.request('dir-a');
  await queued[0]!.task({
    signal: new AbortController().signal,
  });
  shouldThrow = true;
  cache.request('dir-a', {
    forceRefresh: true,
  });
  await queued[1]!.task({
    signal: new AbortController().signal,
  });

  const last = updates.at(-1)?.review;
  assert.ok(last);
  assert.equal(last.status, 'error');
  assert.equal(last.branchName, 'main');
  assert.equal(last.errorMessage, 'api failed');
  assert.deepEqual(forceRefreshFlags, [false, true]);
});

void test('runtime project pane GitHub review cache auto-refreshes active directory and clears timer on stop', () => {
  const queued: QueuedLatestOp[] = [];
  const updates: Array<{ directoryId: string; review: ProjectPaneGitHubReviewSummary }> = [];
  const timerCallbacks: Array<() => void> = [];
  const clearedTimers: NodeJS.Timeout[] = [];
  const timer = { unref: () => {} } as unknown as NodeJS.Timeout;
  let activeDirectoryId: string | null = 'dir-a';

  const cache = new RuntimeProjectPaneGitHubReviewCache({
    ttlMs: 1_000,
    refreshIntervalMs: 5_000,
    queueLatestControlPlaneOp: (key, task, label) => {
      queued.push({ key, task, label });
    },
    loadReview: async (_directoryId, _options) => readySummary('main'),
    onUpdate: (directoryId, review) => {
      updates.push({ directoryId, review });
    },
    formatErrorMessage: (error) => String(error),
    setInterval: (callback) => {
      timerCallbacks.push(callback);
      return timer;
    },
    clearInterval: (value) => {
      clearedTimers.push(value);
    },
  });

  cache.startAutoRefresh(() => activeDirectoryId);
  assert.equal(timerCallbacks.length, 1);
  timerCallbacks[0]?.();
  assert.equal(queued.length, 1);
  assert.equal(updates[0]?.review.status, 'loading');

  activeDirectoryId = null;
  timerCallbacks[0]?.();
  assert.equal(queued.length, 1);

  cache.stopAutoRefresh();
  assert.deepEqual(clearedTimers, [timer]);
});
