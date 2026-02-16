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
  _currentState?: Record<string, unknown>,
  _event?: StreamSessionEvent,
  _observedAt?: string
): Record<string, unknown> | null {
  void _currentState;
  void _event;
  void _observedAt;
  if (agentType !== 'codex') {
    return null;
  }
  return null;
}

export function buildAgentStartArgs(
  agentType: string,
  baseArgs: readonly string[],
  adapterState: Record<string, unknown>,
  options?: {
    codexLaunchMode?: CodexLaunchMode;
  }
): string[] {
  if (agentType !== 'codex') {
    return [...baseArgs];
  }

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
