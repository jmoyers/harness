import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupBackgroundResumeService } from '../../../../src/services/startup-background-resume.ts';

type TimeoutHandle = ReturnType<typeof setTimeout>;

void test('startup background resume records wait and skip when disabled', async () => {
  const events: string[] = [];
  let queuedCalls = 0;
  const service = new StartupBackgroundResumeService({
    enabled: false,
    maxWaitMs: 5000,
    waitForSettled: async () => {},
    settledObserved: () => false,
    queuePersistedConversationsInBackground: () => {
      queuedCalls += 1;
      return 0;
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  await service.run('session-a');

  assert.deepEqual(events, [
    'mux.startup.background-start.wait:{"sessionId":"session-a","maxWaitMs":5000,"enabled":0}',
    'mux.startup.background-start.skipped:{"sessionId":"session-a","reason":"disabled"}',
  ]);
  assert.equal(queuedCalls, 0);
});

void test('startup background resume waits for settled and queues persisted conversations', async () => {
  const events: string[] = [];
  const timeoutHandles: TimeoutHandle[] = [];
  const clearedTimeouts: TimeoutHandle[] = [];
  const queuedSessions: Array<string | null> = [];
  let timeoutHandleIndex = 0;
  const service = new StartupBackgroundResumeService({
    enabled: true,
    maxWaitMs: 5000,
    waitForSettled: async () => {},
    settledObserved: () => true,
    queuePersistedConversationsInBackground: (initialActiveId) => {
      queuedSessions.push(initialActiveId);
      return 3;
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
    setTimeoutFn: (_handler, _ms) => {
      timeoutHandleIndex += 1;
      const handle = { timeoutHandleIndex } as unknown as TimeoutHandle;
      timeoutHandles.push(handle);
      return handle;
    },
    clearTimeoutFn: (handle) => {
      clearedTimeouts.push(handle);
    },
  });

  await service.run(null);

  assert.deepEqual(events, [
    'mux.startup.background-start.wait:{"sessionId":"none","maxWaitMs":5000,"enabled":1}',
    'mux.startup.background-start.begin:{"sessionId":"none","timedOut":false,"settledObserved":true}',
    'mux.startup.background-start.queued:{"sessionId":"none","queued":3}',
  ]);
  assert.deepEqual(queuedSessions, [null]);
  assert.equal(timeoutHandles.length, 1);
  assert.deepEqual(clearedTimeouts, timeoutHandles);
});

void test('startup background resume timeout path marks timedOut true', async () => {
  const events: string[] = [];
  const service = new StartupBackgroundResumeService({
    enabled: true,
    maxWaitMs: 5000,
    waitForSettled: () => new Promise<void>(() => {}),
    settledObserved: () => false,
    queuePersistedConversationsInBackground: () => 1,
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
    setTimeoutFn: (handler, _ms) => {
      handler();
      return { timeout: true } as unknown as TimeoutHandle;
    },
    clearTimeoutFn: () => {},
  });

  await service.run('session-b');

  assert.deepEqual(events, [
    'mux.startup.background-start.wait:{"sessionId":"session-b","maxWaitMs":5000,"enabled":1}',
    'mux.startup.background-start.begin:{"sessionId":"session-b","timedOut":true,"settledObserved":false}',
    'mux.startup.background-start.queued:{"sessionId":"session-b","queued":1}',
  ]);
});
