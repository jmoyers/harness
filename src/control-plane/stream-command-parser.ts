import type { StreamCommand } from './stream-protocol.ts';

type StreamCommandType = StreamCommand['type'];
type CommandRecord = Record<string, unknown>;
type CommandParser = (record: CommandRecord) => StreamCommand | null;

function asRecord(value: unknown): CommandRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as CommandRecord;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readStringRecord(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== 'string') {
      return null;
    }
    normalized[key] = entryValue;
  }
  return normalized;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function readOptionalString(record: CommandRecord, field: string): string | null | undefined {
  const value = readString(record[field]);
  if (record[field] !== undefined && value === null) {
    return undefined;
  }
  return value;
}

function readOptionalBoolean(record: CommandRecord, field: string): boolean | null | undefined {
  const value = readBoolean(record[field]);
  if (record[field] !== undefined && value === null) {
    return undefined;
  }
  return value;
}

function readOptionalInteger(
  record: CommandRecord,
  field: string,
  minInclusive: number
): number | null | undefined {
  const value = readNumber(record[field]);
  if (record[field] !== undefined && value === null) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < minInclusive) {
    return undefined;
  }
  return value;
}

function parseSessionControllerType(value: unknown): 'human' | 'agent' | 'automation' | null {
  if (value === 'human' || value === 'agent' || value === 'automation') {
    return value;
  }
  return null;
}

function parseDirectoryUpsert(record: CommandRecord): StreamCommand | null {
  const path = readString(record['path']);
  if (path === null) {
    return null;
  }
  const directoryId = readOptionalString(record, 'directoryId');
  const tenantId = readOptionalString(record, 'tenantId');
  const userId = readOptionalString(record, 'userId');
  const workspaceId = readOptionalString(record, 'workspaceId');
  if (
    directoryId === undefined ||
    tenantId === undefined ||
    userId === undefined ||
    workspaceId === undefined
  ) {
    return null;
  }
  const command: StreamCommand = {
    type: 'directory.upsert',
    path
  };
  if (directoryId !== null) {
    command.directoryId = directoryId;
  }
  if (tenantId !== null) {
    command.tenantId = tenantId;
  }
  if (userId !== null) {
    command.userId = userId;
  }
  if (workspaceId !== null) {
    command.workspaceId = workspaceId;
  }
  return command;
}

function parseDirectoryList(record: CommandRecord): StreamCommand | null {
  const tenantId = readOptionalString(record, 'tenantId');
  const userId = readOptionalString(record, 'userId');
  const workspaceId = readOptionalString(record, 'workspaceId');
  const includeArchived = readOptionalBoolean(record, 'includeArchived');
  const limit = readOptionalInteger(record, 'limit', 1);
  if (
    tenantId === undefined ||
    userId === undefined ||
    workspaceId === undefined ||
    includeArchived === undefined ||
    limit === undefined
  ) {
    return null;
  }
  const command: StreamCommand = {
    type: 'directory.list'
  };
  if (tenantId !== null) {
    command.tenantId = tenantId;
  }
  if (userId !== null) {
    command.userId = userId;
  }
  if (workspaceId !== null) {
    command.workspaceId = workspaceId;
  }
  if (includeArchived !== null) {
    command.includeArchived = includeArchived;
  }
  if (limit !== null) {
    command.limit = limit;
  }
  return command;
}

function parseDirectoryArchive(record: CommandRecord): StreamCommand | null {
  const directoryId = readString(record['directoryId']);
  if (directoryId === null) {
    return null;
  }
  return {
    type: 'directory.archive',
    directoryId
  };
}

function parseConversationCreate(record: CommandRecord): StreamCommand | null {
  const directoryId = readString(record['directoryId']);
  const title = readString(record['title']);
  const agentType = readString(record['agentType']);
  if (directoryId === null || title === null || agentType === null) {
    return null;
  }
  const conversationId = readOptionalString(record, 'conversationId');
  if (conversationId === undefined) {
    return null;
  }
  const command: StreamCommand = {
    type: 'conversation.create',
    directoryId,
    title,
    agentType
  };
  const adapterState = record['adapterState'];
  if (adapterState !== undefined) {
    const parsedAdapterState = asRecord(adapterState);
    if (parsedAdapterState === null) {
      return null;
    }
    command.adapterState = parsedAdapterState;
  }
  if (conversationId !== null) {
    command.conversationId = conversationId;
  }
  return command;
}

function parseConversationList(record: CommandRecord): StreamCommand | null {
  const directoryId = readOptionalString(record, 'directoryId');
  const tenantId = readOptionalString(record, 'tenantId');
  const userId = readOptionalString(record, 'userId');
  const workspaceId = readOptionalString(record, 'workspaceId');
  const includeArchived = readOptionalBoolean(record, 'includeArchived');
  const limit = readOptionalInteger(record, 'limit', 1);
  if (
    directoryId === undefined ||
    tenantId === undefined ||
    userId === undefined ||
    workspaceId === undefined ||
    includeArchived === undefined ||
    limit === undefined
  ) {
    return null;
  }
  const command: StreamCommand = {
    type: 'conversation.list'
  };
  if (directoryId !== null) {
    command.directoryId = directoryId;
  }
  if (tenantId !== null) {
    command.tenantId = tenantId;
  }
  if (userId !== null) {
    command.userId = userId;
  }
  if (workspaceId !== null) {
    command.workspaceId = workspaceId;
  }
  if (includeArchived !== null) {
    command.includeArchived = includeArchived;
  }
  if (limit !== null) {
    command.limit = limit;
  }
  return command;
}

function parseConversationArchive(record: CommandRecord): StreamCommand | null {
  const conversationId = readString(record['conversationId']);
  if (conversationId === null) {
    return null;
  }
  return {
    type: 'conversation.archive',
    conversationId
  };
}

function parseConversationUpdate(record: CommandRecord): StreamCommand | null {
  const conversationId = readString(record['conversationId']);
  const title = readString(record['title']);
  if (conversationId === null || title === null) {
    return null;
  }
  return {
    type: 'conversation.update',
    conversationId,
    title
  };
}

function parseConversationDelete(record: CommandRecord): StreamCommand | null {
  const conversationId = readString(record['conversationId']);
  if (conversationId === null) {
    return null;
  }
  return {
    type: 'conversation.delete',
    conversationId
  };
}

function parseStreamSubscribe(record: CommandRecord): StreamCommand | null {
  const tenantId = readOptionalString(record, 'tenantId');
  const userId = readOptionalString(record, 'userId');
  const workspaceId = readOptionalString(record, 'workspaceId');
  const directoryId = readOptionalString(record, 'directoryId');
  const conversationId = readOptionalString(record, 'conversationId');
  const includeOutput = readOptionalBoolean(record, 'includeOutput');
  const afterCursor = readOptionalInteger(record, 'afterCursor', 0);
  if (
    tenantId === undefined ||
    userId === undefined ||
    workspaceId === undefined ||
    directoryId === undefined ||
    conversationId === undefined ||
    includeOutput === undefined ||
    afterCursor === undefined
  ) {
    return null;
  }
  const command: StreamCommand = {
    type: 'stream.subscribe'
  };
  if (tenantId !== null) {
    command.tenantId = tenantId;
  }
  if (userId !== null) {
    command.userId = userId;
  }
  if (workspaceId !== null) {
    command.workspaceId = workspaceId;
  }
  if (directoryId !== null) {
    command.directoryId = directoryId;
  }
  if (conversationId !== null) {
    command.conversationId = conversationId;
  }
  if (includeOutput !== null) {
    command.includeOutput = includeOutput;
  }
  if (afterCursor !== null) {
    command.afterCursor = afterCursor;
  }
  return command;
}

function parseStreamUnsubscribe(record: CommandRecord): StreamCommand | null {
  const subscriptionId = readString(record['subscriptionId']);
  if (subscriptionId === null) {
    return null;
  }
  return {
    type: 'stream.unsubscribe',
    subscriptionId
  };
}

function parseSessionList(record: CommandRecord): StreamCommand | null {
  const tenantId = readOptionalString(record, 'tenantId');
  const userId = readOptionalString(record, 'userId');
  const workspaceId = readOptionalString(record, 'workspaceId');
  const worktreeId = readOptionalString(record, 'worktreeId');
  const status = readOptionalString(record, 'status');
  const live = readOptionalBoolean(record, 'live');
  const sort = readOptionalString(record, 'sort');
  const limit = readOptionalInteger(record, 'limit', 1);
  if (
    tenantId === undefined ||
    userId === undefined ||
    workspaceId === undefined ||
    worktreeId === undefined ||
    status === undefined ||
    live === undefined ||
    sort === undefined ||
    limit === undefined
  ) {
    return null;
  }
  if (
    status !== null &&
    status !== 'running' &&
    status !== 'needs-input' &&
    status !== 'completed' &&
    status !== 'exited'
  ) {
    return null;
  }
  if (sort !== null && sort !== 'attention-first' && sort !== 'started-desc' && sort !== 'started-asc') {
    return null;
  }
  const command: StreamCommand = {
    type: 'session.list'
  };
  if (tenantId !== null) {
    command.tenantId = tenantId;
  }
  if (userId !== null) {
    command.userId = userId;
  }
  if (workspaceId !== null) {
    command.workspaceId = workspaceId;
  }
  if (worktreeId !== null) {
    command.worktreeId = worktreeId;
  }
  if (status !== null) {
    command.status = status;
  }
  if (live !== null) {
    command.live = live;
  }
  if (sort !== null) {
    command.sort = sort;
  }
  if (limit !== null) {
    command.limit = limit;
  }
  return command;
}

function parseAttentionList(): StreamCommand {
  return {
    type: 'attention.list'
  };
}

function parseSessionIdCommand(type: 'session.status' | 'session.snapshot' | 'session.interrupt' | 'session.remove') {
  return (record: CommandRecord): StreamCommand | null => {
    const sessionId = readString(record['sessionId']);
    if (sessionId === null) {
      return null;
    }
    return {
      type,
      sessionId
    };
  };
}

function parseSessionRespond(record: CommandRecord): StreamCommand | null {
  const sessionId = readString(record['sessionId']);
  const text = readString(record['text']);
  if (sessionId === null || text === null) {
    return null;
  }
  return {
    type: 'session.respond',
    sessionId,
    text
  };
}

function parseSessionClaim(record: CommandRecord): StreamCommand | null {
  const sessionId = readString(record['sessionId']);
  const controllerId = readString(record['controllerId']);
  const controllerType = parseSessionControllerType(record['controllerType']);
  if (sessionId === null || controllerId === null || controllerType === null) {
    return null;
  }
  const controllerLabel = readOptionalString(record, 'controllerLabel');
  const reason = readOptionalString(record, 'reason');
  const takeover = readOptionalBoolean(record, 'takeover');
  if (controllerLabel === undefined || reason === undefined || takeover === undefined) {
    return null;
  }
  const command: StreamCommand = {
    type: 'session.claim',
    sessionId,
    controllerId,
    controllerType
  };
  if (controllerLabel !== null) {
    command.controllerLabel = controllerLabel;
  }
  if (reason !== null) {
    command.reason = reason;
  }
  if (takeover !== null) {
    command.takeover = takeover;
  }
  return command;
}

function parseSessionRelease(record: CommandRecord): StreamCommand | null {
  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }
  const reason = readOptionalString(record, 'reason');
  if (reason === undefined) {
    return null;
  }
  const command: StreamCommand = {
    type: 'session.release',
    sessionId
  };
  if (reason !== null) {
    command.reason = reason;
  }
  return command;
}

function parsePtyStart(record: CommandRecord): StreamCommand | null {
  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }
  const argsValue = record['args'];
  if (!isStringArray(argsValue)) {
    return null;
  }
  const initialCols = readNumber(record['initialCols']);
  const initialRows = readNumber(record['initialRows']);
  if (initialCols === null || initialRows === null) {
    return null;
  }
  const envValue = record['env'];
  let env: Record<string, string> | undefined;
  if (envValue !== undefined) {
    const parsedEnv = readStringRecord(envValue);
    if (parsedEnv === null) {
      return null;
    }
    env = parsedEnv;
  }
  const cwd = readOptionalString(record, 'cwd');
  if (cwd === undefined) {
    return null;
  }
  const tenantId = readOptionalString(record, 'tenantId');
  const userId = readOptionalString(record, 'userId');
  const workspaceId = readOptionalString(record, 'workspaceId');
  const worktreeId = readOptionalString(record, 'worktreeId');
  if (tenantId === undefined || userId === undefined || workspaceId === undefined || worktreeId === undefined) {
    return null;
  }
  const terminalForegroundHex = record['terminalForegroundHex'];
  if (terminalForegroundHex !== undefined && typeof terminalForegroundHex !== 'string') {
    return null;
  }
  const terminalBackgroundHex = record['terminalBackgroundHex'];
  if (terminalBackgroundHex !== undefined && typeof terminalBackgroundHex !== 'string') {
    return null;
  }
  const command: StreamCommand = {
    type: 'pty.start',
    sessionId,
    args: argsValue,
    initialCols,
    initialRows
  };
  if (env !== undefined) {
    command.env = env;
  }
  if (cwd !== null) {
    command.cwd = cwd;
  }
  if (terminalForegroundHex !== undefined) {
    command.terminalForegroundHex = terminalForegroundHex;
  }
  if (terminalBackgroundHex !== undefined) {
    command.terminalBackgroundHex = terminalBackgroundHex;
  }
  if (tenantId !== null) {
    command.tenantId = tenantId;
  }
  if (userId !== null) {
    command.userId = userId;
  }
  if (workspaceId !== null) {
    command.workspaceId = workspaceId;
  }
  if (worktreeId !== null) {
    command.worktreeId = worktreeId;
  }
  return command;
}

function parsePtyAttach(record: CommandRecord): StreamCommand | null {
  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }
  const sinceCursor = readNumber(record['sinceCursor']);
  if (record['sinceCursor'] !== undefined && sinceCursor === null) {
    return null;
  }
  const command: StreamCommand = {
    type: 'pty.attach',
    sessionId
  };
  if (sinceCursor !== null) {
    command.sinceCursor = sinceCursor;
  }
  return command;
}

function parsePtySimple(type: 'pty.detach' | 'pty.subscribe-events' | 'pty.unsubscribe-events' | 'pty.close') {
  return (record: CommandRecord): StreamCommand | null => {
    const sessionId = readString(record['sessionId']);
    if (sessionId === null) {
      return null;
    }
    return {
      type,
      sessionId
    };
  };
}

export interface StreamCommandParserRegistry {
  readonly [type: string]: CommandParser;
}

export const DEFAULT_STREAM_COMMAND_PARSERS: StreamCommandParserRegistry = {
  'directory.upsert': parseDirectoryUpsert,
  'directory.list': parseDirectoryList,
  'directory.archive': parseDirectoryArchive,
  'conversation.create': parseConversationCreate,
  'conversation.list': parseConversationList,
  'conversation.archive': parseConversationArchive,
  'conversation.update': parseConversationUpdate,
  'conversation.delete': parseConversationDelete,
  'stream.subscribe': parseStreamSubscribe,
  'stream.unsubscribe': parseStreamUnsubscribe,
  'session.list': parseSessionList,
  'attention.list': () => parseAttentionList(),
  'session.status': parseSessionIdCommand('session.status'),
  'session.snapshot': parseSessionIdCommand('session.snapshot'),
  'session.respond': parseSessionRespond,
  'session.claim': parseSessionClaim,
  'session.release': parseSessionRelease,
  'session.interrupt': parseSessionIdCommand('session.interrupt'),
  'session.remove': parseSessionIdCommand('session.remove'),
  'pty.start': parsePtyStart,
  'pty.attach': parsePtyAttach,
  'pty.detach': parsePtySimple('pty.detach'),
  'pty.subscribe-events': parsePtySimple('pty.subscribe-events'),
  'pty.unsubscribe-events': parsePtySimple('pty.unsubscribe-events'),
  'pty.close': parsePtySimple('pty.close')
};

export function parseStreamCommand(
  value: unknown,
  parsers: StreamCommandParserRegistry = DEFAULT_STREAM_COMMAND_PARSERS
): StreamCommand | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const type = readString(record['type']);
  if (type === null) {
    return null;
  }
  const parser = parsers[type as StreamCommandType];
  if (parser === undefined) {
    return null;
  }
  return parser(record);
}
