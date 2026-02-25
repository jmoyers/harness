import { mergeAdapterStateFromSessionEvent } from '../adapters/agent-session-state.ts';
import type { CodexLiveEvent } from '../codex/live-session.ts';
import type {
  StreamObservedEvent,
  StreamSessionController,
  StreamSessionEvent,
  StreamSessionKeyEventRecord,
  StreamSessionPromptRecord,
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
  StreamSignal,
} from './stream-protocol.ts';
import { SessionPromptEngine } from './prompt/session-prompt-engine.ts';

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
const sessionPromptEngine = new SessionPromptEngine();

interface RuntimeSession {
  id: string;
  directoryId: string | null;
  tenantId: string;
  userId: string;
  workspaceId: string;
  agentType: string;
  requestedAgentType?: string;
  effectiveAgentType?: string;
  launchMismatchReason?: string | null;
  adapterState: Record<string, unknown>;
  eventSubscriberConnectionIds: Set<string>;
  status: StreamSessionRuntimeStatus;
  statusModel: StreamSessionStatusModel | null;
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
  publishSessionKeyObservedEvent(
    state: RuntimeSession,
    keyEvent: StreamSessionKeyEventRecord,
  ): void;
  publishSessionPromptObservedEvent(state: RuntimeSession, prompt: StreamSessionPromptRecord): void;
  refreshSessionStatusModel(state: RuntimeSession, observedAt: string): void;
  toPublicSessionController(
    controller: StreamSessionController | null,
  ): StreamSessionController | null;
  readonly stateStore: {
    updateConversationAdapterState(
      conversationId: string,
      adapterState: Record<string, unknown>,
    ): void;
    updateConversationRuntime(
      conversationId: string,
      input: {
        status: StreamSessionRuntimeStatus;
        statusModel: StreamSessionStatusModel | null;
        live: boolean;
        attentionReason: string | null;
        processId: number | null;
        lastEventAt: string | null;
        lastExit: { code: number | null; signal: NodeJS.Signals | null } | null;
      },
    ): void;
  };
}

interface ApplySessionKeyEventOptions {
  readonly applyStatusHint: boolean;
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEventToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function claudeStatusHintFromNotificationType(
  notificationType: string,
): 'running' | 'needs-input' | 'completed' | null {
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
  if (
    token.includes('abort') ||
    token.includes('interrupt') ||
    token.includes('cancel') ||
    token === 'stop' ||
    token === 'completed' ||
    token === 'complete' ||
    token.includes('turncomplete')
  ) {
    return 'completed';
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

export function persistConversationRuntime(ctx: StreamRuntimeContext, state: RuntimeSession): void {
  ctx.stateStore.updateConversationRuntime(state.id, {
    status: state.status,
    statusModel: state.statusModel,
    live: state.session !== null,
    attentionReason: state.attentionReason,
    processId: state.session?.processId() ?? null,
    lastEventAt: state.lastEventAt,
    lastExit: state.lastExit,
  });
}

export function publishStatusObservedEvent(ctx: StreamRuntimeContext, state: RuntimeSession): void {
  const requestedAgentType = state.requestedAgentType ?? state.agentType;
  const effectiveAgentType = state.effectiveAgentType ?? state.agentType;
  const launchMismatchReason =
    state.launchMismatchReason === undefined ? null : state.launchMismatchReason;
  const exposeLaunchParity =
    requestedAgentType !== effectiveAgentType || launchMismatchReason !== null;
  ctx.publishObservedEvent(ctx.sessionScope(state), {
    type: 'session-status',
    sessionId: state.id,
    status: state.status,
    attentionReason: state.attentionReason,
    statusModel: state.statusModel,
    live: state.session !== null,
    ts: new Date().toISOString(),
    directoryId: state.directoryId,
    conversationId: state.id,
    ...(exposeLaunchParity ? { requestedAgentType, effectiveAgentType, launchMismatchReason } : {}),
    telemetry: state.latestTelemetry,
    controller: ctx.toPublicSessionController(
      (state as RuntimeSession & { controller?: StreamSessionController | null }).controller ??
        null,
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
  const observedAt = lastEventAt ?? state.lastEventAt ?? new Date().toISOString();
  ctx.refreshSessionStatusModel(state, observedAt);
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
    setSessionStatus(ctx, state, 'completed', null, new Date().toISOString());
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
    if (notifyPayloadType === null) {
      return null;
    }
    const notifyTypeToken = normalizeEventToken(notifyPayloadType);
    const completedNotify =
      notifyTypeToken === 'agentturncomplete' ||
      notifyTypeToken.includes('interrupt') ||
      notifyTypeToken.includes('abort') ||
      notifyTypeToken.includes('cancel') ||
      notifyTypeToken.includes('incomplete');
    if (!completedNotify) {
      return null;
    }
    const summary =
      notifyTypeToken === 'agentturncomplete'
        ? 'turn complete (notify)'
        : `turn complete (${notifyPayloadType})`;
    return {
      source: 'otlp-metric',
      eventName: 'codex.turn.e2e_duration_ms',
      severity: null,
      summary,
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
      readTrimmedString(payload['final_status']) ?? readTrimmedString(payload['finalStatus']) ?? '';
    const finalStatus = normalizeEventToken(finalStatusRaw);
    const reasonToken = normalizeEventToken(readTrimmedString(payload['reason']) ?? '');

    let statusHint: StreamSessionKeyEventRecord['statusHint'] = null;
    let normalizedSummary = summary;
    if (hookEventToken === 'beforesubmitprompt') {
      statusHint = 'running';
      normalizedSummary ??= 'prompt submitted';
    } else if (
      hookEventToken.startsWith('before') &&
      (hookEventToken.includes('shell') ||
        hookEventToken.includes('mcp') ||
        hookEventToken.includes('tool'))
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
      normalizedSummary ??=
        finalStatus === 'aborted' ? 'turn complete (aborted)' : 'turn complete (hook)';
    } else if (
      hookEventToken.startsWith('after') &&
      (hookEventToken.includes('shell') ||
        hookEventToken.includes('mcp') ||
        hookEventToken.includes('tool'))
    ) {
      normalizedSummary ??= 'tool finished (hook)';
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

function summarizeUnmappedNotifyPayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).slice(0, 6);
  if (keys.length === 0) {
    return 'notify payload unmapped (no keys)';
  }
  return `notify payload unmapped keys=${keys.join(',')}`;
}

function normalizedAgentTypeForUnmappedEvent(
  agentType: string,
): 'codex' | 'claude' | 'cursor' | 'terminal' | 'critique' | 'nim' | 'agent' {
  if (
    agentType === 'codex' ||
    agentType === 'claude' ||
    agentType === 'cursor' ||
    agentType === 'terminal' ||
    agentType === 'critique' ||
    agentType === 'nim'
  ) {
    return agentType;
  }
  return 'agent';
}

export function unmappedNotifyKeyEventFromPayload(
  agentType: string,
  payload: Record<string, unknown>,
  observedAt: string,
): StreamSessionKeyEventRecord {
  const normalizedAgentType = normalizedAgentTypeForUnmappedEvent(agentType);
  return {
    source: 'otlp-log',
    eventName: `${normalizedAgentType}.notify.unmapped`,
    severity: null,
    summary: summarizeUnmappedNotifyPayload(payload),
    observedAt,
    statusHint: null,
  };
}

export function applySessionKeyEvent(
  ctx: StreamRuntimeContext,
  state: RuntimeSession,
  keyEvent: StreamSessionKeyEventRecord,
  options: ApplySessionKeyEventOptions,
): void {
  state.latestTelemetry = {
    source: keyEvent.source,
    eventName: keyEvent.eventName,
    severity: keyEvent.severity,
    summary: keyEvent.summary,
    observedAt: keyEvent.observedAt,
  };
  ctx.publishSessionKeyObservedEvent(state, keyEvent);
  if (options.applyStatusHint && keyEvent.statusHint === 'needs-input') {
    const nextAttentionReason = keyEvent.summary ?? state.attentionReason ?? 'input required';
    setSessionStatus(ctx, state, 'needs-input', nextAttentionReason, keyEvent.observedAt);
    return;
  }
  if (options.applyStatusHint && keyEvent.statusHint !== null) {
    setSessionStatus(ctx, state, keyEvent.statusHint, null, keyEvent.observedAt);
    return;
  }
  setSessionStatus(ctx, state, state.status, state.attentionReason, keyEvent.observedAt);
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
    const nowIso = new Date().toISOString();
    const observedAt = mapped.type === 'session-exit' ? nowIso : mapped.record.ts;
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
      ts: nowIso,
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
      const promptEvent = sessionPromptEngine.extractFromNotify({
        agentType: sessionState.agentType,
        payload: mapped.record.payload,
        observedAt,
      });
      if (promptEvent !== null) {
        ctx.publishSessionPromptObservedEvent(sessionState, promptEvent);
      }
      const keyEvent =
        notifyKeyEventFromPayload(sessionState.agentType, mapped.record.payload, observedAt) ??
        unmappedNotifyKeyEventFromPayload(
          sessionState.agentType,
          mapped.record.payload,
          observedAt,
        );
      applySessionKeyEvent(ctx, sessionState, keyEvent, {
        applyStatusHint: true,
      });
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
