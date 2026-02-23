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

export interface SelectOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export class ItemSelected extends Message {
  constructor(
    readonly index: number,
    readonly option: SelectOption,
  ) {
    super();
  }
}

export interface SelectProps {
  readonly id?: string;
  readonly options?: readonly SelectOption[];
  readonly selectedIndex?: number;
  readonly fg?: string;
  readonly selectedFg?: string;
  readonly selectedBg?: string;
  readonly descriptionFg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly wrapSelection?: boolean;
}

export class SelectWidget extends Widget {
  options = reactive<readonly SelectOption[]>([]);
  selectedIndex = reactive(0);
  fg = reactive<string | undefined>(undefined);
  selectedFg = reactive<string | undefined>(undefined);
  selectedBg = reactive<string | undefined>(undefined);
  descriptionFg = reactive<string | undefined>(undefined);
  wrapSelection = reactive(true);
  scrollOffset = reactive(0);

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'move-up', description: 'Previous item' },
    { key: 'k', action: 'move-up', description: 'Previous item' },
    { key: 'down', action: 'move-down', description: 'Next item' },
    { key: 'j', action: 'move-down', description: 'Next item' },
    { key: 'enter', action: 'select', description: 'Select item' },
    { key: 'home', action: 'move-first', description: 'First item' },
    { key: 'end', action: 'move-last', description: 'Last item' },
  ];

  constructor(props: SelectProps = {}) {
    super(props.id);
    this.focusable = true;
    if (props.options !== undefined) this.options = props.options;
    if (props.selectedIndex !== undefined) this.selectedIndex = props.selectedIndex;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.selectedFg !== undefined) this.selectedFg = props.selectedFg;
    if (props.selectedBg !== undefined) this.selectedBg = props.selectedBg;
    if (props.descriptionFg !== undefined) this.descriptionFg = props.descriptionFg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
    if (props.wrapSelection !== undefined) this.wrapSelection = props.wrapSelection;
  }

  validateSelectedIndex(index: number): number {
    if (this.options.length === 0) return 0;
    return Math.max(0, Math.min(this.options.length - 1, Math.floor(index)));
  }

  actionMoveUp(): void {
    if (this.options.length === 0) return;
    if (this.selectedIndex > 0) {
      this.selectedIndex = this.selectedIndex - 1;
    } else if (this.wrapSelection) {
      this.selectedIndex = this.options.length - 1;
    }
    this.ensureVisible();
  }

  actionMoveDown(): void {
    if (this.options.length === 0) return;
    if (this.selectedIndex < this.options.length - 1) {
      this.selectedIndex = this.selectedIndex + 1;
    } else if (this.wrapSelection) {
      this.selectedIndex = 0;
    }
    this.ensureVisible();
  }

  actionSelect(): void {
    if (this.options.length === 0) return;
    const option = this.options[this.selectedIndex];
    if (option !== undefined) {
      this.emit(new ItemSelected(this.selectedIndex, option));
    }
  }

  actionMoveFirst(): void {
    this.selectedIndex = 0;
    this.ensureVisible();
  }

  actionMoveLast(): void {
    if (this.options.length > 0) {
      this.selectedIndex = this.options.length - 1;
      this.ensureVisible();
    }
  }

  private ensureVisible(): void {
    const rect = this.computedRect;
    const visibleRows = rect.height > 0 ? rect.height : 10;
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + visibleRows) {
      this.scrollOffset = this.selectedIndex - visibleRows + 1;
    }
  }

  render(buffer: ClippedCellBuffer): void {
    const fgColor = resolveColor(this.fg);
    const selFgColor = resolveColor(this.selectedFg);
    const selBgColor = resolveColor(this.selectedBg);
    const descFgColor = resolveColor(this.descriptionFg);

    const normalStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor };
    const selectedStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: selFgColor.kind !== 'default' ? selFgColor : fgColor,
      bg: selBgColor,
      bold: true,
    };
    const descStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: descFgColor.kind !== 'default' ? descFgColor : { kind: 'indexed', index: 244 },
    };

    const visibleCount = buffer.rows;
    const startIndex = Math.max(0, this.scrollOffset);

    for (let row = 0; row < visibleCount; row += 1) {
      const optionIndex = startIndex + row;
      if (optionIndex >= this.options.length) break;

      const option = this.options[optionIndex]!;
      const isSelected = optionIndex === this.selectedIndex;
      const style = isSelected ? selectedStyle : normalStyle;
      const prefix = isSelected ? '▸ ' : '  ';
      const labelText = `${prefix}${option.label}`;
      const truncated = layout.truncate(labelText, buffer.cols);

      if (isSelected && selBgColor.kind !== 'default') {
        buffer.fillRow(row, selectedStyle);
      }

      buffer.drawText(0, row, truncated, style);

      if (option.description !== undefined && option.description.length > 0) {
        const labelWidth = layout.measure(truncated);
        const gap = 2;
        const descStart = labelWidth + gap;
        if (descStart < buffer.cols) {
          const descTruncated = layout.truncate(option.description, buffer.cols - descStart);
          const dStyle = isSelected ? { ...descStyle, bg: selBgColor } : descStyle;
          buffer.drawText(descStart, row, descTruncated, dStyle);
        }
      }
    }
  }
}

export function Select(props: SelectProps = {}): SelectWidget {
  return new SelectWidget(props);
}
