import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  type NotifyPayload,
  type CodexLiveEvent
} from '../codex/live-session.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import type { TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  type StreamObservedEvent,
  type StreamSessionListSort,
  type StreamSessionRuntimeStatus,
  type StreamClientEnvelope,
  type StreamCommand,
  type StreamServerEnvelope,
  type StreamSessionEvent,
  type StreamSignal
} from './stream-protocol.ts';
import {
  SqliteControlPlaneStore,
  type ControlPlaneConversationRecord,
  type ControlPlaneDirectoryRecord
} from '../store/control-plane-store.ts';
import {
  mergeAdapterStateFromSessionEvent,
  normalizeAdapterState
} from '../adapters/agent-session-state.ts';
import { recordPerfEvent, startPerfSpan } from '../perf/perf-core.ts';

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

interface LiveSessionLike {
  attach(handlers: SessionAttachHandlers, sinceCursor?: number): string;
  detach(attachmentId: string): void;
  latestCursorValue(): number;
  processId(): number | null;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  snapshot(): TerminalSnapshotFrame;
  close(): void;
  onEvent(listener: (event: CodexLiveEvent) => void): () => void;
}

export interface StartControlPlaneSessionInput {
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  initialCols: number;
  initialRows: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
}

type StartControlPlaneSession = (input: StartControlPlaneSessionInput) => LiveSessionLike;

interface StartControlPlaneStreamServerOptions {
  host?: string;
  port?: number;
  startSession?: StartControlPlaneSession;
  authToken?: string;
  maxConnectionBufferedBytes?: number;
  sessionExitTombstoneTtlMs?: number;
  maxStreamJournalEntries?: number;
  stateStorePath?: string;
  stateStore?: SqliteControlPlaneStore;
}

interface ConnectionState {
  id: string;
  socket: Socket;
  remainder: string;
  authenticated: boolean;
  attachedSessionIds: Set<string>;
  eventSessionIds: Set<string>;
  streamSubscriptionIds: Set<string>;
  queuedPayloads: string[];
  queuedPayloadBytes: number;
  writeBlocked: boolean;
}

interface SessionState {
  id: string;
  directoryId: string | null;
  agentType: string;
  adapterState: Record<string, unknown>;
  tenantId: string;
  userId: string;
  workspaceId: string;
  worktreeId: string;
  session: LiveSessionLike | null;
  eventSubscriberConnectionIds: Set<string>;
  attachmentByConnectionId: Map<string, string>;
  unsubscribe: (() => void) | null;
  status: StreamSessionRuntimeStatus;
  attentionReason: string | null;
  lastEventAt: string | null;
  lastExit: PtyExit | null;
  lastSnapshot: Record<string, unknown> | null;
  startedAt: string;
  exitedAt: string | null;
  tombstoneTimer: NodeJS.Timeout | null;
  lastObservedOutputCursor: number;
}

interface StreamSubscriptionFilter {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  directoryId?: string;
  conversationId?: string;
  includeOutput: boolean;
}

interface StreamSubscriptionState {
  id: string;
  connectionId: string;
  filter: StreamSubscriptionFilter;
}

interface StreamObservedScope {
  tenantId: string;
  userId: string;
  workspaceId: string;
  directoryId: string | null;
  conversationId: string | null;
}

interface StreamJournalEntry {
  cursor: number;
  scope: StreamObservedScope;
  event: StreamObservedEvent;
}

const DEFAULT_MAX_CONNECTION_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_SESSION_EXIT_TOMBSTONE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_STREAM_JOURNAL_ENTRIES = 10000;
const DEFAULT_TENANT_ID = 'tenant-local';
const DEFAULT_USER_ID = 'user-local';
const DEFAULT_WORKSPACE_ID = 'workspace-local';
const DEFAULT_WORKTREE_ID = 'worktree-local';

function compareIsoDesc(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right.localeCompare(left);
}

function inputContainsTurnSubmission(data: Uint8Array): boolean {
  for (const byte of data) {
    if (byte === 0x0a || byte === 0x0d) {
      return true;
    }
  }
  return false;
}

function sessionPriority(status: StreamSessionRuntimeStatus): number {
  if (status === 'needs-input') {
    return 0;
  }
  if (status === 'running') {
    return 1;
  }
  if (status === 'completed') {
    return 2;
  }
  return 3;
}

function mapNotifyRecord(record: { ts: string; payload: NotifyPayload }): {
  ts: string;
  payload: Record<string, unknown>;
} {
  return {
    ts: record.ts,
    payload: record.payload
  };
}

function mapSessionEvent(event: CodexLiveEvent): StreamSessionEvent | null {
  if (event.type === 'notify') {
    return {
      type: 'notify',
      record: mapNotifyRecord(event.record)
    };
  }

  if (event.type === 'turn-completed') {
    return {
      type: 'turn-completed',
      record: mapNotifyRecord(event.record)
    };
  }

  if (event.type === 'attention-required') {
    return {
      type: 'attention-required',
      reason: event.reason,
      record: mapNotifyRecord(event.record)
    };
  }

  if (event.type === 'session-exit') {
    return {
      type: 'session-exit',
      exit: event.exit
    };
  }

  return null;
}

export class ControlPlaneStreamServer {
  private readonly host: string;
  private readonly port: number;
  private readonly authToken: string | null;
  private readonly maxConnectionBufferedBytes: number;
  private readonly sessionExitTombstoneTtlMs: number;
  private readonly maxStreamJournalEntries: number;
  private readonly startSession: StartControlPlaneSession;
  private readonly stateStore: SqliteControlPlaneStore;
  private readonly ownsStateStore: boolean;
  private readonly server: Server;
  private readonly connections = new Map<string, ConnectionState>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly streamSubscriptions = new Map<string, StreamSubscriptionState>();
  private readonly streamJournal: StreamJournalEntry[] = [];
  private streamCursor = 0;
  private listening = false;
  private stateStoreClosed = false;

  constructor(options: StartControlPlaneStreamServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.authToken = options.authToken ?? null;
    this.maxConnectionBufferedBytes =
      options.maxConnectionBufferedBytes ?? DEFAULT_MAX_CONNECTION_BUFFERED_BYTES;
    this.sessionExitTombstoneTtlMs =
      options.sessionExitTombstoneTtlMs ?? DEFAULT_SESSION_EXIT_TOMBSTONE_TTL_MS;
    this.maxStreamJournalEntries =
      options.maxStreamJournalEntries ?? DEFAULT_MAX_STREAM_JOURNAL_ENTRIES;
    if (options.startSession === undefined) {
      throw new Error('startSession is required');
    }
    this.startSession = options.startSession;
    if (options.stateStore !== undefined) {
      this.stateStore = options.stateStore;
      this.ownsStateStore = false;
    } else {
      this.stateStore = new SqliteControlPlaneStore(options.stateStorePath ?? ':memory:');
      this.ownsStateStore = true;
    }
    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });
  }

  async start(): Promise<void> {
    if (this.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off('error', onError);
        this.listening = true;
        resolve();
      };

      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.port, this.host);
    });
  }

  address(): AddressInfo {
    const value = this.server.address();
    if (value === null || typeof value === 'string') {
      throw new Error('control-plane server is not listening on tcp');
    }
    return value;
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      this.destroySession(sessionId, true);
    }

    for (const connection of this.connections.values()) {
      connection.socket.destroy();
    }
    this.connections.clear();
    this.streamSubscriptions.clear();
    this.streamJournal.length = 0;

    if (!this.listening) {
      this.closeOwnedStateStore();
      return;
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => {
        this.listening = false;
        this.closeOwnedStateStore();
        resolve();
      });
    });
  }

  private closeOwnedStateStore(): void {
    if (!this.ownsStateStore || this.stateStoreClosed) {
      return;
    }
    this.stateStore.close();
    this.stateStoreClosed = true;
  }

  private handleConnection(socket: Socket): void {
    const connectionId = `connection-${randomUUID()}`;
    const state: ConnectionState = {
      id: connectionId,
      socket,
      remainder: '',
      authenticated: this.authToken === null,
      attachedSessionIds: new Set<string>(),
      eventSessionIds: new Set<string>(),
      streamSubscriptionIds: new Set<string>(),
      queuedPayloads: [],
      queuedPayloadBytes: 0,
      writeBlocked: false
    };

    this.connections.set(connectionId, state);
    recordPerfEvent('control-plane.server.connection.open', {
      role: 'server',
      connectionId,
      authRequired: this.authToken !== null
    });

    socket.on('data', (chunk: Buffer) => {
      this.handleSocketData(state, chunk);
    });

    socket.on('drain', () => {
      state.writeBlocked = false;
      this.flushConnectionWrites(connectionId);
    });

    socket.on('error', () => {
      this.cleanupConnection(connectionId);
    });

    socket.on('close', () => {
      this.cleanupConnection(connectionId);
    });
  }

  private handleSocketData(connection: ConnectionState, chunk: Buffer): void {
    const combined = `${connection.remainder}${chunk.toString('utf8')}`;
    const consumed = consumeJsonLines(combined);
    connection.remainder = consumed.remainder;

    for (const message of consumed.messages) {
      const parsed = parseClientEnvelope(message);
      if (parsed === null) {
        continue;
      }
      this.handleClientEnvelope(connection, parsed);
    }
  }

  private handleClientEnvelope(connection: ConnectionState, envelope: StreamClientEnvelope): void {
    if (envelope.kind === 'auth') {
      this.handleAuth(connection, envelope.token);
      return;
    }

    if (!connection.authenticated) {
      this.sendToConnection(connection.id, {
        kind: 'auth.error',
        error: 'authentication required'
      });
      recordPerfEvent('control-plane.server.auth.required', {
        role: 'server',
        connectionId: connection.id
      });
      connection.socket.destroy();
      return;
    }

    if (envelope.kind === 'command') {
      this.handleCommand(connection, envelope.commandId, envelope.command);
      return;
    }

    if (envelope.kind === 'pty.input') {
      this.handleInput(envelope.sessionId, envelope.dataBase64);
      return;
    }

    if (envelope.kind === 'pty.resize') {
      this.handleResize(envelope.sessionId, envelope.cols, envelope.rows);
      return;
    }

    this.handleSignal(envelope.sessionId, envelope.signal);
  }

  private handleAuth(connection: ConnectionState, token: string): void {
    if (this.authToken === null) {
      connection.authenticated = true;
      this.sendToConnection(connection.id, {
        kind: 'auth.ok'
      });
      recordPerfEvent('control-plane.server.auth.ok', {
        role: 'server',
        connectionId: connection.id,
        authRequired: false
      });
      return;
    }

    if (token !== this.authToken) {
      this.sendToConnection(connection.id, {
        kind: 'auth.error',
        error: 'invalid auth token'
      });
      recordPerfEvent('control-plane.server.auth.failed', {
        role: 'server',
        connectionId: connection.id
      });
      connection.socket.destroy();
      return;
    }

    connection.authenticated = true;
    this.sendToConnection(connection.id, {
      kind: 'auth.ok'
    });
    recordPerfEvent('control-plane.server.auth.ok', {
      role: 'server',
      connectionId: connection.id,
      authRequired: true
    });
  }

  private handleCommand(connection: ConnectionState, commandId: string, command: StreamCommand): void {
    this.sendToConnection(connection.id, {
      kind: 'command.accepted',
      commandId
    });

    const commandSpan = startPerfSpan('control-plane.server.command', {
      role: 'server',
      type: command.type
    });
    try {
      const result = this.executeCommand(connection, command);
      commandSpan.end({
        type: command.type,
        status: 'completed'
      });
      this.sendToConnection(connection.id, {
        kind: 'command.completed',
        commandId,
        result
      });
    } catch (error) {
      commandSpan.end({
        type: command.type,
        status: 'failed',
        message: String(error)
      });
      this.sendToConnection(connection.id, {
        kind: 'command.failed',
        commandId,
        error: String(error)
      });
    }
  }

  private executeCommand(connection: ConnectionState, command: StreamCommand): Record<string, unknown> {
    if (command.type === 'directory.upsert') {
      const directory = this.stateStore.upsertDirectory({
        directoryId: command.directoryId ?? `directory-${randomUUID()}`,
        tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
        userId: command.userId ?? DEFAULT_USER_ID,
        workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
        path: command.path
      });
      const record = this.directoryRecord(directory);
      this.publishObservedEvent(
        {
          tenantId: directory.tenantId,
          userId: directory.userId,
          workspaceId: directory.workspaceId,
          directoryId: directory.directoryId,
          conversationId: null
        },
        {
          type: 'directory-upserted',
          directory: record
        }
      );
      return {
        directory: record
      };
    }

    if (command.type === 'directory.list') {
      const query: {
        tenantId?: string;
        userId?: string;
        workspaceId?: string;
        includeArchived?: boolean;
        limit?: number;
      } = {};
      if (command.tenantId !== undefined) {
        query.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        query.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        query.workspaceId = command.workspaceId;
      }
      if (command.includeArchived !== undefined) {
        query.includeArchived = command.includeArchived;
      }
      if (command.limit !== undefined) {
        query.limit = command.limit;
      }
      const directories = this.stateStore
        .listDirectories(query)
        .map((directory) => this.directoryRecord(directory));
      return {
        directories
      };
    }

    if (command.type === 'directory.archive') {
      const archived = this.stateStore.archiveDirectory(command.directoryId);
      const record = this.directoryRecord(archived);
      this.publishObservedEvent(
        {
          tenantId: archived.tenantId,
          userId: archived.userId,
          workspaceId: archived.workspaceId,
          directoryId: archived.directoryId,
          conversationId: null
        },
        {
          type: 'directory-archived',
          directoryId: archived.directoryId,
          ts: archived.archivedAt ?? new Date().toISOString()
        }
      );
      return {
        directory: record
      };
    }

    if (command.type === 'conversation.create') {
      const conversation = this.stateStore.createConversation({
        conversationId: command.conversationId ?? `conversation-${randomUUID()}`,
        directoryId: command.directoryId,
        title: command.title,
        agentType: command.agentType,
        adapterState: normalizeAdapterState(command.adapterState)
      });
      const record = this.conversationRecord(conversation);
      this.publishObservedEvent(
        {
          tenantId: conversation.tenantId,
          userId: conversation.userId,
          workspaceId: conversation.workspaceId,
          directoryId: conversation.directoryId,
          conversationId: conversation.conversationId
        },
        {
          type: 'conversation-created',
          conversation: record
        }
      );
      return {
        conversation: record
      };
    }

    if (command.type === 'conversation.list') {
      const query: {
        directoryId?: string;
        tenantId?: string;
        userId?: string;
        workspaceId?: string;
        includeArchived?: boolean;
        limit?: number;
      } = {};
      if (command.directoryId !== undefined) {
        query.directoryId = command.directoryId;
      }
      if (command.tenantId !== undefined) {
        query.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        query.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        query.workspaceId = command.workspaceId;
      }
      if (command.includeArchived !== undefined) {
        query.includeArchived = command.includeArchived;
      }
      if (command.limit !== undefined) {
        query.limit = command.limit;
      }
      const conversations = this.stateStore
        .listConversations(query)
        .map((conversation) => this.conversationRecord(conversation));
      return {
        conversations
      };
    }

    if (command.type === 'conversation.archive') {
      const archived = this.stateStore.archiveConversation(command.conversationId);
      this.publishObservedEvent(
        {
          tenantId: archived.tenantId,
          userId: archived.userId,
          workspaceId: archived.workspaceId,
          directoryId: archived.directoryId,
          conversationId: archived.conversationId
        },
        {
          type: 'conversation-archived',
          conversationId: archived.conversationId,
          ts: archived.archivedAt ?? new Date().toISOString()
        }
      );
      return {
        conversation: this.conversationRecord(archived)
      };
    }

    if (command.type === 'conversation.update') {
      const updated = this.stateStore.updateConversationTitle(command.conversationId, command.title);
      if (updated === null) {
        throw new Error(`conversation not found: ${command.conversationId}`);
      }
      const record = this.conversationRecord(updated);
      this.publishObservedEvent(
        {
          tenantId: updated.tenantId,
          userId: updated.userId,
          workspaceId: updated.workspaceId,
          directoryId: updated.directoryId,
          conversationId: updated.conversationId
        },
        {
          type: 'conversation-updated',
          conversation: record
        }
      );
      return {
        conversation: record
      };
    }

    if (command.type === 'conversation.delete') {
      const existing = this.stateStore.getConversation(command.conversationId);
      if (existing === null) {
        throw new Error(`conversation not found: ${command.conversationId}`);
      }
      this.destroySession(command.conversationId, true);
      this.stateStore.deleteConversation(command.conversationId);
      this.publishObservedEvent(
        {
          tenantId: existing.tenantId,
          userId: existing.userId,
          workspaceId: existing.workspaceId,
          directoryId: existing.directoryId,
          conversationId: existing.conversationId
        },
        {
          type: 'conversation-deleted',
          conversationId: existing.conversationId,
          ts: new Date().toISOString()
        }
      );
      return {
        deleted: true
      };
    }

    if (command.type === 'stream.subscribe') {
      const subscriptionId = `subscription-${randomUUID()}`;
      const filter: StreamSubscriptionFilter = {
        includeOutput: command.includeOutput ?? false
      };
      if (command.tenantId !== undefined) {
        filter.tenantId = command.tenantId;
      }
      if (command.userId !== undefined) {
        filter.userId = command.userId;
      }
      if (command.workspaceId !== undefined) {
        filter.workspaceId = command.workspaceId;
      }
      if (command.directoryId !== undefined) {
        filter.directoryId = command.directoryId;
      }
      if (command.conversationId !== undefined) {
        filter.conversationId = command.conversationId;
      }

      this.streamSubscriptions.set(subscriptionId, {
        id: subscriptionId,
        connectionId: connection.id,
        filter
      });
      connection.streamSubscriptionIds.add(subscriptionId);

      const afterCursor = command.afterCursor ?? 0;
      for (const entry of this.streamJournal) {
        if (entry.cursor <= afterCursor) {
          continue;
        }
        if (!this.matchesObservedFilter(entry.scope, entry.event, filter)) {
          continue;
        }
        this.sendToConnection(connection.id, {
          kind: 'stream.event',
          subscriptionId,
          cursor: entry.cursor,
          event: entry.event
        });
      }

      return {
        subscriptionId,
        cursor: this.streamCursor
      };
    }

    if (command.type === 'stream.unsubscribe') {
      const subscription = this.streamSubscriptions.get(command.subscriptionId);
      if (subscription !== undefined) {
        const subscriptionConnection = this.connections.get(subscription.connectionId);
        subscriptionConnection?.streamSubscriptionIds.delete(command.subscriptionId);
        this.streamSubscriptions.delete(command.subscriptionId);
      }
      return {
        unsubscribed: true
      };
    }

    if (command.type === 'session.list') {
      const sort = command.sort ?? 'attention-first';
      const filtered = [...this.sessions.values()].filter((state) => {
        if (command.tenantId !== undefined && state.tenantId !== command.tenantId) {
          return false;
        }
        if (command.userId !== undefined && state.userId !== command.userId) {
          return false;
        }
        if (command.workspaceId !== undefined && state.workspaceId !== command.workspaceId) {
          return false;
        }
        if (command.worktreeId !== undefined && state.worktreeId !== command.worktreeId) {
          return false;
        }
        if (command.status !== undefined && state.status !== command.status) {
          return false;
        }
        if (command.live !== undefined && (state.session !== null) !== command.live) {
          return false;
        }
        return true;
      });
      const sessions = this.sortSessionSummaries(filtered, sort);
      const limited = command.limit === undefined ? sessions : sessions.slice(0, command.limit);
      return {
        sessions: limited
      };
    }

    if (command.type === 'attention.list') {
      return {
        sessions: this.sortSessionSummaries(
          [...this.sessions.values()].filter((state) => state.status === 'needs-input'),
          'attention-first'
        )
      };
    }

    if (command.type === 'session.status') {
      const state = this.requireSession(command.sessionId);
      return this.sessionSummaryRecord(state);
    }

    if (command.type === 'session.snapshot') {
      const state = this.requireSession(command.sessionId);
      if (state.session === null) {
        if (state.lastSnapshot === null) {
          throw new Error(`session snapshot unavailable: ${command.sessionId}`);
        }
        return {
          sessionId: command.sessionId,
          snapshot: state.lastSnapshot,
          stale: true
        };
      }
      const snapshot = this.snapshotRecordFromFrame(state.session.snapshot());
      state.lastSnapshot = snapshot;
      return {
        sessionId: command.sessionId,
        snapshot,
        stale: false
      };
    }

    if (command.type === 'session.respond') {
      const state = this.requireLiveSession(command.sessionId);
      state.session.write(command.text);
      this.setSessionStatus(state, 'running', null, new Date().toISOString());
      return {
        responded: true,
        sentBytes: Buffer.byteLength(command.text)
      };
    }

    if (command.type === 'session.interrupt') {
      const state = this.requireLiveSession(command.sessionId);
      state.session.write('\u0003');
      this.setSessionStatus(state, 'running', null, new Date().toISOString());
      return {
        interrupted: true
      };
    }

    if (command.type === 'session.remove') {
      this.destroySession(command.sessionId, true);
      return {
        removed: true
      };
    }

    if (command.type === 'pty.start') {
      const existing = this.sessions.get(command.sessionId);
      if (existing !== undefined) {
        if (existing.status === 'exited' && existing.session === null) {
          this.destroySession(command.sessionId, false);
        } else {
        throw new Error(`session already exists: ${command.sessionId}`);
        }
      }

      const startInput: StartControlPlaneSessionInput = {
        args: command.args,
        initialCols: command.initialCols,
        initialRows: command.initialRows
      };
      if (command.env !== undefined) {
        startInput.env = command.env;
      }
      if (command.cwd !== undefined) {
        startInput.cwd = command.cwd;
      }
      if (command.terminalForegroundHex !== undefined) {
        startInput.terminalForegroundHex = command.terminalForegroundHex;
      }
      if (command.terminalBackgroundHex !== undefined) {
        startInput.terminalBackgroundHex = command.terminalBackgroundHex;
      }

      const session = this.startSession(startInput);

      const unsubscribe = session.onEvent((event) => {
        this.handleSessionEvent(command.sessionId, event);
      });

      const persistedConversation = this.stateStore.getConversation(command.sessionId);
      const persistedRuntimeStatus = persistedConversation?.runtimeStatus;
      const initialStatus: StreamSessionRuntimeStatus =
        persistedRuntimeStatus === undefined ||
        persistedRuntimeStatus === 'running' ||
        persistedRuntimeStatus === 'exited'
          ? 'completed'
          : persistedRuntimeStatus;
      const initialAttentionReason =
        initialStatus === 'needs-input' ? persistedConversation?.runtimeAttentionReason ?? null : null;
      this.sessions.set(command.sessionId, {
        id: command.sessionId,
        directoryId: persistedConversation?.directoryId ?? null,
        agentType: persistedConversation?.agentType ?? 'codex',
        adapterState: normalizeAdapterState(persistedConversation?.adapterState ?? {}),
        tenantId: persistedConversation?.tenantId ?? command.tenantId ?? DEFAULT_TENANT_ID,
        userId: persistedConversation?.userId ?? command.userId ?? DEFAULT_USER_ID,
        workspaceId: persistedConversation?.workspaceId ?? command.workspaceId ?? DEFAULT_WORKSPACE_ID,
        worktreeId: command.worktreeId ?? DEFAULT_WORKTREE_ID,
        session,
        eventSubscriberConnectionIds: new Set<string>(),
        attachmentByConnectionId: new Map<string, string>(),
        unsubscribe,
        status: initialStatus,
        attentionReason: initialAttentionReason,
        lastEventAt: persistedConversation?.runtimeLastEventAt ?? null,
        lastExit: persistedConversation?.runtimeLastExit ?? null,
        lastSnapshot: null,
        startedAt: new Date().toISOString(),
        exitedAt: null,
        tombstoneTimer: null,
        lastObservedOutputCursor: session.latestCursorValue()
      });

      const state = this.sessions.get(command.sessionId);
      if (state !== undefined) {
        this.persistConversationRuntime(state);
        this.publishStatusObservedEvent(state);
      }

      return {
        sessionId: command.sessionId
      };
    }

    if (command.type === 'pty.attach') {
      const state = this.requireLiveSession(command.sessionId);
      const previous = state.attachmentByConnectionId.get(connection.id);
      if (previous !== undefined) {
        state.session.detach(previous);
      }

      const attachmentId = state.session.attach(
        {
          onData: (event) => {
            this.sendToConnection(connection.id, {
              kind: 'pty.output',
              sessionId: command.sessionId,
              cursor: event.cursor,
              chunkBase64: Buffer.from(event.chunk).toString('base64')
            });
            const sessionState = this.sessions.get(command.sessionId);
            if (sessionState !== undefined) {
              if (event.cursor <= sessionState.lastObservedOutputCursor) {
                return;
              }
              sessionState.lastObservedOutputCursor = event.cursor;
              this.publishObservedEvent(
                this.sessionScope(sessionState),
                {
                  type: 'session-output',
                  sessionId: command.sessionId,
                  outputCursor: event.cursor,
                  chunkBase64: Buffer.from(event.chunk).toString('base64'),
                  ts: new Date().toISOString(),
                  directoryId: sessionState.directoryId,
                  conversationId: sessionState.id
                }
              );
            }
          },
          onExit: (exit) => {
            this.sendToConnection(connection.id, {
              kind: 'pty.exit',
              sessionId: command.sessionId,
              exit
            });
          }
        },
        command.sinceCursor ?? 0
      );

      state.attachmentByConnectionId.set(connection.id, attachmentId);
      connection.attachedSessionIds.add(command.sessionId);

      return {
        latestCursor: state.session.latestCursorValue()
      };
    }

    if (command.type === 'pty.detach') {
      this.detachConnectionFromSession(connection.id, command.sessionId);
      connection.attachedSessionIds.delete(command.sessionId);
      return {
        detached: true
      };
    }

    if (command.type === 'pty.subscribe-events') {
      const state = this.requireSession(command.sessionId);
      state.eventSubscriberConnectionIds.add(connection.id);
      connection.eventSessionIds.add(command.sessionId);
      return {
        subscribed: true
      };
    }

    if (command.type === 'pty.unsubscribe-events') {
      const state = this.requireSession(command.sessionId);
      state.eventSubscriberConnectionIds.delete(connection.id);
      connection.eventSessionIds.delete(command.sessionId);
      return {
        subscribed: false
      };
    }

    this.requireLiveSession(command.sessionId);
    this.destroySession(command.sessionId, true);
    return {
      closed: true
    };
  }

  private handleInput(sessionId: string, dataBase64: string): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
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
    if (inputContainsTurnSubmission(data)) {
      this.setSessionStatus(state, 'running', null, new Date().toISOString());
    }
  }

  private handleResize(sessionId: string, cols: number, rows: number): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    if (state.status === 'exited' || state.session === null) {
      return;
    }
    state.session.resize(cols, rows);
  }

  private handleSignal(sessionId: string, signal: StreamSignal): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    if (state.status === 'exited' || state.session === null) {
      return;
    }

    if (signal === 'interrupt') {
      state.session.write('\u0003');
      this.setSessionStatus(state, 'running', null, new Date().toISOString());
      return;
    }

    if (signal === 'eof') {
      state.session.write('\u0004');
      this.setSessionStatus(state, 'running', null, new Date().toISOString());
      return;
    }

    this.destroySession(sessionId, true);
  }

  private handleSessionEvent(sessionId: string, event: CodexLiveEvent): void {
    const sessionState = this.sessions.get(sessionId);
    if (sessionState === undefined) {
      return;
    }

    const mapped = mapSessionEvent(event);
    if (mapped !== null && event.type !== 'terminal-output') {
      const observedAt =
        mapped.type === 'session-exit' ? new Date().toISOString() : mapped.record.ts;
      const updatedAdapterState = mergeAdapterStateFromSessionEvent(
        sessionState.agentType,
        sessionState.adapterState,
        mapped,
        observedAt
      );
      if (updatedAdapterState !== null) {
        sessionState.adapterState = updatedAdapterState;
        this.stateStore.updateConversationAdapterState(sessionState.id, updatedAdapterState);
      }
      for (const connectionId of sessionState.eventSubscriberConnectionIds) {
        this.sendToConnection(connectionId, {
          kind: 'pty.event',
          sessionId,
          event: mapped
        });
      }
      this.publishObservedEvent(
        this.sessionScope(sessionState),
        {
          type: 'session-event',
          sessionId,
          event: mapped,
          ts: new Date().toISOString(),
          directoryId: sessionState.directoryId,
          conversationId: sessionState.id
        }
      );
    }

    if (event.type === 'attention-required') {
      this.setSessionStatus(sessionState, 'needs-input', event.reason, event.record.ts);
      return;
    }

    if (event.type === 'turn-completed') {
      this.setSessionStatus(sessionState, 'completed', null, event.record.ts);
      return;
    }

    if (event.type === 'notify') {
      this.setSessionStatus(sessionState, sessionState.status, sessionState.attentionReason, event.record.ts);
      return;
    }

    if (event.type === 'session-exit') {
      sessionState.lastExit = event.exit;
      const exitedAt = new Date().toISOString();
      sessionState.exitedAt = exitedAt;
      this.setSessionStatus(sessionState, 'exited', null, exitedAt);
      this.deactivateSession(sessionState.id, true);
    }
  }

  private setSessionStatus(
    state: SessionState,
    status: StreamSessionRuntimeStatus,
    attentionReason: string | null,
    lastEventAt: string | null
  ): void {
    state.status = status;
    state.attentionReason = attentionReason;
    if (lastEventAt !== null) {
      state.lastEventAt = lastEventAt;
    }
    this.persistConversationRuntime(state);
    this.publishStatusObservedEvent(state);
  }

  private persistConversationRuntime(state: SessionState): void {
    this.stateStore.updateConversationRuntime(state.id, {
      status: state.status,
      live: state.session !== null,
      attentionReason: state.attentionReason,
      processId: state.session?.processId() ?? null,
      lastEventAt: state.lastEventAt,
      lastExit: state.lastExit
    });
  }

  private publishStatusObservedEvent(state: SessionState): void {
    this.publishObservedEvent(
      this.sessionScope(state),
      {
        type: 'session-status',
        sessionId: state.id,
        status: state.status,
        attentionReason: state.attentionReason,
        live: state.session !== null,
        ts: new Date().toISOString(),
        directoryId: state.directoryId,
        conversationId: state.id
      }
    );
  }

  private sessionScope(state: SessionState): StreamObservedScope {
    return {
      tenantId: state.tenantId,
      userId: state.userId,
      workspaceId: state.workspaceId,
      directoryId: state.directoryId,
      conversationId: state.id
    };
  }

  private matchesObservedFilter(
    scope: StreamObservedScope,
    event: StreamObservedEvent,
    filter: StreamSubscriptionFilter
  ): boolean {
    if (!filter.includeOutput && event.type === 'session-output') {
      return false;
    }
    if (filter.tenantId !== undefined && scope.tenantId !== filter.tenantId) {
      return false;
    }
    if (filter.userId !== undefined && scope.userId !== filter.userId) {
      return false;
    }
    if (filter.workspaceId !== undefined && scope.workspaceId !== filter.workspaceId) {
      return false;
    }
    if (filter.directoryId !== undefined && scope.directoryId !== filter.directoryId) {
      return false;
    }
    if (filter.conversationId !== undefined && scope.conversationId !== filter.conversationId) {
      return false;
    }
    return true;
  }

  private publishObservedEvent(scope: StreamObservedScope, event: StreamObservedEvent): void {
    this.streamCursor += 1;
    const entry: StreamJournalEntry = {
      cursor: this.streamCursor,
      scope,
      event
    };
    this.streamJournal.push(entry);
    if (this.streamJournal.length > this.maxStreamJournalEntries) {
      this.streamJournal.shift();
    }

    for (const subscription of this.streamSubscriptions.values()) {
      if (!this.matchesObservedFilter(scope, event, subscription.filter)) {
        continue;
      }
      this.sendToConnection(subscription.connectionId, {
        kind: 'stream.event',
        subscriptionId: subscription.id,
        cursor: entry.cursor,
        event: entry.event
      });
    }
  }

  private directoryRecord(directory: ControlPlaneDirectoryRecord): Record<string, unknown> {
    return {
      directoryId: directory.directoryId,
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      path: directory.path,
      createdAt: directory.createdAt,
      archivedAt: directory.archivedAt
    };
  }

  private conversationRecord(conversation: ControlPlaneConversationRecord): Record<string, unknown> {
    return {
      conversationId: conversation.conversationId,
      directoryId: conversation.directoryId,
      tenantId: conversation.tenantId,
      userId: conversation.userId,
      workspaceId: conversation.workspaceId,
      title: conversation.title,
      agentType: conversation.agentType,
      createdAt: conversation.createdAt,
      archivedAt: conversation.archivedAt,
      runtimeStatus: conversation.runtimeStatus,
      runtimeLive: conversation.runtimeLive,
      runtimeAttentionReason: conversation.runtimeAttentionReason,
      runtimeProcessId: conversation.runtimeProcessId,
      runtimeLastEventAt: conversation.runtimeLastEventAt,
      runtimeLastExit: conversation.runtimeLastExit,
      adapterState: conversation.adapterState
    };
  }

  private requireSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return state;
  }

  private requireLiveSession(sessionId: string): SessionState & { session: LiveSessionLike } {
    const state = this.requireSession(sessionId);
    if (state.session === null) {
      throw new Error(`session is not live: ${sessionId}`);
    }
    return state as SessionState & { session: LiveSessionLike };
  }

  private detachConnectionFromSession(connectionId: string, sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }

    const attachmentId = state.attachmentByConnectionId.get(connectionId);
    if (attachmentId === undefined) {
      return;
    }
    if (state.session === null) {
      state.attachmentByConnectionId.delete(connectionId);
      return;
    }

    state.session.detach(attachmentId);
    state.attachmentByConnectionId.delete(connectionId);
  }

  private cleanupConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) {
      return;
    }

    for (const sessionId of connection.attachedSessionIds) {
      this.detachConnectionFromSession(connectionId, sessionId);
    }

    for (const sessionId of connection.eventSessionIds) {
      const state = this.sessions.get(sessionId);
      state?.eventSubscriberConnectionIds.delete(connectionId);
    }

    for (const subscriptionId of connection.streamSubscriptionIds) {
      this.streamSubscriptions.delete(subscriptionId);
    }

    this.connections.delete(connectionId);
    recordPerfEvent('control-plane.server.connection.closed', {
      role: 'server',
      connectionId
    });
  }

  private deactivateSession(sessionId: string, closeSession: boolean): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined || state.session === null) {
      return;
    }

    const liveSession = state.session;
    state.session = null;

    if (state.unsubscribe !== null) {
      state.unsubscribe();
      state.unsubscribe = null;
    }

    state.lastSnapshot = this.snapshotRecordFromFrame(liveSession.snapshot());

    if (closeSession) {
      liveSession.close();
    }

    for (const [connectionId, attachmentId] of state.attachmentByConnectionId.entries()) {
      liveSession.detach(attachmentId);
      const connection = this.connections.get(connectionId);
      if (connection !== undefined) {
        connection.attachedSessionIds.delete(sessionId);
      }
    }
    state.attachmentByConnectionId.clear();

    for (const connectionId of state.eventSubscriberConnectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection !== undefined) {
        connection.eventSessionIds.delete(sessionId);
      }
    }
    state.eventSubscriberConnectionIds.clear();

    this.persistConversationRuntime(state);
    this.publishStatusObservedEvent(state);

    if (state.status === 'exited') {
      this.scheduleTombstoneRemoval(state.id);
    }
  }

  private scheduleTombstoneRemoval(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined || state.status !== 'exited') {
      return;
    }

    if (state.tombstoneTimer !== null) {
      clearTimeout(state.tombstoneTimer);
      state.tombstoneTimer = null;
    }

    if (this.sessionExitTombstoneTtlMs <= 0) {
      this.destroySession(sessionId, false);
      return;
    }

    state.tombstoneTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (current === undefined || current.status !== 'exited') {
        return;
      }
      this.destroySession(sessionId, false);
    }, this.sessionExitTombstoneTtlMs);
    state.tombstoneTimer.unref();
  }

  private destroySession(sessionId: string, closeSession: boolean): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }

    if (state.tombstoneTimer !== null) {
      clearTimeout(state.tombstoneTimer);
      state.tombstoneTimer = null;
    }

    if (state.session !== null) {
      this.deactivateSession(sessionId, closeSession);
    }

    this.sessions.delete(sessionId);
  }

  private sortSessionSummaries(
    sessions: readonly SessionState[],
    sort: StreamSessionListSort
  ): readonly Record<string, unknown>[] {
    const sorted = [...sessions];
    sorted.sort((left, right) => {
      if (sort === 'started-asc') {
        const byStartedAsc = left.startedAt.localeCompare(right.startedAt);
        if (byStartedAsc !== 0) {
          return byStartedAsc;
        }
        return left.id.localeCompare(right.id);
      }

      if (sort === 'started-desc') {
        const byStartedDesc = right.startedAt.localeCompare(left.startedAt);
        if (byStartedDesc !== 0) {
          return byStartedDesc;
        }
        return left.id.localeCompare(right.id);
      }

      const byPriority = sessionPriority(left.status) - sessionPriority(right.status);
      if (byPriority !== 0) {
        return byPriority;
      }
      const byLastEvent = compareIsoDesc(left.lastEventAt, right.lastEventAt);
      if (byLastEvent !== 0) {
        return byLastEvent;
      }
      const byStartedDesc = right.startedAt.localeCompare(left.startedAt);
      if (byStartedDesc !== 0) {
        return byStartedDesc;
      }
      return left.id.localeCompare(right.id);
    });

    return sorted.map((state) => this.sessionSummaryRecord(state));
  }

  private sessionSummaryRecord(state: SessionState): Record<string, unknown> {
    return {
      sessionId: state.id,
      directoryId: state.directoryId,
      tenantId: state.tenantId,
      userId: state.userId,
      workspaceId: state.workspaceId,
      worktreeId: state.worktreeId,
      status: state.status,
      attentionReason: state.attentionReason,
      latestCursor: state.session?.latestCursorValue() ?? null,
      processId: state.session?.processId() ?? null,
      attachedClients: state.attachmentByConnectionId.size,
      eventSubscribers: state.eventSubscriberConnectionIds.size,
      startedAt: state.startedAt,
      lastEventAt: state.lastEventAt,
      lastExit: state.lastExit,
      exitedAt: state.exitedAt,
      live: state.session !== null
    };
  }

  private snapshotRecordFromFrame(frame: TerminalSnapshotFrame): Record<string, unknown> {
    return {
      rows: frame.rows,
      cols: frame.cols,
      activeScreen: frame.activeScreen,
      modes: frame.modes,
      cursor: frame.cursor,
      viewport: frame.viewport,
      lines: frame.lines,
      frameHash: frame.frameHash
    };
  }

  private sendToConnection(connectionId: string, envelope: StreamServerEnvelope): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) {
      return;
    }

    const payload = encodeStreamEnvelope(envelope);
    connection.queuedPayloads.push(payload);
    connection.queuedPayloadBytes += Buffer.byteLength(payload);

    if (this.connectionBufferedBytes(connection) > this.maxConnectionBufferedBytes) {
      connection.socket.destroy(new Error('connection output buffer exceeded configured maximum'));
      return;
    }

    this.flushConnectionWrites(connectionId);
  }

  private flushConnectionWrites(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection === undefined || connection.writeBlocked) {
      return;
    }

    while (connection.queuedPayloads.length > 0) {
      const payload = connection.queuedPayloads.shift()!;
      connection.queuedPayloadBytes -= Buffer.byteLength(payload);
      const writeResult = connection.socket.write(payload);
      if (!writeResult) {
        connection.writeBlocked = true;
        break;
      }
    }

    if (this.connectionBufferedBytes(connection) > this.maxConnectionBufferedBytes) {
      connection.socket.destroy(new Error('connection output buffer exceeded configured maximum'));
    }
  }

  private connectionBufferedBytes(connection: ConnectionState): number {
    return connection.queuedPayloadBytes + connection.socket.writableLength;
  }
}

export async function startControlPlaneStreamServer(
  options: StartControlPlaneStreamServerOptions
): Promise<ControlPlaneStreamServer> {
  const server = new ControlPlaneStreamServer(options);
  await server.start();
  return server;
}
