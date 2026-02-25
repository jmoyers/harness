import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

const DEFAULT_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const layout = new TextLayoutEngine();

export type TurnActivityState = 'thinking' | 'tool-calling' | 'responding' | 'idle';

export interface TurnActivitySummary {
  readonly totalTools?: number;
  readonly completedTools?: number;
  readonly failedTools?: number;
  readonly latestToolName?: string;
}

export interface TurnActivityFormatInput {
  readonly inProgress: boolean;
  readonly state?: TurnActivityState;
  readonly summary?: TurnActivitySummary;
  readonly nowMs?: number;
  readonly spinnerFrames?: readonly string[];
  readonly spinnerIntervalMs?: number;
}

export function spinnerFrameAt(
  nowMs: number,
  frames: readonly string[] = DEFAULT_SPINNER_FRAMES,
  intervalMs = 140,
): string {
  if (frames.length === 0) return '';
  const safeInterval = Math.max(1, Math.floor(intervalMs));
  return frames[Math.floor(nowMs / safeInterval) % frames.length]!;
}

function stateLabel(state: TurnActivityState | undefined): string {
  if (state === 'tool-calling') return 'running tools';
  if (state === 'responding') return 'writing response';
  if (state === 'thinking') return 'thinking';
  return 'idle';
}

function safeSummary(summary: TurnActivitySummary | undefined): Required<TurnActivitySummary> {
  const totalTools = Math.max(0, Math.floor(summary?.totalTools ?? 0));
  const completedTools = Math.max(0, Math.floor(summary?.completedTools ?? 0));
  const failedTools = Math.max(0, Math.floor(summary?.failedTools ?? 0));
  return {
    totalTools,
    completedTools: Math.min(totalTools, completedTools),
    failedTools: Math.min(totalTools, failedTools),
    latestToolName: summary?.latestToolName ?? '',
  };
}

export function formatTurnActivityLine(input: TurnActivityFormatInput): string {
  const now = input.nowMs ?? Date.now();
  const summary = safeSummary(input.summary);
  if (!input.inProgress) {
    if (summary.totalTools === 0) return '✓ complete';
    let done = `✓ ${summary.totalTools} tool call${summary.totalTools === 1 ? '' : 's'}`;
    done += ` · ${summary.completedTools}/${summary.totalTools} complete`;
    if (summary.failedTools > 0) done += ` · ${summary.failedTools} failed`;
    if (summary.latestToolName.length > 0) done += ` · latest ${summary.latestToolName}`;
    return done;
  }

  let line = `${spinnerFrameAt(now, input.spinnerFrames, input.spinnerIntervalMs)} ${stateLabel(input.state)}...`;
  if (summary.totalTools > 0) {
    line += ` · ${summary.completedTools}/${summary.totalTools} complete`;
    if (summary.failedTools > 0) line += ` · ${summary.failedTools} failed`;
    if (summary.latestToolName.length > 0) line += ` · ${summary.latestToolName}`;
  }
  return line;
}

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

export interface TurnActivityStripProps {
  readonly id?: string;
  readonly inProgress?: boolean;
  readonly state?: TurnActivityState;
  readonly summary?: TurnActivitySummary;
  readonly fg?: string;
  readonly width?: LayoutValue;
}

export class TurnActivityStripWidget extends Widget {
  inProgress = reactive(false);
  state = reactive<TurnActivityState>('idle');
  summary = reactive<TurnActivitySummary>({});
  fg = reactive<string | undefined>(undefined);

  constructor(props: TurnActivityStripProps = {}) {
    super(props.id);
    this.height = 1;
    if (props.inProgress !== undefined) this.inProgress = props.inProgress;
    if (props.state !== undefined) this.state = props.state;
    if (props.summary !== undefined) this.summary = props.summary;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.width !== undefined) this.width = props.width;
  }

  render(buffer: ClippedCellBuffer): void {
    const style: CellStyle = { ...DEFAULT_CELL_STYLE, fg: resolveColor(this.fg) };
    const line = formatTurnActivityLine({
      inProgress: this.inProgress,
      state: this.state,
      summary: this.summary,
    });
    buffer.drawText(0, 0, layout.truncate(line, buffer.cols), style);
  }
}

export function TurnActivityStrip(props: TurnActivityStripProps = {}): TurnActivityStripWidget {
  return new TurnActivityStripWidget(props);
}
