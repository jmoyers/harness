import type { NimEventEnvelope } from '../../nim-core/src/events.ts';
import type { NimRuntime, NimUiEvent } from '../../nim-core/src/contracts.ts';
import { projectEventToUiEvents, type NimUiMode } from '../../nim-ui-core/src/projection.ts';

export type TestTuiFrame = {
  readonly mode: NimUiMode;
  readonly runId: string;
  readonly lines: readonly string[];
  readonly state: 'thinking' | 'tool-calling' | 'responding' | 'idle';
};

export type CollectNimTestTuiFrameInput = {
  readonly runtime: NimRuntime;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly mode: NimUiMode;
  readonly fromEventIdExclusive?: string;
  readonly timeoutMs?: number;
};

export type CollectNimTestTuiFrameResult = {
  readonly frame: TestTuiFrame;
  readonly lastEventId?: string;
  readonly projectedEventCount: number;
};

export class NimTestTuiController {
  private mode: NimUiMode;
  private runId: string;
  private state: 'thinking' | 'tool-calling' | 'responding' | 'idle';
  private lines: string[];
  private pendingAssistantText: string;

  public constructor(input: { mode: NimUiMode; runId: string }) {
    this.mode = input.mode;
    this.runId = input.runId;
    this.state = 'idle';
    this.lines = [];
    this.pendingAssistantText = '';
  }

  public consume(event: NimEventEnvelope): readonly NimUiEvent[] {
    if (event.run_id.length > 0) {
      this.runId = event.run_id;
    }
    const projected = projectEventToUiEvents(event, this.mode);
    for (const item of projected) {
      if (item.type === 'assistant.state') {
        this.state = item.state;
        continue;
      }
      if (item.type === 'assistant.text.delta') {
        this.pendingAssistantText += item.text;
        continue;
      }
      if (item.type === 'assistant.text.message') {
        this.pendingAssistantText = '';
        this.lines.push(item.text);
        continue;
      }
      if (item.type === 'tool.activity') {
        this.lines.push(`[tool:${item.phase}] ${item.toolName}`);
        continue;
      }
      if (item.type === 'system.notice') {
        this.lines.push(`[notice] ${item.text}`);
      }
    }
    return projected;
  }

  public snapshot(): TestTuiFrame {
    const lines =
      this.pendingAssistantText.length > 0
        ? [...this.lines, this.pendingAssistantText]
        : this.lines.slice();
    return {
      mode: this.mode,
      runId: this.runId,
      lines,
      state: this.state,
    };
  }
}

export async function collectNimTestTuiFrame(
  input: CollectNimTestTuiFrameInput,
): Promise<CollectNimTestTuiFrameResult> {
  const stream = input.runtime.streamEvents({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    ...(input.fromEventIdExclusive !== undefined
      ? { fromEventIdExclusive: input.fromEventIdExclusive }
      : {}),
    fidelity: 'semantic',
  });
  const iterator = stream[Symbol.asyncIterator]();
  const controller = new NimTestTuiController({
    mode: input.mode,
    runId: input.sessionId,
  });
  const timeoutMs = input.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  let sawActiveState = false;
  let projectedEventCount = 0;
  let lastEventId: string | undefined;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('timed out waiting for Nim test TUI idle frame'));
          }, remaining);
        }),
      ]).finally(() => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      });
      if (next.done) {
        break;
      }
      lastEventId = next.value.event_id;
      const projected = controller.consume(next.value);
      projectedEventCount += projected.length;
      for (const item of projected) {
        if (item.type !== 'assistant.state') {
          continue;
        }
        if (item.state !== 'idle') {
          sawActiveState = true;
          continue;
        }
        if (sawActiveState) {
          return {
            frame: controller.snapshot(),
            ...(lastEventId !== undefined ? { lastEventId } : {}),
            projectedEventCount,
          };
        }
      }
    }
    throw new Error('timed out waiting for Nim test TUI idle frame');
  } finally {
    await iterator.return?.();
  }
}
