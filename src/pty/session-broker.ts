import { startPtySession, type PtyExit } from './pty_host.ts';

interface BacklogEntry {
  cursor: number;
  chunk: Buffer;
}

export interface BrokerDataEvent {
  cursor: number;
  chunk: Buffer;
}

export interface BrokerAttachmentHandlers {
  onData: (event: BrokerDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

type StartPtySessionOptions = Parameters<typeof startPtySession>[0];

class SingleSessionBroker {
  private readonly session: ReturnType<typeof startPtySession>;
  private readonly maxBacklogBytes: number;
  private readonly attachments = new Map<string, BrokerAttachmentHandlers>();
  private readonly backlog: BacklogEntry[] = [];
  private backlogBytes = 0;
  private nextAttachmentId = 1;
  private nextCursor = 1;
  private latestExit: PtyExit | null = null;

  constructor(options?: StartPtySessionOptions, maxBacklogBytes = 256 * 1024) {
    this.session = startPtySession(options);
    this.maxBacklogBytes = maxBacklogBytes;

    this.session.on('data', (chunk: Buffer) => {
      this.handleData(chunk);
    });

    this.session.on('exit', (exit: unknown) => {
      this.handleExit(exit as PtyExit);
    });
  }

  attach(handlers: BrokerAttachmentHandlers, sinceCursor = 0): string {
    const attachmentId = `attachment-${this.nextAttachmentId}`;
    this.nextAttachmentId += 1;
    this.attachments.set(attachmentId, handlers);

    for (const entry of this.backlog) {
      if (entry.cursor <= sinceCursor) {
        continue;
      }
      handlers.onData({
        cursor: entry.cursor,
        chunk: Buffer.from(entry.chunk)
      });
    }

    if (this.latestExit !== null) {
      handlers.onExit(this.latestExit);
    }

    return attachmentId;
  }

  detach(attachmentId: string): void {
    this.attachments.delete(attachmentId);
  }

  latestCursorValue(): number {
    return this.nextCursor - 1;
  }

  write(data: string | Uint8Array): void {
    this.session.write(data);
  }

  resize(cols: number, rows: number): void {
    this.session.resize(cols, rows);
  }

  close(): void {
    this.session.close();
  }

  private handleData(chunk: Buffer): void {
    const fullChunk = Buffer.from(chunk);
    let storedChunk = fullChunk;
    if (storedChunk.length > this.maxBacklogBytes) {
      storedChunk = storedChunk.subarray(storedChunk.length - this.maxBacklogBytes);
      this.backlog.length = 0;
      this.backlogBytes = 0;
    }

    const entry: BacklogEntry = {
      cursor: this.nextCursor,
      chunk: storedChunk
    };
    this.nextCursor += 1;

    this.backlog.push(entry);
    this.backlogBytes += entry.chunk.length;
    while (this.backlogBytes > this.maxBacklogBytes && this.backlog.length > 0) {
      const removed = this.backlog.shift()!;
      this.backlogBytes -= removed.chunk.length;
    }

    for (const handlers of this.attachments.values()) {
      handlers.onData({
        cursor: entry.cursor,
        chunk: Buffer.from(fullChunk)
      });
    }
  }

  private handleExit(exit: PtyExit): void {
    this.latestExit = exit;
    for (const handlers of this.attachments.values()) {
      handlers.onExit(exit);
    }
  }
}

export function startSingleSessionBroker(
  options?: StartPtySessionOptions,
  maxBacklogBytes?: number
): SingleSessionBroker {
  return new SingleSessionBroker(options, maxBacklogBytes);
}
