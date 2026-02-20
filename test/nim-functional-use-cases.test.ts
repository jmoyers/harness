import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  InMemoryNimRuntime,
  type NimEventEnvelope,
  type NimProviderDriver,
  type NimUiEvent,
} from '../packages/nim-core/src/index.ts';
import { projectEventToUiEvents } from '../packages/nim-ui-core/src/index.ts';

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
  maxEvents = 400,
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

function providerDriver(providerId: string, prefix: string): NimProviderDriver {
  return {
    providerId,
    async *runTurn(input) {
      yield { type: 'provider.thinking.started' };
      yield { type: 'provider.thinking.completed' };

      const requestedToolMatch = /(?:^|\s)use-tool(?:\s+([A-Za-z0-9._:-]+))?/u.exec(input.input);
      if (requestedToolMatch !== null) {
        const requestedToolName =
          requestedToolMatch[1] ??
          (input.tools[0] !== undefined ? String(input.tools[0].name) : undefined);
        const matchedTool = input.tools.find((tool) => tool.name === requestedToolName);
        if (matchedTool !== undefined) {
          const toolCallId = `${prefix}-tool-1`;
          const toolName = matchedTool.name;
          yield {
            type: 'tool.call.started',
            toolCallId,
            toolName,
          };
          yield {
            type: 'tool.call.completed',
            toolCallId,
            toolName,
          };
          yield {
            type: 'tool.result.emitted',
            toolCallId,
            toolName,
            output: { ok: true },
          };
        }
      }

      yield {
        type: 'assistant.output.delta',
        text: `${prefix}:${input.input}`,
      };
      yield { type: 'assistant.output.completed' };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'stop',
      };
    },
  };
}

function slowToolDriver(providerId: string): NimProviderDriver {
  return {
    providerId,
    async *runTurn(input) {
      yield { type: 'provider.thinking.started' };
      yield { type: 'provider.thinking.completed' };

      const firstTool = input.tools[0];
      if (firstTool !== undefined) {
        const toolCallId = 'slow-tool-1';
        yield {
          type: 'tool.call.started',
          toolCallId,
          toolName: firstTool.name,
        };
        await new Promise((resolve) => setTimeout(resolve, 50));
        yield {
          type: 'tool.call.completed',
          toolCallId,
          toolName: firstTool.name,
        };
        yield {
          type: 'tool.result.emitted',
          toolCallId,
          toolName: firstTool.name,
          output: { ok: true },
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      yield {
        type: 'assistant.output.delta',
        text: `slow:${input.input}`,
      };
      yield { type: 'assistant.output.completed' };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'stop',
      };
    },
  };
}

function assistantText(events: readonly NimEventEnvelope[]): string {
  return events
    .filter((event): event is NimEventEnvelope & { type: 'assistant.output.delta' } => {
      return event.type === 'assistant.output.delta';
    })
    .map((event) => String(event.data?.['text'] ?? ''))
    .join('');
}

test('UC-01 start session and first turn emits replayable lifecycle', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'first turn',
    idempotencyKey: 'uc01-turn-1',
  });
  const result = await turn.done;
  assert.equal(result.terminalState, 'completed');

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const replay = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  const replayIterator = replay[Symbol.asyncIterator]();

  try {
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
    );
    const replayedEvents = await collectUntil(replayIterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
    );

    assert.equal(
      events.some((event) => event.type === 'session.started'),
      true,
    );
    assert.equal(
      events.some((event) => event.type === 'turn.started' && event.run_id === turn.runId),
      true,
    );
    assert.equal(
      events.some(
        (event) => event.type === 'provider.thinking.started' && event.run_id === turn.runId,
      ),
      true,
    );
    assert.equal(
      events.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
      true,
    );

    const completed = events.find(
      (event) => event.type === 'turn.completed' && event.run_id === turn.runId,
    );
    const replayedCompleted = replayedEvents.find(
      (event) => event.type === 'turn.completed' && event.run_id === turn.runId,
    );
    assert.equal(completed?.data?.['terminalState'], 'completed');
    assert.equal(replayedCompleted?.data?.['terminalState'], 'completed');
    assert.deepEqual(replayedEvents, events);
  } finally {
    await iterator.return?.();
    await replayIterator.return?.();
  }
});

test('UC-02 resume session continues conversation without duplicating prior turns', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const first = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'turn one',
    idempotencyKey: 'uc02-a',
  });
  await first.done;

  const resumed = await runtime.resumeSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    sessionId: session.sessionId,
  });
  assert.equal(resumed.sessionId, session.sessionId);

  const second = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'turn two',
    idempotencyKey: 'uc02-b',
  });
  await second.done;

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === second.runId),
    );

    assert.equal(events.filter((event) => event.type === 'session.resumed').length, 1);
    assert.equal(events.filter((event) => event.type === 'turn.started').length, 2);
    assert.match(
      assistantText(events.filter((event) => event.run_id === first.runId)),
      /anthropic:turn one/u,
    );
    assert.match(
      assistantText(events.filter((event) => event.run_id === second.runId)),
      /anthropic:turn two/u,
    );
  } finally {
    await iterator.return?.();
  }
});

test('UC-03 switch model provider mid-session and preserve policy hash', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProvider({
    id: 'openai',
    displayName: 'OpenAI',
    models: ['openai/gpt-4.1-mini'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));
  runtime.registerProviderDriver(providerDriver('openai', 'openai'));
  runtime.setToolPolicy({
    hash: 'policy:uc03',
    allow: ['ping'],
    deny: [],
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turnA = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'provider A',
    idempotencyKey: 'uc03-a',
  });
  await turnA.done;

  await runtime.switchModel({
    sessionId: session.sessionId,
    model: 'openai/gpt-4.1-mini',
    reason: 'manual',
  });

  const turnB = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'provider B',
    idempotencyKey: 'uc03-b',
  });
  await turnB.done;

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turnB.runId),
    );

    const runAEvents = events.filter((event) => event.run_id === turnA.runId);
    const runBEvents = events.filter((event) => event.run_id === turnB.runId);
    assert.match(assistantText(runAEvents), /anthropic:provider A/u);
    assert.match(assistantText(runBEvents), /openai:provider B/u);

    const switchEvent = events.find((event) => event.type === 'provider.model.switch.completed');
    assert.notEqual(switchEvent, undefined);
    assert.equal(switchEvent?.data?.['model'], 'openai/gpt-4.1-mini');

    const policyHashes = new Set(
      events.filter((event) => event.run_id === turnB.runId).map((event) => event.policy_hash),
    );
    assert.deepEqual([...policyHashes], ['policy:uc03']);
  } finally {
    await iterator.return?.();
  }
});

test('UC-04 tool policy deny precedence emits blocked event and suppresses tool execution', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));
  runtime.registerTools([
    { name: 'ping', description: 'ping tool' },
    { name: 'search', description: 'search tool' },
  ]);
  runtime.setToolPolicy({
    hash: 'policy:uc04',
    allow: ['ping', 'search'],
    deny: ['ping'],
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });
  const run = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool ping',
    idempotencyKey: 'uc04-a',
  });
  await run.done;

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: run.runId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === run.runId),
    );
    const blocked = events.find((event) => event.type === 'tool.policy.blocked');
    assert.notEqual(blocked, undefined);
    assert.equal(blocked?.data?.['toolName'], 'ping');
    assert.equal(blocked?.data?.['reason'], 'policy-deny');
    assert.equal(
      events.some((event) => event.type === 'tool.call.started'),
      false,
    );
  } finally {
    await iterator.return?.();
  }
});

test('UC-05 abort running turn prevents post-abort tool results and output', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(slowToolDriver('anthropic'));
  runtime.registerTools([{ name: 'ping', description: 'ping tool' }]);

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });
  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  const run = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool ping',
    idempotencyKey: 'uc05-a',
  });

  try {
    await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'tool.call.started' && event.run_id === run.runId),
    );

    await runtime.abortTurn({
      runId: run.runId,
      reason: 'manual',
    });
    const done = await run.done;
    assert.equal(done.terminalState, 'aborted');

    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === run.runId),
    );
    assert.equal(
      events.some((event) => event.type === 'turn.abort.requested'),
      true,
    );
    assert.equal(
      events.some((event) => event.type === 'turn.abort.completed'),
      true,
    );

    const abortRequested = events.find((event) => event.type === 'turn.abort.requested');
    assert.notEqual(abortRequested, undefined);
    const abortEventSeq = Number(abortRequested?.event_seq ?? 0);
    assert.equal(
      events.some(
        (event) =>
          event.event_seq > abortEventSeq &&
          (event.type === 'tool.result.emitted' || event.type === 'assistant.output.delta'),
      ),
      false,
    );
  } finally {
    await iterator.return?.();
  }
});

test('UC-06 overflow compaction is bounded and deterministic for recover/fail modes', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));
  runtime.registerTools([{ name: 'ping', description: 'ping tool' }]);
  runtime.setToolPolicy({
    hash: 'policy:uc06',
    allow: ['ping'],
    deny: [],
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const recoveredRun = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'force-overflow-recover use-tool ping',
    idempotencyKey: 'uc06-recover',
  });
  const recovered = await recoveredRun.done;
  assert.equal(recovered.terminalState, 'completed');

  const failedRun = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'force-overflow-fail use-tool ping',
    idempotencyKey: 'uc06-fail',
  });
  const failed = await failedRun.done;
  assert.equal(failed.terminalState, 'failed');

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === failedRun.runId),
    );

    const recoverEvents = events.filter((event) => event.run_id === recoveredRun.runId);
    assert.equal(
      recoverEvents.some((event) => event.type === 'provider.context.compaction.started'),
      true,
    );
    assert.equal(
      recoverEvents.some((event) => event.type === 'provider.context.compaction.completed'),
      true,
    );

    const failEvents = events.filter((event) => event.run_id === failedRun.runId);
    assert.equal(
      failEvents.some((event) => event.type === 'provider.context.compaction.retry'),
      true,
    );
    assert.equal(
      failEvents.some((event) => event.type === 'provider.context.compaction.failed'),
      true,
    );
    const failureReason = failEvents.find((event) => event.type === 'turn.failed');
    assert.equal(
      String(failureReason?.data?.['message'] ?? ''),
      'context overflow after compaction retries',
    );
    assert.equal(
      failEvents.some((event) => event.type === 'assistant.output.delta'),
      false,
    );
  } finally {
    await iterator.return?.();
  }
});

test('UC-07 skills snapshot version is stable during active turn and advances next turn', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(slowToolDriver('anthropic'));
  runtime.registerSkillSource({ name: 'skills-v1' });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });
  assert.equal(session.skillsSnapshotVersion, 1);

  const firstStream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const firstIterator = firstStream[Symbol.asyncIterator]();
  const firstRun = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'turn-one',
    idempotencyKey: 'uc07-a',
  });

  try {
    await collectUntil(firstIterator, (items) =>
      items.some((event) => event.type === 'turn.started' && event.run_id === firstRun.runId),
    );
    runtime.registerSkillSource({ name: 'skills-v2' });

    const firstDone = await firstRun.done;
    assert.equal(firstDone.terminalState, 'completed');
    const firstEvents = await collectUntil(firstIterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === firstRun.runId),
    );

    const firstVersions = new Set(
      firstEvents
        .filter((event) => event.run_id === firstRun.runId)
        .map((event) => event.skills_snapshot_version),
    );
    assert.deepEqual([...firstVersions], [1]);
  } finally {
    await firstIterator.return?.();
  }

  const secondRun = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'turn-two',
    idempotencyKey: 'uc07-b',
  });
  await secondRun.done;
  const secondStream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: secondRun.runId,
    fidelity: 'semantic',
  });
  const secondIterator = secondStream[Symbol.asyncIterator]();
  try {
    const secondEvents = await collectUntil(secondIterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === secondRun.runId),
    );
    const secondVersions = new Set(secondEvents.map((event) => event.skills_snapshot_version));
    assert.deepEqual([...secondVersions], [2]);
    assert.equal(
      secondEvents.some((event) => event.type === 'skills.snapshot.loaded'),
      true,
    );
  } finally {
    await secondIterator.return?.();
  }
});

test('UC-08 soul and memory snapshot load/missing are explicit in run timeline', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const missingRun = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'missing-context',
    idempotencyKey: 'uc08-missing',
  });
  await missingRun.done;

  runtime.registerSoulSource({ name: 'soul-v1' });
  runtime.registerMemoryStore({ name: 'memory-v1' });
  const loadedRun = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'loaded-context',
    idempotencyKey: 'uc08-loaded',
  });
  await loadedRun.done;

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === loadedRun.runId),
    );

    const missingEvents = events.filter((event) => event.run_id === missingRun.runId);
    assert.equal(
      missingEvents.some((event) => event.type === 'soul.snapshot.missing'),
      true,
    );
    assert.equal(
      missingEvents.some((event) => event.type === 'memory.snapshot.missing'),
      true,
    );
    assert.equal(
      missingEvents.some((event) => event.soul_hash !== undefined),
      false,
    );

    const loadedEvents = events.filter((event) => event.run_id === loadedRun.runId);
    assert.equal(
      loadedEvents.some((event) => event.type === 'soul.snapshot.loaded'),
      true,
    );
    assert.equal(
      loadedEvents.some((event) => event.type === 'memory.snapshot.loaded'),
      true,
    );
    assert.equal(
      loadedEvents.some((event) => event.soul_hash === 'soul:1'),
      true,
    );
    const memoryLoaded = loadedEvents.find((event) => event.type === 'memory.snapshot.loaded');
    assert.equal(memoryLoaded?.data?.['hash'], 'memory:1');
  } finally {
    await iterator.return?.();
  }
});

test('UC-09 deterministic replay snapshot is stable and fully ordered', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));
  runtime.registerTools([{ name: 'ping', description: 'ping tool' }]);

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const first = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool first',
    idempotencyKey: 'uc09-a',
  });
  await first.done;
  const second = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'second',
    idempotencyKey: 'uc09-b',
  });
  await second.done;

  const firstReplay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const secondReplay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });

  assert.deepEqual(firstReplay, secondReplay);

  const sessionEvents = firstReplay.events.filter(
    (event) => event.session_id === session.sessionId,
  );
  for (let index = 0; index < sessionEvents.length; index += 1) {
    assert.equal(sessionEvents[index]?.event_seq, index + 1);
    assert.equal(typeof sessionEvents[index]?.payload_hash, 'string');
    assert.notEqual(String(sessionEvents[index]?.payload_hash).length, 0);
  }

  const anchor = sessionEvents.find(
    (event) => event.type === 'turn.started' && event.run_id === second.runId,
  );
  assert.notEqual(anchor, undefined);
  const anchorEvent = anchor as NimEventEnvelope;
  const lastSessionEvent = sessionEvents[sessionEvents.length - 1];
  assert.notEqual(lastSessionEvent, undefined);
  const endEvent = lastSessionEvent as NimEventEnvelope;
  const windowedReplay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fromEventIdExclusive: anchorEvent.event_id,
    toEventIdInclusive: endEvent.event_id,
    fidelity: 'semantic',
  });
  assert.equal(
    windowedReplay.events.every((event) => event.event_seq > anchorEvent.event_seq),
    true,
  );
});

test('UC-10 in-turn steer inject mutates active run output and keeps single terminal', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const run = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'base input',
    idempotencyKey: 'uc10-a',
  });

  const steer = await runtime.steerTurn({
    sessionId: session.sessionId,
    runId: run.runId,
    text: 'inject-now',
    strategy: 'inject',
  });
  assert.equal(steer.accepted, true);

  const result = await run.done;
  assert.equal(result.terminalState, 'completed');

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: run.runId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === run.runId),
    );
    assert.equal(events.filter((event) => event.type === 'turn.completed').length, 1);
    assert.equal(
      events.some((event) => event.type === 'turn.steer.accepted'),
      true,
    );
    assert.match(assistantText(events), /\[steer:inject-now\]/u);
  } finally {
    await iterator.return?.();
  }
});

test('UC-11 queued follow-ups dequeue deterministically by priority and preserve order', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const firstRun = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'root',
    idempotencyKey: 'uc11-root',
  });

  const normal = await runtime.queueFollowUp({
    sessionId: session.sessionId,
    text: 'follow-normal',
    priority: 'normal',
  });
  const high = await runtime.queueFollowUp({
    sessionId: session.sessionId,
    text: 'follow-high',
    priority: 'high',
  });
  assert.equal(normal.queued, true);
  assert.equal(high.queued, true);

  await firstRun.done;

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  try {
    const events = await collectUntil(
      iterator,
      (items) => items.filter((event) => event.type === 'turn.completed').length === 3,
      1200,
    );

    const dequeues = events.filter((event) => event.type === 'turn.followup.dequeued');
    assert.equal(dequeues.length, 2);
    assert.equal(dequeues[0]?.queue_id, high.queueId);
    assert.equal(dequeues[1]?.queue_id, normal.queueId);

    const outputs = events
      .filter((event) => event.type === 'assistant.output.delta')
      .map((event) => String(event.data?.['text'] ?? ''));
    const highOutputIndex = outputs.findIndex((text) => text.includes('echo:follow-high'));
    const normalOutputIndex = outputs.findIndex((text) => text.includes('echo:follow-normal'));
    assert.equal(highOutputIndex >= 0, true);
    assert.equal(normalOutputIndex >= 0, true);
    assert.equal(highOutputIndex < normalOutputIndex, true);
  } finally {
    await iterator.return?.();
  }
});

test('UC-12 debug and seamless projections are pure functions of canonical stream', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });
  runtime.registerProviderDriver(providerDriver('anthropic', 'anthropic'));
  runtime.registerTools([{ name: 'ping', description: 'ping tool' }]);

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'use-tool ping',
    idempotencyKey: 'uc12-a',
  });
  await turn.done;

  const canonical = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: turn.runId,
    fidelity: 'semantic',
  });
  const debugUi = runtime.streamUi({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: turn.runId,
    mode: 'debug',
  });
  const seamlessUi = runtime.streamUi({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: turn.runId,
    mode: 'seamless',
  });
  const canonicalIterator = canonical[Symbol.asyncIterator]();
  const debugIterator = debugUi[Symbol.asyncIterator]();
  const seamlessIterator = seamlessUi[Symbol.asyncIterator]();

  try {
    const canonicalEvents = await collectUntil(canonicalIterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
    );
    const debugUiEvents = await collectUntil<NimUiEvent>(debugIterator, (items) =>
      items.some((event) => event.type === 'assistant.state' && event.state === 'idle'),
    );
    const seamlessUiEvents = await collectUntil<NimUiEvent>(seamlessIterator, (items) =>
      items.some((event) => event.type === 'assistant.state' && event.state === 'idle'),
    );

    const projectedDebug = canonicalEvents.flatMap((event) =>
      projectEventToUiEvents(event, 'debug'),
    );
    const projectedSeamless = canonicalEvents.flatMap((event) =>
      projectEventToUiEvents(event, 'seamless'),
    );

    assert.deepEqual(debugUiEvents, projectedDebug);
    assert.deepEqual(seamlessUiEvents, projectedSeamless);
    assert.equal(
      debugUiEvents.some((event) => event.type === 'tool.activity' && event.phase === 'start'),
      true,
    );
    assert.equal(
      seamlessUiEvents.some(
        (event) => event.type === 'assistant.state' && event.state === 'tool-calling',
      ),
      true,
    );
  } finally {
    await canonicalIterator.return?.();
    await debugIterator.return?.();
    await seamlessIterator.return?.();
  }
});
