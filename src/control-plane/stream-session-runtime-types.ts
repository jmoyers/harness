import type { CodexLiveEvent } from '../codex/live-session.ts';
import type { PtyExit } from '../pty/pty_host.ts';
import type { TerminalBufferTail, TerminalSnapshotFrame } from '../terminal/snapshot-oracle.ts';

export interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

export interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

export interface LiveSessionLike {
  attach(handlers: SessionAttachHandlers, sinceCursor?: number): string;
  detach(attachmentId: string): void;
  latestCursorValue(): number;
  processId(): number | null;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  snapshot(): TerminalSnapshotFrame;
  bufferTail?(tailLines?: number): TerminalBufferTail;
  close(): void;
  onEvent(listener: (event: CodexLiveEvent) => void): () => void;
}

export interface StartSessionRuntimeInput {
  readonly sessionId: string;
  readonly args: readonly string[];
  readonly initialCols: number;
  readonly initialRows: number;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly worktreeId?: string;
  readonly terminalForegroundHex?: string;
  readonly terminalBackgroundHex?: string;
}
