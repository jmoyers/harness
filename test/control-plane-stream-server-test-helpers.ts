import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StartControlPlaneSessionInput } from '../src/control-plane/stream-server.ts';
import type { ControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import type { StreamServerEnvelope } from '../src/control-plane/stream-protocol.ts';
import type { CodexLiveEvent } from '../src/codex/live-session.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import { TerminalSnapshotOracle, type TerminalBufferTail } from '../src/terminal/snapshot-oracle.ts';

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

export class FakeLiveSession {
  private static nextProcessId = 51000;
  readonly input: StartControlPlaneSessionInput;
  readonly writes: Buffer[] = [];
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  readonly processIdValue: number;

  private readonly attachments = new Map<string, SessionAttachHandlers>();
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private readonly backlog: SessionDataEvent[];
  private readonly snapshotOracle: TerminalSnapshotOracle;
  private closed = false;
  private nextAttachmentId = 1;
  private latestCursor = 0;

  constructor(input: StartControlPlaneSessionInput) {
    this.input = input;
    this.processIdValue = FakeLiveSession.nextProcessId;
    FakeLiveSession.nextProcessId += 1;
    this.snapshotOracle = new TerminalSnapshotOracle(input.initialCols, input.initialRows);
    this.backlog = [
      {
        cursor: 1,
        chunk: Buffer.from('warmup-1', 'utf8'),
      },
      {
        cursor: 2,
        chunk: Buffer.from('warmup-2', 'utf8'),
      },
    ];
    this.latestCursor = 2;
    for (const entry of this.backlog) {
      this.snapshotOracle.ingest(entry.chunk);
    }
  }

  attach(handlers: SessionAttachHandlers, sinceCursor = 0): string {
    const attachmentId = `attachment-${this.nextAttachmentId}`;
    this.nextAttachmentId += 1;
    this.attachments.set(attachmentId, handlers);

    for (const event of this.backlog) {
      if (event.cursor <= sinceCursor) {
        continue;
      }
      handlers.onData({
        cursor: event.cursor,
        chunk: Buffer.from(event.chunk),
      });
    }

    return attachmentId;
  }

  detach(attachmentId: string): void {
    this.attachments.delete(attachmentId);
  }

  latestCursorValue(): number {
    return this.latestCursor;
  }

  processId(): number | null {
    return this.processIdValue;
  }

  write(data: string | Uint8Array): void {
    const chunk = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
    this.writes.push(chunk);
    this.snapshotOracle.ingest(chunk);

    this.latestCursor += 1;
    const event = {
      cursor: this.latestCursor,
      chunk,
    };
    for (const handlers of this.attachments.values()) {
      handlers.onData(event);
    }
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
    this.snapshotOracle.resize(cols, rows);
  }

  snapshot() {
    return this.snapshotOracle.snapshot();
  }

  bufferTail(tailLines?: number): TerminalBufferTail {
    return this.snapshotOracle.bufferTail(tailLines);
  }

  close(): void {
    this.closed = true;
  }

  onEvent(listener: (event: CodexLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  attachmentCount(): number {
    return this.attachments.size;
  }

  isClosed(): boolean {
    return this.closed;
  }

  emitEvent(event: CodexLiveEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  emitExit(exit: PtyExit): void {
    for (const handlers of this.attachments.values()) {
      handlers.onExit(exit);
    }
    this.emitEvent({
      type: 'session-exit',
      exit,
    });
  }
}

export function collectEnvelopes(client: ControlPlaneStreamClient): StreamServerEnvelope[] {
  const envelopes: StreamServerEnvelope[] = [];
  client.onEnvelope((envelope) => {
    envelopes.push(envelope);
  });
  return envelopes;
}

export async function writeRaw(
  address: { host: string; port: number },
  lines: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(address.port, address.host, () => {
      socket.end(lines);
    });
    socket.once('close', () => resolve());
    socket.once('error', reject);
  });
}

export async function postJson(
  address: { host: string; port: number },
  path: string,
  payload: unknown,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = httpRequest(
      {
        host: address.host,
        port: address.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.once('error', reject);
    req.write(body);
    req.end();
  });
}

export async function postRaw(
  address: { host: string; port: number },
  path: string,
  method: string,
  body: string,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: address.host,
        port: address.port,
        path,
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.once('error', reject);
    req.write(body);
    req.end();
  });
}

export function makeTempStateStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-stream-server-'));
  return join(dir, 'control-plane.sqlite');
}
