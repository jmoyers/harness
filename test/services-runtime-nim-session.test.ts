import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeNimSession } from '../src/services/runtime-nim-session.ts';
import { RuntimeNimToolBridge } from '../src/services/runtime-nim-tool-bridge.ts';
import { InMemoryNimRuntime, type NimProviderDriver } from '../packages/nim-core/src/index.ts';

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

    session.handleInputChunk('/mode user\r');
    await waitFor(() => session.snapshot().uiMode === 'user');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('ui mode set to user')),
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

void test('runtime nim session compacts duplicate adjacent transcript lines', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-dup',
    userId: 'user-dup',
    markDirty: () => {},
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    session.handleInputChunk('/abort\r/abort\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[notice] no active run (x2)')),
    );
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session emits tool lifecycle rows in debug mode', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-e',
    userId: 'user-e',
    markDirty: () => {},
    responseChunkDelayMs: 0,
    sleep: async () => {},
    toolBridge: new RuntimeNimToolBridge({
      listDirectories: async () => [{ directoryId: 'dir-1' }],
      listRepositories: async () => [{ repositoryId: 'repo-1' }],
      listTasks: async () => [{ taskId: 'task-1' }],
      listSessions: async () => [{ sessionId: 'session-1' }],
    }),
  });
  try {
    await session.start();
    session.handleInputChunk('use-tool repository.list\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[tool:start] repository.list')),
    );
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[tool:end] repository.list')),
    );
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session suppresses tool lifecycle rows in user mode', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-f',
    userId: 'user-f',
    markDirty: () => {},
    responseChunkDelayMs: 0,
    sleep: async () => {},
    toolBridge: new RuntimeNimToolBridge({
      listDirectories: async () => [{ directoryId: 'dir-1' }],
      listRepositories: async () => [{ repositoryId: 'repo-1' }],
      listTasks: async () => [{ taskId: 'task-1' }],
      listSessions: async () => [{ sessionId: 'session-1' }],
    }),
  });
  try {
    await session.start();
    session.handleInputChunk('/mode user\r');
    await waitFor(() => session.snapshot().uiMode === 'user');

    session.handleInputChunk('use-tool repository.list\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('you> use-tool repository.list')),
    );
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('nim> nim mock: use-tool repository.list')),
    );
    assert.equal(
      session.snapshot().transcriptLines.some((line) => line.includes('[tool:start] repository.list')),
      false,
    );
    assert.equal(
      session.snapshot().transcriptLines.some((line) => line.includes('[tool:end] repository.list')),
      false,
    );
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session accepts /mode seamless as alias for /mode user', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-h',
    userId: 'user-h',
    markDirty: () => {},
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    session.handleInputChunk('/mode seamless\r');
    await waitFor(() => session.snapshot().uiMode === 'user');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('ui mode set to user')),
    );
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session reports unavailable tools in debug mode', async () => {
  const session = new RuntimeNimSession({
    tenantId: 'tenant-g',
    userId: 'user-g',
    markDirty: () => {},
    responseChunkDelayMs: 0,
    sleep: async () => {},
    toolBridge: new RuntimeNimToolBridge({
      listDirectories: async () => [],
      listRepositories: async () => [],
      listTasks: async () => [],
      listSessions: async () => [],
    }),
  });
  try {
    await session.start();
    session.handleInputChunk('use-tool not-real\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[tool:error] not-real')),
    );
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session uses injected provider driver for live provider path', async () => {
  const providerDriver: NimProviderDriver = {
    providerId: 'anthropic',
    async *runTurn() {
      yield { type: 'provider.thinking.started' };
      yield { type: 'provider.thinking.completed' };
      yield { type: 'assistant.output.delta', text: 'live' };
      yield { type: 'assistant.output.completed' };
      yield { type: 'provider.turn.finished', finishReason: 'stop' };
    },
  };
  const session = new RuntimeNimSession({
    tenantId: 'tenant-i',
    userId: 'user-i',
    markDirty: () => {},
    model: 'anthropic/claude-3-5-haiku-latest',
    providerDriver,
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    session.handleInputChunk('hello live\r');
    await waitFor(() => session.snapshot().transcriptLines.some((line) => line.includes('nim> live')));
    await waitFor(() => session.snapshot().status === 'idle');
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session surfaces non-error input lane failures', async () => {
  const dirtyMarks: number[] = [];
  const session = new RuntimeNimSession({
    tenantId: 'tenant-j',
    userId: 'user-j',
    markDirty: () => {
      dirtyMarks.push(1);
    },
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    (session as unknown as { consumeInputText: (chunk: string) => Promise<void> }).consumeInputText =
      async () => {
        throw 'lane-failed';
      };
    session.handleInputChunk('hello');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[error] lane-failed')),
    );
    assert.equal(dirtyMarks.length > 0, true);
  } finally {
    await session.dispose();
  }
});

void test('runtime nim session handles rejected turn completion promises', async () => {
  const runtime = new InMemoryNimRuntime();
  const session = new RuntimeNimSession({
    tenantId: 'tenant-k',
    userId: 'user-k',
    markDirty: () => {},
    runtime,
    responseChunkDelayMs: 0,
    sleep: async () => {},
  });
  try {
    await session.start();
    (
      runtime as unknown as {
        sendTurn: (input: unknown) => Promise<{ runId: string; done: Promise<unknown> }>;
      }
    ).sendTurn = async () => ({
      runId: 'run-rejected',
      done: Promise.reject('turn-done-failed'),
    });
    session.handleInputChunk('trigger\r');
    await waitFor(() =>
      session.snapshot().transcriptLines.some((line) => line.includes('[error] turn-done-failed')),
    );
    await waitFor(() => session.snapshot().activeRunId === null);
  } finally {
    await session.dispose();
  }
});
