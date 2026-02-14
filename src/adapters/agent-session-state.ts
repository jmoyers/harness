import type { StreamSessionEvent } from '../control-plane/stream-protocol.ts';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function codexRecord(state: Record<string, unknown>): Record<string, unknown> {
  const existing = asRecord(state['codex']);
  if (existing !== null) {
    return {
      ...existing
    };
  }
  return {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function firstNonOptionArg(args: readonly string[]): string | null {
  for (const arg of args) {
    if (arg === '--') {
      return null;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    return arg;
  }
  return null;
}

function codexThreadIdFromPayload(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload['thread-id'],
    payload['thread_id'],
    payload['threadId'],
    payload['session-id'],
    payload['session_id'],
    payload['sessionId']
  ];
  for (const candidate of candidates) {
    const id = readString(candidate);
    if (id !== null && id.trim().length > 0) {
      return id.trim();
    }
  }
  return null;
}

export function normalizeAdapterState(value: unknown): Record<string, unknown> {
  const normalized = asRecord(value);
  if (normalized === null) {
    return {};
  }
  return {
    ...normalized
  };
}

export function codexResumeSessionIdFromAdapterState(
  adapterState: Record<string, unknown>
): string | null {
  const codex = asRecord(adapterState['codex']);
  if (codex === null) {
    return null;
  }
  const resumeSessionId = readString(codex['resumeSessionId']);
  if (resumeSessionId !== null && resumeSessionId.length > 0) {
    return resumeSessionId;
  }
  const legacyThreadId = readString(codex['threadId']);
  if (legacyThreadId !== null && legacyThreadId.length > 0) {
    return legacyThreadId;
  }
  return null;
}

export function mergeAdapterStateFromSessionEvent(
  agentType: string,
  currentState: Record<string, unknown>,
  event: StreamSessionEvent,
  observedAt: string
): Record<string, unknown> | null {
  if (agentType !== 'codex') {
    return null;
  }

  if (
    event.type !== 'notify' &&
    event.type !== 'turn-completed' &&
    event.type !== 'attention-required'
  ) {
    return null;
  }

  const threadId = codexThreadIdFromPayload(event.record.payload);
  if (threadId === null) {
    return null;
  }

  const currentResumeId = codexResumeSessionIdFromAdapterState(currentState);
  if (currentResumeId === threadId) {
    return null;
  }

  const updatedCodex = codexRecord(currentState);
  updatedCodex['resumeSessionId'] = threadId;
  updatedCodex['lastObservedAt'] = observedAt;

  return {
    ...currentState,
    codex: updatedCodex
  };
}

export function buildAgentStartArgs(
  agentType: string,
  baseArgs: readonly string[],
  adapterState: Record<string, unknown>
): string[] {
  if (agentType !== 'codex') {
    return [...baseArgs];
  }

  const firstArg = firstNonOptionArg(baseArgs);
  if (
    firstArg === 'exec' ||
    firstArg === 'review' ||
    firstArg === 'login' ||
    firstArg === 'logout' ||
    firstArg === 'mcp' ||
    firstArg === 'mcp-server' ||
    firstArg === 'app-server' ||
    firstArg === 'app' ||
    firstArg === 'completion' ||
    firstArg === 'sandbox' ||
    firstArg === 'debug' ||
    firstArg === 'apply' ||
    firstArg === 'resume' ||
    firstArg === 'fork' ||
    firstArg === 'cloud' ||
    firstArg === 'features' ||
    firstArg === 'help'
  ) {
    return [...baseArgs];
  }

  const resumeSessionId = codexResumeSessionIdFromAdapterState(adapterState);
  if (resumeSessionId === null) {
    return [...baseArgs];
  }

  return ['resume', resumeSessionId, ...baseArgs];
}
