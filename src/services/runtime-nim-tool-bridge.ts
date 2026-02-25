import type { StreamSessionControllerType } from '../control-plane/stream-protocol.ts';
import type { NimToolDefinition, NimToolPolicy } from '../../packages/nim-core/src/index.ts';

type RuntimeNimThreadRuntimeStatus = 'running' | 'needs-input' | 'completed' | 'exited';

const TOOL_INPUT_SCHEMA_EMPTY = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_ID = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
  },
  required: [],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_RESPOND = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
    text: { type: 'string' },
    message: { type: 'string' },
  },
  required: [],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_CREATE = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    projectId: { type: 'string' },
    directoryId: { type: 'string' },
    title: { type: 'string' },
    agentType: { type: 'string' },
    adapterState: { type: 'object' },
  },
  required: ['projectId', 'title', 'agentType'],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_LIST = {
  type: 'object',
  properties: {
    projectId: { type: 'string' },
    directoryId: { type: 'string' },
    includeArchived: { type: 'boolean' },
    limit: { type: 'integer' },
    agentType: { type: 'string' },
    runtimeStatus: { type: 'string' },
    status: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_TASK_LIST = {
  type: 'object',
  properties: {
    limit: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_UPDATE = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['title'],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_SNAPSHOT = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
    tailLines: { type: 'integer' },
  },
  required: [],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_CLAIM = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
    controllerId: { type: 'string' },
    controllerType: { type: 'string', enum: ['human', 'agent', 'automation'] },
    controllerLabel: { type: 'string' },
    reason: { type: 'string' },
    takeover: { type: 'boolean' },
  },
  required: [],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_RELEASE = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
    reason: { type: 'string' },
  },
  required: [],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_START = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
    args: { type: 'array', items: { type: 'string' } },
    env: { type: 'object' },
    cwd: { type: 'string' },
    initialCols: { type: 'integer' },
    initialRows: { type: 'integer' },
    worktreeId: { type: 'string' },
  },
  required: [],
  additionalProperties: false,
} as const;

const TOOL_INPUT_SCHEMA_THREAD_ATTACH = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    sessionId: { type: 'string' },
    sinceCursor: { type: 'integer' },
  },
  required: [],
  additionalProperties: false,
} as const;

const runtimeNimTools: readonly NimToolDefinition[] = [
  {
    name: 'directory.list',
    description: 'List directories known to the current workspace.',
    inputSchema: TOOL_INPUT_SCHEMA_EMPTY,
  },
  {
    name: 'repository.list',
    description: 'List repositories known to the current workspace.',
    inputSchema: TOOL_INPUT_SCHEMA_EMPTY,
  },
  {
    name: 'task.list',
    description: 'List tasks known to the current workspace.',
    inputSchema: TOOL_INPUT_SCHEMA_TASK_LIST,
  },
  {
    name: 'thread.list',
    description: 'List threads in the current workspace.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_LIST,
  },
  {
    name: 'thread.create',
    description: 'Create a new thread in a project.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_CREATE,
  },
  {
    name: 'thread.update',
    description: 'Update thread metadata such as title.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_UPDATE,
  },
  {
    name: 'thread.archive',
    description: 'Archive a thread.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'thread.status',
    description: 'Get runtime status for a thread.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'thread.snapshot',
    description: 'Get a thread terminal snapshot and optional tail buffer.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_SNAPSHOT,
  },
  {
    name: 'thread.respond',
    description: 'Send input to a thread session.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_RESPOND,
  },
  {
    name: 'thread.interrupt',
    description: 'Interrupt an active thread session.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'thread.claim',
    description: 'Claim control of a thread session.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_CLAIM,
  },
  {
    name: 'thread.release',
    description: 'Release control of a thread session.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_RELEASE,
  },
  {
    name: 'thread.start',
    description: 'Start or restart a thread runtime session.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_START,
  },
  {
    name: 'thread.attach',
    description: 'Attach to a thread runtime stream.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ATTACH,
  },
  {
    name: 'thread.detach',
    description: 'Detach from a thread runtime stream.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'thread.events.subscribe',
    description: 'Subscribe to thread session events.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'thread.events.unsubscribe',
    description: 'Unsubscribe from thread session events.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'thread.close',
    description: 'Close a thread runtime session.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'thread.remove',
    description: 'Remove a thread runtime session from control-plane state.',
    inputSchema: TOOL_INPUT_SCHEMA_THREAD_ID,
  },
  {
    name: 'session.list',
    description: 'List active and historical sessions in the current workspace.',
    inputSchema: TOOL_INPUT_SCHEMA_EMPTY,
  },
];

const runtimeNimPolicy: NimToolPolicy = {
  hash: 'nim-control-plane-tools-v5',
  allow: runtimeNimTools.map((tool) => tool.name),
  deny: [],
};

export interface RuntimeNimToolBridgeOptions {
  readonly listDirectories: () => Promise<readonly unknown[]>;
  readonly listRepositories: () => Promise<readonly unknown[]>;
  readonly listTasks: (limit: number) => Promise<readonly unknown[]>;
  readonly listThreads: (query: {
    projectId?: string;
    includeArchived?: boolean;
    limit?: number;
  }) => Promise<readonly unknown[]>;
  readonly createThread: (input: {
    threadId?: string;
    projectId: string;
    title: string;
    agentType: string;
    adapterState?: Record<string, unknown>;
  }) => Promise<unknown>;
  readonly updateThread: (input: { threadId: string; title: string }) => Promise<unknown>;
  readonly archiveThread: (threadId: string) => Promise<unknown>;
  readonly threadStatus: (threadId: string) => Promise<unknown>;
  readonly threadSnapshot: (input: { threadId: string; tailLines?: number }) => Promise<unknown>;
  readonly threadRespond: (input: { threadId: string; text: string }) => Promise<{
    responded: boolean;
    sentBytes: number;
  }>;
  readonly threadInterrupt: (threadId: string) => Promise<{ interrupted: boolean }>;
  readonly threadClaim: (input: {
    threadId: string;
    controllerId: string;
    controllerType: StreamSessionControllerType;
    controllerLabel?: string;
    reason?: string;
    takeover?: boolean;
  }) => Promise<unknown>;
  readonly threadRelease: (input: { threadId: string; reason?: string }) => Promise<unknown>;
  readonly threadStart: (input: {
    threadId: string;
    args?: readonly string[];
    env?: Record<string, string>;
    cwd?: string;
    initialCols?: number;
    initialRows?: number;
    worktreeId?: string;
  }) => Promise<unknown>;
  readonly threadAttach: (input: { threadId: string; sinceCursor?: number }) => Promise<unknown>;
  readonly threadDetach: (threadId: string) => Promise<unknown>;
  readonly threadSubscribeEvents: (threadId: string) => Promise<unknown>;
  readonly threadUnsubscribeEvents: (threadId: string) => Promise<unknown>;
  readonly threadClose: (threadId: string) => Promise<unknown>;
  readonly threadRemove: (threadId: string) => Promise<unknown>;
  readonly listSessions: () => Promise<readonly unknown[]>;
  readonly taskListLimit?: number;
  readonly threadListLimit?: number;
  readonly snapshotTailLines?: number;
  readonly defaultControllerId?: string;
  readonly defaultControllerLabel?: string;
}

export interface RuntimeNimToolBridgeInvokeInput {
  readonly toolName: string;
  readonly argumentsText?: string;
  readonly argumentsValue?: unknown;
}

export interface RuntimeNimToolRuntime {
  registerTools(tools: readonly NimToolDefinition[]): void;
  setToolPolicy(policy: NimToolPolicy): void;
}

export class RuntimeNimToolBridge {
  private readonly taskListLimit: number;
  private readonly threadListLimit: number;
  private readonly snapshotTailLines: number;
  private readonly defaultControllerId: string;
  private readonly defaultControllerLabel: string;

  constructor(private readonly options: RuntimeNimToolBridgeOptions) {
    this.taskListLimit = Math.max(1, options.taskListLimit ?? 100);
    this.threadListLimit = Math.max(1, options.threadListLimit ?? 100);
    this.snapshotTailLines = Math.max(1, options.snapshotTailLines ?? 80);
    this.defaultControllerId = options.defaultControllerId?.trim() || 'nim';
    this.defaultControllerLabel = options.defaultControllerLabel?.trim() || 'nim';
  }

  registerWithRuntime(runtime: RuntimeNimToolRuntime): void {
    runtime.registerTools(runtimeNimTools);
    runtime.setToolPolicy(runtimeNimPolicy);
  }

  async invoke(input: RuntimeNimToolBridgeInvokeInput): Promise<unknown> {
    if (input.toolName === 'directory.list') {
      const directories = await this.options.listDirectories();
      return {
        count: directories.length,
        directories,
      };
    }
    if (input.toolName === 'repository.list') {
      const repositories = await this.options.listRepositories();
      return {
        count: repositories.length,
        repositories,
      };
    }
    if (input.toolName === 'task.list') {
      const limit = resolveTaskListLimit({
        argumentsText: input.argumentsText,
        argumentsValue: input.argumentsValue,
        fallback: this.taskListLimit,
      });
      const tasks = await this.options.listTasks(limit);
      return {
        count: tasks.length,
        limit,
        tasks,
      };
    }
    if (input.toolName === 'thread.list') {
      const parsed = parseThreadListArguments(input, this.threadListLimit);
      const listed = await this.options.listThreads({
        ...(parsed.projectId === undefined ? {} : { projectId: parsed.projectId }),
        ...(parsed.includeArchived === undefined
          ? {}
          : { includeArchived: parsed.includeArchived }),
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
      });
      const threads = filterThreadRows(listed, parsed.agentType, parsed.runtimeStatus);
      return {
        count: threads.length,
        limit: parsed.limit,
        threads,
      };
    }
    if (input.toolName === 'thread.create') {
      const parsed = parseThreadCreateArguments(input);
      return await this.options.createThread(parsed);
    }
    if (input.toolName === 'thread.update') {
      const parsed = parseThreadUpdateArguments(input);
      return await this.options.updateThread(parsed);
    }
    if (input.toolName === 'thread.archive') {
      const threadId = resolveThreadId(input, 'thread.archive');
      return await this.options.archiveThread(threadId);
    }
    if (input.toolName === 'thread.status') {
      const threadId = resolveThreadId(input, 'thread.status');
      const status = await this.options.threadStatus(threadId);
      return {
        threadId,
        status,
      };
    }
    if (input.toolName === 'thread.snapshot') {
      const parsed = parseThreadSnapshotArguments(input, this.snapshotTailLines);
      const snapshot = await this.options.threadSnapshot(parsed);
      return {
        threadId: parsed.threadId,
        tailLines: parsed.tailLines,
        snapshot,
      };
    }
    if (input.toolName === 'thread.respond') {
      const parsed = parseThreadRespondArguments(input);
      return await this.options.threadRespond(parsed);
    }
    if (input.toolName === 'thread.interrupt') {
      const threadId = resolveThreadId(input, 'thread.interrupt');
      return await this.options.threadInterrupt(threadId);
    }
    if (input.toolName === 'thread.claim') {
      const parsed = parseThreadClaimArguments(input, {
        defaultControllerId: this.defaultControllerId,
        defaultControllerLabel: this.defaultControllerLabel,
      });
      return await this.options.threadClaim(parsed);
    }
    if (input.toolName === 'thread.release') {
      const parsed = parseThreadReleaseArguments(input);
      return await this.options.threadRelease(parsed);
    }
    if (input.toolName === 'thread.start') {
      const parsed = parseThreadStartArguments(input);
      return await this.options.threadStart(parsed);
    }
    if (input.toolName === 'thread.attach') {
      const parsed = parseThreadAttachArguments(input);
      return await this.options.threadAttach(parsed);
    }
    if (input.toolName === 'thread.detach') {
      const threadId = resolveThreadId(input, 'thread.detach');
      return await this.options.threadDetach(threadId);
    }
    if (input.toolName === 'thread.events.subscribe') {
      const threadId = resolveThreadId(input, 'thread.events.subscribe');
      return await this.options.threadSubscribeEvents(threadId);
    }
    if (input.toolName === 'thread.events.unsubscribe') {
      const threadId = resolveThreadId(input, 'thread.events.unsubscribe');
      return await this.options.threadUnsubscribeEvents(threadId);
    }
    if (input.toolName === 'thread.close') {
      const threadId = resolveThreadId(input, 'thread.close');
      return await this.options.threadClose(threadId);
    }
    if (input.toolName === 'thread.remove') {
      const threadId = resolveThreadId(input, 'thread.remove');
      return await this.options.threadRemove(threadId);
    }
    if (input.toolName === 'session.list') {
      const sessions = await this.options.listSessions();
      return {
        count: sessions.length,
        sessions,
      };
    }
    throw new Error(`unsupported nim tool: ${input.toolName}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return undefined;
  }
  return value;
}

function readOptionalStringRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = value as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(entries)) {
    if (typeof entryValue !== 'string') {
      return undefined;
    }
    normalized[entryKey] = entryValue;
  }
  return normalized;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      return undefined;
    }
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  }
  return undefined;
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return undefined;
    }
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return undefined;
    }
    return parsed;
  }
  return undefined;
}

function parseArgumentPayload(input: RuntimeNimToolBridgeInvokeInput): unknown {
  if (input.argumentsValue !== undefined) {
    return input.argumentsValue;
  }
  const raw = input.argumentsText?.trim() ?? '';
  if (raw.length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function resolvePositiveLimit(argumentsText: string, fallback: number): number {
  const trimmed = argumentsText.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid limit: ${trimmed}`);
  }
  return parsed;
}

function resolveTaskListLimit(input: {
  readonly argumentsText: string | undefined;
  readonly argumentsValue: unknown;
  readonly fallback: number;
}): number {
  const value = input.argumentsValue;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`invalid task.list limit: ${String(value)}`);
    }
    return value;
  }
  if (typeof value === 'object' && value !== null && 'limit' in value) {
    const limit = (value as { readonly limit?: unknown }).limit;
    const parsed = parsePositiveInteger(limit);
    if (parsed === undefined) {
      throw new Error(`invalid task.list limit: ${String(limit)}`);
    }
    return parsed;
  }
  const parsed = resolvePositiveLimit(input.argumentsText ?? '', input.fallback);
  return parsed;
}

function readThreadIdFromRecord(record: Record<string, unknown>): string | null {
  const threadId = readOptionalString(record, 'threadId');
  if (threadId !== undefined) {
    const trimmed = threadId.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const sessionId = readOptionalString(record, 'sessionId');
  if (sessionId === undefined) {
    return null;
  }
  const trimmed = sessionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveThreadId(input: RuntimeNimToolBridgeInvokeInput, toolName: string): string {
  const payload = parseArgumentPayload(input);
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.length === 0) {
      throw new Error(`missing ${toolName} threadId`);
    }
    return trimmed;
  }
  const record = asRecord(payload);
  if (record === null) {
    throw new Error(`invalid ${toolName} arguments`);
  }
  const threadId = readThreadIdFromRecord(record);
  if (threadId === null) {
    throw new Error(`missing ${toolName} threadId`);
  }
  return threadId;
}

function parseThreadListArguments(
  input: RuntimeNimToolBridgeInvokeInput,
  fallbackLimit: number,
): {
  projectId?: string;
  includeArchived?: boolean;
  limit: number;
  agentType?: string;
  runtimeStatus?: RuntimeNimThreadRuntimeStatus;
} {
  const payload = parseArgumentPayload(input);
  if (typeof payload === 'string') {
    return {
      limit: resolvePositiveLimit(payload, fallbackLimit),
    };
  }
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.list arguments');
  }
  const limit = parsePositiveInteger(record['limit']) ?? fallbackLimit;
  const projectId =
    readOptionalString(record, 'projectId') ?? readOptionalString(record, 'directoryId');
  const includeArchived = readOptionalBoolean(record, 'includeArchived');
  const agentType = readOptionalString(record, 'agentType');
  const runtimeStatusRaw =
    readOptionalString(record, 'runtimeStatus') ?? readOptionalString(record, 'status');
  let runtimeStatus: RuntimeNimThreadRuntimeStatus | undefined;
  if (runtimeStatusRaw !== undefined) {
    if (
      runtimeStatusRaw !== 'running' &&
      runtimeStatusRaw !== 'needs-input' &&
      runtimeStatusRaw !== 'completed' &&
      runtimeStatusRaw !== 'exited'
    ) {
      throw new Error(`invalid thread.list runtimeStatus: ${runtimeStatusRaw}`);
    }
    runtimeStatus = runtimeStatusRaw;
  }
  return {
    ...(projectId === undefined ? {} : { projectId }),
    ...(includeArchived === undefined ? {} : { includeArchived }),
    limit,
    ...(agentType === undefined ? {} : { agentType }),
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
  };
}

function parseThreadCreateArguments(input: RuntimeNimToolBridgeInvokeInput): {
  threadId?: string;
  projectId: string;
  title: string;
  agentType: string;
  adapterState?: Record<string, unknown>;
} {
  const payload = parseArgumentPayload(input);
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.create arguments');
  }
  const projectId =
    readOptionalString(record, 'projectId') ?? readOptionalString(record, 'directoryId');
  const title = readOptionalString(record, 'title');
  const agentType = readOptionalString(record, 'agentType');
  const threadId = readThreadIdFromRecord(record) ?? undefined;
  if (projectId === undefined || projectId.trim().length === 0) {
    throw new Error('missing thread.create projectId');
  }
  if (title === undefined || title.trim().length === 0) {
    throw new Error('missing thread.create title');
  }
  if (agentType === undefined || agentType.trim().length === 0) {
    throw new Error(
      'missing thread.create agentType (expected one of codex|claude|cursor|terminal|shell|critique|nim)',
    );
  }
  const adapterStateRaw = record['adapterState'];
  let adapterState: Record<string, unknown> | undefined;
  if (adapterStateRaw !== undefined) {
    const parsedAdapterState = asRecord(adapterStateRaw);
    if (parsedAdapterState === null) {
      throw new Error('invalid thread.create adapterState');
    }
    adapterState = parsedAdapterState;
  }
  return {
    ...(threadId === undefined ? {} : { threadId }),
    projectId,
    title,
    agentType: agentType.trim(),
    ...(adapterState === undefined ? {} : { adapterState }),
  };
}

function parseThreadUpdateArguments(input: RuntimeNimToolBridgeInvokeInput): {
  threadId: string;
  title: string;
} {
  const payload = parseArgumentPayload(input);
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.update arguments');
  }
  const threadId = readThreadIdFromRecord(record);
  const title = readOptionalString(record, 'title');
  if (threadId === null) {
    throw new Error('missing thread.update threadId');
  }
  if (title === undefined || title.trim().length === 0) {
    throw new Error('missing thread.update title');
  }
  return {
    threadId,
    title,
  };
}

function parseThreadSnapshotArguments(
  input: RuntimeNimToolBridgeInvokeInput,
  fallbackTailLines: number,
): {
  threadId: string;
  tailLines: number;
} {
  const payload = parseArgumentPayload(input);
  if (typeof payload === 'string') {
    const threadId = payload.trim();
    if (threadId.length === 0) {
      throw new Error('missing thread.snapshot threadId');
    }
    return {
      threadId,
      tailLines: fallbackTailLines,
    };
  }
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.snapshot arguments');
  }
  const threadId = readThreadIdFromRecord(record);
  if (threadId === null) {
    throw new Error('missing thread.snapshot threadId');
  }
  const tailLines = parsePositiveInteger(record['tailLines']) ?? fallbackTailLines;
  return {
    threadId,
    tailLines,
  };
}

function parseThreadRespondArguments(input: RuntimeNimToolBridgeInvokeInput): {
  threadId: string;
  text: string;
} {
  const payload = parseArgumentPayload(input);
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.respond arguments');
  }
  const threadId = readThreadIdFromRecord(record);
  const text = readOptionalString(record, 'text');
  if (threadId === null) {
    throw new Error('missing thread.respond threadId');
  }
  if (text === undefined || text.trim().length === 0) {
    const messageAlias = readOptionalString(record, 'message');
    if (messageAlias !== undefined && messageAlias.trim().length > 0) {
      return {
        threadId,
        text: messageAlias,
      };
    }
    throw new Error(
      'missing thread.respond text (expected {"threadId":"<id>","text":"<message>"})',
    );
  }
  return {
    threadId,
    text,
  };
}

function parseThreadClaimArguments(
  input: RuntimeNimToolBridgeInvokeInput,
  defaults: {
    defaultControllerId: string;
    defaultControllerLabel: string;
  },
): {
  threadId: string;
  controllerId: string;
  controllerType: StreamSessionControllerType;
  controllerLabel?: string;
  reason?: string;
  takeover?: boolean;
} {
  const payload = parseArgumentPayload(input);
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.claim arguments');
  }
  const threadId = readThreadIdFromRecord(record);
  if (threadId === null) {
    throw new Error('missing thread.claim threadId');
  }
  const controllerId = readOptionalString(record, 'controllerId') ?? defaults.defaultControllerId;
  const rawControllerType = readOptionalString(record, 'controllerType');
  const controllerType: StreamSessionControllerType =
    rawControllerType === undefined
      ? 'agent'
      : rawControllerType === 'human' ||
          rawControllerType === 'agent' ||
          rawControllerType === 'automation'
        ? rawControllerType
        : (() => {
            throw new Error(`invalid thread.claim controllerType: ${rawControllerType}`);
          })();
  const controllerLabel =
    readOptionalString(record, 'controllerLabel') ?? defaults.defaultControllerLabel;
  const reason = readOptionalString(record, 'reason');
  const takeover = readOptionalBoolean(record, 'takeover');
  return {
    threadId,
    controllerId,
    controllerType,
    ...(controllerLabel.length === 0 ? {} : { controllerLabel }),
    ...(reason === undefined ? {} : { reason }),
    ...(takeover === undefined ? {} : { takeover }),
  };
}

function parseThreadReleaseArguments(input: RuntimeNimToolBridgeInvokeInput): {
  threadId: string;
  reason?: string;
} {
  const payload = parseArgumentPayload(input);
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.release arguments');
  }
  const threadId = readThreadIdFromRecord(record);
  if (threadId === null) {
    throw new Error('missing thread.release threadId');
  }
  const reason = readOptionalString(record, 'reason');
  return {
    threadId,
    ...(reason === undefined ? {} : { reason }),
  };
}

function parseThreadStartArguments(input: RuntimeNimToolBridgeInvokeInput): {
  threadId: string;
  args?: readonly string[];
  env?: Record<string, string>;
  cwd?: string;
  initialCols?: number;
  initialRows?: number;
  worktreeId?: string;
} {
  const payload = parseArgumentPayload(input);
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.start arguments');
  }
  const threadId = readThreadIdFromRecord(record);
  if (threadId === null) {
    throw new Error('missing thread.start threadId');
  }
  const args = readOptionalStringArray(record, 'args');
  if (record['args'] !== undefined && args === undefined) {
    throw new Error('invalid thread.start args');
  }
  const env = readOptionalStringRecord(record, 'env');
  if (record['env'] !== undefined && env === undefined) {
    throw new Error('invalid thread.start env');
  }
  const cwd = readOptionalString(record, 'cwd');
  if (record['cwd'] !== undefined && cwd === undefined) {
    throw new Error('invalid thread.start cwd');
  }
  const initialCols = parsePositiveInteger(record['initialCols']);
  if (record['initialCols'] !== undefined && initialCols === undefined) {
    throw new Error('invalid thread.start initialCols');
  }
  const initialRows = parsePositiveInteger(record['initialRows']);
  if (record['initialRows'] !== undefined && initialRows === undefined) {
    throw new Error('invalid thread.start initialRows');
  }
  const worktreeId = readOptionalString(record, 'worktreeId');
  if (record['worktreeId'] !== undefined && worktreeId === undefined) {
    throw new Error('invalid thread.start worktreeId');
  }
  return {
    threadId,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(initialCols === undefined ? {} : { initialCols }),
    ...(initialRows === undefined ? {} : { initialRows }),
    ...(worktreeId === undefined ? {} : { worktreeId }),
  };
}

function parseThreadAttachArguments(input: RuntimeNimToolBridgeInvokeInput): {
  threadId: string;
  sinceCursor?: number;
} {
  const payload = parseArgumentPayload(input);
  if (typeof payload === 'string') {
    const threadId = payload.trim();
    if (threadId.length === 0) {
      throw new Error('missing thread.attach threadId');
    }
    return {
      threadId,
    };
  }
  const record = asRecord(payload);
  if (record === null) {
    throw new Error('invalid thread.attach arguments');
  }
  const threadId = readThreadIdFromRecord(record);
  if (threadId === null) {
    throw new Error('missing thread.attach threadId');
  }
  const sinceCursor = parseNonNegativeInteger(record['sinceCursor']);
  if (record['sinceCursor'] !== undefined && sinceCursor === undefined) {
    throw new Error('invalid thread.attach sinceCursor');
  }
  return {
    threadId,
    ...(sinceCursor === undefined ? {} : { sinceCursor }),
  };
}

function filterThreadRows(
  rows: readonly unknown[],
  agentType: string | undefined,
  runtimeStatus: RuntimeNimThreadRuntimeStatus | undefined,
): readonly unknown[] {
  if (agentType === undefined && runtimeStatus === undefined) {
    return rows;
  }
  return rows.filter((row) => {
    const record = asRecord(row);
    if (record === null) {
      return false;
    }
    if (agentType !== undefined) {
      const value = readOptionalString(record, 'agentType');
      if (value === undefined || value.trim().toLowerCase() !== agentType.trim().toLowerCase()) {
        return false;
      }
    }
    if (runtimeStatus !== undefined) {
      const value = readOptionalString(record, 'runtimeStatus');
      if (value !== runtimeStatus) {
        return false;
      }
    }
    return true;
  });
}
