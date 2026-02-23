import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { Message } from '../widget/message.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { Binding } from '../widget/keybinding.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export class CollapsibleToggled extends Message {
  constructor(readonly expanded: boolean) {
    super();
  }
}

export interface CollapsibleProps {
  readonly id?: string;
  readonly header: string;
  readonly expanded?: boolean;
  readonly maxCollapsedLines?: number;
  readonly headerFg?: string;
  readonly headerBg?: string;
  readonly bodyFg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class CollapsibleWidget extends Widget {
  header = reactive('');
  expanded = reactive(false);
  maxCollapsedLines = reactive(3);
  headerFg = reactive<string | undefined>(undefined);
  headerBg = reactive<string | undefined>(undefined);
  bodyFg = reactive<string | undefined>(undefined);
  bodyLines = reactive<readonly string[]>([]);

  static BINDINGS: Binding[] = [{ key: 'enter', action: 'toggle', description: 'Toggle' }];

  constructor(props: CollapsibleProps) {
    super(props.id);
    this.focusable = true;
    if (props.header !== undefined) this.header = props.header;
    if (props.expanded !== undefined) this.expanded = props.expanded;
    if (props.maxCollapsedLines !== undefined) this.maxCollapsedLines = props.maxCollapsedLines;
    if (props.headerFg !== undefined) this.headerFg = props.headerFg;
    if (props.headerBg !== undefined) this.headerBg = props.headerBg;
    if (props.bodyFg !== undefined) this.bodyFg = props.bodyFg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  setContent(lines: readonly string[]): void {
    this.bodyLines = lines;
    this.markDirty();
  }

  actionToggle(): void {
    this.expanded = !this.expanded;
    this.emit(new CollapsibleToggled(this.expanded));
  }

  render(buffer: ClippedCellBuffer): void {
    const hdrFg = resolveColor(this.headerFg);
    const hdrBg = resolveColor(this.headerBg);
    const bFg = resolveColor(this.bodyFg);

    const headerStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: hdrFg.kind !== 'default' ? hdrFg : { kind: 'indexed', index: 255 },
      bg: hdrBg,
      bold: true,
    };
    const bodyStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: bFg.kind !== 'default' ? bFg : { kind: 'indexed', index: 252 },
    };
    const moreStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: { kind: 'indexed', index: 244 },
    };

    const toggle = this.expanded ? '▾' : '▸';
    const headerText = `${toggle} ${this.header}`;
    const truncatedHeader = layout.truncate(headerText, buffer.cols);
    if (hdrBg.kind !== 'default') buffer.fillRow(0, headerStyle);
    buffer.drawText(0, 0, truncatedHeader, headerStyle);

    if (!this.expanded) {
      const visibleLines = Math.min(this.maxCollapsedLines, this.bodyLines.length, buffer.rows - 1);
      for (let i = 0; i < visibleLines; i += 1) {
        const line = this.bodyLines[i] ?? '';
        buffer.drawText(2, 1 + i, layout.truncate(line, buffer.cols - 2), bodyStyle);
      }
      if (this.bodyLines.length > this.maxCollapsedLines && visibleLines + 1 < buffer.rows) {
        const remaining = this.bodyLines.length - this.maxCollapsedLines;
        buffer.drawText(2, 1 + visibleLines, `… ${remaining} more lines`, moreStyle);
      }
      return;
    }

    for (let i = 0; i < this.bodyLines.length && 1 + i < buffer.rows; i += 1) {
      const line = this.bodyLines[i] ?? '';
      buffer.drawText(2, 1 + i, layout.truncate(line, buffer.cols - 2), bodyStyle);
    }
  }
}

export function Collapsible(props: CollapsibleProps): CollapsibleWidget {
  return new CollapsibleWidget(props);
}
