import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  parseActiveRenderTraceState,
  type ActiveRenderTraceState,
} from '../mux/live-mux/render-trace-state.ts';

export interface RenderTraceLabels {
  readonly repositoryId: string | null;
  readonly repositoryName: string | null;
  readonly projectId: string | null;
  readonly projectPath: string | null;
  readonly threadId: string | null;
  readonly threadTitle: string | null;
  readonly agentType: string | null;
  readonly conversationId: string | null;
}

interface RenderTraceRecordInput {
  readonly direction: 'incoming' | 'outgoing';
  readonly source: string;
  readonly eventType: string;
  readonly labels: RenderTraceLabels;
  readonly payload: unknown;
  readonly dedupeKey?: string;
  readonly dedupeValue?: string;
}

interface RenderTraceRecorderOptions {
  readonly statePath: string;
  readonly nowMs?: () => number;
  readonly nowIso?: () => string;
  readonly refreshIntervalMs?: number;
}

const DEFAULT_REFRESH_INTERVAL_MS = 250;

export class RenderTraceRecorder {
  private readonly nowMs: () => number;
  private readonly nowIso: () => string;
  private readonly refreshIntervalMs: number;
  private nextRefreshAtMs = 0;
  private activeState: ActiveRenderTraceState | null = null;
  private activeOutputPath: string | null = null;
  private outputFd: number | null = null;
  private readonly dedupeValueByKey = new Map<string, string>();

  constructor(private readonly options: RenderTraceRecorderOptions) {
    this.nowMs = options.nowMs ?? Date.now;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  }

  isActive(): boolean {
    this.refreshIfDue();
    return this.outputFd !== null && this.activeState !== null;
  }

  shouldCaptureConversation(conversationId: string | null): boolean {
    this.refreshIfDue();
    if (this.outputFd === null || this.activeState === null) {
      return false;
    }
    if (this.activeState.conversationId === null) {
      return true;
    }
    return conversationId === this.activeState.conversationId;
  }

  record(input: RenderTraceRecordInput): void {
    this.refreshIfDue();
    if (this.outputFd === null || this.activeState === null) {
      return;
    }
    if (!this.matchesConversationFilter(input.labels, this.activeState)) {
      return;
    }
    if (
      input.dedupeKey !== undefined &&
      input.dedupeValue !== undefined &&
      this.dedupeValueByKey.get(input.dedupeKey) === input.dedupeValue
    ) {
      return;
    }
    if (input.dedupeKey !== undefined && input.dedupeValue !== undefined) {
      this.dedupeValueByKey.set(input.dedupeKey, input.dedupeValue);
    }
    const record = {
      ts: this.nowIso(),
      direction: input.direction,
      source: input.source,
      eventType: input.eventType,
      labels: input.labels,
      payload: input.payload,
      filterConversationId: this.activeState.conversationId,
    };
    try {
      writeSync(this.outputFd, `${JSON.stringify(record)}\n`);
    } catch {
      this.deactivate();
    }
  }

  close(): void {
    this.deactivate();
  }

  private matchesConversationFilter(
    labels: RenderTraceLabels,
    state: ActiveRenderTraceState,
  ): boolean {
    if (state.conversationId === null) {
      return true;
    }
    if (labels.conversationId === state.conversationId) {
      return true;
    }
    return labels.threadId === state.conversationId;
  }

  private refreshIfDue(): void {
    const now = this.nowMs();
    if (now < this.nextRefreshAtMs) {
      return;
    }
    this.nextRefreshAtMs = now + this.refreshIntervalMs;
    const nextState = this.readState();
    if (nextState === null) {
      this.deactivate();
      return;
    }
    const nextOutputPath = resolve(nextState.outputPath);
    if (this.activeOutputPath === nextOutputPath && this.outputFd !== null) {
      this.activeState = nextState;
      return;
    }
    this.activate(nextState, nextOutputPath);
  }

  private activate(state: ActiveRenderTraceState, outputPath: string): void {
    this.deactivate();
    try {
      mkdirSync(dirname(outputPath), { recursive: true });
      this.outputFd = openSync(outputPath, 'a');
      this.activeOutputPath = outputPath;
      this.activeState = state;
    } catch {
      this.deactivate();
    }
  }

  private deactivate(): void {
    if (this.outputFd !== null) {
      try {
        closeSync(this.outputFd);
      } catch {
        // Best-effort close only.
      }
    }
    this.outputFd = null;
    this.activeOutputPath = null;
    this.activeState = null;
    this.dedupeValueByKey.clear();
  }

  private readState(): ActiveRenderTraceState | null {
    if (!existsSync(this.options.statePath)) {
      return null;
    }
    try {
      const raw = JSON.parse(readFileSync(this.options.statePath, 'utf8')) as unknown;
      return parseActiveRenderTraceState(raw);
    } catch {
      return null;
    }
  }
}
