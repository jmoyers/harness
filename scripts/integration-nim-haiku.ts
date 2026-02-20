import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import { createAnthropic, streamText } from '../packages/harness-ai/src/index.ts';
import {
  InMemoryNimRuntime,
  createAnthropicNimProviderDriver,
  type NimEventEnvelope,
  type NimUiEvent,
} from '../packages/nim-core/src/index.ts';

interface ParsedArgs {
  readonly secretsFile: string;
  readonly models: readonly string[];
  readonly baseUrl?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: {
    secretsFile?: string;
    model?: string;
    baseUrl?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--secrets-file') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --secrets-file');
      }
      parsed.secretsFile = value;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --model');
      }
      parsed.model = value;
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --base-url');
      }
      parsed.baseUrl = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    secretsFile:
      parsed.secretsFile ??
      resolve(process.env.HOME ?? process.cwd(), 'dev/harness/.harness/secrets.env'),
    models:
      parsed.model === undefined
        ? ([
            'claude-3-5-haiku-latest',
            'claude-3-5-haiku-20241022',
            'claude-3-haiku-20240307',
          ] as const)
        : [parsed.model],
    ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
  };
}

async function collectAsync<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of stream) {
    output.push(value);
  }
  return output;
}

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs = 20000,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timed out waiting for nim integration event'));
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

function collapseStateTransitions(events: readonly NimUiEvent[]): string[] {
  const collapsed: string[] = [];
  for (const event of events) {
    if (event.type !== 'assistant.state') {
      continue;
    }
    if (collapsed[collapsed.length - 1] === event.state) {
      continue;
    }
    collapsed.push(event.state);
  }
  return collapsed;
}

function includesOrderedSubsequence(
  observed: readonly string[],
  expected: readonly string[],
): boolean {
  let cursor = 0;
  for (const item of observed) {
    if (item === expected[cursor]) {
      cursor += 1;
      if (cursor === expected.length) {
        return true;
      }
    }
  }
  return false;
}

async function runNimRuntimeHaikuObservabilityCheck(input: {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
}): Promise<{ readonly stateTransitions: readonly string[] }> {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: [`anthropic/${input.modelId}`],
  });
  runtime.registerProviderDriver(
    createAnthropicNimProviderDriver({
      apiKey: input.apiKey,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    }),
  );
  runtime.registerTools([
    {
      name: 'ping',
      description: 'Echo a string',
    },
  ]);

  const session = await runtime.startSession({
    tenantId: 'nim-haiku-tenant',
    userId: 'nim-haiku-user',
    model: `anthropic/${input.modelId}`,
  });

  const uiStream = runtime.streamUi({
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    mode: 'debug',
  });
  const eventStream = runtime.streamEvents({
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    includeThoughtDeltas: true,
    includeToolArgumentDeltas: true,
  });
  const uiIterator = uiStream[Symbol.asyncIterator]();
  const eventIterator = eventStream[Symbol.asyncIterator]();

  try {
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: [
        'Call the `ping` tool exactly once with {"value":"nim-haiku"}.',
        'After the tool returns, respond exactly with NIM_HAIKU_OK.',
        'Do not output any extra text.',
      ].join(' '),
      idempotencyKey: `nim-haiku-runtime:${input.modelId}`,
    });

    const [turnResult, uiEvents, runEvents] = await Promise.all([
      turn.done,
      collectUntil(
        uiIterator,
        (items) =>
          items.some((event) => event.type === 'assistant.state' && event.state === 'idle'),
        800,
      ),
      collectUntil(
        eventIterator,
        (items) =>
          items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
        800,
      ),
    ]);

    assert.equal(turnResult.terminalState, 'completed');

    const stateTransitions = collapseStateTransitions(uiEvents);
    assert.equal(
      includesOrderedSubsequence(stateTransitions, [
        'thinking',
        'tool-calling',
        'responding',
        'idle',
      ]),
      true,
    );

    const assistantText = uiEvents
      .filter((event): event is Extract<NimUiEvent, { type: 'assistant.text.delta' }> => {
        return event.type === 'assistant.text.delta';
      })
      .map((event) => event.text)
      .join('');
    assert.match(assistantText, /NIM_HAIKU_OK/u);
    assert.equal(
      uiEvents.some((event) => event.type === 'tool.activity' && event.phase === 'start'),
      true,
    );
    assert.equal(
      uiEvents.some((event) => event.type === 'tool.activity' && event.phase === 'end'),
      true,
    );

    const runOutput = runEvents
      .filter((event): event is NimEventEnvelope & { type: 'assistant.output.delta' } => {
        return event.type === 'assistant.output.delta';
      })
      .map((event) => String(event.data?.['text'] ?? ''))
      .join('');
    const runMessage = runEvents.find(
      (event): event is NimEventEnvelope & { type: 'assistant.output.message' } => {
        return event.type === 'assistant.output.message';
      },
    );
    assert.match(runOutput, /NIM_HAIKU_OK/u);
    assert.match(String(runMessage?.data?.['text'] ?? ''), /NIM_HAIKU_OK/u);
    assert.equal(
      runEvents.some((event) => event.type === 'provider.thinking.started'),
      true,
    );
    assert.equal(
      runEvents.some((event) => event.type === 'provider.thinking.completed'),
      true,
    );
    assert.equal(
      runEvents.some((event) => event.type === 'tool.call.started'),
      true,
    );
    assert.equal(
      runEvents.some((event) => event.type === 'tool.call.completed'),
      true,
    );
    assert.equal(
      runEvents.some((event) => event.type === 'tool.result.emitted'),
      true,
    );

    return {
      stateTransitions,
    };
  } finally {
    await uiIterator.return?.();
    await eventIterator.return?.();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadHarnessSecrets({
    cwd: process.cwd(),
    filePath: args.secretsFile,
    overrideExisting: false,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('ANTHROPIC_API_KEY was not found after loading secrets');
  }

  const anthropic = createAnthropic({
    apiKey,
    ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
  });

  const failures: string[] = [];
  for (const modelId of args.models) {
    try {
      const model = anthropic(modelId);
      const result = streamText({
        model,
        prompt: [
          'Call the `ping` tool exactly once with {"value":"nim-haiku"}.',
          'After the tool returns, respond exactly with NIM_HAIKU_OK.',
          'Do not output any extra text.',
        ].join(' '),
        temperature: 0,
        maxOutputTokens: 128,
        tools: {
          ping: {
            description: 'Echo a string',
            inputSchema: {
              type: 'object',
              properties: {
                value: {
                  type: 'string',
                },
              },
              required: ['value'],
            },
            execute: (input: unknown) => {
              if (typeof input !== 'object' || input === null) {
                return {
                  ok: false,
                  echoed: '',
                };
              }
              const value = (input as { value?: unknown }).value;
              return {
                ok: typeof value === 'string',
                echoed: typeof value === 'string' ? value : '',
              };
            },
          },
        },
      });

      const [parts, text, toolCalls, toolResults, finishReason] = await Promise.all([
        collectAsync(result.fullStream),
        result.text,
        result.toolCalls,
        result.toolResults,
        result.finishReason,
      ]);

      const sawToolCall = parts.some((part) => part.type === 'tool-call');
      const sawToolResult = parts.some((part) => part.type === 'tool-result');
      const sawTextDelta = parts.some((part) => part.type === 'text-delta');
      const sawReasoningSignal = parts.some(
        (part) => part.type === 'reasoning-start' || part.type === 'reasoning-delta',
      );

      assert.equal(finishReason, 'stop');
      assert.equal(sawToolCall, true);
      assert.equal(sawToolResult, true);
      assert.equal(sawTextDelta, true);
      assert.equal(toolCalls.length >= 1, true);
      assert.equal(toolResults.length >= 1, true);
      assert.match(text, /NIM_HAIKU_OK/u);

      const runtimeObservability = await runNimRuntimeHaikuObservabilityCheck({
        apiKey,
        modelId,
        ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
      });

      process.stdout.write('nim haiku integration passed\n');
      process.stdout.write(`model=${modelId}\n`);
      process.stdout.write(`stream_parts=${String(parts.length)}\n`);
      process.stdout.write(`tool_calls=${String(toolCalls.length)}\n`);
      process.stdout.write(`tool_results=${String(toolResults.length)}\n`);
      process.stdout.write(`reasoning_signals=${String(sawReasoningSignal)}\n`);
      process.stdout.write(
        `runtime_state_transitions=${runtimeObservability.stateTransitions.join('>')}\n`,
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${modelId}: ${message}`);
    }
  }

  throw new Error(`nim haiku integration failed for all candidates\n${failures.join('\n')}`);
}

await main();
