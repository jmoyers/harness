import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { recordPerfEvent, startPerfSpan } from '../perf/perf-core.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseServerEnvelope,
  type StreamCommand,
  type StreamCommandEnvelope,
  type StreamServerEnvelope,
  type StreamSignal
} from './stream-protocol.ts';

interface ControlPlaneStreamClientOptions {
  host: string;
  port: number;
  authToken?: string;
  connectRetryWindowMs?: number;
  connectRetryDelayMs?: number;
}

interface PendingCommand {
  readonly type: string;
  readonly span: ReturnType<typeof startPerfSpan>;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export class ControlPlaneStreamClient {
  private readonly socket: Socket;
  private readonly listeners = new Set<(envelope: StreamServerEnvelope) => void>();
  private readonly pending = new Map<string, PendingCommand>();
  private remainder = '';
  private pendingAuth:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | null = null;
  private closed = false;

  constructor(socket: Socket) {
    this.socket = socket;

    socket.on('data', (chunk: Buffer) => {
      this.handleData(chunk);
    });

    socket.on('close', () => {
      this.handleClose(new Error('control-plane stream closed'));
    });

    socket.on('error', (error: Error) => {
      this.handleClose(error);
    });
  }

  onEnvelope(listener: (envelope: StreamServerEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  sendCommand(command: StreamCommand): Promise<Record<string, unknown>> {
    const commandId = `command-${randomUUID()}`;
    const commandType = command.type;
    const commandSpan = startPerfSpan('control-plane.command.rtt', {
      role: 'client',
      type: commandType
    });

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (this.closed) {
        commandSpan.end({
          type: commandType,
          status: 'client-closed'
        });
        reject(new Error('control-plane stream is closed'));
        return;
      }

      this.pending.set(commandId, {
        type: commandType,
        span: commandSpan,
        resolve,
        reject
      });
      recordPerfEvent('control-plane.command.sent', {
        role: 'client',
        type: commandType
      });

      const envelope: StreamCommandEnvelope = {
        kind: 'command',
        commandId,
        command
      };
      this.socket.write(encodeStreamEnvelope(envelope));
    });
  }

  authenticate(token: string): Promise<void> {
    const authSpan = startPerfSpan('control-plane.auth.rtt', {
      role: 'client'
    });
    return new Promise<void>((resolve, reject) => {
      if (this.closed) {
        authSpan.end({
          status: 'client-closed'
        });
        reject(new Error('control-plane stream is closed'));
        return;
      }
      if (this.pendingAuth !== null) {
        authSpan.end({
          status: 'already-pending'
        });
        reject(new Error('auth is already pending'));
        return;
      }

      this.pendingAuth = {
        resolve: () => {
          authSpan.end({
            status: 'ok'
          });
          resolve();
        },
        reject: (error: Error) => {
          authSpan.end({
            status: 'error',
            message: error.message
          });
          reject(error);
        }
      };
      this.socket.write(
        encodeStreamEnvelope({
          kind: 'auth',
          token
        })
      );
    });
  }

  sendInput(sessionId: string, data: Buffer): void {
    if (this.closed) {
      return;
    }

    this.socket.write(
      encodeStreamEnvelope({
        kind: 'pty.input',
        sessionId,
        dataBase64: data.toString('base64')
      })
    );
  }

  sendResize(sessionId: string, cols: number, rows: number): void {
    if (this.closed) {
      return;
    }

    this.socket.write(
      encodeStreamEnvelope({
        kind: 'pty.resize',
        sessionId,
        cols,
        rows
      })
    );
  }

  sendSignal(sessionId: string, signal: StreamSignal): void {
    if (this.closed) {
      return;
    }

    this.socket.write(
      encodeStreamEnvelope({
        kind: 'pty.signal',
        sessionId,
        signal
      })
    );
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.end();
    this.rejectPending(new Error('control-plane stream closed'));
  }

  private handleData(chunk: Buffer): void {
    const consumed = consumeJsonLines(`${this.remainder}${chunk.toString('utf8')}`);
    this.remainder = consumed.remainder;

    for (const message of consumed.messages) {
      const envelope = parseServerEnvelope(message);
      if (envelope === null) {
        continue;
      }
      this.handleEnvelope(envelope);
    }
  }

  private handleEnvelope(envelope: StreamServerEnvelope): void {
    if (envelope.kind === 'auth.ok') {
      const pendingAuth = this.pendingAuth;
      if (pendingAuth !== null) {
        this.pendingAuth = null;
        pendingAuth.resolve();
      }
      return;
    }

    if (envelope.kind === 'auth.error') {
      const pendingAuth = this.pendingAuth;
      if (pendingAuth !== null) {
        this.pendingAuth = null;
        pendingAuth.reject(new Error(envelope.error));
      }
      return;
    }

    if (envelope.kind === 'command.accepted') {
      return;
    }

    if (envelope.kind === 'command.completed') {
      const pending = this.pending.get(envelope.commandId);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(envelope.commandId);
      pending.span.end({
        type: pending.type,
        status: 'completed'
      });
      pending.resolve(envelope.result);
      return;
    }

    if (envelope.kind === 'command.failed') {
      const pending = this.pending.get(envelope.commandId);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(envelope.commandId);
      pending.span.end({
        type: pending.type,
        status: 'failed',
        message: envelope.error
      });
      pending.reject(new Error(envelope.error));
      return;
    }

    for (const listener of this.listeners) {
      listener(envelope);
    }
  }

  private handleClose(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    const pendingAuth = this.pendingAuth;
    if (pendingAuth !== null) {
      this.pendingAuth = null;
      pendingAuth.reject(error);
    }
    for (const pending of this.pending.values()) {
      pending.span.end({
        type: pending.type,
        status: 'closed',
        message: error.message
      });
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function connectControlPlaneStreamClient(
  options: ControlPlaneStreamClientOptions
): Promise<ControlPlaneStreamClient> {
  const retryWindowMs = Math.max(0, options.connectRetryWindowMs ?? 0);
  const retryDelayMs = Math.max(1, options.connectRetryDelayMs ?? 50);
  const retryableCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT'
  ]);
  const startedAtMs = Date.now();
  recordPerfEvent('control-plane.connect.begin', {
    role: 'client',
    host: options.host,
    port: options.port,
    retryWindowMs,
    retryDelayMs
  });
  let attempts = 0;
  let socket: Socket | null = null;
  while (socket === null) {
    attempts += 1;
    const attemptSpan = startPerfSpan('control-plane.connect.attempt', {
      role: 'client',
      attempt: attempts,
      host: options.host,
      port: options.port
    });
    try {
      socket = await new Promise<Socket>((resolve, reject) => {
        const client = connect(options.port, options.host);
        const onError = (error: Error): void => {
          client.off('connect', onConnect);
          reject(error);
        };
        const onConnect = (): void => {
          client.off('error', onError);
          resolve(client);
        };

        client.once('error', onError);
        client.once('connect', onConnect);
      });
      attemptSpan.end({
        attempt: attempts,
        status: 'connected'
      });
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      const elapsedMs = Date.now() - startedAtMs;
      attemptSpan.end({
        attempt: attempts,
        status: 'error',
        code: typeof code === 'string' ? code : 'unknown'
      });
      if (
        retryWindowMs === 0 ||
        typeof code !== 'string' ||
        !retryableCodes.has(code) ||
        elapsedMs >= retryWindowMs
      ) {
        recordPerfEvent('control-plane.connect.failed', {
          role: 'client',
          host: options.host,
          port: options.port,
          attempts,
          elapsedMs,
          code: typeof code === 'string' ? code : 'unknown'
        });
        throw error;
      }
      const remainingMs = retryWindowMs - elapsedMs;
      recordPerfEvent('control-plane.connect.retrying', {
        role: 'client',
        host: options.host,
        port: options.port,
        attempts,
        elapsedMs,
        remainingMs,
        code: typeof code === 'string' ? code : 'unknown'
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(1, Math.min(retryDelayMs, remainingMs)));
      });
    }
  }

  const client = new ControlPlaneStreamClient(socket);
  if (typeof options.authToken === 'string') {
    await client.authenticate(options.authToken);
  }
  recordPerfEvent('control-plane.connect.ready', {
    role: 'client',
    host: options.host,
    port: options.port,
    attempts,
    elapsedMs: Date.now() - startedAtMs,
    authenticated: typeof options.authToken === 'string'
  });
  return client;
}
