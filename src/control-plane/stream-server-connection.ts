import { randomUUID } from 'node:crypto';
import {
  consumeJsonLines,
  parseClientEnvelope,
  type StreamClientEnvelope,
  type StreamCommand,
  type StreamSignal,
} from './stream-protocol.ts';
import { recordPerfEvent, startPerfSpan } from '../perf/perf-core.ts';

interface ConnectionState {
  id: string;
  socket: {
    destroy(): void;
    on(event: 'data', listener: (chunk: Buffer) => void): void;
    on(event: 'drain' | 'error' | 'close', listener: () => void): void;
  };
  remainder: string;
  authenticated: boolean;
  attachedSessionIds: Set<string>;
  eventSessionIds: Set<string>;
  streamSubscriptionIds: Set<string>;
  queuedPayloads: Array<{
    payload: string;
    bytes: number;
    diagnosticSessionId: string | null;
  }>;
  queuedPayloadBytes: number;
  writeBlocked: boolean;
}

interface StreamServerConnectionContext {
  readonly authToken: string | null;
  readonly connections: Map<string, ConnectionState>;
  flushConnectionWrites(connectionId: string): void;
  cleanupConnection(connectionId: string): void;
  handleSocketData(connection: ConnectionState, chunk: Buffer): void;
  handleClientEnvelope(connection: ConnectionState, envelope: StreamClientEnvelope): void;
  handleAuth(connection: ConnectionState, token: string): void;
  handleCommand(connection: ConnectionState, commandId: string, command: StreamCommand): void;
  handleInput(connectionId: string, sessionId: string, dataBase64: string): void;
  handleResize(connectionId: string, sessionId: string, cols: number, rows: number): void;
  handleSignal(connectionId: string, sessionId: string, signal: StreamSignal): void;
  executeCommand(
    connection: ConnectionState,
    command: StreamCommand,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  sendToConnection(connectionId: string, envelope: Record<string, unknown>): void;
}

export function handleConnection(
  ctx: StreamServerConnectionContext,
  socket: ConnectionState['socket'],
): void {
  const connectionId = `connection-${randomUUID()}`;
  const state: ConnectionState = {
    id: connectionId,
    socket,
    remainder: '',
    authenticated: ctx.authToken === null,
    attachedSessionIds: new Set<string>(),
    eventSessionIds: new Set<string>(),
    streamSubscriptionIds: new Set<string>(),
    queuedPayloads: [],
    queuedPayloadBytes: 0,
    writeBlocked: false,
  };

  ctx.connections.set(connectionId, state);
  recordPerfEvent('control-plane.server.connection.open', {
    role: 'server',
    connectionId,
    authRequired: ctx.authToken !== null,
  });

  socket.on('data', (chunk: Buffer) => {
    ctx.handleSocketData(state, chunk);
  });

  socket.on('drain', () => {
    state.writeBlocked = false;
    ctx.flushConnectionWrites(connectionId);
  });

  socket.on('error', () => {
    ctx.cleanupConnection(connectionId);
  });

  socket.on('close', () => {
    ctx.cleanupConnection(connectionId);
  });
}

export function handleSocketData(
  ctx: StreamServerConnectionContext,
  connection: ConnectionState,
  chunk: Buffer,
): void {
  const combined = `${connection.remainder}${chunk.toString('utf8')}`;
  const consumed = consumeJsonLines(combined);
  connection.remainder = consumed.remainder;

  for (const message of consumed.messages) {
    const parsed = parseClientEnvelope(message);
    if (parsed === null) {
      continue;
    }
    ctx.handleClientEnvelope(connection, parsed);
  }
}

export function handleClientEnvelope(
  ctx: StreamServerConnectionContext,
  connection: ConnectionState,
  envelope: StreamClientEnvelope,
): void {
  if (envelope.kind === 'auth') {
    ctx.handleAuth(connection, envelope.token);
    return;
  }

  if (!connection.authenticated) {
    ctx.sendToConnection(connection.id, {
      kind: 'auth.error',
      error: 'authentication required',
    });
    recordPerfEvent('control-plane.server.auth.required', {
      role: 'server',
      connectionId: connection.id,
    });
    connection.socket.destroy();
    return;
  }

  if (envelope.kind === 'command') {
    ctx.handleCommand(connection, envelope.commandId, envelope.command);
    return;
  }

  if (envelope.kind === 'pty.input') {
    ctx.handleInput(connection.id, envelope.sessionId, envelope.dataBase64);
    return;
  }

  if (envelope.kind === 'pty.resize') {
    ctx.handleResize(connection.id, envelope.sessionId, envelope.cols, envelope.rows);
    return;
  }

  ctx.handleSignal(connection.id, envelope.sessionId, envelope.signal);
}

export function handleAuth(
  ctx: StreamServerConnectionContext,
  connection: ConnectionState,
  token: string,
): void {
  if (ctx.authToken === null) {
    connection.authenticated = true;
    ctx.sendToConnection(connection.id, {
      kind: 'auth.ok',
    });
    recordPerfEvent('control-plane.server.auth.ok', {
      role: 'server',
      connectionId: connection.id,
      authRequired: false,
    });
    return;
  }

  if (token !== ctx.authToken) {
    ctx.sendToConnection(connection.id, {
      kind: 'auth.error',
      error: 'invalid auth token',
    });
    recordPerfEvent('control-plane.server.auth.failed', {
      role: 'server',
      connectionId: connection.id,
    });
    connection.socket.destroy();
    return;
  }

  connection.authenticated = true;
  ctx.sendToConnection(connection.id, {
    kind: 'auth.ok',
  });
  recordPerfEvent('control-plane.server.auth.ok', {
    role: 'server',
    connectionId: connection.id,
    authRequired: true,
  });
}

export function handleCommand(
  ctx: StreamServerConnectionContext,
  connection: ConnectionState,
  commandId: string,
  command: StreamCommand,
): void {
  ctx.sendToConnection(connection.id, {
    kind: 'command.accepted',
    commandId,
  });

  const commandSpan = startPerfSpan('control-plane.server.command', {
    role: 'server',
    type: command.type,
  });
  Promise.resolve(ctx.executeCommand(connection, command))
    .then((result) => {
      commandSpan.end({
        type: command.type,
        status: 'completed',
      });
      ctx.sendToConnection(connection.id, {
        kind: 'command.completed',
        commandId,
        result,
      });
    })
    .catch((error: unknown) => {
      commandSpan.end({
        type: command.type,
        status: 'failed',
        message: String(error),
      });
      ctx.sendToConnection(connection.id, {
        kind: 'command.failed',
        commandId,
        error: String(error),
      });
    });
}
