import { closeSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  renderTraceChunkPreview,
  type RenderTraceControlIssue,
} from '../mux/live-mux/render-trace-analysis.ts';

const DEFAULT_MAX_ENTRIES_PER_CONVERSATION = 512;
export const SESSION_DIAGNOSTICS_FILE_EXTENSION = '.jsonl';

export interface SessionStatusSnapshot {
  readonly status: string;
  readonly attentionReason: string | null;
  readonly live: boolean;
  readonly phase: string | null;
  readonly detailText: string | null;
  readonly lastKnownWork: string | null;
  readonly lastKnownWorkAt: string | null;
  readonly telemetrySource: string | null;
}

export interface UnsupportedControlSequencesEntry {
  readonly kind: 'unsupported-control-sequences';
  readonly observedAt: string;
  readonly source: string;
  readonly cursor: number;
  readonly chunkPreview: string;
  readonly issues: ReadonlyArray<{
    readonly kind: RenderTraceControlIssue['kind'];
    readonly offset: number;
    readonly sequence: string;
    readonly sequencePreview: string;
    readonly finalByte?: string;
    readonly rawParams?: string;
  }>;
}

export interface SessionStatusTransitionEntry {
  readonly kind: 'status-transition';
  readonly observedAt: string;
  readonly source: string;
  readonly from: SessionStatusSnapshot;
  readonly to: SessionStatusSnapshot;
  readonly metadata?: Record<string, unknown>;
}

export type SessionDiagnosticsEntry =
  | UnsupportedControlSequencesEntry
  | SessionStatusTransitionEntry;

interface SessionDiagnosticsStoreOptions {
  readonly maxEntriesPerConversation?: number;
  readonly diagnosticsDirectory?: string | null;
}

export class SessionDiagnosticsStore {
  private readonly maxEntriesPerConversation: number;
  private readonly diagnosticsDirectory: string | null;
  private readonly entriesByConversationId = new Map<string, SessionDiagnosticsEntry[]>();
  private readonly fileDescriptorByConversationId = new Map<string, number>();

  constructor(options: SessionDiagnosticsStoreOptions = {}) {
    const configuredMax = options.maxEntriesPerConversation;
    this.maxEntriesPerConversation =
      typeof configuredMax === 'number' && Number.isFinite(configuredMax)
        ? Math.max(1, Math.floor(configuredMax))
        : DEFAULT_MAX_ENTRIES_PER_CONVERSATION;
    this.diagnosticsDirectory =
      typeof options.diagnosticsDirectory === 'string' && options.diagnosticsDirectory.length > 0
        ? resolve(options.diagnosticsDirectory)
        : null;
  }

  close(): void {
    for (const conversationId of this.fileDescriptorByConversationId.keys()) {
      this.closeConversationFile(conversationId);
    }
  }

  recordUnsupportedControlSequences(input: {
    readonly conversationId: string;
    readonly observedAt: string;
    readonly source: string;
    readonly cursor: number;
    readonly chunkPreview: string;
    readonly issues: readonly RenderTraceControlIssue[];
  }): void {
    if (input.issues.length === 0) {
      return;
    }
    const normalizedIssues = input.issues.map((issue) => ({
      kind: issue.kind,
      offset: issue.offset,
      sequence: issue.sequence,
      sequencePreview: renderTraceChunkPreview(issue.sequence, 160),
      ...(issue.finalByte === undefined ? {} : { finalByte: issue.finalByte }),
      ...(issue.rawParams === undefined ? {} : { rawParams: issue.rawParams }),
    }));
    this.recordConversationEntry(input.conversationId, {
      kind: 'unsupported-control-sequences',
      observedAt: input.observedAt,
      source: input.source,
      cursor: input.cursor,
      chunkPreview: input.chunkPreview,
      issues: normalizedIssues,
    });
  }

  recordStatusTransition(input: {
    readonly conversationId: string;
    readonly observedAt: string;
    readonly source: string;
    readonly from: SessionStatusSnapshot;
    readonly to: SessionStatusSnapshot;
    readonly metadata?: Record<string, unknown>;
  }): void {
    this.recordConversationEntry(input.conversationId, {
      kind: 'status-transition',
      observedAt: input.observedAt,
      source: input.source,
      from: input.from,
      to: input.to,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
  }

  listConversationEntries(conversationId: string): readonly SessionDiagnosticsEntry[] {
    const entries = this.entriesByConversationId.get(conversationId);
    return entries === undefined ? [] : [...entries];
  }

  clearConversation(conversationId: string): void {
    this.entriesByConversationId.delete(conversationId);
    this.closeConversationFile(conversationId);
    const filePath = this.resolveConversationDiagnosticsPath(conversationId);
    if (filePath === null) {
      return;
    }
    try {
      rmSync(filePath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }

  private recordConversationEntry(conversationId: string, entry: SessionDiagnosticsEntry): void {
    const entries = this.entriesByConversationId.get(conversationId) ?? [];
    entries.push(entry);
    if (entries.length > this.maxEntriesPerConversation) {
      entries.splice(0, entries.length - this.maxEntriesPerConversation);
    }
    this.entriesByConversationId.set(conversationId, entries);
    this.writeConversationEntry(conversationId, entry);
  }

  private writeConversationEntry(conversationId: string, entry: SessionDiagnosticsEntry): void {
    const filePath = this.resolveConversationDiagnosticsPath(conversationId);
    if (filePath === null) {
      return;
    }
    const fd = this.ensureConversationFile(conversationId, filePath);
    if (fd === null) {
      return;
    }
    const record = {
      conversationId,
      ...entry,
    };
    try {
      writeSync(fd, `${JSON.stringify(record)}\n`);
    } catch {
      this.closeConversationFile(conversationId);
    }
  }

  private ensureConversationFile(conversationId: string, filePath: string): number | null {
    const existing = this.fileDescriptorByConversationId.get(conversationId);
    if (existing !== undefined) {
      return existing;
    }
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const fd = openSync(filePath, 'a');
      this.fileDescriptorByConversationId.set(conversationId, fd);
      return fd;
    } catch {
      this.closeConversationFile(conversationId);
      return null;
    }
  }

  private closeConversationFile(conversationId: string): void {
    const fd = this.fileDescriptorByConversationId.get(conversationId);
    if (fd === undefined) {
      return;
    }
    try {
      closeSync(fd);
    } catch {
      // Best-effort close only.
    }
    this.fileDescriptorByConversationId.delete(conversationId);
  }

  private resolveConversationDiagnosticsPath(conversationId: string): string | null {
    if (this.diagnosticsDirectory === null) {
      return null;
    }
    const fileToken = sanitizeFileToken(conversationId);
    return resolve(this.diagnosticsDirectory, `${fileToken}${SESSION_DIAGNOSTICS_FILE_EXTENSION}`);
  }
}

function sanitizeFileToken(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/gu, '-');
  return normalized.length === 0 ? 'conversation' : normalized;
}
