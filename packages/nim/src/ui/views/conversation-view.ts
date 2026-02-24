import { Widget } from '../../../../harness-ui/src/widget/widget.ts';
import { reactive } from '../../../../harness-ui/src/widget/reactive.ts';
import type { ClippedCellBuffer } from '../../../../harness-ui/src/core/cell-buffer.ts';
import type { Binding } from '../../../../harness-ui/src/widget/keybinding.ts';
import type { AgentMode, ChatMsg } from '../../contracts/types.ts';
import { layout, modeTitle, prettyModel } from '../../state/helpers.ts';
import { TH } from '../theme.ts';

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

  private flatten(width: number): string[] {
    const lines: string[] = [];
    const safe = Math.max(12, width);

    for (let index = 0; index < this.messages.length; index += 1) {
      const message = this.messages[index]!;
      if (index > 0) {
        lines.push('E');
      }

      if (message.role === 'user') {
        for (const wrapped of layout.wrap(message.text, safe - 5)) {
          lines.push(`U${wrapped}`);
        }
        continue;
      }

      let inCode = false;
      for (const rawLine of message.text.split('\n')) {
        const line = rawLine.trimEnd();
        if (line.startsWith('```')) {
          inCode = !inCode;
          continue;
        }
        const wrapped = layout.wrap(line, safe - (inCode ? 8 : 6));
        for (const item of wrapped.length > 0 ? wrapped : ['']) {
          if (inCode) {
            lines.push(`C${item}`);
          } else if (item.startsWith('# ')) {
            lines.push(`H${item.slice(2)}`);
          } else if (item.startsWith('> ')) {
            lines.push(`Q${item.slice(2)}`);
          } else if (item.startsWith('+') && item.length > 1) {
            lines.push(`P${item}`);
          } else if (item.startsWith('-') && item.length > 1) {
            lines.push(`N${item}`);
          } else {
            lines.push(`A${item}`);
          }
        }
      }

      for (const tool of message.tools) {
        const icon = tool.status === 'done' ? '✓' : tool.status === 'error' ? '✕' : '•';
        lines.push(`T${icon}|${tool.name}|${tool.args}`);
        if (tool.result !== undefined && tool.result.length > 0) {
          for (const wrapped of layout.wrap(tool.result, safe - 10)) {
            lines.push(`R${wrapped}`);
          }
        }
      }

      const time = message.duration === undefined ? '' : ` · ${String(message.duration)}ms`;
      lines.push(`I▣ ${modeTitle(this.mode)} · ${prettyModel(this.model)}${time}`);
    }

    return lines;
  }

  render(buf: ClippedCellBuffer): void {
    for (let row = 0; row < buf.rows; row += 1) {
      buf.fillRow(row, TH.bg);
    }

    const lines = this.flatten(buf.cols);
    const maxScroll = Math.max(0, lines.length - buf.rows);
    if (this.scrollTop > maxScroll) {
      this.scrollTop = maxScroll;
    }
    const topPad = lines.length < buf.rows ? buf.rows - lines.length : 0;

    for (let row = topPad; row < buf.rows; row += 1) {
      const lineIndex = this.scrollTop + (row - topPad);
      if (lineIndex >= lines.length) {
        break;
      }
      const line = lines[lineIndex]!;
      const tag = line[0]!;
      const content = line.slice(1);

      if (tag === 'U') {
        buf.fillRow(row, TH.userBg);
        buf.drawText(0, row, '┃', this.mode === 'build' ? TH.userPipeBuild : TH.userPipePlan);
        buf.drawText(2, row, content, TH.userBg);
        continue;
      }
      if (tag === 'A') {
        buf.drawText(3, row, content, TH.assistantText);
        continue;
      }
      if (tag === 'H') {
        buf.drawText(3, row, content, TH.assistantHeading);
        continue;
      }
      if (tag === 'Q') {
        buf.drawText(3, row, '▌', TH.assistantQuote);
        buf.drawText(5, row, content, TH.assistantQuote);
        continue;
      }
      if (tag === 'C') {
        buf.fillRow(row, TH.codeBg);
        buf.drawText(3, row, content, TH.codeText);
        continue;
      }
      if (tag === 'P') {
        buf.drawText(3, row, content, TH.diffAdd);
        continue;
      }
      if (tag === 'N') {
        buf.drawText(3, row, content, TH.diffRemove);
        continue;
      }
      if (tag === 'T') {
        const [icon, name, args] = content.split('|');
        const iconStyle = icon === '✓' ? TH.toolDone : icon === '✕' ? TH.toolError : TH.toolPending;
        buf.drawText(3, row, icon!, iconStyle);
        buf.drawText(5, row, name!, TH.toolName);
        if (args !== undefined && args.length > 0) {
          buf.drawText(6 + name!.length, row, args, TH.assistantMeta);
        }
        continue;
      }
      if (tag === 'R') {
        buf.drawText(5, row, content, TH.assistantMeta);
        continue;
      }
      if (tag === 'I') {
        buf.drawText(3, row, content, TH.assistantMeta);
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
