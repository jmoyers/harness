import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  InMemoryNimRuntime,
  type NimEventEnvelope,
  type NimUiEvent,
  NimSqliteEventStore,
  NimSqliteSessionStore,
} from '../packages/nim-core/src/index.ts';

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs = 2000,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timed out waiting for stream event'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function collectUntil<T>(
  iterator: AsyncIterator<T>,
  predicate: (events: readonly T[]) => boolean,
  maxEvents = 200,
): Promise<T[]> {
  const events: T[] = [];
  while (events.length < maxEvents) {
    const next = await nextWithTimeout(iterator);
    if (next.done) {
      break;
    }
    events.push(next.value);
    if (predicate(events)) {
      return events;
    }
  }
  throw new Error(`stream predicate not met after ${String(events.length)} events`);
}

function createRuntime(input?: ConstructorParameters<typeof InMemoryNimRuntime>[0]) {
  const runtime = new InMemoryNimRuntime(input);
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-5-haiku-latest'],
  });
  runtime.registerTools([
    {
      name: 'mock-tool',
      description: 'mock',
    },
  ]);
  runtime.setToolPolicy({
    hash: 'policy-test',
    allow: ['mock-tool'],
    deny: [],
  });
  return runtime;
}

async function createSession(runtime: InMemoryNimRuntime) {
  return await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-5-haiku-latest',
  });
}

test('nim runtime supports session lifecycle and tenant/user enforcement', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const listed = await runtime.listSessions({
    tenantId: 'tenant-a',
    userId: 'user-a',
  });
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.sessions[0]?.sessionId, session.sessionId);

  await assert.rejects(
    async () => {
      await runtime.resumeSession({
        tenantId: 'tenant-a',
        userId: 'user-b',
        sessionId: session.sessionId,
      });
    },
    {
      message: 'session access denied',
    },
  );

  await runtime.switchModel({
    sessionId: session.sessionId,
    model: 'anthropic/claude-3-5-haiku-latest',
    reason: 'manual',
  });

  await assert.rejects(
    async () => {
      await runtime.switchModel({
        sessionId: session.sessionId,
        model: 'anthropic/unsupported-model',
        reason: 'manual',
      });
    },
    {
      message: 'model not registered for provider anthropic: anthropic/unsupported-model',
    },
  );
});

test('nim runtime reuses run for idempotency key and emits reuse event', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const eventStream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
  });
  const iterator = eventStream[Symbol.asyncIterator]();

  try {
    const first = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'hello',
      idempotencyKey: 'idem-1',
    });
    const second = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'ignored',
      idempotencyKey: 'idem-1',
    });

    assert.equal(first.runId, second.runId);
    const done = await first.done;
    assert.equal(done.terminalState, 'completed');

    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === first.runId),
    );
    assert.equal(
      events.some((event) => event.type === 'turn.idempotency.reused'),
      true,
    );
  } finally {
    await iterator.return?.();
  }
});

test('nim runtime abortTurn cascades into aborted terminal state with lifecycle events', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const eventStream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
  });
  const iterator = eventStream[Symbol.asyncIterator]();

  try {
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'use-tool abort-me',
      idempotencyKey: 'idem-abort',
    });

    await runtime.abortTurn({
      runId: turn.runId,
      reason: 'timeout',
    });

    const result = await turn.done;
    assert.equal(result.terminalState, 'aborted');

    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
    );

    assert.equal(
      events.some((event) => event.type === 'turn.abort.requested' && event.run_id === turn.runId),
      true,
    );
    assert.equal(
      events.some((event) => event.type === 'turn.abort.propagated' && event.run_id === turn.runId),
      true,
    );
    assert.equal(
      events.some((event) => event.type === 'turn.abort.completed' && event.run_id === turn.runId),
      true,
    );
  } finally {
    await iterator.return?.();
  }
});

test('nim runtime steerTurn appends input to the active run only', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
  });
  const iterator = stream[Symbol.asyncIterator]();

  try {
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'first',
      idempotencyKey: 'idem-steer-1',
    });

    const steerResult = await runtime.steerTurn({
      sessionId: session.sessionId,
      runId: turn.runId,
      text: 'append-me',
    });
    assert.equal(steerResult.accepted, true);

    const firstResult = await turn.done;
    assert.equal(firstResult.terminalState, 'completed');
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
    );

    assert.equal(
      events.some(
        (event) =>
          event.type === 'assistant.output.delta' &&
          event.run_id === turn.runId &&
          String(event.data?.['text'] ?? '').includes('echo:first [steer:append-me]'),
      ),
      true,
    );
    assert.equal(
      events.some(
        (event) =>
          event.type === 'assistant.output.message' &&
          event.run_id === turn.runId &&
          String(event.data?.['text'] ?? '').includes('echo:first [steer:append-me]'),
      ),
      true,
    );

    const noActive = await runtime.steerTurn({
      sessionId: session.sessionId,
      text: 'after',
    });
    assert.equal(noActive.accepted, false);
    assert.equal(noActive.reason, 'no-active-run');
  } finally {
    await iterator.return?.();
  }
});

test('nim runtime queueTurn prioritizes high priority and dedupes entries', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
  });
  const iterator = stream[Symbol.asyncIterator]();

  try {
    const first = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'first',
      idempotencyKey: 'idem-q-1',
    });

    const queuedNormal = await runtime.queueTurn({
      sessionId: session.sessionId,
      text: 'normal',
    });
    const queuedHigh = await runtime.queueTurn({
      sessionId: session.sessionId,
      text: 'high',
      priority: 'high',
    });
    const duplicate = await runtime.queueTurn({
      sessionId: session.sessionId,
      text: 'normal',
    });

    assert.equal(queuedNormal.queued, true);
    assert.equal(queuedNormal.position, 0);
    assert.equal(queuedHigh.queued, true);
    assert.equal(queuedHigh.position, 0);
    assert.equal(duplicate.queued, false);
    assert.equal(duplicate.reason, 'duplicate');

    const firstResult = await first.done;
    assert.equal(firstResult.terminalState, 'completed');

    const events = await collectUntil(iterator, (items) => {
      const completed = items.filter((event) => event.type === 'turn.completed');
      return completed.length >= 3;
    });

    const outputs = events
      .filter((event) => event.type === 'assistant.output.delta')
      .map((event) => String(event.data?.['text'] ?? ''));
    const fullOutputs = events
      .filter((event) => event.type === 'assistant.output.message')
      .map((event) => String(event.data?.['text'] ?? ''));

    assert.equal(outputs[0], 'echo:first');
    assert.equal(outputs[1], 'echo:high');
    assert.equal(outputs[2], 'echo:normal');
    assert.equal(fullOutputs[0], 'echo:first');
    assert.equal(fullOutputs[1], 'echo:high');
    assert.equal(fullOutputs[2], 'echo:normal');

    assert.equal(
      events.some((event) => event.type === 'turn.queue.dequeued'),
      true,
    );
  } finally {
    await iterator.return?.();
  }
});

test('nim runtime queueTurn validates empty text and queue max', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const invalid = await runtime.queueTurn({
    sessionId: session.sessionId,
    text: ' ',
  });
  assert.equal(invalid.queued, false);
  assert.equal(invalid.reason, 'invalid-state');

  for (let index = 0; index < 64; index += 1) {
    const queued = await runtime.queueTurn({
      sessionId: session.sessionId,
      text: `q-${String(index)}`,
    });
    assert.equal(queued.queued, true);
  }

  const overflow = await runtime.queueTurn({
    sessionId: session.sessionId,
    text: 'overflow',
  });
  assert.equal(overflow.queued, false);
  assert.equal(overflow.reason, 'queue-full');
});

test('nim runtime streamEvents supports fromEventIdExclusive continuation cursor', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const baselineStream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
  });
  const baselineIterator = baselineStream[Symbol.asyncIterator]();

  let baseline: NimEventEnvelope[] = [];
  try {
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'cursor-check',
      idempotencyKey: 'idem-cursor',
    });

    await turn.done;
    baseline = await collectUntil(baselineIterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
    );
  } finally {
    await baselineIterator.return?.();
  }

  const anchor = baseline[1];
  assert.equal(anchor === undefined, false);

  const resumedStream = runtime.streamEvents({
    tenantId: 'tenant-a',
    ...(anchor?.event_id !== undefined ? { fromEventIdExclusive: anchor.event_id } : {}),
  });
  const resumedIterator = resumedStream[Symbol.asyncIterator]();

  try {
    const next = await nextWithTimeout(resumedIterator);
    assert.equal(next.done, false);
    assert.equal(next.value.session_id, session.sessionId);
    assert.equal(next.value.event_seq > (anchor as NimEventEnvelope).event_seq, true);
  } finally {
    await resumedIterator.return?.();
  }
});

test('nim runtime replayEvents supports deterministic windowed replay', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool mock-tool',
    idempotencyKey: 'idem-replay-window',
  });
  await turn.done;

  const full = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  assert.equal(full.events.length > 0, true);

  const anchor = full.events.find((event) => event.type === 'turn.started');
  assert.notEqual(anchor, undefined);
  const anchorEvent = anchor as NimEventEnvelope;
  const lastFullEvent = full.events[full.events.length - 1];
  assert.notEqual(lastFullEvent, undefined);
  const endEvent = lastFullEvent as NimEventEnvelope;

  const windowed = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fromEventIdExclusive: anchorEvent.event_id,
    toEventIdInclusive: endEvent.event_id,
    fidelity: 'semantic',
  });
  assert.equal(windowed.events.length > 0, true);
  const firstWindowed = windowed.events[0];
  assert.notEqual(firstWindowed, undefined);
  assert.equal((firstWindowed as NimEventEnvelope).event_seq > anchorEvent.event_seq, true);
  const maxFullSeq = endEvent.event_seq;
  assert.equal(
    windowed.events.every((event) => event.event_seq <= maxFullSeq),
    true,
  );
});

test('nim runtime emits canonical events to constructor and registered telemetry sinks', async () => {
  const constructorEvents: NimEventEnvelope[] = [];
  const registeredEvents: NimEventEnvelope[] = [];
  const runtime = new InMemoryNimRuntime({
    telemetrySinks: [
      {
        name: 'constructor-sink',
        record(event) {
          constructorEvents.push(event);
        },
      },
    ],
  });
  runtime.registerTelemetrySink({
    name: 'registered-sink',
    record(event) {
      registeredEvents.push(event);
    },
  });
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-5-haiku-latest'],
  });
  runtime.registerTools([
    {
      name: 'mock-tool',
      description: 'mock',
    },
  ]);
  runtime.setToolPolicy({
    hash: 'policy-test',
    allow: ['mock-tool'],
    deny: [],
  });
  const session = await createSession(runtime);
  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool mock-tool',
    idempotencyKey: 'idem-telemetry-sink',
  });
  await turn.done;

  const replay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    includeThoughtDeltas: true,
    includeToolArgumentDeltas: true,
  });
  assert.equal(constructorEvents.length, replay.events.length);
  assert.equal(registeredEvents.length, replay.events.length);
  assert.deepEqual(
    constructorEvents.map((event) => event.event_id),
    replay.events.map((event) => event.event_id),
  );
  assert.deepEqual(
    registeredEvents.map((event) => event.event_id),
    replay.events.map((event) => event.event_id),
  );
});

test('nim runtime uses sqlite event store for replayable persistence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-runtime-sqlite-'));
  const dbPath = join(dir, 'events.sqlite');
  const eventStore = new NimSqliteEventStore(dbPath);
  const runtime = createRuntime({
    eventStore,
  });
  const session = await createSession(runtime);
  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool mock-tool',
    idempotencyKey: 'idem-runtime-sqlite-store',
  });
  await turn.done;

  const replay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    includeThoughtDeltas: true,
    includeToolArgumentDeltas: true,
  });
  assert.equal(replay.events.length > 0, true);
  eventStore.close();

  const persisted = new NimSqliteEventStore(dbPath);
  try {
    const rows = persisted.list({
      tenantId: 'tenant-a',
      sessionId: session.sessionId,
    });
    assert.equal(rows.length, replay.events.length);
    assert.deepEqual(
      rows.map((event) => event.event_id),
      replay.events.map((event) => event.event_id),
    );
  } finally {
    persisted.close();
  }
});

test('nim runtime resumes persisted session and idempotency across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-runtime-restart-'));
  const eventDbPath = join(dir, 'events.sqlite');
  const sessionDbPath = join(dir, 'sessions.sqlite');

  const initialEventStore = new NimSqliteEventStore(eventDbPath);
  const initialSessionStore = new NimSqliteSessionStore(sessionDbPath);
  const initialRuntime = createRuntime({
    eventStore: initialEventStore,
    sessionStore: initialSessionStore,
  });
  const session = await createSession(initialRuntime);
  const first = await initialRuntime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool mock-tool',
    idempotencyKey: 'idem-restart-a',
  });
  const firstResult = await first.done;
  initialEventStore.close();
  initialSessionStore.close();

  const resumedEventStore = new NimSqliteEventStore(eventDbPath);
  const resumedSessionStore = new NimSqliteSessionStore(sessionDbPath);
  const resumedRuntime = createRuntime({
    eventStore: resumedEventStore,
    sessionStore: resumedSessionStore,
  });
  try {
    const listed = await resumedRuntime.listSessions({
      tenantId: 'tenant-a',
      userId: 'user-a',
    });
    assert.equal(
      listed.sessions.some((item) => item.sessionId === session.sessionId),
      true,
    );

    const resumed = await resumedRuntime.resumeSession({
      tenantId: 'tenant-a',
      userId: 'user-a',
      sessionId: session.sessionId,
    });
    assert.equal(resumed.sessionId, session.sessionId);

    const reused = await resumedRuntime.sendTurn({
      sessionId: session.sessionId,
      input: 'use-tool mock-tool',
      idempotencyKey: 'idem-restart-a',
    });
    assert.equal(reused.runId, first.runId);
    const reusedResult = await reused.done;
    assert.deepEqual(reusedResult, firstResult);

    const second = await resumedRuntime.sendTurn({
      sessionId: session.sessionId,
      input: 'second turn',
      idempotencyKey: 'idem-restart-b',
    });
    await second.done;

    const replay = await resumedRuntime.replayEvents({
      tenantId: 'tenant-a',
      sessionId: session.sessionId,
    });
    assert.equal(
      replay.events.filter((event) => event.type === 'turn.started' && event.run_id === first.runId)
        .length,
      1,
    );
    assert.equal(
      replay.events.some(
        (event) => event.type === 'turn.idempotency.reused' && event.run_id === first.runId,
      ),
      true,
    );
  } finally {
    resumedEventStore.close();
    resumedSessionStore.close();
  }
});

test('nim runtime fails closed on non-terminal persisted idempotency runs after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-runtime-idempotency-fail-closed-'));
  const eventDbPath = join(dir, 'events.sqlite');
  const sessionDbPath = join(dir, 'sessions.sqlite');

  const initialEventStore = new NimSqliteEventStore(eventDbPath);
  const initialSessionStore = new NimSqliteSessionStore(sessionDbPath);
  const initialRuntime = createRuntime({
    eventStore: initialEventStore,
    sessionStore: initialSessionStore,
  });
  const session = await createSession(initialRuntime);
  initialSessionStore.upsertIdempotency(
    session.sessionId,
    'idem-restart-non-terminal',
    'run-non-terminal',
  );
  initialEventStore.close();
  initialSessionStore.close();

  const resumedEventStore = new NimSqliteEventStore(eventDbPath);
  const resumedSessionStore = new NimSqliteSessionStore(sessionDbPath);
  const resumedRuntime = createRuntime({
    eventStore: resumedEventStore,
    sessionStore: resumedSessionStore,
  });
  try {
    await assert.rejects(
      async () => {
        await resumedRuntime.sendTurn({
          sessionId: session.sessionId,
          input: 'retry stale idempotency',
          idempotencyKey: 'idem-restart-non-terminal',
        });
      },
      {
        message: 'idempotency run is non-terminal: run-non-terminal',
      },
    );
    const replay = await resumedRuntime.replayEvents({
      tenantId: 'tenant-a',
      sessionId: session.sessionId,
    });
    assert.equal(
      replay.events.some((event) => event.type === 'turn.idempotency.unresolved'),
      true,
    );
  } finally {
    resumedEventStore.close();
    resumedSessionStore.close();
  }
});

test('nim runtime persists queued turns across restart and drains on next terminal run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nim-runtime-queue-restart-'));
  const eventDbPath = join(dir, 'events.sqlite');
  const sessionDbPath = join(dir, 'sessions.sqlite');

  const initialEventStore = new NimSqliteEventStore(eventDbPath);
  const initialSessionStore = new NimSqliteSessionStore(sessionDbPath);
  const initialRuntime = createRuntime({
    eventStore: initialEventStore,
    sessionStore: initialSessionStore,
  });
  const session = await createSession(initialRuntime);
  const queued = await initialRuntime.queueTurn({
    sessionId: session.sessionId,
    text: 'queued after restart',
    priority: 'high',
  });
  assert.equal(queued.queued, true);
  assert.notEqual(queued.queueId, undefined);
  const queueId = queued.queueId as string;
  initialEventStore.close();
  initialSessionStore.close();

  const resumedEventStore = new NimSqliteEventStore(eventDbPath);
  const resumedSessionStore = new NimSqliteSessionStore(sessionDbPath);
  const resumedRuntime = createRuntime({
    eventStore: resumedEventStore,
    sessionStore: resumedSessionStore,
  });
  try {
    const trigger = await resumedRuntime.sendTurn({
      sessionId: session.sessionId,
      input: 'trigger queue drain',
      idempotencyKey: 'idem-restart-queue-trigger',
    });
    await trigger.done;
    let replay = await resumedRuntime.replayEvents({
      tenantId: 'tenant-a',
      sessionId: session.sessionId,
    });
    const deadline = Date.now() + 2000;
    while (
      Date.now() < deadline &&
      !replay.events.some(
        (event) => event.type === 'turn.started' && event.idempotency_key === `queue:${queueId}`,
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      replay = await resumedRuntime.replayEvents({
        tenantId: 'tenant-a',
        sessionId: session.sessionId,
      });
    }
    assert.equal(
      replay.events.some(
        (event) => event.type === 'turn.queue.dequeued' && event.queue_id === queueId,
      ),
      true,
    );
    assert.equal(
      replay.events.some(
        (event) => event.type === 'turn.started' && event.idempotency_key === `queue:${queueId}`,
      ),
      true,
    );
  } finally {
    resumedEventStore.close();
    resumedSessionStore.close();
  }
});

test('nim runtime streamUi projects canonical events for debug and seamless modes', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const debugStream = runtime.streamUi({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    mode: 'debug',
  });
  const seamlessStream = runtime.streamUi({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    mode: 'seamless',
  });

  const debugIterator = debugStream[Symbol.asyncIterator]();
  const seamlessIterator = seamlessStream[Symbol.asyncIterator]();

  try {
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'use-tool mock-tool',
      idempotencyKey: 'idem-ui',
    });
    await turn.done;

    const debugEvents = await collectUntil<NimUiEvent>(debugIterator, (items) =>
      items.some((event) => event.type === 'assistant.state' && event.state === 'idle'),
    );
    const seamlessEvents = await collectUntil<NimUiEvent>(seamlessIterator, (items) =>
      items.some((event) => event.type === 'assistant.state' && event.state === 'idle'),
    );

    assert.equal(
      debugEvents.some((event) => event.type === 'tool.activity'),
      true,
    );
    assert.equal(
      seamlessEvents.some(
        (event) => event.type === 'assistant.state' && event.state === 'tool-calling',
      ),
      true,
    );
  } finally {
    await debugIterator.return?.();
    await seamlessIterator.return?.();
  }
});

test('nim runtime loads soul/skills/memory snapshots from registered sources', async () => {
  const runtime = createRuntime();
  runtime.registerSoulSource({ name: 'workspace-soul' });
  runtime.registerSkillSource({ name: 'workspace-skills' });
  runtime.registerMemoryStore({ name: 'workspace-memory' });

  const soul = await runtime.loadSoul();
  const skills = await runtime.loadSkills();
  const memory = await runtime.loadMemory();

  assert.equal(soul.hash, 'soul:1');
  assert.equal(skills.hash, 'skills:1');
  assert.equal(skills.version, 1);
  assert.equal(memory.hash, 'memory:1');
});

test('nim runtime supports compactSession and abort signal on sendTurn', async () => {
  const runtime = createRuntime();
  const session = await createSession(runtime);

  const compactedWithoutRun = await runtime.compactSession({
    sessionId: session.sessionId,
    trigger: 'manual',
    includeMemoryFlush: true,
  });
  assert.equal(compactedWithoutRun.compacted, true);
  assert.equal(typeof compactedWithoutRun.summaryEventId, 'string');

  const controller = new AbortController();
  const run = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'signal abort',
    idempotencyKey: 'idem-signal',
    abortSignal: controller.signal,
  });

  controller.abort();
  const result = await run.done;
  assert.equal(result.terminalState, 'aborted');

  const compactedWithRun = await runtime.compactSession({
    sessionId: session.sessionId,
    trigger: 'policy',
  });
  assert.equal(compactedWithRun.compacted, true);
});
