import { randomUUID } from 'node:crypto';

type EventSource = 'provider' | 'meta';

type ProviderEventType =
  | 'provider-thread-started'
  | 'provider-turn-started'
  | 'provider-turn-completed'
  | 'provider-turn-failed'
  | 'provider-turn-interrupted'
  | 'provider-diff-updated'
  | 'provider-text-delta'
  | 'provider-tool-call-started'
  | 'provider-tool-call-completed';

type MetaEventType =
  | 'meta-attention-raised'
  | 'meta-attention-cleared'
  | 'meta-queue-updated'
  | 'meta-notify-observed'
  | 'meta-conversation-handoff';

type EventType = ProviderEventType | MetaEventType;

export interface EventScope {
  tenantId: string;
  userId: string;
  workspaceId: string;
  worktreeId: string;
  conversationId: string;
  turnId?: string;
}

interface BaseEventPayload {
  kind: string;
}

interface ThreadEventPayload extends BaseEventPayload {
  kind: 'thread';
  threadId: string;
}

interface TurnEventPayload extends BaseEventPayload {
  kind: 'turn';
  threadId: string;
  turnId: string;
  status: 'in-progress' | 'completed' | 'failed' | 'interrupted';
}

interface TextDeltaPayload extends BaseEventPayload {
  kind: 'text-delta';
  threadId: string;
  turnId: string;
  delta: string;
}

interface DiffUpdatedPayload extends BaseEventPayload {
  kind: 'diff-updated';
  threadId: string;
  turnId: string;
  summary: string;
}

interface ToolPayload extends BaseEventPayload {
  kind: 'tool';
  threadId: string;
  turnId: string;
  toolName: string;
}

interface AttentionPayload extends BaseEventPayload {
  kind: 'attention';
  threadId: string;
  turnId: string;
  reason: 'approval' | 'user-input' | 'stalled';
  detail: string;
}

interface QueuePayload extends BaseEventPayload {
  kind: 'queue';
  queueSize: number;
}

interface NotifyObservedPayload extends BaseEventPayload {
  kind: 'notify';
  notifyType: string;
  raw: Record<string, unknown>;
}

type EventPayload =
  | AttentionPayload
  | DiffUpdatedPayload
  | NotifyObservedPayload
  | QueuePayload
  | TextDeltaPayload
  | ThreadEventPayload
  | ToolPayload
  | TurnEventPayload;

export interface NormalizedEventEnvelope {
  schemaVersion: '1';
  eventId: string;
  source: EventSource;
  type: EventType;
  ts: string;
  scope: EventScope;
  payload: EventPayload;
}

function nowIsoString(clock?: () => Date): string {
  const value = clock?.() ?? new Date();
  return value.toISOString();
}

export function createNormalizedEvent(
  source: EventSource,
  type: EventType,
  scope: EventScope,
  payload: EventPayload,
  clock?: () => Date,
  idFactory?: () => string
): NormalizedEventEnvelope {
  return {
    schemaVersion: '1',
    eventId: idFactory?.() ?? randomUUID(),
    source,
    type,
    ts: nowIsoString(clock),
    scope,
    payload
  };
}
