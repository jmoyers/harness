import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { NimApp } from '../../../packages/nim/src/app/nim-app.ts';
import { ComposerSubmitted } from '../../../packages/harness-ui/src/widgets/composer.ts';
import type {
  NimRuntime,
  NimModelRef,
  SessionHandle,
  TurnHandle,
  StartSessionInput,
  ResumeSessionInput,
  ListSessionsInput,
  ListSessionsResult,
  SwitchModelInput,
  SendTurnInput,
  AbortTurnInput,
  SteerTurnInput,
  SteerTurnResult,
  QueueTurnInput,
  QueueTurnResult,
  CompactSessionInput,
  CompactionResult,
  StreamEventsInput,
  StreamUiInput,
  ReplayEventsInput,
  ReplayEventsResult,
  NimToolDefinition,
  NimToolPolicy,
  NimProvider,
  NimTelemetrySink,
  NimUiEvent,
  SoulSource,
  SkillSource,
  MemoryStore,
  SoulSnapshot,
  SkillsSnapshot,
  MemorySnapshot,
} from '../../../packages/nim-core/src/contracts.ts';

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {}

async function waitFor(predicate: () => boolean, timeoutMs = 2000, pollMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('timed out waiting for condition');
}

function createRuntimeStub(): NimRuntime {
  return {
    async startSession(_input: StartSessionInput): Promise<SessionHandle> {
      return {
        sessionId: 'session-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        model: 'anthropic/claude-sonnet-4-20250514',
        lane: 'session:session-1',
      };
    },
    async resumeSession(_input: ResumeSessionInput): Promise<SessionHandle> {
      throw new Error('not implemented in test');
    },
    async listSessions(_input: ListSessionsInput): Promise<ListSessionsResult> {
      return {
        sessions: [],
      };
    },
    registerTools(_tools: readonly NimToolDefinition[]): void {},
    setToolPolicy(_policy: NimToolPolicy): void {},
    registerProvider(_provider: NimProvider): void {},
    async switchModel(_input: SwitchModelInput): Promise<void> {},
    registerTelemetrySink(_sink: NimTelemetrySink): void {},
    registerSoulSource(_source: SoulSource): void {},
    registerSkillSource(_source: SkillSource): void {},
    registerMemoryStore(_store: MemoryStore): void {},
    async loadSoul(): Promise<SoulSnapshot> {
      return { hash: 'soul' };
    },
    async loadSkills(): Promise<SkillsSnapshot> {
      return { hash: 'skills', version: 1 };
    },
    async loadMemory(): Promise<MemorySnapshot> {
      return { hash: 'memory' };
    },
    async sendTurn(_input: SendTurnInput): Promise<TurnHandle> {
      throw new Error('not implemented in test');
    },
    async abortTurn(_input: AbortTurnInput): Promise<void> {},
    async steerTurn(_input: SteerTurnInput): Promise<SteerTurnResult> {
      return { accepted: false, reason: 'no-active-run' };
    },
    async queueTurn(_input: QueueTurnInput): Promise<QueueTurnResult> {
      return { queued: false, reason: 'queue-full' };
    },
    async compactSession(_input: CompactSessionInput): Promise<CompactionResult> {
      return { compacted: false };
    },
    streamEvents(_input: StreamEventsInput): AsyncIterable<never> {
      return emptyAsyncIterable();
    },
    streamUi(_input: StreamUiInput): AsyncIterable<never> {
      return emptyAsyncIterable();
    },
    async replayEvents(_input: ReplayEventsInput): Promise<ReplayEventsResult> {
      return { events: [] };
    },
  };
}

test('nim app API key onboarding saves key and exits setup mode', () => {
  let configured = false;
  const saved: string[] = [];
  const configuredKeys: string[] = [];
  const app = new NimApp({
    runtime: createRuntimeStub(),
    model: 'anthropic/claude-sonnet-4-20250514' as NimModelRef,
    tenantId: 'tenant-1',
    userId: 'user-1',
    requiredApiKey: {
      envVar: 'ANTHROPIC_API_KEY',
      displayName: 'Anthropic API Key',
    },
    hasRequiredApiKey: () => configured,
    saveRequiredApiKey: (input) => {
      saved.push(`${input.envVar}:${input.value}`);
    },
    configureRequiredApiKey: (apiKey) => {
      configured = true;
      configuredKeys.push(apiKey);
    },
  });
  const composer = app.queryOne('#composer') as { placeholder?: string } | null;
  assert.equal((composer?.placeholder ?? '').includes('ANTHROPIC_API_KEY'), true);

  app.onComposerSubmitted(new ComposerSubmitted('sk-ant-test'));

  assert.deepEqual(saved, ['ANTHROPIC_API_KEY:sk-ant-test']);
  assert.deepEqual(configuredKeys, ['sk-ant-test']);
  assert.equal(composer?.placeholder, 'Ask anything...');
});

test('nim app streams assistant response deltas into a single visible message', async () => {
  const streamedUiEvents: readonly NimUiEvent[] = [
    { type: 'assistant.state', state: 'responding' },
    { type: 'assistant.text.delta', text: 'Hel' },
    { type: 'assistant.text.delta', text: 'lo' },
    { type: 'assistant.text.message', text: 'Hello' },
    { type: 'assistant.state', state: 'idle' },
  ];
  const runtime = createRuntimeStub();
  runtime.sendTurn = async (_input: SendTurnInput): Promise<TurnHandle> => {
    return {
      runId: 'run-stream',
      sessionId: 'session-1',
      idempotencyKey: 'turn-1',
      done: Promise.resolve({
        runId: 'run-stream',
        terminalState: 'completed',
      }),
    };
  };
  runtime.streamUi = (_input: StreamUiInput): AsyncIterable<NimUiEvent> => {
    return {
      async *[Symbol.asyncIterator]() {
        for (const event of streamedUiEvents) {
          yield event;
        }
      },
    };
  };

  const app = new NimApp({
    runtime,
    model: 'anthropic/claude-sonnet-4-20250514' as NimModelRef,
    tenantId: 'tenant-1',
    userId: 'user-1',
  });

  app.onComposerSubmitted(new ComposerSubmitted('hello'));

  const conversation = app.queryOne('#conv') as { messages?: Array<{ text: string }> } | null;
  await waitFor(() => {
    const messages = conversation?.messages;
    if (messages === undefined) {
      return false;
    }
    return messages.length === 2 && messages[1]?.text === 'Hello';
  });

  assert.equal(conversation === null, false);
  const messages = conversation?.messages ?? [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.text, 'hello');
  assert.equal(messages[1]?.text, 'Hello');
});

test('nim app tracks repeated tool names by toolCallId instead of name collisions', async () => {
  const streamedUiEvents: readonly NimUiEvent[] = [
    { type: 'assistant.state', state: 'responding' },
    { type: 'tool.activity', phase: 'start', toolCallId: 'call-a', toolName: 'directory.list' },
    { type: 'tool.activity', phase: 'start', toolCallId: 'call-b', toolName: 'directory.list' },
    { type: 'tool.activity', phase: 'error', toolCallId: 'call-a', toolName: 'directory.list' },
    { type: 'tool.activity', phase: 'end', toolCallId: 'call-b', toolName: 'directory.list' },
    { type: 'assistant.state', state: 'idle' },
  ];
  const runtime = createRuntimeStub();
  runtime.sendTurn = async (_input: SendTurnInput): Promise<TurnHandle> => {
    return {
      runId: 'run-tools',
      sessionId: 'session-1',
      idempotencyKey: 'turn-1',
      done: Promise.resolve({
        runId: 'run-tools',
        terminalState: 'completed',
      }),
    };
  };
  runtime.streamUi = (_input: StreamUiInput): AsyncIterable<NimUiEvent> => {
    return {
      async *[Symbol.asyncIterator]() {
        for (const event of streamedUiEvents) {
          yield event;
        }
      },
    };
  };

  const app = new NimApp({
    runtime,
    model: 'anthropic/claude-sonnet-4-20250514' as NimModelRef,
    tenantId: 'tenant-1',
    userId: 'user-1',
  });

  app.onComposerSubmitted(new ComposerSubmitted('show me directories'));

  const conversation = app.queryOne('#conv') as {
    messages?: Array<{ tools: Array<{ id: string; status: string }> }>;
  } | null;
  await waitFor(() => {
    const messages = conversation?.messages;
    if (messages === undefined || messages.length < 2) {
      return false;
    }
    return messages[1]?.tools.length === 2;
  });

  const assistantTools = conversation?.messages?.[1]?.tools ?? [];
  assert.equal(assistantTools.length, 2);
  const toolById = new Map(assistantTools.map((tool) => [tool.id, tool.status]));
  assert.equal(toolById.get('call-a'), 'error');
  assert.equal(toolById.get('call-b'), 'done');
});
