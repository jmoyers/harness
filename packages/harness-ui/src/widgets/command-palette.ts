import { Widget } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { Message } from '../widget/message.ts';
import { measureDisplayWidth, TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { KeyEvent } from '../widget/input.ts';
import type { Binding } from '../widget/keybinding.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export interface CommandAction {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly bindingHint?: string;
}

export class CommandExecuted extends Message {
  constructor(
    readonly actionId: string,
    readonly action: CommandAction,
  ) {
    super();
  }
}

export class CommandPaletteDismissed extends Message {}

export interface CommandPaletteProps {
  readonly id?: string;
  readonly actions?: readonly CommandAction[];
  readonly placeholder?: string;
  readonly maxResults?: number;
  readonly width?: number;
  readonly height?: number;
  readonly borderColor?: string;
  readonly backgroundColor?: string;
  readonly selectedBg?: string;
  readonly inputFg?: string;
}

interface ScoredAction {
  readonly action: CommandAction;
  readonly score: number;
}

function scoreMatch(query: string, action: CommandAction): number {
  if (query.length === 0) return 1;
  const lq = query.toLowerCase();
  const lt = action.title.toLowerCase();
  if (lt === lq) return 100;
  if (lt.startsWith(lq)) return 80;
  if (lt.includes(lq)) return 60;
  const kw = action.keywords ?? [];
  for (const k of kw) {
    if (k.toLowerCase().includes(lq)) return 40;
  }
  const ld = (action.description ?? '').toLowerCase();
  if (ld.includes(lq)) return 20;
  return 0;
}

export class CommandPaletteWidget extends Widget {
  actions = reactive<readonly CommandAction[]>([]);
  query = reactive('');
  selectedIndex = reactive(0);
  placeholder = reactive('Type a command...');
  maxResults = reactive(8);
  borderColor = reactive<string | undefined>(undefined);
  backgroundColor = reactive<string | undefined>(undefined);
  selectedBg = reactive<string | undefined>(undefined);
  inputFg = reactive<string | undefined>(undefined);

  static BINDINGS: Binding[] = [
    { key: 'escape', action: 'dismiss', description: 'Close' },
    { key: 'up', action: 'move-up', description: 'Previous' },
    { key: 'down', action: 'move-down', description: 'Next' },
    { key: 'enter', action: 'execute', description: 'Run command' },
  ];

  constructor(props: CommandPaletteProps = {}) {
    super(props.id);
    this.position = 'absolute';
    this.zIndex = 200;
    this.focusable = true;
    this.manualChildRendering = true;
    if (props.actions !== undefined) this.actions = props.actions;
    if (props.placeholder !== undefined) this.placeholder = props.placeholder;
    if (props.maxResults !== undefined) this.maxResults = props.maxResults;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.borderColor !== undefined) this.borderColor = props.borderColor;
    if (props.backgroundColor !== undefined) this.backgroundColor = props.backgroundColor;
    if (props.selectedBg !== undefined) this.selectedBg = props.selectedBg;
    if (props.inputFg !== undefined) this.inputFg = props.inputFg;
  }

  filteredActions(): readonly ScoredAction[] {
    const scored: ScoredAction[] = [];
    for (const action of this.actions) {
      const s = scoreMatch(this.query, action);
      if (s > 0) scored.push({ action, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.maxResults);
  }

  positionInViewport(viewportCols: number, viewportRows: number): void {
    const w =
      typeof this.width === 'number'
        ? Math.min(this.width, viewportCols)
        : Math.min(60, viewportCols);
    const h =
      typeof this.height === 'number'
        ? Math.min(this.height, viewportRows)
        : Math.min(this.maxResults + 4, viewportRows);
    this.width = w;
    this.height = h;
    this.left = Math.max(0, Math.floor((viewportCols - w) / 2));
    this.top = Math.max(1, Math.floor(viewportRows * 0.2));
  }

  handleKeypress(event: KeyEvent): boolean {
    if (event.ctrl || event.alt) return false;
    if (event.key.length === 1 && event.key.charCodeAt(0) >= 0x20) {
      this.query = this.query + event.key;
      this.selectedIndex = 0;
      return true;
    }
    if (event.key === 'backspace') {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.selectedIndex = 0;
      }
      return true;
    }
    return false;
  }

  actionDismiss(): void {
    this.emit(new CommandPaletteDismissed());
  }

  actionMoveUp(): void {
    const results = this.filteredActions();
    if (results.length === 0) return;
    this.selectedIndex = this.selectedIndex > 0 ? this.selectedIndex - 1 : results.length - 1;
  }

  actionMoveDown(): void {
    const results = this.filteredActions();
    if (results.length === 0) return;
    this.selectedIndex = this.selectedIndex < results.length - 1 ? this.selectedIndex + 1 : 0;
  }

  actionExecute(): void {
    const results = this.filteredActions();
    if (this.selectedIndex >= 0 && this.selectedIndex < results.length) {
      const entry = results[this.selectedIndex]!;
      this.emit(new CommandExecuted(entry.action.id, entry.action));
    }
  }

  render(buffer: ClippedCellBuffer): void {
    const bgColor = resolveColor(this.backgroundColor);
    const brdColor = resolveColor(this.borderColor);
    const selBgColor = resolveColor(this.selectedBg);
    const inputFgColor = resolveColor(this.inputFg);

    const bgStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      bg: bgColor.kind !== 'default' ? bgColor : { kind: 'indexed', index: 236 },
    };
    const borderStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: brdColor.kind !== 'default' ? brdColor : { kind: 'indexed', index: 252 },
      bg: bgStyle.bg,
    };
    const inputStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: inputFgColor.kind !== 'default' ? inputFgColor : { kind: 'indexed', index: 255 },
      bg: bgStyle.bg,
    };
    const resultStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: { kind: 'indexed', index: 252 },
      bg: bgStyle.bg,
    };
    const selectedStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: { kind: 'indexed', index: 255 },
      bg: selBgColor.kind !== 'default' ? selBgColor : { kind: 'indexed', index: 24 },
      bold: true,
    };
    const hintStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: { kind: 'indexed', index: 244 },
      bg: bgStyle.bg,
    };

    for (let r = 0; r < buffer.rows; r += 1) buffer.fillRow(r, bgStyle);

    if (buffer.cols < 4 || buffer.rows < 3) return;

    const hBar = '─'.repeat(Math.max(0, buffer.cols - 2));
    buffer.drawText(0, 0, `┌${hBar}┐`, borderStyle);
    buffer.drawText(0, buffer.rows - 1, `└${hBar}┘`, borderStyle);
    for (let r = 1; r < buffer.rows - 1; r += 1) {
      buffer.drawText(0, r, '│', borderStyle);
      buffer.drawText(buffer.cols - 1, r, '│', borderStyle);
    }

    const innerW = buffer.cols - 2;
    const queryDisplay = this.query.length > 0 ? this.query : this.placeholder;
    const queryTruncated = layout.truncate(`> ${queryDisplay}`, innerW);
    const qStyle =
      this.query.length > 0
        ? inputStyle
        : { ...inputStyle, fg: { kind: 'indexed' as const, index: 244 } };
    buffer.drawText(1, 1, queryTruncated, qStyle);

    buffer.drawText(1, 2, '─'.repeat(innerW), borderStyle);

    const results = this.filteredActions();
    const startRow = 3;
    for (let i = 0; i < results.length && startRow + i < buffer.rows - 1; i += 1) {
      const entry = results[i]!;
      const isSelected = i === this.selectedIndex;
      const rowStyle = isSelected ? selectedStyle : resultStyle;

      if (isSelected) buffer.fillRow(startRow + i, selectedStyle);

      const label = layout.truncate(entry.action.title, innerW);
      buffer.drawText(1, startRow + i, ` ${label}`, rowStyle);

      if (entry.action.bindingHint !== undefined) {
        const hintW = measureDisplayWidth(entry.action.bindingHint);
        const hintCol = buffer.cols - 2 - hintW;
        if (hintCol > measureDisplayWidth(label) + 3) {
          const hs = isSelected ? { ...hintStyle, bg: selectedStyle.bg } : hintStyle;
          buffer.drawText(hintCol, startRow + i, entry.action.bindingHint, hs);
        }
      }
    }
  }
}

export function CommandPalette(props: CommandPaletteProps = {}): CommandPaletteWidget {
  return new CommandPaletteWidget(props);
}
