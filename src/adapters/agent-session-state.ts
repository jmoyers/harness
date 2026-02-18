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
  'help',
]);

const CLAUDE_EXPLICIT_SUBCOMMANDS = new Set([
  'doctor',
  'install',
  'mcp',
  'plugin',
  'setup-token',
  'update',
  'help',
]);

type CodexLaunchMode = 'yolo' | 'standard';
type ClaudeLaunchMode = 'yolo' | 'standard';
type CursorLaunchMode = 'yolo' | 'standard';

interface BuildAgentSessionStartArgsOptions {
  readonly directoryPath?: string | null;
  readonly codexLaunchDefaultMode?: CodexLaunchMode;
  readonly codexLaunchModeByDirectoryPath?: Readonly<Record<string, CodexLaunchMode>>;
  readonly claudeLaunchDefaultMode?: ClaudeLaunchMode;
  readonly claudeLaunchModeByDirectoryPath?: Readonly<Record<string, ClaudeLaunchMode>>;
  readonly cursorLaunchDefaultMode?: CursorLaunchMode;
  readonly cursorLaunchModeByDirectoryPath?: Readonly<Record<string, CursorLaunchMode>>;
}

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
    ...normalized,
  };
}

export function codexResumeSessionIdFromAdapterState(
  adapterState: Record<string, unknown>,
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
  adapterState: Record<string, unknown>,
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

export function cursorResumeSessionIdFromAdapterState(
  adapterState: Record<string, unknown>,
): string | null {
  const cursor = asRecord(adapterState['cursor']);
  if (cursor === null) {
    return null;
  }
  const resumeSessionId = readNonEmptyString(cursor['resumeSessionId']);
  if (resumeSessionId !== null) {
    return resumeSessionId;
  }
  const conversationId = readNonEmptyString(cursor['conversationId']);
  if (conversationId !== null) {
    return conversationId;
  }
  return readNonEmptyString(cursor['sessionId']);
}

export function mergeAdapterStateFromSessionEvent(
  agentType: string,
  _currentState?: Record<string, unknown>,
  _event?: StreamSessionEvent,
  _observedAt?: string,
): Record<string, unknown> | null {
  if (_event?.type !== 'notify') {
    return null;
  }
  const payload = asRecord(_event.record.payload);
  if (agentType === 'claude') {
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
        ...(nextObservedAt === null ? {} : { lastObservedAt: nextObservedAt }),
      },
    };
  }
  if (agentType !== 'cursor') {
    return null;
  }
  const conversationId =
    readNonEmptyString(payload?.['conversation_id']) ??
    readNonEmptyString(payload?.['conversationId']);
  const rawSessionId =
    readNonEmptyString(payload?.['session_id']) ?? readNonEmptyString(payload?.['sessionId']);
  const harnessSessionId =
    readNonEmptyString(payload?.['harness_session_id']) ??
    readNonEmptyString(payload?.['harnessSessionId']);
  const sessionId =
    conversationId ??
    (rawSessionId !== null && rawSessionId !== harnessSessionId ? rawSessionId : null);
  if (sessionId === null) {
    return null;
  }
  const currentState = normalizeAdapterState(_currentState ?? {});
  const cursor = asRecord(currentState['cursor']) ?? {};
  const currentResumeSessionId = readNonEmptyString(cursor['resumeSessionId']);
  const lastObservedAt = readNonEmptyString(cursor['lastObservedAt']);
  const nextObservedAt = readNonEmptyString(_observedAt) ?? lastObservedAt ?? null;
  if (currentResumeSessionId === sessionId && nextObservedAt === lastObservedAt) {
    return null;
  }
  return {
    ...currentState,
    cursor: {
      ...cursor,
      resumeSessionId: sessionId,
      ...(nextObservedAt === null ? {} : { lastObservedAt: nextObservedAt }),
    },
  };
}

function hasCursorResumeArg(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--resume' || arg === '-r') {
      return true;
    }
  }
  return false;
}

function hasCursorPrintOrHeadlessArg(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--print' || arg === '--headless') {
      return true;
    }
    if (arg === '--mode') {
      const next = args[index + 1];
      if (next === 'headless') {
        return true;
      }
      continue;
    }
    if (arg?.startsWith('--mode=')) {
      const mode = arg.slice('--mode='.length);
      if (mode === 'headless') {
        return true;
      }
    }
  }
  return false;
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
    claudeLaunchMode?: ClaudeLaunchMode;
    cursorLaunchMode?: CursorLaunchMode;
  },
): string[] {
  if (agentType === 'codex') {
    const firstArg = firstNonOptionArg(baseArgs);
    if (firstArg !== null && CODEX_EXPLICIT_SUBCOMMANDS.has(firstArg)) {
      return [...baseArgs];
    }

    const codexLaunchMode = options?.codexLaunchMode ?? 'standard';
    const argsWithLaunchMode =
      codexLaunchMode === 'yolo' && !baseArgs.includes('--yolo')
        ? [...baseArgs, '--yolo']
        : [...baseArgs];

    const resumeSessionId = codexResumeSessionIdFromAdapterState(adapterState);
    if (resumeSessionId === null) {
      return argsWithLaunchMode;
    }

    return ['resume', resumeSessionId, ...argsWithLaunchMode];
  }

  if (agentType === 'claude') {
    const firstArg = firstNonOptionArg(baseArgs);
    if (firstArg !== null && CLAUDE_EXPLICIT_SUBCOMMANDS.has(firstArg)) {
      return [...baseArgs];
    }

    const claudeLaunchMode = options?.claudeLaunchMode ?? 'standard';
    const argsWithLaunchMode =
      claudeLaunchMode === 'yolo' && !baseArgs.includes('--dangerously-skip-permissions')
        ? [...baseArgs, '--dangerously-skip-permissions']
        : [...baseArgs];

    if (hasClaudeResumeArg(baseArgs)) {
      return argsWithLaunchMode;
    }
    const resumeSessionId = claudeResumeSessionIdFromAdapterState(adapterState);
    if (resumeSessionId === null) {
      return argsWithLaunchMode;
    }
    return ['--resume', resumeSessionId, ...argsWithLaunchMode];
  }

  if (agentType === 'cursor') {
    const cursorLaunchMode = options?.cursorLaunchMode ?? 'standard';
    const argsWithLaunchMode = [...baseArgs];
    if (
      cursorLaunchMode === 'yolo' &&
      !argsWithLaunchMode.includes('--yolo') &&
      !argsWithLaunchMode.includes('--force')
    ) {
      argsWithLaunchMode.push('--yolo');
    }
    if (
      cursorLaunchMode === 'yolo' &&
      hasCursorPrintOrHeadlessArg(argsWithLaunchMode) &&
      !argsWithLaunchMode.includes('--trust')
    ) {
      argsWithLaunchMode.push('--trust');
    }

    if (hasCursorResumeArg(baseArgs)) {
      return argsWithLaunchMode;
    }
    const resumeSessionId = cursorResumeSessionIdFromAdapterState(adapterState);
    if (resumeSessionId === null) {
      return argsWithLaunchMode;
    }
    return ['--resume', resumeSessionId, ...argsWithLaunchMode];
  }

  return [...baseArgs];
}

export function buildAgentSessionStartArgs(
  agentType: string,
  baseArgs: readonly string[],
  adapterState: Record<string, unknown>,
  options: BuildAgentSessionStartArgsOptions = {},
): string[] {
  const normalizedDirectoryPath = options.directoryPath?.trim() ?? '';

  if (agentType === 'codex') {
    const defaultMode = options.codexLaunchDefaultMode ?? 'standard';
    const directoryModes = options.codexLaunchModeByDirectoryPath ?? {};
    const codexLaunchMode =
      normalizedDirectoryPath.length > 0
        ? (directoryModes[normalizedDirectoryPath] ?? defaultMode)
        : defaultMode;

    return buildAgentStartArgs(agentType, baseArgs, adapterState, {
      codexLaunchMode,
    });
  }

  if (agentType === 'claude') {
    const defaultMode = options.claudeLaunchDefaultMode ?? 'standard';
    const directoryModes = options.claudeLaunchModeByDirectoryPath ?? {};
    const claudeLaunchMode =
      normalizedDirectoryPath.length > 0
        ? (directoryModes[normalizedDirectoryPath] ?? defaultMode)
        : defaultMode;

    return buildAgentStartArgs(agentType, baseArgs, adapterState, {
      claudeLaunchMode,
    });
  }

  if (agentType === 'cursor') {
    const defaultMode = options.cursorLaunchDefaultMode ?? 'standard';
    const directoryModes = options.cursorLaunchModeByDirectoryPath ?? {};
    const cursorLaunchMode =
      normalizedDirectoryPath.length > 0
        ? (directoryModes[normalizedDirectoryPath] ?? defaultMode)
        : defaultMode;

    return buildAgentStartArgs(agentType, baseArgs, adapterState, {
      cursorLaunchMode,
    });
  }

  return buildAgentStartArgs(agentType, baseArgs, adapterState);
}
