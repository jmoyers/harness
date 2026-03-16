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

const NON_DESTRUCTIVE_PROJECT_IDS = [
  'directory-harness',
  'directory-38a742d3-cf48-4d2a-9fa2-4ce4e0fcc334',
  'directory-8785421d-893e-4238-a327-e0b9adb74ad6',
  'directory-1f758ddc-cb25-4451-b1e3-5a912af21b7f',
  'directory-da829d18-56e6-403b-bddf-b953bd349750',
] as const;
const NON_DESTRUCTIVE_PROJECT_ID_SET = new Set<string>(NON_DESTRUCTIVE_PROJECT_IDS);

const NON_DESTRUCTIVE_FANOUT_PROMPT = [
  'Use tools only. Do not run shell commands.',
  'First call `project_list` once.',
  'Then call `thread_create` exactly once per project using title `git pull main` and agentType `shell`.',
  'Then call `thread_respond` exactly once per created thread with text `git pull main`.',
  'Finally reply exactly with FANOUT_OK.',
].join(' ');

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, key: string): string | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const field = record[key];
  return typeof field === 'string' && field.trim().length > 0 ? field.trim() : null;
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
        'After the tool returns, respond exactly with nim_haiku_ok.',
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
    assert.match(assistantText, /nim_haiku_ok/u);
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
    assert.match(runOutput, /nim_haiku_ok/u);
    assert.match(String(runMessage?.data?.['text'] ?? ''), /nim_haiku_ok/u);
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

async function runAgentSdkHaikuFanoutCheck(input: {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
}): Promise<{
  readonly finishReason: string;
  readonly toolCalls: number;
  readonly toolResults: number;
}> {
  const anthropic = createAnthropic({
    apiKey: input.apiKey,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
  });
  const model = anthropic(input.modelId);

  let projectListCallCount = 0;
  const createdThreadIdsByProject = new Map<string, string>();
  const respondedThreadIds = new Set<string>();

  const result = streamText({
    model,
    prompt: NON_DESTRUCTIVE_FANOUT_PROMPT,
    temperature: 0,
    maxOutputTokens: 2048,
    maxToolRoundtrips: 128,
    tools: {
      project_list: {
        description: 'List non-destructive in-memory projects.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: () => {
          projectListCallCount += 1;
          return {
            projects: NON_DESTRUCTIVE_PROJECT_IDS.map((projectId) => ({ projectId })),
          };
        },
      },
      thread_create: {
        description: 'Create an in-memory thread id for a project.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            title: { type: 'string' },
            agentType: { type: 'string' },
          },
          required: ['projectId', 'title', 'agentType'],
          additionalProperties: false,
        },
        execute: (toolInput: unknown) => {
          const projectId = readString(toolInput, 'projectId');
          if (projectId === null || !NON_DESTRUCTIVE_PROJECT_ID_SET.has(projectId)) {
            return { ok: false, error: 'invalid projectId' };
          }
          const existing = createdThreadIdsByProject.get(projectId);
          if (existing !== undefined) {
            return { ok: true, threadId: existing, projectId, reused: true };
          }
          const threadId = `thread-${String(createdThreadIdsByProject.size + 1)}`;
          createdThreadIdsByProject.set(projectId, threadId);
          return { ok: true, threadId, projectId, reused: false };
        },
      },
      thread_respond: {
        description: 'Record a non-destructive in-memory response payload.',
        inputSchema: {
          type: 'object',
          properties: {
            threadId: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['threadId', 'text'],
          additionalProperties: false,
        },
        execute: (toolInput: unknown) => {
          const threadId = readString(toolInput, 'threadId');
          const text = readString(toolInput, 'text');
          if (threadId === null || text === null) {
            return { ok: false, error: 'invalid thread.respond payload' };
          }
          respondedThreadIds.add(threadId);
          return { ok: true, threadId, text };
        },
      },
    },
  });

  const [text, toolCalls, toolResults, finishReason] = await Promise.all([
    result.text,
    result.toolCalls,
    result.toolResults,
    result.finishReason,
  ]);

  const threadCreateCalls = toolCalls.filter((call) => String(call.toolName) === 'thread_create');
  const threadRespondCalls = toolCalls.filter((call) => String(call.toolName) === 'thread_respond');

  assert.equal(finishReason, 'stop');
  assert.equal(projectListCallCount >= 1, true);
  assert.equal(threadCreateCalls.length >= NON_DESTRUCTIVE_PROJECT_IDS.length, true);
  assert.equal(threadRespondCalls.length >= NON_DESTRUCTIVE_PROJECT_IDS.length, true);
  assert.equal(createdThreadIdsByProject.size >= NON_DESTRUCTIVE_PROJECT_IDS.length, true);
  assert.equal(respondedThreadIds.size >= NON_DESTRUCTIVE_PROJECT_IDS.length, true);
  assert.match(text, /FANOUT_OK/u);

  return {
    finishReason,
    toolCalls: toolCalls.length,
    toolResults: toolResults.length,
  };
}

async function runNimRuntimeHaikuFanoutCheck(input: {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
}): Promise<{
  readonly toolCallsStarted: number;
  readonly toolCallsCompleted: number;
  readonly pendingToolCalls: number;
}> {
  const createdThreadIdsByProject = new Map<string, string>();
  const respondedThreadIds = new Set<string>();

  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: [`anthropic/${input.modelId}`],
  });
  runtime.registerProviderDriver(
    createAnthropicNimProviderDriver({
      apiKey: input.apiKey,
      maxOutputTokens: 2048,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      executeTool: async ({ toolName, toolInput }) => {
        if (toolName === 'project_list') {
          return {
            projects: NON_DESTRUCTIVE_PROJECT_IDS.map((projectId) => ({ projectId })),
          };
        }
        if (toolName === 'thread_create') {
          const projectId = readString(toolInput, 'projectId');
          if (projectId === null || !NON_DESTRUCTIVE_PROJECT_ID_SET.has(projectId)) {
            return { ok: false, error: 'invalid projectId' };
          }
          const existing = createdThreadIdsByProject.get(projectId);
          if (existing !== undefined) {
            return { ok: true, threadId: existing, projectId, reused: true };
          }
          const threadId = `thread-${String(createdThreadIdsByProject.size + 1)}`;
          createdThreadIdsByProject.set(projectId, threadId);
          return { ok: true, threadId, projectId, reused: false };
        }
        if (toolName === 'thread_respond') {
          const threadId = readString(toolInput, 'threadId');
          const text = readString(toolInput, 'text');
          if (threadId === null || text === null) {
            return { ok: false, error: 'invalid thread.respond payload' };
          }
          respondedThreadIds.add(threadId);
          return { ok: true, threadId, text };
        }
        return { ok: false, error: `unsupported tool ${toolName}` };
      },
    }),
  );

  runtime.registerTools([
    {
      name: 'project_list',
      description: 'List non-destructive in-memory projects.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'thread_create',
      description: 'Create an in-memory thread id for a project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          agentType: { type: 'string' },
        },
        required: ['projectId', 'title', 'agentType'],
        additionalProperties: false,
      },
    },
    {
      name: 'thread_respond',
      description: 'Record a non-destructive in-memory response payload.',
      inputSchema: {
        type: 'object',
        properties: {
          threadId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['threadId', 'text'],
        additionalProperties: false,
      },
    },
  ]);

  const session = await runtime.startSession({
    tenantId: 'nim-haiku-fanout-tenant',
    userId: 'nim-haiku-fanout-user',
    model: `anthropic/${input.modelId}`,
  });
  const eventStream = runtime.streamEvents({
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    includeThoughtDeltas: false,
    includeToolArgumentDeltas: false,
  });
  const eventIterator = eventStream[Symbol.asyncIterator]();

  try {
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: NON_DESTRUCTIVE_FANOUT_PROMPT,
      idempotencyKey: `nim-haiku-runtime-fanout:${input.modelId}`,
    });

    const [turnResult, runEvents] = await Promise.all([
      turn.done,
      collectUntil(
        eventIterator,
        (items) =>
          items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
        2000,
      ),
    ]);

    assert.equal(turnResult.terminalState, 'completed');
    assert.equal(turnResult.toolCalls?.pending ?? -1, 0);
    assert.equal(createdThreadIdsByProject.size >= NON_DESTRUCTIVE_PROJECT_IDS.length, true);
    assert.equal(respondedThreadIds.size >= NON_DESTRUCTIVE_PROJECT_IDS.length, true);
    assert.equal(
      runEvents.some((event) => event.type === 'turn.failed' && event.run_id === turn.runId),
      false,
    );

    const terminal = runEvents.find(
      (event): event is NimEventEnvelope & { type: 'turn.completed' } => {
        return event.type === 'turn.completed' && event.run_id === turn.runId;
      },
    );
    const pendingToolCalls = Number(terminal?.data?.['openToolCallsPending'] ?? -1);
    assert.equal(String(terminal?.data?.['terminalReason'] ?? ''), 'completed');
    assert.equal(pendingToolCalls, 0);

    return {
      toolCallsStarted: runEvents.filter((event) => event.type === 'tool.call.started').length,
      toolCallsCompleted: runEvents.filter((event) => event.type === 'tool.call.completed').length,
      pendingToolCalls,
    };
  } finally {
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
          'After the tool returns, respond exactly with nim_haiku_ok.',
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
      assert.match(text, /nim_haiku_ok/u);

      const runtimeObservability = await runNimRuntimeHaikuObservabilityCheck({
        apiKey,
        modelId,
        ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
      });
      const sdkFanout = await runAgentSdkHaikuFanoutCheck({
        apiKey,
        modelId,
        ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
      });
      const runtimeFanout = await runNimRuntimeHaikuFanoutCheck({
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
      process.stdout.write(`sdk_fanout_finish_reason=${sdkFanout.finishReason}\n`);
      process.stdout.write(`sdk_fanout_tool_calls=${String(sdkFanout.toolCalls)}\n`);
      process.stdout.write(`sdk_fanout_tool_results=${String(sdkFanout.toolResults)}\n`);
      process.stdout.write(
        `runtime_fanout_tool_calls_started=${String(runtimeFanout.toolCallsStarted)}\n`,
      );
      process.stdout.write(
        `runtime_fanout_tool_calls_completed=${String(runtimeFanout.toolCallsCompleted)}\n`,
      );
      process.stdout.write(
        `runtime_fanout_pending_tool_calls=${String(runtimeFanout.pendingToolCalls)}\n`,
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${modelId}: ${message}`);
    }
  }

  throw new Error(`nim haiku integration failed for all candidates\n${failures.join('\n')}`);
}

if (import.meta.main) {
  await main();
}

export const __integrationNimHaikuInternals = {
  parseArgs,
  readString,
};
