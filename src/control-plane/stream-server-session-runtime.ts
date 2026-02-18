import { mergeAdapterStateFromSessionEvent } from '../adapters/agent-session-state.ts';
import type { CodexLiveEvent } from '../codex/live-session.ts';
import type {
  StreamObservedEvent,
  StreamSessionController,
  StreamSessionEvent,
  StreamSessionKeyEventRecord,
  StreamSessionRuntimeStatus,
  StreamSignal,
} from './stream-protocol.ts';

const CLAUDE_NEEDS_INPUT_NOTIFICATION_TYPES = new Set([
  'permissionrequest',
  'approvalrequest',
  'approvalrequired',
  'inputrequired',
]);
const CLAUDE_RUNNING_NOTIFICATION_TYPES = new Set([
  'permissionapproved',
  'permissiongranted',
  'approvalapproved',
  'approvalgranted',
]);

interface RuntimeSession {
  id: string;
  directoryId: string | null;
  tenantId: string;
  userId: string;
  workspaceId: string;
  agentType: string;
  adapterState: Record<string, unknown>;
  eventSubscriberConnectionIds: Set<string>;
  status: StreamSessionRuntimeStatus;
  attentionReason: string | null;
  lastEventAt: string | null;
  lastExit: { code: number | null; signal: NodeJS.Signals | null } | null;
  exitedAt: string | null;
  latestTelemetry: {
    source: StreamSessionKeyEventRecord['source'];
    eventName: string | null;
    severity: string | null;
    summary: string | null;
    observedAt: string;
  } | null;
  session: {
    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
    processId(): number | null;
  } | null;
}

interface StreamRuntimeContext {
  readonly sessions: Map<string, RuntimeSession>;
  connectionCanMutateSession(connectionId: string, state: RuntimeSession): boolean;
  destroySession(sessionId: string, closeSession: boolean): void;
  deactivateSession(sessionId: string, closeSession: boolean): void;
  sendToConnection(
    connectionId: string,
    envelope: Record<string, unknown>,
    diagnosticSessionId?: string | null,
  ): void;
  sessionScope(state: RuntimeSession): {
    tenantId: string;
    userId: string;
    workspaceId: string;
    directoryId: string | null;
    conversationId: string | null;
  };
  publishObservedEvent(
    scope: {
      tenantId: string;
      userId: string;
      workspaceId: string;
      directoryId: string | null;
      conversationId: string | null;
    },
    event: StreamObservedEvent,
  ): void;
  publishSessionKeyObservedEvent(state: RuntimeSession, keyEvent: StreamSessionKeyEventRecord): void;
  toPublicSessionController(controller: StreamSessionController | null): StreamSessionController | null;
  readonly stateStore: {
    updateConversationAdapterState(conversationId: string, adapterState: Record<string, unknown>): void;
    updateConversationRuntime(
      conversationId: string,
      input: {
        status: StreamSessionRuntimeStatus;
        live: boolean;
        attentionReason: string | null;
        processId: number | null;
        lastEventAt: string | null;
        lastExit: { code: number | null; signal: NodeJS.Signals | null } | null;
      },
    ): void;
  };
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEventToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function claudeStatusHintFromNotificationType(
  notificationType: string,
): 'running' | 'needs-input' | null {
  const token = normalizeEventToken(notificationType);
  if (token.length === 0) {
    return null;
  }
  if (CLAUDE_NEEDS_INPUT_NOTIFICATION_TYPES.has(token)) {
    return 'needs-input';
  }
  if (CLAUDE_RUNNING_NOTIFICATION_TYPES.has(token)) {
    return 'running';
  }
  return null;
}

function mapSessionEvent(event: CodexLiveEvent): StreamSessionEvent | null {
  if (event.type === 'notify') {
    return {
      type: 'notify',
      record: {
        ts: event.record.ts,
        payload: event.record.payload,
      },
    };
  }

  if (event.type === 'session-exit') {
    return {
      type: 'session-exit',
      exit: event.exit,
    };
  }

  return null;
}

export function persistConversationRuntime(
  ctx: StreamRuntimeContext,
  state: RuntimeSession,
): void {
  ctx.stateStore.updateConversationRuntime(state.id, {
    status: state.status,
    live: state.session !== null,
    attentionReason: state.attentionReason,
    processId: state.session?.processId() ?? null,
    lastEventAt: state.lastEventAt,
    lastExit: state.lastExit,
  });
}

export function publishStatusObservedEvent(
  ctx: StreamRuntimeContext,
  state: RuntimeSession,
): void {
  ctx.publishObservedEvent(ctx.sessionScope(state), {
    type: 'session-status',
    sessionId: state.id,
    status: state.status,
    attentionReason: state.attentionReason,
    live: state.session !== null,
    ts: new Date().toISOString(),
    directoryId: state.directoryId,
    conversationId: state.id,
    telemetry: state.latestTelemetry,
    controller: ctx.toPublicSessionController(
      (state as RuntimeSession & { controller?: StreamSessionController | null }).controller ?? null,
    ),
  });
}

export function setSessionStatus(
  ctx: StreamRuntimeContext,
  state: RuntimeSession,
  status: StreamSessionRuntimeStatus,
  attentionReason: string | null,
  lastEventAt: string | null,
): void {
  state.status = status;
  state.attentionReason = attentionReason;
  if (lastEventAt !== null) {
    state.lastEventAt = lastEventAt;
  }
  persistConversationRuntime(ctx, state);
  publishStatusObservedEvent(ctx, state);
}

export function handleInput(
  ctx: StreamRuntimeContext,
  connectionId: string,
  sessionId: string,
  dataBase64: string,
): void {
  const state = ctx.sessions.get(sessionId);
  if (state === undefined) {
    return;
  }
  if (!ctx.connectionCanMutateSession(connectionId, state)) {
    return;
  }
  if (state.status === 'exited' || state.session === null) {
    return;
  }

  const data = Buffer.from(dataBase64, 'base64');
  if (data.length === 0 && dataBase64.length > 0) {
    return;
  }
  state.session.write(data);
}

export function handleResize(
  ctx: StreamRuntimeContext,
  connectionId: string,
  sessionId: string,
  cols: number,
  rows: number,
): void {
  const state = ctx.sessions.get(sessionId);
  if (state === undefined) {
    return;
  }
  if (!ctx.connectionCanMutateSession(connectionId, state)) {
    return;
  }
  if (state.status === 'exited' || state.session === null) {
    return;
  }
  state.session.resize(cols, rows);
}

export function handleSignal(
  ctx: StreamRuntimeContext,
  connectionId: string,
  sessionId: string,
  signal: StreamSignal,
): void {
  const state = ctx.sessions.get(sessionId);
  if (state === undefined) {
    return;
  }
  if (!ctx.connectionCanMutateSession(connectionId, state)) {
    return;
  }
  if (state.status === 'exited' || state.session === null) {
    return;
  }

  if (signal === 'interrupt') {
    state.session.write('\u0003');
    return;
  }

  if (signal === 'eof') {
    state.session.write('\u0004');
    return;
  }

  ctx.destroySession(sessionId, true);
}

export function notifyKeyEventFromPayload(
  agentType: string,
  payload: Record<string, unknown>,
  observedAt: string,
): StreamSessionKeyEventRecord | null {
  if (agentType === 'codex') {
    const notifyPayloadType = readTrimmedString(payload['type']);
    if (notifyPayloadType !== 'agent-turn-complete') {
      return null;
    }
    return {
      source: 'otlp-metric',
      eventName: 'codex.turn.e2e_duration_ms',
      severity: null,
      summary: 'turn complete (notify)',
      observedAt,
      statusHint: 'completed',
    };
  }
  if (agentType !== 'claude') {
    if (agentType !== 'cursor') {
      return null;
    }
    const hookEventNameRaw =
      readTrimmedString(payload['hook_event_name']) ??
      readTrimmedString(payload['hookEventName']) ??
      readTrimmedString(payload['event_name']) ??
      readTrimmedString(payload['eventName']) ??
      readTrimmedString(payload['event']);
    if (hookEventNameRaw === null) {
      return null;
    }
    const hookEventToken = normalizeEventToken(hookEventNameRaw);
    if (hookEventToken.length === 0) {
      return null;
    }
    const eventName = `cursor.${hookEventToken}`;
    const summary =
      readTrimmedString(payload['summary']) ??
      readTrimmedString(payload['message']) ??
      readTrimmedString(payload['reason']) ??
      readTrimmedString(payload['output']);
    const finalStatusRaw =
      readTrimmedString(payload['final_status']) ??
      readTrimmedString(payload['finalStatus']) ??
      '';
    const finalStatus = normalizeEventToken(finalStatusRaw);
    const reasonToken = normalizeEventToken(readTrimmedString(payload['reason']) ?? '');

    let statusHint: StreamSessionKeyEventRecord['statusHint'] = null;
    let normalizedSummary = summary;
    if (hookEventToken === 'beforesubmitprompt') {
      statusHint = 'running';
      normalizedSummary ??= 'prompt submitted';
    } else if (
      hookEventToken.startsWith('before') &&
      (hookEventToken.includes('shell') || hookEventToken.includes('mcp') || hookEventToken.includes('tool'))
    ) {
      statusHint = 'running';
      normalizedSummary ??= 'tool started (hook)';
    } else if (
      hookEventToken === 'stop' ||
      hookEventToken === 'sessionend' ||
      hookEventToken.includes('abort') ||
      reasonToken.includes('abort') ||
      finalStatus === 'aborted' ||
      finalStatus === 'cancelled' ||
      finalStatus === 'canceled' ||
      finalStatus === 'completed'
    ) {
      statusHint = 'completed';
      normalizedSummary ??= finalStatus === 'aborted' ? 'turn complete (aborted)' : 'turn complete (hook)';
    } else if (
      hookEventToken.startsWith('after') &&
      (hookEventToken.includes('shell') || hookEventToken.includes('mcp') || hookEventToken.includes('tool'))
    ) {
      normalizedSummary ??= 'tool finished (hook)';
    } else if (normalizedSummary === null) {
      normalizedSummary = hookEventNameRaw;
    }

    return {
      source: 'otlp-log',
      eventName,
      severity: null,
      summary: normalizedSummary,
      observedAt,
      statusHint,
    };
  }

  const hookEventNameRaw =
    readTrimmedString(payload['hook_event_name']) ?? readTrimmedString(payload['hookEventName']);
  if (hookEventNameRaw === null) {
    return null;
  }
  const hookEventToken = normalizeEventToken(hookEventNameRaw);
  if (hookEventToken.length === 0) {
    return null;
  }
  const eventName = `claude.${hookEventToken}`;
  const summary = readTrimmedString(payload['message']) ?? readTrimmedString(payload['reason']);
  const notificationType = readTrimmedString(payload['notification_type'])?.toLowerCase() ?? '';

  let statusHint: StreamSessionKeyEventRecord['statusHint'] = null;
  let normalizedSummary = summary;
  if (hookEventToken === 'userpromptsubmit') {
    statusHint = 'running';
    normalizedSummary ??= 'prompt submitted';
  } else if (hookEventToken === 'pretooluse') {
    statusHint = 'running';
    normalizedSummary ??= 'tool started (hook)';
  } else if (
    hookEventToken === 'stop' ||
    hookEventToken === 'subagentstop' ||
    hookEventToken === 'sessionend'
  ) {
    statusHint = 'completed';
    normalizedSummary ??= 'turn complete (hook)';
  } else if (hookEventToken === 'notification') {
    statusHint = claudeStatusHintFromNotificationType(notificationType);
    if (normalizedSummary === null) {
      normalizedSummary = notificationType.length > 0 ? notificationType : hookEventNameRaw;
    }
  } else if (normalizedSummary === null) {
    normalizedSummary = hookEventNameRaw;
  }

  return {
    source: 'otlp-log',
    eventName,
    severity: null,
    summary: normalizedSummary,
    observedAt,
    statusHint,
  };
}

export function handleSessionEvent(
  ctx: StreamRuntimeContext,
  sessionId: string,
  event: CodexLiveEvent,
): void {
  const sessionState = ctx.sessions.get(sessionId);
  if (sessionState === undefined) {
    return;
  }

  const mapped = mapSessionEvent(event);
  if (mapped !== null && event.type !== 'terminal-output') {
    const observedAt = mapped.type === 'session-exit' ? new Date().toISOString() : mapped.record.ts;
    for (const connectionId of sessionState.eventSubscriberConnectionIds) {
      ctx.sendToConnection(
        connectionId,
        {
          kind: 'pty.event',
          sessionId,
          event: mapped,
        },
        sessionId,
      );
    }
    ctx.publishObservedEvent(ctx.sessionScope(sessionState), {
      type: 'session-event',
      sessionId,
      event: mapped,
      ts: new Date().toISOString(),
      directoryId: sessionState.directoryId,
      conversationId: sessionState.id,
    });
    const mergedAdapterState = mergeAdapterStateFromSessionEvent(
      sessionState.agentType,
      sessionState.adapterState,
      mapped,
      observedAt,
    );
    if (mergedAdapterState !== null) {
      sessionState.adapterState = mergedAdapterState;
      ctx.stateStore.updateConversationAdapterState(sessionState.id, mergedAdapterState);
    }
    if (mapped.type === 'notify') {
      const keyEvent = notifyKeyEventFromPayload(
        sessionState.agentType,
        mapped.record.payload,
        observedAt,
      );
      if (keyEvent !== null) {
        sessionState.latestTelemetry = {
          source: keyEvent.source,
          eventName: keyEvent.eventName,
          severity: keyEvent.severity,
          summary: keyEvent.summary,
          observedAt: keyEvent.observedAt,
        };
        ctx.publishSessionKeyObservedEvent(sessionState, keyEvent);
        if (keyEvent.statusHint === 'needs-input') {
          const nextAttentionReason = keyEvent.summary ?? sessionState.attentionReason ?? 'input required';
          setSessionStatus(ctx, sessionState, 'needs-input', nextAttentionReason, observedAt);
        } else if (keyEvent.statusHint !== null) {
          setSessionStatus(ctx, sessionState, keyEvent.statusHint, null, observedAt);
        } else {
          setSessionStatus(
            ctx,
            sessionState,
            sessionState.status,
            sessionState.attentionReason,
            observedAt,
          );
        }
      } else {
        setSessionStatus(
          ctx,
          sessionState,
          sessionState.status,
          sessionState.attentionReason,
          observedAt,
        );
      }
    }
  }

  if (event.type === 'session-exit') {
    sessionState.lastExit = event.exit;
    const exitedAt = new Date().toISOString();
    sessionState.exitedAt = exitedAt;
    setSessionStatus(ctx, sessionState, 'exited', null, exitedAt);
    ctx.deactivateSession(sessionState.id, true);
  }
}
