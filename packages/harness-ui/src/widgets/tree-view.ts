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

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly badge?: string;
  readonly children?: readonly TreeNode[];
  readonly data?: unknown;
}

export class TreeItemSelected extends Message {
  constructor(
    readonly nodeId: string,
    readonly node: TreeNode,
  ) {
    super();
  }
}

export class TreeItemExpanded extends Message {
  constructor(readonly nodeId: string) {
    super();
  }
}

export class TreeItemCollapsed extends Message {
  constructor(readonly nodeId: string) {
    super();
  }
}

interface FlatRow {
  readonly node: TreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

export interface TreeViewProps {
  readonly id?: string;
  readonly nodes?: readonly TreeNode[];
  readonly selectedId?: string | null;
  readonly fg?: string;
  readonly selectedFg?: string;
  readonly selectedBg?: string;
  readonly width?: LayoutValue;
  readonly height?: LayoutValue;
  readonly flexGrow?: number;
  readonly indentSize?: number;
}

export class TreeViewWidget extends Widget {
  nodes = reactive<readonly TreeNode[]>([]);
  selectedId = reactive<string | null>(null);
  fg = reactive<string | undefined>(undefined);
  selectedFg = reactive<string | undefined>(undefined);
  selectedBg = reactive<string | undefined>(undefined);
  indentSize = reactive(2);
  scrollOffset = reactive(0);
  expandedIds = reactive<ReadonlySet<string>>(new Set());

  static BINDINGS: Binding[] = [
    { key: 'up', action: 'move-up', description: 'Previous' },
    { key: 'k', action: 'move-up', description: 'Previous' },
    { key: 'down', action: 'move-down', description: 'Next' },
    { key: 'j', action: 'move-down', description: 'Next' },
    { key: 'enter', action: 'select', description: 'Select' },
    { key: 'right', action: 'expand', description: 'Expand' },
    { key: 'left', action: 'collapse', description: 'Collapse' },
  ];

  constructor(props: TreeViewProps = {}) {
    super(props.id);
    this.focusable = true;
    if (props.nodes !== undefined) this.nodes = props.nodes;
    if (props.selectedId !== undefined) this.selectedId = props.selectedId;
    if (props.fg !== undefined) this.fg = props.fg;
    if (props.selectedFg !== undefined) this.selectedFg = props.selectedFg;
    if (props.selectedBg !== undefined) this.selectedBg = props.selectedBg;
    if (props.width !== undefined) this.width = props.width;
    if (props.height !== undefined) this.height = props.height;
    if (props.flexGrow !== undefined) this.flexGrow = props.flexGrow;
    if (props.indentSize !== undefined) this.indentSize = props.indentSize;
  }

  private flattenRows(): FlatRow[] {
    const rows: FlatRow[] = [];
    const expandedSet = this.expandedIds;
    const walk = (nodes: readonly TreeNode[], depth: number): void => {
      for (const node of nodes) {
        const hasChildren = node.children !== undefined && node.children.length > 0;
        const expanded = hasChildren && expandedSet.has(node.id);
        rows.push({ node, depth, hasChildren, expanded });
        if (expanded && node.children !== undefined) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(this.nodes, 0);
    return rows;
  }

  private findSelectedIndex(rows: readonly FlatRow[]): number {
    if (this.selectedId === null) return -1;
    return rows.findIndex((r) => r.node.id === this.selectedId);
  }

  toggleExpanded(nodeId: string): void {
    const current = new Set(this.expandedIds);
    if (current.has(nodeId)) {
      current.delete(nodeId);
      this.expandedIds = current;
      this.emit(new TreeItemCollapsed(nodeId));
    } else {
      current.add(nodeId);
      this.expandedIds = current;
      this.emit(new TreeItemExpanded(nodeId));
    }
  }

  actionMoveUp(): void {
    const rows = this.flattenRows();
    if (rows.length === 0) return;
    const idx = this.findSelectedIndex(rows);
    const next = idx <= 0 ? rows.length - 1 : idx - 1;
    this.selectedId = rows[next]!.node.id;
    this.ensureVisible(rows);
  }

  actionMoveDown(): void {
    const rows = this.flattenRows();
    if (rows.length === 0) return;
    const idx = this.findSelectedIndex(rows);
    const next = idx < 0 || idx >= rows.length - 1 ? 0 : idx + 1;
    this.selectedId = rows[next]!.node.id;
    this.ensureVisible(rows);
  }

  actionSelect(): void {
    const rows = this.flattenRows();
    const idx = this.findSelectedIndex(rows);
    if (idx < 0) return;
    const row = rows[idx]!;
    this.emit(new TreeItemSelected(row.node.id, row.node));
  }

  actionExpand(): void {
    const rows = this.flattenRows();
    const idx = this.findSelectedIndex(rows);
    if (idx < 0) return;
    const row = rows[idx]!;
    if (row.hasChildren && !row.expanded) {
      this.toggleExpanded(row.node.id);
    }
  }

  actionCollapse(): void {
    const rows = this.flattenRows();
    const idx = this.findSelectedIndex(rows);
    if (idx < 0) return;
    const row = rows[idx]!;
    if (row.hasChildren && row.expanded) {
      this.toggleExpanded(row.node.id);
    }
  }

  private ensureVisible(rows: readonly FlatRow[]): void {
    const idx = this.findSelectedIndex(rows);
    if (idx < 0) return;
    const viewH = this.computedRect.height > 0 ? this.computedRect.height : 10;
    if (idx < this.scrollOffset) this.scrollOffset = idx;
    else if (idx >= this.scrollOffset + viewH) this.scrollOffset = idx - viewH + 1;
  }

  render(buffer: ClippedCellBuffer): void {
    const rows = this.flattenRows();
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

    for (let viewRow = 0; viewRow < buffer.rows; viewRow += 1) {
      const rowIdx = this.scrollOffset + viewRow;
      if (rowIdx >= rows.length) break;
      const row = rows[rowIdx]!;
      const isSelected = row.node.id === this.selectedId;
      const style = isSelected ? selectedStyle : normalStyle;

      if (isSelected && selBg.kind !== 'default') {
        buffer.fillRow(viewRow, selectedStyle);
      }

      const indent = ' '.repeat(row.depth * this.indentSize);
      const toggle = row.hasChildren ? (row.expanded ? '▾ ' : '▸ ') : '  ';
      const icon = row.node.icon !== undefined ? `${row.node.icon} ` : '';
      const label = row.node.label;
      const badge = row.node.badge !== undefined ? ` ${row.node.badge}` : '';
      const text = `${indent}${toggle}${icon}${label}${badge}`;
      const truncated = layout.truncate(text, buffer.cols);
      buffer.drawText(0, viewRow, truncated, style);
    }
  }
}

export function TreeView(props: TreeViewProps = {}): TreeViewWidget {
  return new TreeViewWidget(props);
}
