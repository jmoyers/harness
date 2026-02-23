/**
 * nim agent integration test — verifies real nim-core runtime
 * with Anthropic provider sends and receives messages.
 *
 * Requires: ANTHROPIC_API_KEY in ~/.harness/secrets.env or environment.
 * Run: bun test test/integration/ui/nim-agent.integration.test.ts
 */
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { loadHarnessSecrets } from '../../../src/config/secrets-core.ts';
import { InMemoryNimRuntime } from '../../../packages/nim-core/src/runtime.ts';
import { createAnthropicNimProviderDriver } from '../../../packages/nim-core/src/providers/anthropic-driver.ts';
import { NimProviderRouter } from '../../../packages/nim-core/src/provider-router.ts';
import { InMemoryNimEventStore } from '../../../packages/nim-core/src/event-store.ts';
import { InMemoryNimSessionStore } from '../../../packages/nim-core/src/session-store.ts';
import type {
  NimRuntime,
  NimModelRef,
  SessionHandle,
  NimUiEvent,
} from '../../../packages/nim-core/src/contracts.ts';

loadHarnessSecrets();

const apiKey = process.env.ANTHROPIC_API_KEY;
const model: NimModelRef =
  (process.env.HARNESS_NIM_MODEL as NimModelRef) ?? 'anthropic/claude-sonnet-4-20250514';

const skip = !apiKey;

let runtime: NimRuntime;
let session: SessionHandle;

if (!skip) {
  const providerRouter = new NimProviderRouter();
  providerRouter.registerDriver(createAnthropicNimProviderDriver({ apiKey }));
  runtime = new InMemoryNimRuntime({
    providerRouter,
    eventStore: new InMemoryNimEventStore(),
    sessionStore: new InMemoryNimSessionStore(),
  });
  (runtime as InMemoryNimRuntime).registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: [model],
  });
}

describe('nim agent integration', () => {
  if (skip) {
    test('SKIPPED — no ANTHROPIC_API_KEY', () => {
      console.log('Set ANTHROPIC_API_KEY in ~/.harness/secrets.env to run this test');
    });
    return;
  }

  test('start session', async () => {
    session = await runtime.startSession({
      tenantId: 'test',
      userId: 'test-user',
      model,
    });
    assert.ok(session.sessionId.length > 0);
    assert.equal(session.model, model);
  }, 10_000);

  test('send turn and receive streaming response', async () => {
    // Subscribe to session-level stream BEFORE sending turn
    const events: NimUiEvent[] = [];
    const uiStream = runtime.streamUi({
      tenantId: 'test',
      sessionId: session.sessionId,
      mode: 'seamless',
    });

    const turnHandle = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'Say "hello world" and nothing else.',
      idempotencyKey: 'test-turn-1',
    });
    assert.ok(turnHandle.runId.length > 0);

    // Consume events until the turn completes
    const done = turnHandle.done;
    const streamPromise = (async () => {
      for await (const event of uiStream) {
        events.push(event);
        if (event.type === 'assistant.state' && event.state === 'idle') break;
      }
    })();

    await Promise.race([
      Promise.all([done, streamPromise]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000)),
    ]);

    assert.ok(events.length > 0, 'Should receive at least one UI event');

    const textEvents = events.filter(
      (e) => e.type === 'assistant.text.delta' || e.type === 'assistant.text.message',
    );
    assert.ok(textEvents.length > 0, 'Should receive text events');

    const fullText = textEvents
      .filter((e) => e.type === 'assistant.text.delta')
      .map((e) => (e as { type: 'assistant.text.delta'; text: string }).text)
      .join('');

    const messageText = textEvents.find((e) => e.type === 'assistant.text.message');

    const responseText = messageText
      ? (messageText as { type: 'assistant.text.message'; text: string }).text
      : fullText;

    assert.ok(
      responseText.toLowerCase().includes('hello'),
      `Response should contain "hello": "${responseText}"`,
    );

    const result = await turnHandle.done;
    assert.equal(result.terminalState, 'completed');
  }, 30_000);

  test('send second turn in same session', async () => {
    const events: NimUiEvent[] = [];
    const uiStream = runtime.streamUi({
      tenantId: 'test',
      sessionId: session.sessionId,
      mode: 'seamless',
    });

    const turnHandle = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'What did I just ask you to say?',
      idempotencyKey: 'test-turn-2',
    });

    const streamPromise = (async () => {
      for await (const event of uiStream) {
        events.push(event);
        if (event.type === 'assistant.state' && event.state === 'idle') break;
      }
    })();

    await Promise.race([
      Promise.all([turnHandle.done, streamPromise]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000)),
    ]);

    const textEvents = events.filter((e) => e.type === 'assistant.text.delta');
    const text = textEvents
      .map((e) => (e as { type: 'assistant.text.delta'; text: string }).text)
      .join('');
    assert.ok(text.toLowerCase().includes('hello'), `Should remember previous turn: "${text}"`);
  }, 30_000);
});
