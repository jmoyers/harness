import type { NimEventEnvelope } from './events.ts';

export type NimProviderId = string;
export type NimModelRef = `${string}/${string}`;

export type NimToolPolicy = {
  readonly hash: string;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
};

export type NimProvider = {
  readonly id: NimProviderId;
  readonly displayName: string;
  readonly models: readonly NimModelRef[];
};

export type NimToolDefinition = {
  readonly name: string;
  readonly description: string;
};

export type SessionHandle = {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly model: NimModelRef;
  readonly lane: string;
  readonly soulHash?: string;
  readonly skillsSnapshotVersion?: number;
};

export type TurnResult = {
  readonly runId: string;
  readonly terminalState: 'completed' | 'failed' | 'aborted';
};

export type TurnHandle = {
  readonly runId: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly done: Promise<TurnResult>;
};

export type StartSessionInput = {
  readonly tenantId: string;
  readonly userId: string;
  readonly model: NimModelRef;
  readonly lane?: string;
};

export type ResumeSessionInput = {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
};

export type ListSessionsInput = {
  readonly tenantId: string;
  readonly userId: string;
};

export type ListSessionsResult = {
  readonly sessions: readonly SessionHandle[];
};

export type SwitchModelInput = {
  readonly sessionId: string;
  readonly model: NimModelRef;
  readonly reason: 'manual' | 'policy' | 'fallback';
};

export type SendTurnInput = {
  readonly sessionId: string;
  readonly input: string;
  readonly idempotencyKey: string;
  readonly lane?: string;
  readonly abortSignal?: AbortSignal;
};

export type AbortTurnInput = {
  readonly runId: string;
  readonly reason?: 'manual' | 'timeout' | 'policy';
};

export type CompactSessionInput = {
  readonly sessionId: string;
  readonly trigger: 'manual' | 'overflow' | 'policy';
  readonly includeMemoryFlush?: boolean;
};

export type CompactionResult = {
  readonly compacted: boolean;
  readonly summaryEventId?: string;
  readonly reason?: string;
};

export type SteerTurnInput = {
  readonly sessionId: string;
  readonly runId?: string;
  readonly text: string;
  readonly strategy: 'inject' | 'interrupt-and-restart';
};

export type SteerTurnResult = {
  readonly accepted: boolean;
  readonly reason?: 'no-active-run' | 'not-streaming' | 'compacting' | 'rate-limited';
  readonly replacedRunId?: string;
};

export type QueueFollowUpInput = {
  readonly sessionId: string;
  readonly text: string;
  readonly priority?: 'normal' | 'high';
  readonly dedupeKey?: string;
};

export type QueueFollowUpResult = {
  readonly queued: boolean;
  readonly queueId?: string;
  readonly position?: number;
  readonly reason?: 'duplicate' | 'queue-full' | 'invalid-state';
};

export type StreamEventsInput = {
  readonly tenantId: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly fromEventIdExclusive?: string;
  readonly fidelity?: 'raw' | 'semantic';
  readonly includeThoughtDeltas?: boolean;
  readonly includeToolArgumentDeltas?: boolean;
};

export type StreamUiInput = {
  readonly tenantId: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly mode: 'debug' | 'seamless';
};

export type ReplayEventsInput = {
  readonly tenantId: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly fromEventIdExclusive?: string;
  readonly toEventIdInclusive?: string;
  readonly fidelity?: 'raw' | 'semantic';
  readonly includeThoughtDeltas?: boolean;
  readonly includeToolArgumentDeltas?: boolean;
};

export type ReplayEventsResult = {
  readonly events: readonly NimEventEnvelope[];
};

export type NimTelemetrySink = {
  readonly name: string;
  record(event: NimEventEnvelope): void;
};

export type SoulSource = {
  readonly name: string;
};

export type SkillSource = {
  readonly name: string;
};

export type MemoryStore = {
  readonly name: string;
};

export type SoulSnapshot = {
  readonly hash: string;
};

export type SkillsSnapshot = {
  readonly hash: string;
  readonly version: number;
};

export type MemorySnapshot = {
  readonly hash: string;
};

export type NimUiEvent =
  | {
      readonly type: 'assistant.state';
      readonly state: 'thinking' | 'tool-calling' | 'responding' | 'idle';
    }
  | {
      readonly type: 'assistant.text.delta';
      readonly text: string;
    }
  | {
      readonly type: 'assistant.text.message';
      readonly text: string;
    }
  | {
      readonly type: 'tool.activity';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly phase: 'start' | 'end' | 'error';
    }
  | {
      readonly type: 'system.notice';
      readonly text: string;
    };

export interface NimRuntime {
  startSession(input: StartSessionInput): Promise<SessionHandle>;
  resumeSession(input: ResumeSessionInput): Promise<SessionHandle>;
  listSessions(input: ListSessionsInput): Promise<ListSessionsResult>;

  registerTools(tools: readonly NimToolDefinition[]): void;
  setToolPolicy(policy: NimToolPolicy): void;

  registerProvider(provider: NimProvider): void;
  switchModel(input: SwitchModelInput): Promise<void>;
  registerTelemetrySink(sink: NimTelemetrySink): void;

  registerSoulSource(source: SoulSource): void;
  registerSkillSource(source: SkillSource): void;
  registerMemoryStore(store: MemoryStore): void;

  loadSoul(): Promise<SoulSnapshot>;
  loadSkills(): Promise<SkillsSnapshot>;
  loadMemory(): Promise<MemorySnapshot>;

  sendTurn(input: SendTurnInput): Promise<TurnHandle>;
  abortTurn(input: AbortTurnInput): Promise<void>;
  steerTurn(input: SteerTurnInput): Promise<SteerTurnResult>;
  queueFollowUp(input: QueueFollowUpInput): Promise<QueueFollowUpResult>;

  compactSession(input: CompactSessionInput): Promise<CompactionResult>;

  streamEvents(input: StreamEventsInput): AsyncIterable<NimEventEnvelope>;
  streamUi(input: StreamUiInput): AsyncIterable<NimUiEvent>;
  replayEvents(input: ReplayEventsInput): Promise<ReplayEventsResult>;
}
