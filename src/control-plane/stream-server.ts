import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  type NotifyPayload,
  type CodexLiveEvent
} from '../codex/live-session.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
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
}

interface ConnectionState {
  id: string;
  socket: Socket;
  remainder: string;
  attachedSessionIds: Set<string>;
  eventSessionIds: Set<string>;
}

interface SessionState {
  session: LiveSessionLike;
  eventSubscriberConnectionIds: Set<string>;
  attachmentByConnectionId: Map<string, string>;
  unsubscribe: () => void;
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
  private readonly startSession: StartControlPlaneSession;
  private readonly server: Server;
  private readonly connections = new Map<string, ConnectionState>();
  private readonly sessions = new Map<string, SessionState>();
  private listening = false;

  constructor(options: StartControlPlaneStreamServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
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
      attachedSessionIds: new Set<string>(),
      eventSessionIds: new Set<string>()
    };

    this.connections.set(connectionId, state);

    socket.on('data', (chunk: Buffer) => {
      this.handleSocketData(state, chunk);
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
    if (command.type === 'pty.start') {
      if (this.sessions.has(command.sessionId)) {
        throw new Error(`session already exists: ${command.sessionId}`);
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
        session,
        eventSubscriberConnectionIds: new Set<string>(),
        attachmentByConnectionId: new Map<string, string>(),
        unsubscribe
      });

      return {
        sessionId: command.sessionId
      };
    }

    if (command.type === 'pty.attach') {
      const state = this.requireSession(command.sessionId);
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

    this.requireSession(command.sessionId);
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

    const data = Buffer.from(dataBase64, 'base64');
    if (data.length === 0 && dataBase64.length > 0) {
      return;
    }
    state.session.write(data);
  }

  private handleResize(sessionId: string, cols: number, rows: number): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    state.session.resize(cols, rows);
  }

  private handleSignal(sessionId: string, signal: StreamSignal): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }

    if (signal === 'interrupt') {
      state.session.write('\u0003');
      return;
    }

    if (signal === 'eof') {
      state.session.write('\u0004');
      return;
    }

    this.destroySession(sessionId, true);
  }

  private handleSessionEvent(sessionId: string, event: CodexLiveEvent): void {
    const sessionState = this.sessions.get(sessionId)!;

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

    if (event.type === 'session-exit') {
      this.destroySession(sessionId, false);
    }
  }

  private requireSession(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return state;
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

  private destroySession(sessionId: string, closeSession: boolean): void {
    const state = this.sessions.get(sessionId)!;

    state.unsubscribe();

    if (closeSession) {
      state.session.close();
    }

    for (const [connectionId, attachmentId] of state.attachmentByConnectionId.entries()) {
      state.session.detach(attachmentId);
      const connection = this.connections.get(connectionId);
      if (connection !== undefined) {
        connection.attachedSessionIds.delete(sessionId);
      }
    }

    for (const connectionId of state.eventSubscriberConnectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection !== undefined) {
        connection.eventSessionIds.delete(sessionId);
      }
    }

    this.sessions.delete(sessionId);
  }

  private sendToConnection(connectionId: string, envelope: StreamServerEnvelope): void {
    const connection = this.connections.get(connectionId)!;
    connection.socket.write(encodeStreamEnvelope(envelope));
  }
}

export async function startControlPlaneStreamServer(
  options: StartControlPlaneStreamServerOptions
): Promise<ControlPlaneStreamServer> {
  const server = new ControlPlaneStreamServer(options);
  await server.start();
  return server;
}
