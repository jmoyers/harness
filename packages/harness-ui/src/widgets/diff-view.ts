import { Widget, type LayoutValue } from '../widget/widget.ts';
import { reactive } from '../widget/reactive.ts';
import { TextLayoutEngine } from '../text-layout.ts';
import { parseHexColor, DEFAULT_CELL_STYLE, type CellStyle, type Color } from '../core/color.ts';
import type { ClippedCellBuffer } from '../core/cell-buffer.ts';
import type { Binding } from '../widget/keybinding.ts';

function resolveColor(hex: string | undefined): Color {
  if (hex === undefined) return { kind: 'default' };
  return parseHexColor(hex) ?? { kind: 'default' };
}

const layout = new TextLayoutEngine();

export type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk-header' | 'file-header';

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly content: string;
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
}

export interface DiffFile {
  readonly filename: string;
  readonly lines: readonly DiffLine[];
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffViewProps {
  readonly id?: string;
  readonly files?: readonly DiffFile[];
  readonly addedColor?: string;
  readonly removedColor?: string;
  readonly contextColor?: string;
  readonly hunkHeaderColor?: string;
  readonly addedBgColor?: string;
  readonly removedBgColor?: string;
  readonly contextBgColor?: string;
  readonly lineNumberColor?: string;
  readonly lineNumberWidth?: number;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
}

export function parseDiffText(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = text.split('\n');
  let current: {
    filename: string;
    lines: DiffLine[];
    additions: number;
    deletions: number;
  } | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith('diff --git') || raw.startsWith('---') || raw.startsWith('+++')) {
      if (raw.startsWith('diff --git')) {
        if (current !== null) files.push(current);
        const match = raw.match(/b\/(.+)$/);
        const filename = match?.[1] ?? 'unknown';
        current = { filename, lines: [], additions: 0, deletions: 0 };
      }
      if (raw.startsWith('+++ b/') && current !== null) {
        current.filename = raw.slice(6);
      }
      continue;
    }

    if (raw.startsWith('@@')) {
      const hunkMatch = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (hunkMatch !== null) {
        oldLine = parseInt(hunkMatch[1]!, 10);
        newLine = parseInt(hunkMatch[2]!, 10);
        if (current !== null) {
          current.lines.push({
            kind: 'hunk-header',
            content: raw,
            oldLineNumber: null,
            newLineNumber: null,
          });
        }
      }
      continue;
    }

    if (current === null) continue;

    if (raw.startsWith('+')) {
      current.lines.push({
        kind: 'add',
        content: raw.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      });
      current.additions += 1;
      newLine += 1;
    } else if (raw.startsWith('-')) {
      current.lines.push({
        kind: 'remove',
        content: raw.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      current.deletions += 1;
      oldLine += 1;
    } else if (raw.startsWith(' ')) {
      current.lines.push({
        kind: 'context',
        content: raw.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  if (current !== null) files.push(current);
  return files;
}

export class DiffViewWidget extends Widget {
  files = reactive<readonly DiffFile[]>([]);
  addedColor = reactive<string | undefined>(undefined);
  removedColor = reactive<string | undefined>(undefined);
  contextColor = reactive<string | undefined>(undefined);
  hunkHeaderColor = reactive<string | undefined>(undefined);
  addedBgColor = reactive<string | undefined>(undefined);
  removedBgColor = reactive<string | undefined>(undefined);
  contextBgColor = reactive<string | undefined>(undefined);
  lineNumberColor = reactive<string | undefined>(undefined);
  lineNumberWidth = reactive(4);
  scrollOffset = reactive(0);

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'scroll-up', description: 'Scroll up' },
    { key: 'down', action: 'scroll-down', description: 'Scroll down' },
    { key: 'pageup', action: 'page-up', description: 'Page up' },
    { key: 'pagedown', action: 'page-down', description: 'Page down' },
  ];

  constructor(props: DiffViewProps = {}) {
    super(props.id);
    this.focusable = true;
    if (props.files !== undefined) this.files = props.files;
    if (props.addedColor !== undefined) this.addedColor = props.addedColor;
    if (props.removedColor !== undefined) this.removedColor = props.removedColor;
    if (props.contextColor !== undefined) this.contextColor = props.contextColor;
    if (props.hunkHeaderColor !== undefined) this.hunkHeaderColor = props.hunkHeaderColor;
    if (props.addedBgColor !== undefined) this.addedBgColor = props.addedBgColor;
    if (props.removedBgColor !== undefined) this.removedBgColor = props.removedBgColor;
    if (props.contextBgColor !== undefined) this.contextBgColor = props.contextBgColor;
    if (props.lineNumberColor !== undefined) this.lineNumberColor = props.lineNumberColor;
    if (props.lineNumberWidth !== undefined) this.lineNumberWidth = props.lineNumberWidth;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
  }

  private flatLines(): readonly { file: DiffFile; line: DiffLine; isFileHeader: boolean }[] {
    const result: Array<{ file: DiffFile; line: DiffLine; isFileHeader: boolean }> = [];
    for (const file of this.files) {
      result.push({
        file,
        line: {
          kind: 'file-header',
          content: file.filename,
          oldLineNumber: null,
          newLineNumber: null,
        },
        isFileHeader: true,
      });
      for (const line of file.lines) {
        result.push({ file, line, isFileHeader: false });
      }
    }
    return result;
  }

  actionScrollUp(): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - 1);
  }
  actionScrollDown(): void {
    this.scrollOffset = this.scrollOffset + 1;
  }
  actionPageUp(): void {
    const h = this.computedRect.height > 0 ? this.computedRect.height : 10;
    this.scrollOffset = Math.max(0, this.scrollOffset - (h - 1));
  }
  actionPageDown(): void {
    const h = this.computedRect.height > 0 ? this.computedRect.height : 10;
    this.scrollOffset = this.scrollOffset + (h - 1);
  }

  render(buffer: ClippedCellBuffer): void {
    const addFg = resolveColor(this.addedColor) ?? { kind: 'indexed' as const, index: 2 };
    const remFg = resolveColor(this.removedColor) ?? { kind: 'indexed' as const, index: 1 };
    const ctxFg = resolveColor(this.contextColor) ?? { kind: 'indexed' as const, index: 244 };
    const hunkFg = resolveColor(this.hunkHeaderColor) ?? { kind: 'indexed' as const, index: 244 };
    const addBg = resolveColor(this.addedBgColor);
    const remBg = resolveColor(this.removedBgColor);
    const ctxBg = resolveColor(this.contextBgColor);
    const lnFg = resolveColor(this.lineNumberColor) ?? { kind: 'indexed' as const, index: 240 };

    const addStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: addFg.kind !== 'default' ? addFg : { kind: 'indexed', index: 2 },
      bg: addBg,
    };
    const remStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: remFg.kind !== 'default' ? remFg : { kind: 'indexed', index: 1 },
      bg: remBg,
    };
    const ctxStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: ctxFg.kind !== 'default' ? ctxFg : { kind: 'indexed', index: 244 },
      bg: ctxBg,
    };
    const hunkStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: hunkFg.kind !== 'default' ? hunkFg : { kind: 'indexed', index: 244 },
      dim: true,
    };
    const fileStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: { kind: 'indexed', index: 255 },
      bold: true,
    };
    const lnStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: lnFg.kind !== 'default' ? lnFg : { kind: 'indexed', index: 240 },
    };
    const statAddStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: addFg.kind !== 'default' ? addFg : { kind: 'indexed', index: 2 },
    };
    const statRemStyle: CellStyle = {
      ...DEFAULT_CELL_STYLE,
      fg: remFg.kind !== 'default' ? remFg : { kind: 'indexed', index: 1 },
    };

    const flat = this.flatLines();
    const lnW = this.lineNumberWidth;
    const gutterW = lnW * 2 + 3;
    const contentW = Math.max(1, buffer.cols - gutterW);

    for (let viewRow = 0; viewRow < buffer.rows; viewRow += 1) {
      const idx = this.scrollOffset + viewRow;
      if (idx >= flat.length) break;
      const entry = flat[idx]!;
      const { line } = entry;

      if (entry.isFileHeader) {
        const stats = `+${entry.file.additions} -${entry.file.deletions}`;
        const headerText = layout.truncate(entry.file.filename, buffer.cols - stats.length - 2);
        buffer.drawText(0, viewRow, headerText, fileStyle);
        const statsCol = buffer.cols - stats.length;
        buffer.drawText(statsCol, viewRow, `+${entry.file.additions}`, statAddStyle);
        buffer.drawText(
          statsCol + String(entry.file.additions).length + 1,
          viewRow,
          ` -${entry.file.deletions}`,
          statRemStyle,
        );
        continue;
      }

      if (line.kind === 'hunk-header') {
        buffer.drawText(0, viewRow, layout.truncate(line.content, buffer.cols), hunkStyle);
        continue;
      }

      const oldLn =
        line.oldLineNumber !== null ? String(line.oldLineNumber).padStart(lnW) : ' '.repeat(lnW);
      const newLn =
        line.newLineNumber !== null ? String(line.newLineNumber).padStart(lnW) : ' '.repeat(lnW);
      const prefix = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';

      buffer.drawText(0, viewRow, oldLn, lnStyle);
      buffer.drawText(lnW, viewRow, ' ', lnStyle);
      buffer.drawText(lnW + 1, viewRow, newLn, lnStyle);
      buffer.drawText(
        lnW * 2 + 1,
        viewRow,
        ` ${prefix}`,
        line.kind === 'add' ? addStyle : line.kind === 'remove' ? remStyle : ctxStyle,
      );

      const style = line.kind === 'add' ? addStyle : line.kind === 'remove' ? remStyle : ctxStyle;
      if (style.bg.kind !== 'default') buffer.fillRow(viewRow, style);
      buffer.drawText(0, viewRow, oldLn, lnStyle);
      buffer.drawText(lnW, viewRow, ' ', lnStyle);
      buffer.drawText(lnW + 1, viewRow, newLn, lnStyle);
      buffer.drawText(lnW * 2 + 1, viewRow, ` ${prefix}`, style);
      buffer.drawText(gutterW, viewRow, layout.truncate(line.content, contentW), style);
    }
  }
}

export function DiffView(props: DiffViewProps = {}): DiffViewWidget {
  return new DiffViewWidget(props);
}
