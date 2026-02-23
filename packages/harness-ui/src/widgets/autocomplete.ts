import { Widget } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { Message } from '../widget/message.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { KeyEvent } from '../widget/input.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export interface AutocompleteOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export type AutocompleteProvider = (query: string) => readonly AutocompleteOption[];

export class AutocompleteSelected extends Message {
  constructor(readonly option: AutocompleteOption) {
    super();
  }
}

export class AutocompleteDismissed extends Message {}

export interface AutocompletePopupProps {
  readonly id?: string;
  readonly provider?: AutocompleteProvider;
  readonly trigger?: string;
  readonly maxResults?: number;
  readonly bg?: string;
  readonly selectedBg?: string;
  readonly fg?: string;
  readonly selectedFg?: string;
  readonly width?: number;
  readonly maxHeight?: number;
}

export class AutocompletePopupWidget extends Widget {
  provider = reactive<AutocompleteProvider | null>(null);
  trigger = reactive('/');
  query = reactive('');
  selectedIndex = reactive(0);
  open = reactive(false);
  maxResults = reactive(8);
  bg = reactive<string | undefined>(undefined);
  selectedBg = reactive<string | undefined>(undefined);
  fg = reactive<string | undefined>(undefined);
  selectedFg = reactive<string | undefined>(undefined);
  popupWidth = reactive(40);
  maxHeight = reactive(10);
  anchorCol = reactive(0);
  anchorRow = reactive(0);

  constructor(props: AutocompletePopupProps = {}) {
    super(props.id);
    this.position = 'absolute';
    this.zIndex = 250;
    this.focusable = false;
    if (props.provider !== undefined) this.provider = props.provider;
    if (props.trigger !== undefined) this.trigger = props.trigger;
    if (props.maxResults !== undefined) this.maxResults = props.maxResults;
    if (props.bg !== undefined) this.bg = props.bg;
    if (props.selectedBg !== undefined) this.selectedBg = props.selectedBg;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.selectedFg !== undefined) this.selectedFg = props.selectedFg;
    if (props.width !== undefined) this.popupWidth = props.width;
    if (props.maxHeight !== undefined) this.maxHeight = props.maxHeight;
  }

  filteredOptions(): readonly AutocompleteOption[] {
    if (this.provider === null) return [];
    return this.provider(this.query).slice(0, this.maxResults);
  }

  show(query: string, anchorCol: number, anchorRow: number): void {
    this.query = query;
    this.anchorCol = anchorCol;
    this.anchorRow = anchorRow;
    this.selectedIndex = 0;
    this.open = true;
    const results = this.filteredOptions();
    const h = Math.min(results.length, this.maxHeight);
    this.width = this.popupWidth;
    this.height = Math.max(1, h);
    this.left = anchorCol;
    this.top = Math.max(0, anchorRow - h);
    this.visible = true;
    this.markDirty();
  }

  hide(): void {
    this.open = false;
    this.visible = false;
    this.markDirty();
  }

  updateQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    const results = this.filteredOptions();
    const h = Math.min(results.length, this.maxHeight);
    this.height = Math.max(1, h);
    this.top = Math.max(0, this.anchorRow - h);
    if (results.length === 0) this.hide();
    this.markDirty();
  }

  handleKeypress(event: KeyEvent): boolean {
    if (!this.open) return false;

    if (event.key === 'escape') {
      this.hide();
      this.emit(new AutocompleteDismissed());
      return true;
    }

    if (event.key === 'up') {
      const results = this.filteredOptions();
      if (results.length > 0) {
        this.selectedIndex = this.selectedIndex > 0 ? this.selectedIndex - 1 : results.length - 1;
      }
      return true;
    }

    if (event.key === 'down') {
      const results = this.filteredOptions();
      if (results.length > 0) {
        this.selectedIndex = this.selectedIndex < results.length - 1 ? this.selectedIndex + 1 : 0;
      }
      return true;
    }

    if (event.key === 'enter' || event.key === 'tab') {
      const results = this.filteredOptions();
      if (this.selectedIndex >= 0 && this.selectedIndex < results.length) {
        const option = results[this.selectedIndex]!;
        this.hide();
        this.emit(new AutocompleteSelected(option));
      }
      return true;
    }

    return false;
  }

  render(buffer: ClippedCellBuffer): void {
    if (!this.open) return;

    const bgColor = resolveColor(this.bg);
    const selBgColor = resolveColor(this.selectedBg);
    const fgColor = resolveColor(this.fg);
    const selFgColor = resolveColor(this.selectedFg);

    const normalBg =
      bgColor.kind !== 'default' ? bgColor : { kind: 'indexed' as const, index: 236 };
    const normalFg =
      fgColor.kind !== 'default' ? fgColor : { kind: 'indexed' as const, index: 252 };
    const selBg =
      selBgColor.kind !== 'default' ? selBgColor : { kind: 'indexed' as const, index: 24 };
    const selFg =
      selFgColor.kind !== 'default' ? selFgColor : { kind: 'indexed' as const, index: 255 };

    const normalStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: normalFg, bg: normalBg };
    const selectedStyle: CellStyle = { ...DEFAULT_CELL_STYLE, fg: selFg, bg: selBg, bold: true };
    const descStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: { kind: 'indexed', index: 244 },
      bg: normalBg,
    };

    const results = this.filteredOptions();

    for (let i = 0; i < buffer.rows; i += 1) buffer.fillRow(i, normalStyle);

    for (let i = 0; i < results.length && i < buffer.rows; i += 1) {
      const option = results[i]!;
      const isSelected = i === this.selectedIndex;
      const style = isSelected ? selectedStyle : normalStyle;

      if (isSelected) buffer.fillRow(i, selectedStyle);

      const label = layout.truncate(` ${option.label}`, buffer.cols);
      buffer.drawText(0, i, label, style);

      if (option.description !== undefined) {
        const labelW = layout.measure(label);
        const gap = 2;
        const descStart = labelW + gap;
        if (descStart < buffer.cols) {
          const desc = layout.truncate(option.description, buffer.cols - descStart);
          buffer.drawText(descStart, i, desc, isSelected ? { ...descStyle, bg: selBg } : descStyle);
        }
      }
    }
  }
}

export function AutocompletePopup(props: AutocompletePopupProps = {}): AutocompletePopupWidget {
  return new AutocompletePopupWidget(props);
}
