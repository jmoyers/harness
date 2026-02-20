import type { NimEventEnvelope } from '../../nim-core/src/events.ts';
import type { NimUiEvent } from '../../nim-core/src/contracts.ts';
import { projectEventToUiEvents, type NimUiMode } from '../../nim-ui-core/src/projection.ts';

export type TestTuiFrame = {
  readonly mode: NimUiMode;
  readonly runId: string;
  readonly lines: readonly string[];
  readonly state: 'thinking' | 'tool-calling' | 'responding' | 'idle';
};

export class NimTestTuiController {
  private mode: NimUiMode;
  private runId: string;
  private state: 'thinking' | 'tool-calling' | 'responding' | 'idle';
  private lines: string[];

  public constructor(input: { mode: NimUiMode; runId: string }) {
    this.mode = input.mode;
    this.runId = input.runId;
    this.state = 'idle';
    this.lines = [];
  }

  public consume(event: NimEventEnvelope): readonly NimUiEvent[] {
    const projected = projectEventToUiEvents(event, this.mode);
    for (const item of projected) {
      if (item.type === 'assistant.state') {
        this.state = item.state;
        continue;
      }
      if (item.type === 'assistant.text.delta') {
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
    return {
      mode: this.mode,
      runId: this.runId,
      lines: this.lines.slice(),
      state: this.state,
    };
  }
}
