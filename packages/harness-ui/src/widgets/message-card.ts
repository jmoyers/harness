import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

const layout = new TextLayoutEngine();

export type MessageCardRole = 'user' | 'assistant' | 'system';

export function messageCardRoleLabel(role: MessageCardRole): string {
  if (role === 'user') return 'you';
  if (role === 'assistant') return 'nim';
  return 'system';
}

export interface MessageCardMetaInput {
  readonly modeLabel: string;
  readonly modelLabel: string;
  readonly durationMs?: number;
  readonly inProgress?: boolean;
}

export function formatMessageCardMetaLine(input: MessageCardMetaInput): string {
  const duration = input.durationMs === undefined ? '' : ` · ${String(input.durationMs)}ms`;
  const progress = input.inProgress === true ? ' · in progress' : '';
  return `▣ ${input.modeLabel} · ${input.modelLabel}${duration}${progress}`;
}

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

export interface MessageCardProps {
  readonly id?: string;
  readonly role?: MessageCardRole;
  readonly body?: readonly string[];
  readonly meta?: string;
  readonly roleFg?: string;
  readonly bodyFg?: string;
  readonly metaFg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class MessageCardWidget extends Widget {
  role = reactive<MessageCardRole>('assistant');
  body = reactive<readonly string[]>([]);
  meta = reactive('');
  roleFg = reactive<string | undefined>(undefined);
  bodyFg = reactive<string | undefined>(undefined);
  metaFg = reactive<string | undefined>(undefined);

  constructor(props: MessageCardProps = {}) {
    super(props.id);
    if (props.role !== undefined) this.role = props.role;
    if (props.body !== undefined) this.body = props.body;
    if (props.meta !== undefined) this.meta = props.meta;
    if (props.roleFg !== undefined) this.roleFg = props.roleFg;
    if (props.bodyFg !== undefined) this.bodyFg = props.bodyFg;
    if (props.metaFg !== undefined) this.metaFg = props.metaFg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  render(buffer: ClippedCellBuffer): void {
    const roleStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: resolveColor(this.roleFg),
      bold: true,
    };
    const bodyStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: resolveColor(this.bodyFg) };
    const metaStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: resolveColor(this.metaFg),
      dim: true,
    };

    let row = 0;
    buffer.drawText(
      0,
      row,
      layout.truncate(messageCardRoleLabel(this.role), buffer.cols),
      roleStyle,
    );
    row += 1;
    for (const line of this.body) {
      if (row >= buffer.rows) break;
      buffer.drawText(0, row, layout.truncate(line, buffer.cols), bodyStyle);
      row += 1;
    }
    if (row < buffer.rows && this.meta.length > 0) {
      buffer.drawText(0, row, layout.truncate(this.meta, buffer.cols), metaStyle);
    }
  }
}

export function MessageCard(props: MessageCardProps = {}): MessageCardWidget {
  return new MessageCardWidget(props);
}
