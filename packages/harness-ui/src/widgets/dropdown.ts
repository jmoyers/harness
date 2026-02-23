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

export interface DropdownOption {
  readonly label: string;
  readonly value: string;
}

export class DropdownChanged extends Message {
  constructor(
    readonly value: string,
    readonly label: string,
  ) {
    super();
  }
}

export interface DropdownProps {
  readonly id?: string;
  readonly options?: readonly DropdownOption[];
  readonly selectedValue?: string | null;
  readonly placeholder?: string;
  readonly fg?: string;
  readonly bg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
}

export class DropdownWidget extends Widget {
  options = reactive<readonly DropdownOption[]>([]);
  selectedValue = reactive<string | null>(null);
  placeholder = reactive('Select...');
  fg = reactive<string | undefined>(undefined);
  bg = reactive<string | undefined>(undefined);
  open = reactive(false);
  highlightIndex = reactive(0);

  static BINDINGS: Binding[] = [
    { key: 'enter', action: 'toggle', description: 'Open/select' },
    { key: ' ', action: 'toggle', description: 'Open/select' },
    { key: 'escape', action: 'close', description: 'Close' },
    { key: 'up', action: 'highlight-up', description: 'Previous' },
    { key: 'down', action: 'highlight-down', description: 'Next' },
  ];

  constructor(props: DropdownProps = {}) {
    super(props.id);
    this.focusable = true;
    this.height = props.height ?? 1;
    if (props.options !== undefined) this.options = props.options;
    if (props.selectedValue !== undefined) this.selectedValue = props.selectedValue;
    if (props.placeholder !== undefined) this.placeholder = props.placeholder;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.bg !== undefined) this.bg = props.bg;
    if (props.width !== undefined) this.width = props.width;
  }

  get selectedLabel(): string | null {
    if (this.selectedValue === null) return null;
    const opt = this.options.find((o) => o.value === this.selectedValue);
    return opt?.label ?? null;
  }

  actionToggle(): void {
    if (this.open) {
      this.selectHighlighted();
    } else {
      this.open = true;
      const idx = this.options.findIndex((o) => o.value === this.selectedValue);
      this.highlightIndex = idx >= 0 ? idx : 0;
    }
  }

  actionClose(): void {
    this.open = false;
  }

  actionHighlightUp(): void {
    if (!this.open) return;
    this.highlightIndex =
      this.highlightIndex > 0 ? this.highlightIndex - 1 : this.options.length - 1;
  }

  actionHighlightDown(): void {
    if (!this.open) return;
    this.highlightIndex =
      this.highlightIndex < this.options.length - 1 ? this.highlightIndex + 1 : 0;
  }

  private selectHighlighted(): void {
    if (this.highlightIndex >= 0 && this.highlightIndex < this.options.length) {
      const opt = this.options[this.highlightIndex]!;
      this.selectedValue = opt.value;
      this.open = false;
      this.emit(new DropdownChanged(opt.value, opt.label));
    }
  }

  render(buffer: ClippedCellBuffer): void {
    const fgColor = resolveColor(this.fg);
    const bgColor = resolveColor(this.bg);
    const baseStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor, bg: bgColor };

    const displayLabel = this.selectedLabel ?? this.placeholder;
    const arrow = this.open ? ' ▴' : ' ▾';
    const text = `${displayLabel}${arrow}`;
    const truncated = layout.truncate(text, buffer.cols);
    buffer.drawText(0, 0, truncated, baseStyle);
  }
}

export function Dropdown(props: DropdownProps = {}): DropdownWidget {
  return new DropdownWidget(props);
}
