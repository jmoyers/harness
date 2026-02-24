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
  SoulSource,
  SkillSource,
  MemoryStore,
  SoulSnapshot,
  SkillsSnapshot,
  MemorySnapshot,
} from '../../../packages/nim-core/src/contracts.ts';

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {}

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
