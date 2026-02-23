import { Widget } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOTS_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
const LINE_FRAMES = ['-', '\\', '|', '/'];

export type SpinnerStyle = 'braille' | 'dots' | 'line';

export interface SpinnerProps {
  readonly id?: string;
  readonly label?: string;
  readonly style?: SpinnerStyle;
  readonly fg?: string;
  readonly labelFg?: string;
  readonly intervalMs?: number;
}

function framesForStyle(style: SpinnerStyle): readonly string[] {
  if (style === 'dots') return DOTS_FRAMES;
  if (style === 'line') return LINE_FRAMES;
  return BRAILLE_FRAMES;
}

export class SpinnerWidget extends Widget {
  label = reactive('');
  spinnerStyle = reactive<SpinnerStyle>('braille');
  fg = reactive<string | undefined>(undefined);
  labelFg = reactive<string | undefined>(undefined);
  frameIndex = reactive(0);
  intervalMs = reactive(80);
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(props: SpinnerProps = {}) {
    super(props.id);
    this.height = 1;
    if (props.label !== undefined) this.label = props.label;
    if (props.style !== undefined) this.spinnerStyle = props.style;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.labelFg !== undefined) this.labelFg = props.labelFg;
    if (props.intervalMs !== undefined) this.intervalMs = props.intervalMs;
  }

  start(): void {
    this.stop();
    this._timer = setInterval(() => {
      const frames = framesForStyle(this.spinnerStyle);
      this.frameIndex = (this.frameIndex + 1) % frames.length;
    }, this.intervalMs);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  tick(): void {
    const frames = framesForStyle(this.spinnerStyle);
    this.frameIndex = (this.frameIndex + 1) % frames.length;
  }

  override onMount(): void {
    this.start();
  }

  override onUnmount(): void {
    this.stop();
  }

  render(buffer: ClippedCellBuffer): void {
    const frames = framesForStyle(this.spinnerStyle);
    const frame = frames[this.frameIndex % frames.length]!;
    const fgColor = resolveColor(this.fg);
    const labelFgColor = resolveColor(this.labelFg);

    const spinnerCellStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: fgColor.kind !== 'default' ? fgColor : { kind: 'indexed', index: 39 },
      bold: true,
    };
    const labelStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: labelFgColor.kind !== 'default' ? labelFgColor : fgColor,
    };

    buffer.drawText(0, 0, frame, spinnerCellStyle);
    if (this.label.length > 0) {
      buffer.drawText(2, 0, this.label, labelStyle);
    }
  }
}

export function Spinner(props: SpinnerProps = {}): SpinnerWidget {
  return new SpinnerWidget(props);
}
