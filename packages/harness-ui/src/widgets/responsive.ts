import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

export interface BreakpointRule {
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly action: 'show' | 'hide' | 'overlay';
}

export interface ResponsivePanelProps {
  readonly id?: string;
  readonly breakpoint?: number;
  readonly mode?: 'auto' | 'show' | 'hide';
  readonly side?: 'left' | 'right';
  readonly panelWidth?: number;
  readonly overlayBg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class ResponsivePanelWidget extends Widget {
  breakpoint = reactive(120);
  mode = reactive<'auto' | 'show' | 'hide'>('auto');
  side = reactive<'left' | 'right'>('right');
  panelWidth = reactive(42);
  overlayBg = reactive<string | undefined>(undefined);
  viewportWidth = reactive(80);

  constructor(props: ResponsivePanelProps = {}) {
    super(props.id);
    if (props.breakpoint !== undefined) this.breakpoint = props.breakpoint;
    if (props.mode !== undefined) this.mode = props.mode;
    if (props.side !== undefined) this.side = props.side;
    if (props.panelWidth !== undefined) this.panelWidth = props.panelWidth;
    if (props.overlayBg !== undefined) this.overlayBg = props.overlayBg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  get isWide(): boolean {
    return this.viewportWidth >= this.breakpoint;
  }

  get shouldShow(): boolean {
    if (this.mode === 'show') return true;
    if (this.mode === 'hide') return false;
    return this.isWide;
  }

  get isOverlay(): boolean {
    return this.shouldShow && !this.isWide;
  }

  updateViewport(width: number): void {
    this.viewportWidth = width;
    this.markDirty();
  }

  toggle(): void {
    if (this.mode === 'auto') {
      this.mode = this.isWide ? 'hide' : 'show';
    } else if (this.mode === 'show') {
      this.mode = 'hide';
    } else {
      this.mode = this.isWide ? 'auto' : 'show';
    }
  }

  render(buffer: ClippedCellBuffer): void {
    if (!this.shouldShow) return;

    if (this.isOverlay) {
      const bgColor = resolveColor(this.overlayBg);
      if (bgColor.kind !== 'default') {
        const style: CellStyle = { ...DEFAULT_CELL_STYLE, bg: bgColor };
        for (let r = 0; r < buffer.rows; r += 1) {
          buffer.fillRow(r, style);
        }
      }
    }
  }
}

export function ResponsivePanel(props: ResponsivePanelProps = {}): ResponsivePanelWidget {
  return new ResponsivePanelWidget(props);
}
