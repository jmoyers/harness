import type { PtyExit } from '../pty/pty_host.ts';

export type StreamSignal = 'interrupt' | 'eof' | 'terminate';
export type StreamSessionRuntimeStatus = 'running' | 'needs-input' | 'completed' | 'exited';
export type StreamSessionListSort = 'attention-first' | 'started-desc' | 'started-asc';

interface DirectoryUpsertCommand {
  type: 'directory.upsert';
  directoryId?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  path: string;
}

interface DirectoryListCommand {
  type: 'directory.list';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface ConversationCreateCommand {
  type: 'conversation.create';
  conversationId?: string;
  directoryId: string;
  title: string;
  agentType: string;
  adapterState?: Record<string, unknown>;
}

interface ConversationListCommand {
  type: 'conversation.list';
  directoryId?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface ConversationArchiveCommand {
  type: 'conversation.archive';
  conversationId: string;
}

interface ConversationDeleteCommand {
  type: 'conversation.delete';
  conversationId: string;
}

interface StreamSubscribeCommand {
  type: 'stream.subscribe';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  directoryId?: string;
  conversationId?: string;
  includeOutput?: boolean;
  afterCursor?: number;
}

interface StreamUnsubscribeCommand {
  type: 'stream.unsubscribe';
  subscriptionId: string;
}

interface SessionListCommand {
  type: 'session.list';
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  worktreeId?: string;
  status?: StreamSessionRuntimeStatus;
  live?: boolean;
  sort?: StreamSessionListSort;
  limit?: number;
}

interface AttentionListCommand {
  type: 'attention.list';
}

interface SessionStatusCommand {
  type: 'session.status';
  sessionId: string;
}

interface SessionSnapshotCommand {
  type: 'session.snapshot';
  sessionId: string;
}

interface SessionRespondCommand {
  type: 'session.respond';
  sessionId: string;
  text: string;
}

interface SessionInterruptCommand {
  type: 'session.interrupt';
  sessionId: string;
}

interface SessionRemoveCommand {
  type: 'session.remove';
  sessionId: string;
}

interface PtyStartCommand {
  type: 'pty.start';
  sessionId: string;
  args: string[];
  env?: Record<string, string>;
  initialCols: number;
  initialRows: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  worktreeId?: string;
}

interface PtyAttachCommand {
  type: 'pty.attach';
  sessionId: string;
  sinceCursor?: number;
}

interface PtyDetachCommand {
  type: 'pty.detach';
  sessionId: string;
}

interface PtySubscribeEventsCommand {
  type: 'pty.subscribe-events';
  sessionId: string;
}

interface PtyUnsubscribeEventsCommand {
  type: 'pty.unsubscribe-events';
  sessionId: string;
}

interface PtyCloseCommand {
  type: 'pty.close';
  sessionId: string;
}

export type StreamCommand =
  | DirectoryUpsertCommand
  | DirectoryListCommand
  | ConversationCreateCommand
  | ConversationListCommand
  | ConversationArchiveCommand
  | ConversationDeleteCommand
  | StreamSubscribeCommand
  | StreamUnsubscribeCommand
  | SessionListCommand
  | AttentionListCommand
  | SessionStatusCommand
  | SessionSnapshotCommand
  | SessionRespondCommand
  | SessionInterruptCommand
  | SessionRemoveCommand
  | PtyStartCommand
  | PtyAttachCommand
  | PtyDetachCommand
  | PtySubscribeEventsCommand
  | PtyUnsubscribeEventsCommand
  | PtyCloseCommand;

export interface StreamCommandEnvelope {
  kind: 'command';
  commandId: string;
  command: StreamCommand;
}

interface StreamAuthEnvelope {
  kind: 'auth';
  token: string;
}

interface StreamInputEnvelope {
  kind: 'pty.input';
  sessionId: string;
  dataBase64: string;
}

interface StreamResizeEnvelope {
  kind: 'pty.resize';
  sessionId: string;
  cols: number;
  rows: number;
}

interface StreamSignalEnvelope {
  kind: 'pty.signal';
  sessionId: string;
  signal: StreamSignal;
}

export type StreamClientEnvelope =
  | StreamAuthEnvelope
  | StreamCommandEnvelope
  | StreamInputEnvelope
  | StreamResizeEnvelope
  | StreamSignalEnvelope;

interface StreamNotifyRecord {
  ts: string;
  payload: Record<string, unknown>;
}

export type StreamSessionEvent =
  | {
      type: 'notify';
      record: StreamNotifyRecord;
    }
  | {
      type: 'turn-completed';
      record: StreamNotifyRecord;
    }
  | {
      type: 'attention-required';
      reason: string;
      record: StreamNotifyRecord;
    }
  | {
      type: 'session-exit';
      exit: PtyExit;
    };

export type StreamObservedEvent =
  | {
      type: 'directory-upserted';
      directory: Record<string, unknown>;
    }
  | {
      type: 'conversation-created';
      conversation: Record<string, unknown>;
    }
  | {
      type: 'conversation-archived';
      conversationId: string;
      ts: string;
    }
  | {
      type: 'conversation-deleted';
      conversationId: string;
      ts: string;
    }
  | {
      type: 'session-status';
      sessionId: string;
      status: StreamSessionRuntimeStatus;
      attentionReason: string | null;
      live: boolean;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
    }
  | {
      type: 'session-event';
      sessionId: string;
      event: StreamSessionEvent;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
    }
  | {
      type: 'session-output';
      sessionId: string;
      outputCursor: number;
      chunkBase64: string;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
    };

interface StreamCommandAcceptedEnvelope {
  kind: 'command.accepted';
  commandId: string;
}

interface StreamAuthOkEnvelope {
  kind: 'auth.ok';
}

interface StreamAuthErrorEnvelope {
  kind: 'auth.error';
  error: string;
}

interface StreamCommandCompletedEnvelope {
  kind: 'command.completed';
  commandId: string;
  result: Record<string, unknown>;
}

interface StreamCommandFailedEnvelope {
  kind: 'command.failed';
  commandId: string;
  error: string;
}

interface StreamPtyOutputEnvelope {
  kind: 'pty.output';
  sessionId: string;
  cursor: number;
  chunkBase64: string;
}

interface StreamPtyExitEnvelope {
  kind: 'pty.exit';
  sessionId: string;
  exit: PtyExit;
}

interface StreamPtyEventEnvelope {
  kind: 'pty.event';
  sessionId: string;
  event: StreamSessionEvent;
}

interface StreamObservedEventEnvelope {
  kind: 'stream.event';
  subscriptionId: string;
  cursor: number;
  event: StreamObservedEvent;
}

export type StreamServerEnvelope =
  | StreamAuthOkEnvelope
  | StreamAuthErrorEnvelope
  | StreamCommandAcceptedEnvelope
  | StreamCommandCompletedEnvelope
  | StreamCommandFailedEnvelope
  | StreamPtyOutputEnvelope
  | StreamPtyExitEnvelope
  | StreamPtyEventEnvelope
  | StreamObservedEventEnvelope;

interface ConsumedJsonLines {
  messages: unknown[];
  remainder: string;
}

export function encodeStreamEnvelope(envelope: StreamClientEnvelope | StreamServerEnvelope): string {
  return `${JSON.stringify(envelope)}\n`;
}

export function consumeJsonLines(buffer: string): ConsumedJsonLines {
  const lines = buffer.split('\n');
  const remainder = lines.pop() as string;
  const messages: unknown[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // Invalid lines are ignored so malformed peers cannot break stream processing.
    }
  }

  return {
    messages,
    remainder
  };
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

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readSignalName(value: unknown): NodeJS.Signals | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (!/^SIG[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(value)) {
    return null;
  }
  return value as NodeJS.Signals;
}

function readStringRecord(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const entries = Object.entries(record);
  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
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

function parseStreamCommand(value: unknown): StreamCommand | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const type = readString(record['type']);
  if (type === null) {
    return null;
  }

  if (type === 'directory.upsert') {
    const path = readString(record['path']);
    if (path === null) {
      return null;
    }
    const command: DirectoryUpsertCommand = {
      type,
      path
    };
    const directoryId = readString(record['directoryId']);
    if (record['directoryId'] !== undefined && directoryId === null) {
      return null;
    }
    const tenantId = readString(record['tenantId']);
    if (record['tenantId'] !== undefined && tenantId === null) {
      return null;
    }
    const userId = readString(record['userId']);
    if (record['userId'] !== undefined && userId === null) {
      return null;
    }
    const workspaceId = readString(record['workspaceId']);
    if (record['workspaceId'] !== undefined && workspaceId === null) {
      return null;
    }
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

  if (type === 'directory.list') {
    const command: DirectoryListCommand = {
      type
    };
    const tenantId = readString(record['tenantId']);
    if (record['tenantId'] !== undefined && tenantId === null) {
      return null;
    }
    const userId = readString(record['userId']);
    if (record['userId'] !== undefined && userId === null) {
      return null;
    }
    const workspaceId = readString(record['workspaceId']);
    if (record['workspaceId'] !== undefined && workspaceId === null) {
      return null;
    }
    const includeArchived = readBoolean(record['includeArchived']);
    if (record['includeArchived'] !== undefined && includeArchived === null) {
      return null;
    }
    const limit = readNumber(record['limit']);
    if (record['limit'] !== undefined && limit === null) {
      return null;
    }
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      return null;
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

  if (type === 'conversation.create') {
    const directoryId = readString(record['directoryId']);
    const title = readString(record['title']);
    const agentType = readString(record['agentType']);
    if (directoryId === null || title === null || agentType === null) {
      return null;
    }
    const conversationId = readString(record['conversationId']);
    if (record['conversationId'] !== undefined && conversationId === null) {
      return null;
    }
    const command: ConversationCreateCommand = {
      type,
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

  if (type === 'conversation.list') {
    const command: ConversationListCommand = {
      type
    };
    const directoryId = readString(record['directoryId']);
    if (record['directoryId'] !== undefined && directoryId === null) {
      return null;
    }
    const tenantId = readString(record['tenantId']);
    if (record['tenantId'] !== undefined && tenantId === null) {
      return null;
    }
    const userId = readString(record['userId']);
    if (record['userId'] !== undefined && userId === null) {
      return null;
    }
    const workspaceId = readString(record['workspaceId']);
    if (record['workspaceId'] !== undefined && workspaceId === null) {
      return null;
    }
    const includeArchived = readBoolean(record['includeArchived']);
    if (record['includeArchived'] !== undefined && includeArchived === null) {
      return null;
    }
    const limit = readNumber(record['limit']);
    if (record['limit'] !== undefined && limit === null) {
      return null;
    }
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      return null;
    }
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

  if (type === 'conversation.archive') {
    const conversationId = readString(record['conversationId']);
    if (conversationId === null) {
      return null;
    }
    return {
      type,
      conversationId
    };
  }

  if (type === 'conversation.delete') {
    const conversationId = readString(record['conversationId']);
    if (conversationId === null) {
      return null;
    }
    return {
      type,
      conversationId
    };
  }

  if (type === 'stream.subscribe') {
    const command: StreamSubscribeCommand = {
      type
    };
    const tenantId = readString(record['tenantId']);
    if (record['tenantId'] !== undefined && tenantId === null) {
      return null;
    }
    const userId = readString(record['userId']);
    if (record['userId'] !== undefined && userId === null) {
      return null;
    }
    const workspaceId = readString(record['workspaceId']);
    if (record['workspaceId'] !== undefined && workspaceId === null) {
      return null;
    }
    const directoryId = readString(record['directoryId']);
    if (record['directoryId'] !== undefined && directoryId === null) {
      return null;
    }
    const conversationId = readString(record['conversationId']);
    if (record['conversationId'] !== undefined && conversationId === null) {
      return null;
    }
    const includeOutput = readBoolean(record['includeOutput']);
    if (record['includeOutput'] !== undefined && includeOutput === null) {
      return null;
    }
    const afterCursor = readNumber(record['afterCursor']);
    if (record['afterCursor'] !== undefined && afterCursor === null) {
      return null;
    }
    if (afterCursor !== null && (!Number.isInteger(afterCursor) || afterCursor < 0)) {
      return null;
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

  if (type === 'stream.unsubscribe') {
    const subscriptionId = readString(record['subscriptionId']);
    if (subscriptionId === null) {
      return null;
    }
    return {
      type,
      subscriptionId
    };
  }

  if (type === 'session.list') {
    const command: SessionListCommand = {
      type
    };
    const tenantId = readString(record['tenantId']);
    if (record['tenantId'] !== undefined && tenantId === null) {
      return null;
    }
    const userId = readString(record['userId']);
    if (record['userId'] !== undefined && userId === null) {
      return null;
    }
    const workspaceId = readString(record['workspaceId']);
    if (record['workspaceId'] !== undefined && workspaceId === null) {
      return null;
    }
    const worktreeId = readString(record['worktreeId']);
    if (record['worktreeId'] !== undefined && worktreeId === null) {
      return null;
    }
    const status = readString(record['status']);
    if (
      status !== null &&
      status !== 'running' &&
      status !== 'needs-input' &&
      status !== 'completed' &&
      status !== 'exited'
    ) {
      return null;
    }
    if (record['status'] !== undefined && status === null) {
      return null;
    }
    const live = readBoolean(record['live']);
    if (record['live'] !== undefined && live === null) {
      return null;
    }
    const sort = readString(record['sort']);
    if (
      sort !== null &&
      sort !== 'attention-first' &&
      sort !== 'started-desc' &&
      sort !== 'started-asc'
    ) {
      return null;
    }
    if (record['sort'] !== undefined && sort === null) {
      return null;
    }
    const limit = readNumber(record['limit']);
    if (record['limit'] !== undefined && limit === null) {
      return null;
    }
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      return null;
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

  if (type === 'attention.list') {
    return {
      type
    };
  }

  if (type === 'session.status' || type === 'session.snapshot' || type === 'session.interrupt' || type === 'session.remove') {
    const sessionId = readString(record['sessionId']);
    if (sessionId === null) {
      return null;
    }
    return {
      type,
      sessionId
    };
  }

  if (type === 'session.respond') {
    const sessionId = readString(record['sessionId']);
    const text = readString(record['text']);
    if (sessionId === null || text === null) {
      return null;
    }
    return {
      type,
      sessionId,
      text
    };
  }

  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }

  if (type === 'pty.start') {
    const argsValue = record['args'];
    if (!isStringArray(argsValue)) {
      return null;
    }
    const args = argsValue;
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

    const terminalForegroundHex = record['terminalForegroundHex'];
    if (terminalForegroundHex !== undefined && typeof terminalForegroundHex !== 'string') {
      return null;
    }

    const terminalBackgroundHex = record['terminalBackgroundHex'];
    if (terminalBackgroundHex !== undefined && typeof terminalBackgroundHex !== 'string') {
      return null;
    }
    const tenantId = readString(record['tenantId']);
    if (record['tenantId'] !== undefined && tenantId === null) {
      return null;
    }
    const userId = readString(record['userId']);
    if (record['userId'] !== undefined && userId === null) {
      return null;
    }
    const workspaceId = readString(record['workspaceId']);
    if (record['workspaceId'] !== undefined && workspaceId === null) {
      return null;
    }
    const worktreeId = readString(record['worktreeId']);
    if (record['worktreeId'] !== undefined && worktreeId === null) {
      return null;
    }

    const command: PtyStartCommand = {
      type,
      sessionId,
      args,
      initialCols,
      initialRows
    };
    if (env !== undefined) {
      command.env = env;
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

  if (type === 'pty.attach') {
    const sinceCursor = record['sinceCursor'];
    if (sinceCursor !== undefined && readNumber(sinceCursor) === null) {
      return null;
    }
    const command: PtyAttachCommand = {
      type,
      sessionId
    };
    const parsedSinceCursor = readNumber(sinceCursor);
    if (parsedSinceCursor !== null) {
      command.sinceCursor = parsedSinceCursor;
    }
    return command;
  }

  if (
    type === 'pty.detach' ||
    type === 'pty.subscribe-events' ||
    type === 'pty.unsubscribe-events' ||
    type === 'pty.close'
  ) {
    return {
      type,
      sessionId
    };
  }

  return null;
}

export function parseClientEnvelope(value: unknown): StreamClientEnvelope | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const kind = readString(record['kind']);
  if (kind === null) {
    return null;
  }

  if (kind === 'auth') {
    const token = readString(record['token']);
    if (token === null) {
      return null;
    }
    return {
      kind,
      token
    };
  }

  if (kind === 'command') {
    const commandId = readString(record['commandId']);
    const command = parseStreamCommand(record['command']);
    if (commandId === null || command === null) {
      return null;
    }

    return {
      kind,
      commandId,
      command
    };
  }

  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }

  if (kind === 'pty.input') {
    const dataBase64 = readString(record['dataBase64']);
    if (dataBase64 === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      dataBase64
    };
  }

  if (kind === 'pty.resize') {
    const cols = readNumber(record['cols']);
    const rows = readNumber(record['rows']);
    if (cols === null || rows === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      cols,
      rows
    };
  }

  if (kind === 'pty.signal') {
    const signal = readString(record['signal']);
    if (signal !== 'interrupt' && signal !== 'eof' && signal !== 'terminate') {
      return null;
    }
    return {
      kind,
      sessionId,
      signal
    };
  }

  return null;
}

function parseStreamSessionEvent(value: unknown): StreamSessionEvent | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const type = readString(record['type']);
  if (type === null) {
    return null;
  }

  if (type === 'session-exit') {
    const exitRecord = asRecord(record['exit']);
    if (exitRecord === null) {
      return null;
    }
    const code = exitRecord['code'];
    const signal = exitRecord['signal'];
    const normalizedCode = code === null ? null : readNumber(code);
    const normalizedSignal = signal === null ? null : readSignalName(signal);
    if (normalizedCode === null && code !== null) {
      return null;
    }
    if (normalizedSignal === null && signal !== null) {
      return null;
    }
    return {
      type,
      exit: {
        code: normalizedCode,
        signal: normalizedSignal
      }
    };
  }

  const recordValue = asRecord(record['record']);
  if (recordValue === null) {
    return null;
  }
  const ts = readString(recordValue['ts']);
  const payload = asRecord(recordValue['payload']);
  if (ts === null || payload === null) {
    return null;
  }

  if (type === 'notify' || type === 'turn-completed') {
    return {
      type,
      record: {
        ts,
        payload
      }
    };
  }

  if (type === 'attention-required') {
    const reason = readString(record['reason']);
    if (reason === null) {
      return null;
    }
    return {
      type,
      reason,
      record: {
        ts,
        payload
      }
    };
  }

  return null;
}

function parseStreamObservedEvent(value: unknown): StreamObservedEvent | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const type = readString(record['type']);
  if (type === null) {
    return null;
  }

  if (type === 'directory-upserted') {
    const directory = asRecord(record['directory']);
    if (directory === null) {
      return null;
    }
    return {
      type,
      directory
    };
  }

  if (type === 'conversation-created') {
    const conversation = asRecord(record['conversation']);
    if (conversation === null) {
      return null;
    }
    return {
      type,
      conversation
    };
  }

  if (type === 'conversation-archived') {
    const conversationId = readString(record['conversationId']);
    const ts = readString(record['ts']);
    if (conversationId === null || ts === null) {
      return null;
    }
    return {
      type,
      conversationId,
      ts
    };
  }

  if (type === 'conversation-deleted') {
    const conversationId = readString(record['conversationId']);
    const ts = readString(record['ts']);
    if (conversationId === null || ts === null) {
      return null;
    }
    return {
      type,
      conversationId,
      ts
    };
  }

  if (type === 'session-status') {
    const sessionId = readString(record['sessionId']);
    const status = readString(record['status']);
    const attentionReason = readString(record['attentionReason']);
    const live = readBoolean(record['live']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    if (
      sessionId === null ||
      status === null ||
      live === null ||
      ts === null ||
      (record['attentionReason'] !== null && attentionReason === null) ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null)
    ) {
      return null;
    }
    if (
      status !== 'running' &&
      status !== 'needs-input' &&
      status !== 'completed' &&
      status !== 'exited'
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      status,
      attentionReason: record['attentionReason'] === null ? null : attentionReason,
      live,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId
    };
  }

  if (type === 'session-event') {
    const sessionId = readString(record['sessionId']);
    const event = parseStreamSessionEvent(record['event']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    if (
      sessionId === null ||
      event === null ||
      ts === null ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null)
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      event,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId
    };
  }

  if (type === 'session-output') {
    const sessionId = readString(record['sessionId']);
    const outputCursor = readNumber(record['outputCursor']);
    const chunkBase64 = readString(record['chunkBase64']);
    const ts = readString(record['ts']);
    const directoryId = readString(record['directoryId']);
    const conversationId = readString(record['conversationId']);
    if (
      sessionId === null ||
      outputCursor === null ||
      chunkBase64 === null ||
      ts === null ||
      (record['directoryId'] !== null && directoryId === null) ||
      (record['conversationId'] !== null && conversationId === null)
    ) {
      return null;
    }
    return {
      type,
      sessionId,
      outputCursor,
      chunkBase64,
      ts,
      directoryId: record['directoryId'] === null ? null : directoryId,
      conversationId: record['conversationId'] === null ? null : conversationId
    };
  }

  return null;
}

export function parseServerEnvelope(value: unknown): StreamServerEnvelope | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const kind = readString(record['kind']);
  if (kind === null) {
    return null;
  }

  if (kind === 'auth.ok') {
    return {
      kind
    };
  }

  if (kind === 'auth.error') {
    const error = readString(record['error']);
    if (error === null) {
      return null;
    }
    return {
      kind,
      error
    };
  }

  if (kind === 'command.accepted') {
    const commandId = readString(record['commandId']);
    if (commandId === null) {
      return null;
    }
    return {
      kind,
      commandId
    };
  }

  if (kind === 'command.completed') {
    const commandId = readString(record['commandId']);
    const result = asRecord(record['result']);
    if (commandId === null || result === null) {
      return null;
    }
    return {
      kind,
      commandId,
      result
    };
  }

  if (kind === 'command.failed') {
    const commandId = readString(record['commandId']);
    const error = readString(record['error']);
    if (commandId === null || error === null) {
      return null;
    }
    return {
      kind,
      commandId,
      error
    };
  }

  if (kind === 'stream.event') {
    const subscriptionId = readString(record['subscriptionId']);
    const cursor = readNumber(record['cursor']);
    const event = parseStreamObservedEvent(record['event']);
    if (subscriptionId === null || cursor === null || event === null) {
      return null;
    }
    return {
      kind,
      subscriptionId,
      cursor,
      event
    };
  }

  const sessionId = readString(record['sessionId']);
  if (sessionId === null) {
    return null;
  }

  if (kind === 'pty.output') {
    const cursor = readNumber(record['cursor']);
    const chunkBase64 = readString(record['chunkBase64']);
    if (cursor === null || chunkBase64 === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      cursor,
      chunkBase64
    };
  }

  if (kind === 'pty.exit') {
    const exitRecord = asRecord(record['exit']);
    if (exitRecord === null) {
      return null;
    }
    const code = exitRecord['code'];
    const signal = exitRecord['signal'];
    const normalizedCode = code === null ? null : readNumber(code);
    const normalizedSignal = signal === null ? null : readSignalName(signal);
    if (normalizedCode === null && code !== null) {
      return null;
    }
    if (normalizedSignal === null && signal !== null) {
      return null;
    }
    return {
      kind,
      sessionId,
      exit: {
        code: normalizedCode,
        signal: normalizedSignal
      }
    };
  }

  if (kind === 'pty.event') {
    const event = parseStreamSessionEvent(record['event']);
    if (event === null) {
      return null;
    }
    return {
      kind,
      sessionId,
      event
    };
  }

  return null;
}
