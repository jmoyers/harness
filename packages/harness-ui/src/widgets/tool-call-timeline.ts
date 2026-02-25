import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import { formatTurnActivityLine, type TurnActivityState } from './turn-activity-strip.ts';

const layout = new TextLayoutEngine();

export type ToolCallTimelineStatus = 'pending' | 'done' | 'error';

export interface ToolCallTimelineItem {
  readonly id: string;
  readonly name: string;
  readonly args?: string;
  readonly status: ToolCallTimelineStatus;
  readonly result?: string;
}

export interface ToolCallTimelineSummary {
  readonly total: number;
  readonly completed: number;
  readonly pending: number;
  readonly failed: number;
  readonly latestToolName?: string;
}

export type ToolCallTimelineLineKind = 'summary' | 'call' | 'result';

export interface ToolCallTimelineLine {
  readonly kind: ToolCallTimelineLineKind;
  readonly text: string;
  readonly status?: ToolCallTimelineStatus;
}

export interface BuildToolCallTimelineLinesInput {
  readonly calls: readonly ToolCallTimelineItem[];
  readonly width: number;
  readonly state?: TurnActivityState;
  readonly inProgress?: boolean;
  readonly nowMs?: number;
  readonly resultRenderer?: (result: string, width: number) => readonly ToolCallTimelineLine[];
}

export function summarizeToolCalls(
  calls: readonly ToolCallTimelineItem[],
): ToolCallTimelineSummary {
  const total = calls.length;
  const pending = calls.filter((call) => call.status === 'pending').length;
  const failed = calls.filter((call) => call.status === 'error').length;
  const completed = Math.max(0, total - pending);
  const latestToolName = calls[total - 1]?.name;
  return {
    total,
    completed,
    pending,
    failed,
    ...(latestToolName === undefined ? {} : { latestToolName }),
  };
}

export function toolStatusIcon(status: ToolCallTimelineStatus): string {
  if (status === 'done') return '✓';
  if (status === 'error') return '✕';
  return '⠿';
}

export function buildToolCallTimelineLines(
  input: BuildToolCallTimelineLinesInput,
): ToolCallTimelineLine[] {
  const safeWidth = Math.max(10, Math.floor(input.width));
  const summary = summarizeToolCalls(input.calls);
  const activitySummary = {
    totalTools: summary.total,
    completedTools: summary.completed,
    failedTools: summary.failed,
    ...(summary.latestToolName === undefined ? {} : { latestToolName: summary.latestToolName }),
  };
  const lines: ToolCallTimelineLine[] = [];
  lines.push({
    kind: 'summary',
    text: layout.truncate(
      formatTurnActivityLine({
        inProgress: input.inProgress ?? summary.pending > 0,
        ...(input.state === undefined ? {} : { state: input.state }),
        summary: activitySummary,
        ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
      }),
      safeWidth,
    ),
  });

  for (const call of input.calls) {
    const args = call.args?.trim();
    const prefix = `↳ ${toolStatusIcon(call.status)} ${call.name}`;
    const suffix = args === undefined || args.length === 0 ? '' : ` ${layout.truncate(args, 48)}`;
    lines.push({
      kind: 'call',
      status: call.status,
      text: layout.truncate(`${prefix}${suffix}`, safeWidth),
    });

    if (call.result !== undefined && call.result.trim().length > 0) {
      if (input.resultRenderer !== undefined) {
        lines.push(...input.resultRenderer(call.result, safeWidth));
      } else {
        for (const wrapped of layout.wrap(call.result, Math.max(1, safeWidth - 4))) {
          lines.push({ kind: 'result', text: `   ${wrapped}` });
        }
      }
    }
  }
  return lines;
}

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

export interface ToolCallTimelineProps {
  readonly id?: string;
  readonly calls?: readonly ToolCallTimelineItem[];
  readonly state?: TurnActivityState;
  readonly inProgress?: boolean;
  readonly fg?: string;
  readonly summaryFg?: string;
  readonly pendingFg?: string;
  readonly doneFg?: string;
  readonly errorFg?: string;
  readonly resultFg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class ToolCallTimelineWidget extends Widget {
  calls = reactive<readonly ToolCallTimelineItem[]>([]);
  state = reactive<TurnActivityState>('idle');
  inProgress = reactive(false);
  fg = reactive<string | undefined>(undefined);
  summaryFg = reactive<string | undefined>(undefined);
  pendingFg = reactive<string | undefined>(undefined);
  doneFg = reactive<string | undefined>(undefined);
  errorFg = reactive<string | undefined>(undefined);
  resultFg = reactive<string | undefined>(undefined);

  constructor(props: ToolCallTimelineProps = {}) {
    super(props.id);
    if (props.calls !== undefined) this.calls = props.calls;
    if (props.state !== undefined) this.state = props.state;
    if (props.inProgress !== undefined) this.inProgress = props.inProgress;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.summaryFg !== undefined) this.summaryFg = props.summaryFg;
    if (props.pendingFg !== undefined) this.pendingFg = props.pendingFg;
    if (props.doneFg !== undefined) this.doneFg = props.doneFg;
    if (props.errorFg !== undefined) this.errorFg = props.errorFg;
    if (props.resultFg !== undefined) this.resultFg = props.resultFg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  render(buffer: ClippedCellBuffer): void {
    const baseStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: resolveColor(this.fg) };
    const summaryStyle: CellStyle = { ...baseStyle, fg: resolveColor(this.summaryFg) };
    const pendingStyle: CellStyle = { ...baseStyle, fg: resolveColor(this.pendingFg) };
    const doneStyle: CellStyle = { ...baseStyle, fg: resolveColor(this.doneFg) };
    const errorStyle: CellStyle = { ...baseStyle, fg: resolveColor(this.errorFg) };
    const resultStyle: CellStyle = { ...baseStyle, fg: resolveColor(this.resultFg), dim: true };

    const lines = buildToolCallTimelineLines({
      calls: this.calls,
      width: buffer.cols,
      state: this.state,
      inProgress: this.inProgress,
    });
    const count = Math.min(buffer.rows, lines.length);
    for (let row = 0; row < count; row += 1) {
      const line = lines[row]!;
      const style =
        line.kind === 'summary'
          ? summaryStyle
          : line.kind === 'result'
            ? resultStyle
            : line.status === 'done'
              ? doneStyle
              : line.status === 'error'
                ? errorStyle
                : pendingStyle;
      buffer.drawText(0, row, layout.truncate(line.text, buffer.cols), style);
    }
  }
}

export function ToolCallTimeline(props: ToolCallTimelineProps = {}): ToolCallTimelineWidget {
  return new ToolCallTimelineWidget(props);
}
