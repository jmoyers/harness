import type { StreamSessionEvent } from '../control-plane/stream-protocol.ts';

const CODEX_EXPLICIT_SUBCOMMANDS = new Set([
  'exec',
  'review',
  'login',
  'logout',
  'mcp',
  'mcp-server',
  'app-server',
  'app',
  'completion',
  'sandbox',
  'debug',
  'apply',
  'resume',
  'fork',
  'cloud',
  'features',
  'help'
]);

const CLAUDE_EXPLICIT_SUBCOMMANDS = new Set([
  'doctor',
  'install',
  'mcp',
  'plugin',
  'setup-token',
  'update',
  'help'
]);

type CodexLaunchMode = 'yolo' | 'standard';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  const raw = readString(value);
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  const resumeSessionId = readNonEmptyString(codex['resumeSessionId']);
  if (resumeSessionId !== null) {
    return resumeSessionId;
  }
  const legacyThreadId = readNonEmptyString(codex['threadId']);
  if (legacyThreadId !== null) {
    return legacyThreadId;
  }
  return null;
}

export function claudeResumeSessionIdFromAdapterState(
  adapterState: Record<string, unknown>
): string | null {
  const claude = asRecord(adapterState['claude']);
  if (claude === null) {
    return null;
  }
  const resumeSessionId = readNonEmptyString(claude['resumeSessionId']);
  if (resumeSessionId !== null) {
    return resumeSessionId;
  }
  return readNonEmptyString(claude['sessionId']);
}

export function mergeAdapterStateFromSessionEvent(
  agentType: string,
  _currentState?: Record<string, unknown>,
  _event?: StreamSessionEvent,
  _observedAt?: string
): Record<string, unknown> | null {
  if (agentType !== 'claude' || _event?.type !== 'notify') {
    return null;
  }
  const payload = asRecord(_event.record.payload);
  const sessionId =
    readNonEmptyString(payload?.['session_id']) ?? readNonEmptyString(payload?.['sessionId']);
  if (sessionId === null) {
    return null;
  }

  const currentState = normalizeAdapterState(_currentState ?? {});
  const claude = asRecord(currentState['claude']) ?? {};
  const currentResumeSessionId = readNonEmptyString(claude['resumeSessionId']);
  const lastObservedAt = readNonEmptyString(claude['lastObservedAt']);
  const nextObservedAt = readNonEmptyString(_observedAt) ?? lastObservedAt ?? null;
  if (currentResumeSessionId === sessionId && nextObservedAt === lastObservedAt) {
    return null;
  }

  return {
    ...currentState,
    claude: {
      ...claude,
      resumeSessionId: sessionId,
      ...(nextObservedAt === null ? {} : { lastObservedAt: nextObservedAt })
    }
  };
}

function hasClaudeResumeArg(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (
      arg === '--resume' ||
      arg === '-r' ||
      arg === '--continue' ||
      arg === '-c' ||
      arg === '--session-id'
    ) {
      return true;
    }
  }
  return false;
}

export function buildAgentStartArgs(
  agentType: string,
  baseArgs: readonly string[],
  adapterState: Record<string, unknown>,
  options?: {
    codexLaunchMode?: CodexLaunchMode;
  }
): string[] {
  if (agentType === 'codex') {
    const firstArg = firstNonOptionArg(baseArgs);
    if (firstArg !== null && CODEX_EXPLICIT_SUBCOMMANDS.has(firstArg)) {
      return [...baseArgs];
    }

    const codexLaunchMode = options?.codexLaunchMode ?? 'standard';
    const argsWithLaunchMode =
      codexLaunchMode === 'yolo' && !baseArgs.includes('--yolo') ? [...baseArgs, '--yolo'] : [...baseArgs];

    const resumeSessionId = codexResumeSessionIdFromAdapterState(adapterState);
    if (resumeSessionId === null) {
      return argsWithLaunchMode;
    }

    return ['resume', resumeSessionId, ...argsWithLaunchMode];
  }

  if (agentType !== 'claude') {
    return [...baseArgs];
  }

  const firstArg = firstNonOptionArg(baseArgs);
  if (firstArg !== null && CLAUDE_EXPLICIT_SUBCOMMANDS.has(firstArg)) {
    return [...baseArgs];
  }
  if (hasClaudeResumeArg(baseArgs)) {
    return [...baseArgs];
  }
  const resumeSessionId = claudeResumeSessionIdFromAdapterState(adapterState);
  if (resumeSessionId === null) {
    return [...baseArgs];
  }
  return ['--resume', resumeSessionId, ...baseArgs];
}
