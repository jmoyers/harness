import { Widget } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { Message } from '../widget/message.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

export class DividerMoved extends Message {
  constructor(readonly position: number) {
    super();
  }
}

export type DividerOrientation = 'vertical' | 'horizontal';

export interface PaneDividerProps {
  readonly id?: string;
  readonly orientation?: DividerOrientation;
  readonly fg?: string;
  readonly draggable?: boolean;
}

export class PaneDividerWidget extends Widget {
  orientation = reactive<DividerOrientation>('vertical');
  fg = reactive<string | undefined>(undefined);
  draggable = reactive(true);
  dragging = reactive(false);

  constructor(props: PaneDividerProps = {}) {
    super(props.id);
    if (props.orientation !== undefined) this.orientation = props.orientation;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.draggable !== undefined) this.draggable = props.draggable;
    if (this.orientation === 'vertical') {
      this.width = 1;
    } else {
      this.height = 1;
    }
  }

  startDrag(): void {
    if (!this.draggable) return;
    this.dragging = true;
  }

  endDrag(position: number): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.emit(new DividerMoved(position));
  }

  cancelDrag(): void {
    this.dragging = false;
  }

  render(buffer: ClippedCellBuffer): void {
    const fgColor = resolveColor(this.fg);
    const style: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: fgColor.kind !== 'default' ? fgColor : { kind: 'indexed', index: 240 },
    };

    if (this.orientation === 'vertical') {
      for (let row = 0; row < buffer.rows; row += 1) {
        buffer.drawText(0, row, '│', style);
      }
    } else {
      const hBar = '─'.repeat(buffer.cols);
      buffer.drawText(0, 0, hBar, style);
    }
  }
}

export function PaneDivider(props: PaneDividerProps = {}): PaneDividerWidget {
  return new PaneDividerWidget(props);
}
