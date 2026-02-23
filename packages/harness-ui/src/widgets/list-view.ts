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

export interface ListItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly badge?: string;
  readonly badgeStyle?: 'normal' | 'success' | 'warning' | 'error' | 'muted';
  readonly description?: string;
  readonly data?: unknown;
}

export class ListItemSelected extends Message {
  constructor(
    readonly index: number,
    readonly item: ListItem,
  ) {
    super();
  }
}

export interface ListViewProps {
  readonly id?: string;
  readonly items?: readonly ListItem[];
  readonly selectedId?: string | null;
  readonly fg?: string;
  readonly selectedFg?: string;
  readonly selectedBg?: string;
  readonly activeFg?: string;
  readonly activeIndicator?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly wrapSelection?: boolean;
}

export class ListViewWidget extends Widget {
  items = reactive<readonly ListItem[]>([]);
  selectedId = reactive<string | null>(null);
  fg = reactive<string | undefined>(undefined);
  selectedFg = reactive<string | undefined>(undefined);
  selectedBg = reactive<string | undefined>(undefined);
  activeFg = reactive<string | undefined>(undefined);
  activeIndicator = reactive('▸');
  wrapSelection = reactive(true);
  scrollOffset = reactive(0);

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'move-up', description: 'Previous' },
    { key: 'k', action: 'move-up', description: 'Previous' },
    { key: 'down', action: 'move-down', description: 'Next' },
    { key: 'j', action: 'move-down', description: 'Next' },
    { key: 'enter', action: 'select', description: 'Select' },
    { key: 'home', action: 'move-first', description: 'First' },
    { key: 'end', action: 'move-last', description: 'Last' },
  ];

  constructor(props: ListViewProps = {}) {
    super(props.id);
    this.focusable = true;
    if (props.items !== undefined) this.items = props.items;
    if (props.selectedId !== undefined) this.selectedId = props.selectedId;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.selectedFg !== undefined) this.selectedFg = props.selectedFg;
    if (props.selectedBg !== undefined) this.selectedBg = props.selectedBg;
    if (props.activeFg !== undefined) this.activeFg = props.activeFg;
    if (props.activeIndicator !== undefined) this.activeIndicator = props.activeIndicator;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
    if (props.wrapSelection !== undefined) this.wrapSelection = props.wrapSelection;
  }

  private findSelectedIndex(): number {
    if (this.selectedId === null) return -1;
    return this.items.findIndex((i) => i.id === this.selectedId);
  }

  actionMoveUp(): void {
    if (this.items.length === 0) return;
    const idx = this.findSelectedIndex();
    if (idx > 0) this.selectedId = this.items[idx - 1]!.id;
    else if (this.wrapSelection) this.selectedId = this.items[this.items.length - 1]!.id;
    this.ensureVisible();
  }

  actionMoveDown(): void {
    if (this.items.length === 0) return;
    const idx = this.findSelectedIndex();
    if (idx < 0) this.selectedId = this.items[0]!.id;
    else if (idx < this.items.length - 1) this.selectedId = this.items[idx + 1]!.id;
    else if (this.wrapSelection) this.selectedId = this.items[0]!.id;
    this.ensureVisible();
  }

  actionSelect(): void {
    const idx = this.findSelectedIndex();
    if (idx < 0) return;
    this.emit(new ListItemSelected(idx, this.items[idx]!));
  }

  actionMoveFirst(): void {
    if (this.items.length > 0) {
      this.selectedId = this.items[0]!.id;
      this.ensureVisible();
    }
  }

  actionMoveLast(): void {
    if (this.items.length > 0) {
      this.selectedId = this.items[this.items.length - 1]!.id;
      this.ensureVisible();
    }
  }

  private ensureVisible(): void {
    const idx = this.findSelectedIndex();
    if (idx < 0) return;
    const viewH = this.computedRect.height > 0 ? this.computedRect.height : 10;
    if (idx < this.scrollOffset) this.scrollOffset = idx;
    else if (idx >= this.scrollOffset + viewH) this.scrollOffset = idx - viewH + 1;
  }

  render(buffer: ClippedCellBuffer): void {
    const fgColor = resolveColor(this.fg);
    const selFg = resolveColor(this.selectedFg);
    const selBg = resolveColor(this.selectedBg);

    const normalStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: fgColor };
    const selectedStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: selFg.kind !== 'default' ? selFg : fgColor,
      bg: selBg,
      bold: true,
    };
    const descStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: { kind: 'indexed', index: 244 },
    };

    for (let viewRow = 0; viewRow < buffer.rows; viewRow += 1) {
      const itemIdx = this.scrollOffset + viewRow;
      if (itemIdx >= this.items.length) break;
      const item = this.items[itemIdx]!;
      const isSelected = item.id === this.selectedId;
      const style = isSelected ? selectedStyle : normalStyle;

      if (isSelected && selBg.kind !== 'default') {
        buffer.fillRow(viewRow, selectedStyle);
      }

      const indicator = isSelected ? `${this.activeIndicator} ` : '  ';
      const icon = item.icon !== undefined ? `${item.icon} ` : '';
      const badge = item.badge !== undefined ? ` ${item.badge}` : '';
      const text = `${indicator}${icon}${item.label}${badge}`;
      const truncated = layout.truncate(text, buffer.cols);
      buffer.drawText(0, viewRow, truncated, style);

      if (item.description !== undefined && item.description.length > 0) {
        const labelWidth = layout.measure(truncated);
        const gap = 2;
        const descStart = labelWidth + gap;
        if (descStart < buffer.cols) {
          const descTrunc = layout.truncate(item.description, buffer.cols - descStart);
          const dStyle = isSelected ? { ...descStyle, bg: selBg } : descStyle;
          buffer.drawText(descStart, viewRow, descTrunc, dStyle);
        }
      }
    }
  }
}

export function ListView(props: ListViewProps = {}): ListViewWidget {
  return new ListViewWidget(props);
}
