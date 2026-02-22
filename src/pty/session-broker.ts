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
type StartSessionFactory = (options?: StartPtySessionOptions) => ReturnType<typeof startPtySession>;

interface StartSingleSessionBrokerDependencies {
  startSession?: StartSessionFactory;
}

class SingleSessionBroker {
  private readonly session: ReturnType<typeof startPtySession>;
  private readonly maxBacklogBytes: number;
  private readonly attachments = new Map<string, BrokerAttachmentHandlers>();
  private readonly backlog: BacklogEntry[] = [];
  private backlogBytes = 0;
  private nextAttachmentId = 1;
  private nextCursor = 1;
  private latestExit: PtyExit | null = null;

  constructor(
    options?: StartPtySessionOptions,
    maxBacklogBytes = 256 * 1024,
    startSession: StartSessionFactory = startPtySession,
  ) {
    this.session = startSession(options);
    this.maxBacklogBytes = maxBacklogBytes;

    this.session.on('data', (chunk: Buffer) => {
      this.handleData(chunk);
    });

    this.session.on('exit', (exit: unknown) => {
      this.handleExit(exit as PtyExit);
    });

    this.session.on('error', (error: unknown) => {
      this.handleError(error as Error);
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
        chunk: Buffer.from(entry.chunk),
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

  processId(): number | null {
    return this.session.processId();
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
      chunk: storedChunk,
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
        chunk: fullChunk,
      });
    }
  }

  private handleExit(exit: PtyExit): void {
    if (this.latestExit !== null) {
      return;
    }
    this.latestExit = exit;
    for (const handlers of this.attachments.values()) {
      handlers.onExit(exit);
    }
  }

  private handleError(error: Error): void {
    void error;
    this.handleExit({
      code: null,
      signal: null,
    });
  }
}

export function startSingleSessionBroker(
  options?: StartPtySessionOptions,
  maxBacklogBytes?: number,
  dependencies: StartSingleSessionBrokerDependencies = {},
): SingleSessionBroker {
  const startSession = dependencies.startSession ?? startPtySession;
  return new SingleSessionBroker(options, maxBacklogBytes, startSession);
}
