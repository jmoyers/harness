import { Widget } from '../../../../harness-ui/src/widget/widget.ts';
import { reactive } from '../../../../harness-ui/src/widget/reactive.ts';
import type { ClippedCellBuffer } from '../../../../harness-ui/src/core/cell-buffer.ts';
import type { Binding } from '../../../../harness-ui/src/widget/keybinding.ts';
import {
  buildMarkdownTranscriptLines,
  type MarkdownTranscriptLine,
} from '../../../../harness-ui/src/widgets/markdown-transcript.ts';
import {
  buildToolCallTimelineLines,
  type ToolCallTimelineItem,
  type ToolCallTimelineStatus,
} from '../../../../harness-ui/src/widgets/tool-call-timeline.ts';
import {
  messageCardRoleLabel,
  formatMessageCardMetaLine,
} from '../../../../harness-ui/src/widgets/message-card.ts';
import type { AgentMode, ChatMsg } from '../../contracts/types.ts';
import { layout, modeTitle, prettyModel } from '../../state/helpers.ts';
import { TH } from '../theme.ts';

type TranscriptSource = 'assistant' | 'tool';

type RenderLineKind =
  | 'spacer'
  | 'role'
  | 'user'
  | 'assistant'
  | 'heading'
  | 'quote'
  | 'code'
  | 'list'
  | 'diff-add'
  | 'diff-remove'
  | 'rule'
  | 'tool-summary'
  | 'tool'
  | 'tool-result'
  | 'table-border'
  | 'table-header'
  | 'table-row'
  | 'table-meta'
  | 'meta';

interface RenderLine {
  readonly kind: RenderLineKind;
  readonly text: string;
  readonly role?: 'user' | 'assistant';
  readonly status?: ToolCallTimelineStatus;
  readonly source?: TranscriptSource;
}

function mapTranscriptLine(line: MarkdownTranscriptLine, source: TranscriptSource): RenderLine {
  if (line.kind === 'table-border') return { kind: 'table-border', text: line.text, source };
  if (line.kind === 'table-header') return { kind: 'table-header', text: line.text, source };
  if (line.kind === 'table-row') return { kind: 'table-row', text: line.text, source };
  if (line.kind === 'table-meta') return { kind: 'table-meta', text: line.text, source };
  if (line.kind === 'heading' && source === 'assistant')
    return { kind: 'heading', text: line.text, source };
  if (line.kind === 'blockquote' && source === 'assistant')
    return { kind: 'quote', text: line.text, source };
  if (line.kind === 'code-line' && source === 'assistant')
    return { kind: 'code', text: line.text, source };
  if (line.kind === 'list-item' && source === 'assistant')
    return { kind: 'list', text: line.text, source };
  if (line.kind === 'horizontal-rule') return { kind: 'rule', text: line.text, source };
  if (line.kind === 'diff-add') return { kind: 'diff-add', text: line.text, source };
  if (line.kind === 'diff-remove') return { kind: 'diff-remove', text: line.text, source };
  return { kind: source === 'assistant' ? 'assistant' : 'tool-result', text: line.text, source };
}

export class ConversationView extends Widget {
  messages = reactive<ChatMsg[]>([]);
  scrollTop = reactive(0);
  mode = reactive<AgentMode>('build');
  model = reactive('anthropic/claude-sonnet-4-20250514');

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'scroll-up', description: 'Scroll up' },
    { key: 'down', action: 'scroll-down', description: 'Scroll down' },
    { key: 'pageup', action: 'page-up', description: 'Page up' },
    { key: 'pagedown', action: 'page-down', description: 'Page down' },
  ];

  constructor() {
    super('conv');
    this.focusable = true;
    this.manualChildRendering = true;
  }

  actionScrollUp(): void {
    this.scrollTop = Math.max(0, this.scrollTop - 1);
  }

  actionScrollDown(): void {
    this.scrollTop += 1;
  }

  actionPageUp(): void {
    this.scrollTop = Math.max(
      0,
      this.scrollTop - Math.max(1, (this.computedRect.height || 10) - 2),
    );
  }

  actionPageDown(): void {
    this.scrollTop += Math.max(1, (this.computedRect.height || 10) - 2);
  }

  scrollToBottom(): void {
    const total = this.flatten(Math.max(24, this.computedRect.width || 80)).length;
    this.scrollTop = Math.max(0, total - (this.computedRect.height || 10));
  }

  private flatten(width: number): RenderLine[] {
    const lines: RenderLine[] = [];
    const safe = Math.max(12, width);

    for (let index = 0; index < this.messages.length; index += 1) {
      const message = this.messages[index]!;
      if (index > 0) lines.push({ kind: 'spacer', text: '' });

      if (message.role === 'user') {
        lines.push({ kind: 'role', role: 'user', text: messageCardRoleLabel('user') });
        const wrapped = layout.wrap(message.text, safe - 5);
        for (const line of wrapped.length > 0 ? wrapped : ['']) {
          lines.push({ kind: 'user', text: line });
        }
        continue;
      }

      lines.push({ kind: 'role', role: 'assistant', text: messageCardRoleLabel('assistant') });
      const messageWidth = Math.max(16, safe - 6);
      const transcriptLines = buildMarkdownTranscriptLines({
        text: message.text,
        width: messageWidth,
        tableMaxRows: 8,
      });
      lines.push(...transcriptLines.map((line) => mapTranscriptLine(line, 'assistant')));

      const timelineItems: ToolCallTimelineItem[] = message.tools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        args: tool.args,
        status: tool.status,
      }));
      if (message.pending === true || timelineItems.length > 0) {
        const timelineLines = buildToolCallTimelineLines({
          calls: timelineItems,
          width: Math.max(16, safe - 6),
          ...(message.state === undefined ? {} : { state: message.state }),
          ...(message.pending === undefined ? {} : { inProgress: message.pending }),
        });
        if (timelineLines.length > 0) {
          lines.push({ kind: 'tool-summary', text: timelineLines[0]!.text });
          for (let timelineIndex = 1; timelineIndex < timelineLines.length; timelineIndex += 1) {
            const timelineLine = timelineLines[timelineIndex]!;
            if (timelineLine.kind === 'call') {
              lines.push({
                kind: 'tool',
                text: timelineLine.text,
                ...(timelineLine.status === undefined ? {} : { status: timelineLine.status }),
              });
            }
          }
        }
      }

      for (const tool of message.tools) {
        if (tool.result === undefined || tool.result.length === 0) continue;
        const toolResultLines = buildMarkdownTranscriptLines({
          text: tool.result,
          width: Math.max(16, safe - 10),
          tableMaxRows: 8,
        });
        lines.push(...toolResultLines.map((line) => mapTranscriptLine(line, 'tool')));
      }

      lines.push({
        kind: 'meta',
        text: formatMessageCardMetaLine({
          modeLabel: modeTitle(this.mode),
          modelLabel: prettyModel(this.model),
          ...(message.duration === undefined ? {} : { durationMs: message.duration }),
          ...(message.pending === undefined ? {} : { inProgress: message.pending }),
        }),
      });
    }

    return lines;
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) {
      buf.fillRow(row, TH.bg);
    }

    const lines = this.flatten(buf.cols);
    const maxScroll = Math.max(0, lines.length - buf.rows);
    if (this.scrollTop > maxScroll) this.scrollTop = maxScroll;
    const topPad = lines.length < buf.rows ? buf.rows - lines.length : 0;

    for (let row = topPad; row < buf.rows; row += 1) {
      const lineIndex = this.scrollTop + (row - topPad);
      if (lineIndex >= lines.length) break;
      const line = lines[lineIndex]!;

      if (line.kind === 'role') {
        if (line.role === 'user') {
          buf.drawText(
            1,
            row,
            line.text,
            this.mode === 'build' ? TH.userPipeBuild : TH.userPipePlan,
          );
        } else {
          buf.drawText(3, row, line.text, TH.assistantMeta);
        }
        continue;
      }
      if (line.kind === 'user') {
        buf.fillRow(row, TH.userBg);
        buf.drawText(0, row, '┃', this.mode === 'build' ? TH.userPipeBuild : TH.userPipePlan);
        buf.drawText(2, row, line.text, TH.userBg);
        continue;
      }

      const indent = line.source === 'tool' ? 7 : 3;
      if (line.kind === 'assistant') {
        buf.drawText(indent, row, line.text, TH.assistantText);
        continue;
      }
      if (line.kind === 'heading') {
        buf.drawText(indent, row, line.text, TH.assistantHeading);
        continue;
      }
      if (line.kind === 'quote') {
        buf.drawText(indent, row, line.text, TH.assistantQuote);
        continue;
      }
      if (line.kind === 'code') {
        buf.fillRow(row, TH.codeBg);
        buf.drawText(indent, row, line.text, TH.codeText);
        continue;
      }
      if (line.kind === 'list') {
        buf.drawText(indent, row, line.text, TH.assistantText);
        continue;
      }
      if (line.kind === 'diff-add') {
        buf.drawText(indent, row, line.text, TH.diffAdd);
        continue;
      }
      if (line.kind === 'diff-remove') {
        buf.drawText(indent, row, line.text, TH.diffRemove);
        continue;
      }
      if (line.kind === 'rule') {
        buf.drawText(indent, row, line.text, TH.borderSubtle);
        continue;
      }
      if (line.kind === 'tool-summary') {
        buf.drawText(3, row, line.text, TH.assistantMeta);
        continue;
      }
      if (line.kind === 'tool') {
        const style =
          line.status === 'done'
            ? TH.toolDone
            : line.status === 'error'
              ? TH.toolError
              : TH.toolPending;
        buf.drawText(3, row, line.text, style);
        continue;
      }
      if (line.kind === 'tool-result') {
        buf.drawText(9, row, line.text, TH.assistantMeta);
        continue;
      }
      if (line.kind === 'table-border') {
        buf.drawText(line.source === 'tool' ? 7 : 5, row, line.text, TH.borderSubtle);
        continue;
      }
      if (line.kind === 'table-header') {
        buf.drawText(line.source === 'tool' ? 7 : 5, row, line.text, TH.assistantHeading);
        continue;
      }
      if (line.kind === 'table-row') {
        buf.drawText(line.source === 'tool' ? 7 : 5, row, line.text, TH.assistantText);
        continue;
      }
      if (line.kind === 'table-meta') {
        buf.drawText(line.source === 'tool' ? 7 : 5, row, line.text, TH.assistantMeta);
        continue;
      }
      if (line.kind === 'meta') {
        buf.drawText(3, row, line.text, TH.assistantMeta);
      }
    }

    if (lines.length > buf.rows) {
      const trackHeight = buf.rows;
      const thumbHeight = Math.max(1, Math.round((buf.rows / lines.length) * trackHeight));
      const thumbY = Math.round(
        (this.scrollTop / Math.max(1, maxScroll)) * (trackHeight - thumbHeight),
      );
      for (let row = 0; row < trackHeight; row += 1) {
        const active = row >= thumbY && row < thumbY + thumbHeight;
        buf.drawText(buf.cols - 1, row, active ? '┃' : '│', active ? TH.border : TH.borderSubtle);
      }
    }
  }
}
