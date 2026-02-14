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
  type StreamSessionListSort,
  type StreamSessionRuntimeStatus,
  type StreamClientEnvelope,
  type StreamCommand,
  type StreamServerEnvelope,
  type StreamSessionEvent,
  type StreamSignal
} from './stream-protocol.ts';

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
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  snapshot(): TerminalSnapshotFrame;
  close(): void;
  onEvent(listener: (event: CodexLiveEvent) => void): () => void;
}

export interface StartControlPlaneSessionInput {
  args: string[];
  env?: Record<string, string>;
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
}

interface ConnectionState {
  id: string;
  socket: Socket;
  remainder: string;
  authenticated: boolean;
  attachedSessionIds: Set<string>;
  eventSessionIds: Set<string>;
  queuedPayloads: string[];
  queuedPayloadBytes: number;
  writeBlocked: boolean;
}

interface SessionState {
  id: string;
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
}

const DEFAULT_MAX_CONNECTION_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_SESSION_EXIT_TOMBSTONE_TTL_MS = 5 * 60 * 1000;
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
  private readonly startSession: StartControlPlaneSession;
  private readonly server: Server;
  private readonly connections = new Map<string, ConnectionState>();
  private readonly sessions = new Map<string, SessionState>();
  private listening = false;

  constructor(options: StartControlPlaneStreamServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.authToken = options.authToken ?? null;
    this.maxConnectionBufferedBytes =
      options.maxConnectionBufferedBytes ?? DEFAULT_MAX_CONNECTION_BUFFERED_BYTES;
    this.sessionExitTombstoneTtlMs =
      options.sessionExitTombstoneTtlMs ?? DEFAULT_SESSION_EXIT_TOMBSTONE_TTL_MS;
    if (options.startSession === undefined) {
      throw new Error('startSession is required');
    }
    this.startSession = options.startSession;
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

    if (!this.listening) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => {
        this.listening = false;
        resolve();
      });
    });
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
      queuedPayloads: [],
      queuedPayloadBytes: 0,
      writeBlocked: false
    };

    this.connections.set(connectionId, state);

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
      return;
    }

    if (token !== this.authToken) {
      this.sendToConnection(connection.id, {
        kind: 'auth.error',
        error: 'invalid auth token'
      });
      connection.socket.destroy();
      return;
    }

    connection.authenticated = true;
    this.sendToConnection(connection.id, {
      kind: 'auth.ok'
    });
  }

  private handleCommand(connection: ConnectionState, commandId: string, command: StreamCommand): void {
    this.sendToConnection(connection.id, {
      kind: 'command.accepted',
      commandId
    });

    try {
      const result = this.executeCommand(connection, command);
      this.sendToConnection(connection.id, {
        kind: 'command.completed',
        commandId,
        result
      });
    } catch (error) {
      this.sendToConnection(connection.id, {
        kind: 'command.failed',
        commandId,
        error: String(error)
      });
    }
  }

  private executeCommand(connection: ConnectionState, command: StreamCommand): Record<string, unknown> {
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
      state.status = 'running';
      state.attentionReason = null;
      return {
        responded: true,
        sentBytes: Buffer.byteLength(command.text)
      };
    }

    if (command.type === 'session.interrupt') {
      const state = this.requireLiveSession(command.sessionId);
      state.session.write('\u0003');
      state.status = 'running';
      state.attentionReason = null;
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

      this.sessions.set(command.sessionId, {
        id: command.sessionId,
        tenantId: command.tenantId ?? DEFAULT_TENANT_ID,
        userId: command.userId ?? DEFAULT_USER_ID,
        workspaceId: command.workspaceId ?? DEFAULT_WORKSPACE_ID,
        worktreeId: command.worktreeId ?? DEFAULT_WORKTREE_ID,
        session,
        eventSubscriberConnectionIds: new Set<string>(),
        attachmentByConnectionId: new Map<string, string>(),
        unsubscribe,
        status: 'running',
        attentionReason: null,
        lastEventAt: null,
        lastExit: null,
        lastSnapshot: null,
        startedAt: new Date().toISOString(),
        exitedAt: null,
        tombstoneTimer: null
      });

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
    state.status = 'running';
    state.attentionReason = null;
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
      state.status = 'running';
      state.attentionReason = null;
      return;
    }

    if (signal === 'eof') {
      state.session.write('\u0004');
      state.status = 'running';
      state.attentionReason = null;
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
      for (const connectionId of sessionState.eventSubscriberConnectionIds) {
        this.sendToConnection(connectionId, {
          kind: 'pty.event',
          sessionId,
          event: mapped
        });
      }
    }

    if (event.type === 'attention-required') {
      sessionState.status = 'needs-input';
      sessionState.attentionReason = event.reason;
      sessionState.lastEventAt = event.record.ts;
      return;
    }

    if (event.type === 'turn-completed') {
      sessionState.status = 'completed';
      sessionState.attentionReason = null;
      sessionState.lastEventAt = event.record.ts;
      return;
    }

    if (event.type === 'notify') {
      sessionState.lastEventAt = event.record.ts;
      return;
    }

    if (event.type === 'session-exit') {
      sessionState.status = 'exited';
      sessionState.attentionReason = null;
      sessionState.lastExit = event.exit;
      const exitedAt = new Date().toISOString();
      sessionState.lastEventAt = exitedAt;
      sessionState.exitedAt = exitedAt;
      this.deactivateSession(sessionState.id, true);
    }
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

    this.connections.delete(connectionId);
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
      tenantId: state.tenantId,
      userId: state.userId,
      workspaceId: state.workspaceId,
      worktreeId: state.worktreeId,
      status: state.status,
      attentionReason: state.attentionReason,
      latestCursor: state.session?.latestCursorValue() ?? null,
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
