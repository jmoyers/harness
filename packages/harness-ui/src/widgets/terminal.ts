import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { Message } from '../widget/message.ts';
import { type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { KeyEvent } from '../widget/input.ts';
import { Vte } from '../vte/vte.ts';
import type { TerminalSnapshotFrameCore, TerminalCellStyle, TerminalColor } from '../vte/types.ts';

function vteColorToCellColor(color: TerminalColor): Color {
  if (color.kind === 'default') return { kind: 'default' };
  if (color.kind === 'indexed') return { kind: 'indexed', index: color.index };
  return { kind: 'rgb', r: color.r, g: color.g, b: color.b };
}

function vteStyleToCellStyle(style: TerminalCellStyle): CellStyle {
  return {
    fg: vteColorToCellColor(style.fg),
    bg: vteColorToCellColor(style.bg),
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    inverse: style.inverse,
  };
}

export class TerminalData extends Message {
  constructor(readonly data: Uint8Array) {
    super();
  }
}

export class TerminalTitleChanged extends Message {
  constructor(readonly title: string) {
    super();
  }
}

export class TerminalBell extends Message {
  constructor() {
    super();
  }
}

export interface TerminalWidgetProps {
  readonly id?: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly scrollbackLimit?: number;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export class TerminalWidgetImpl extends Widget {
  private vte: Vte;
  private vteCols: number;
  private vteRows: number;

  title = reactive('');
  cursorVisible = reactive(true);

  onData: ((data: Uint8Array) => void) | null = null;

  constructor(props: TerminalWidgetProps = {}) {
    super(props.id);
    this.focusable = true;
    this.manualChildRendering = true;
    this.vteCols = props.cols ?? 80;
    this.vteRows = props.rows ?? 24;
    this.vte = new Vte(this.vteCols, this.vteRows, props.scrollbackLimit ?? 5000);
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  write(data: Uint8Array | string): void {
    this.vte.ingest(data);
    const snap = this.vte.snapshotWithoutHash();
    this.cursorVisible = snap.cursor.visible;
    this.markDirty();
  }

  resizeTerminal(cols: number, rows: number): void {
    this.vteCols = cols;
    this.vteRows = rows;
    this.vte.resize(cols, rows);
    this.markDirty();
  }

  scrollViewport(delta: number): void {
    this.vte.scrollViewport(delta);
    this.markDirty();
  }

  setFollowOutput(follow: boolean): void {
    this.vte.setFollowOutput(follow);
  }

  snapshot(): TerminalSnapshotFrameCore {
    return this.vte.snapshotWithoutHash();
  }

  isMouseTrackingEnabled(): boolean {
    return this.vte.isMouseTrackingEnabled();
  }

  handleKeypress(event: KeyEvent): boolean {
    if (!this.focused) return false;

    let sequence: string | null = null;

    if (event.key.length === 1 && !event.ctrl && !event.alt) {
      sequence = event.key;
    } else if (event.key === 'enter') {
      sequence = '\r';
    } else if (event.key === 'backspace') {
      sequence = '\x7f';
    } else if (event.key === 'tab') {
      sequence = '\t';
    } else if (event.key === 'escape') {
      sequence = '\x1b';
    } else if (event.key === 'up') {
      sequence = '\x1b[A';
    } else if (event.key === 'down') {
      sequence = '\x1b[B';
    } else if (event.key === 'right') {
      sequence = '\x1b[C';
    } else if (event.key === 'left') {
      sequence = '\x1b[D';
    } else if (event.key === 'home') {
      sequence = '\x1b[H';
    } else if (event.key === 'end') {
      sequence = '\x1b[F';
    } else if (event.key === 'delete') {
      sequence = '\x1b[3~';
    } else if (event.key === 'pageup') {
      sequence = '\x1b[5~';
    } else if (event.key === 'pagedown') {
      sequence = '\x1b[6~';
    } else if (event.ctrl && event.key.length === 1) {
      const code = event.key.charCodeAt(0);
      if (code >= 0x61 && code <= 0x7a) {
        sequence = String.fromCharCode(code - 0x60);
      }
    }

    if (sequence !== null) {
      const encoded = new TextEncoder().encode(sequence);
      this.emit(new TerminalData(encoded));
      if (this.onData !== null) this.onData(encoded);
      return true;
    }

    return false;
  }

  render(buffer: ClippedCellBuffer): void {
    const widgetCols = buffer.cols;
    const widgetRows = buffer.rows;

    if (widgetCols !== this.vteCols || widgetRows !== this.vteRows) {
      this.resizeTerminal(widgetCols, widgetRows);
    }

    const snap = this.vte.snapshotWithoutHash();

    for (let row = 0; row < widgetRows; row += 1) {
      const line = snap.richLines[row];
      if (line === undefined) continue;

      for (let col = 0; col < widgetCols; col += 1) {
        const vteCell = line.cells[col];
        if (vteCell === undefined) continue;

        const cell = buffer.getCell(col, row);
        if (cell === null) continue;

        cell.glyph = vteCell.glyph;
        cell.continued = vteCell.continued;
        cell.style = vteStyleToCellStyle(vteCell.style);
      }
    }
  }
}

export function Terminal(props: TerminalWidgetProps = {}): TerminalWidgetImpl {
  return new TerminalWidgetImpl(props);
}
