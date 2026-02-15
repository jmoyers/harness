import type { ControlPlaneKeyEvent } from '../control-plane/codex-session-stream.ts';
import type {
  StreamSessionController,
  StreamSessionRuntimeStatus
} from '../control-plane/stream-protocol.ts';

interface MuxTelemetrySummaryInput {
  readonly source: string;
  readonly eventName: string | null;
  readonly summary: string | null;
  readonly observedAt: string;
}

export interface MuxRuntimeConversationState {
  directoryId: string | null;
  status: StreamSessionRuntimeStatus;
  attentionReason: string | null;
  live: boolean;
  controller: StreamSessionController | null;
  lastEventAt: string | null;
  lastKnownWork: string | null;
  lastKnownWorkAt: string | null;
  lastTelemetrySource: string | null;
}

interface EnsureConversationSeed {
  directoryId?: string | null;
}

interface ApplyMuxControlPlaneKeyEventOptions<TConversation extends MuxRuntimeConversationState> {
  readonly removedConversationIds: ReadonlySet<string>;
  ensureConversation: (sessionId: string, seed?: EnsureConversationSeed) => TConversation;
}

function normalizeInlineSummaryText(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  if (compact.length <= 96) {
    return compact;
  }
  return `${compact.slice(0, 95)}…`;
}

export function telemetrySummaryText(summary: Omit<MuxTelemetrySummaryInput, 'observedAt'>): string | null {
  const eventName = summary.eventName?.trim() ?? '';
  const description = summary.summary?.trim() ?? '';
  const merged =
    description.length > 0 && eventName.length > 0 && !description.includes(eventName)
      ? `${eventName}: ${description}`
      : description.length > 0
        ? description
        : eventName.length > 0
          ? eventName
          : summary.source;
  const normalized = normalizeInlineSummaryText(merged);
  return normalized.length === 0 ? null : normalized;
}

export function applyTelemetrySummaryToConversation<TConversation extends MuxRuntimeConversationState>(
  target: TConversation,
  telemetry: MuxTelemetrySummaryInput | null
): void {
  if (telemetry === null) {
    return;
  }
  target.lastKnownWork = telemetrySummaryText(telemetry);
  target.lastKnownWorkAt = telemetry.observedAt;
  target.lastTelemetrySource = telemetry.source;
}

export function applyMuxControlPlaneKeyEvent<TConversation extends MuxRuntimeConversationState>(
  event: ControlPlaneKeyEvent,
  options: ApplyMuxControlPlaneKeyEventOptions<TConversation>
): TConversation | null {
  if (options.removedConversationIds.has(event.sessionId)) {
    return null;
  }
  const conversation = options.ensureConversation(event.sessionId, {
    directoryId: event.directoryId
  });
  if (event.directoryId !== null) {
    conversation.directoryId = event.directoryId;
  }

  if (event.type === 'session-status') {
    conversation.status = event.status;
    conversation.attentionReason = event.attentionReason;
    conversation.live = event.live;
    conversation.controller = event.controller;
    conversation.lastEventAt = event.ts;
    applyTelemetrySummaryToConversation(conversation, event.telemetry);
    return conversation;
  }

  if (event.type === 'session-control') {
    conversation.controller = event.controller;
    conversation.lastEventAt = event.ts;
    return conversation;
  }

  applyTelemetrySummaryToConversation(conversation, {
    source: event.keyEvent.source,
    eventName: event.keyEvent.eventName,
    summary: event.keyEvent.summary,
    observedAt: event.keyEvent.observedAt
  });
  conversation.lastEventAt = event.keyEvent.observedAt;
  if (event.keyEvent.statusHint === 'needs-input') {
    conversation.status = 'needs-input';
    conversation.attentionReason = 'telemetry';
    return conversation;
  }
  if (event.keyEvent.statusHint === 'running' && conversation.status !== 'exited') {
    conversation.status = 'running';
    conversation.attentionReason = null;
    return conversation;
  }
  if (event.keyEvent.statusHint === 'completed' && conversation.status !== 'exited') {
    conversation.status = 'completed';
    conversation.attentionReason = null;
  }
  return conversation;
}
