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
    assert.equal(session.snapshot().uiMode, 'debug');
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

void test('runtime nim session handles slash commands and mode changes', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-c',
    userId: 'user-c',
    markDirty: () => {},
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    session.handleInputChunk('/state\r');
    await waitFor(() =>
      session
        .snapshot()
        .transcriptLines.some((line) => line.includes('[state] status:idle mode:debug queued:0')),
    );

    session.handleInputChunk('/mode seamless\r');
    await waitFor(() => session.snapshot().uiMode === 'seamless');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('ui mode set to seamless')),
    );

    session.handleInputChunk('/mode nope\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[error] invalid mode: nope')),
    );

    session.handleInputChunk('/abort\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('no active run')),
    );

    session.handleInputChunk('/clear\r');
    await waitFor(() => {
      const snapshot = session.snapshot();
      return (
        snapshot.transcriptLines.length === 1 &&
        snapshot.transcriptLines[0]?.includes('transcript cleared') === true
      );
    });

    session.handleInputChunk('/help\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[help] /help /mode')),
    );

    session.handleInputChunk('/unknown\r');
    await waitFor(() =>
      session
        .snapshot()
        .transcriptLines.some((line) => line.includes('[error] unknown command: /unknown')),
    );
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session ignores escape when no run is active', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-d',
    userId: 'user-d',
    markDirty: () => {},
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    session.handleEscape();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(session.snapshot().transcriptLines, []);
  } finally {
    await session.dispose();
  }
});
