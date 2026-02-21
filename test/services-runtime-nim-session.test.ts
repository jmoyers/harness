import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeNimSession } from '../src/services/runtime-nim-session.ts';

async function waitFor(predicate: () => boolean, timeoutMs = 3000, pollMs = 10): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('timed out waiting for predicate');
}

void test('runtime nim session supports compose edit submit and streamed assistant output', async () => {
  const dirtyMarks: number[] = [];
  const session = new RuntimeNimSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    markDirty: () => {
      dirtyMarks.push(1);
    },
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    session.handleInputChunk('hello');
    await waitFor(() => session.snapshot().composerText === 'hello');

    session.handleInputChunk('\u007f!');
    await waitFor(() => session.snapshot().composerText === 'hell!');

    session.handleInputChunk('\r');

    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('you> hell!')),
    );
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('nim> nim mock: hell!')),
    );
    await waitFor(() => {
      const snapshot = session.snapshot();
      return snapshot.activeRunId === null && snapshot.status === 'idle';
    });

    assert.equal(session.snapshot().queuedCount, 0);
    assert.equal(dirtyMarks.length > 0, true);
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session queues follow-up and handles escape abort requests', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-b',
    userId: 'user-b',
    markDirty: () => {},
    responseChunkDelayMs: 5,
  });
  try {
    await session.start();
    session.handleInputChunk('one two three four five six seven eight nine ten\r');
    await waitFor(() => session.snapshot().activeRunId !== null);

    session.handleInputChunk('follow up\t');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[queued] follow up')),
    );

    session.handleEscape();
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('abort requested')),
    );

    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('you> follow up')),
    );
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('nim> nim mock: follow up')),
    );
    await waitFor(() => {
      const snapshot = session.snapshot();
      return snapshot.activeRunId === null && snapshot.queuedCount === 0;
    });
  } finally {
    await session.dispose();
  }
});
