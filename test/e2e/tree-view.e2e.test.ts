import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type {
  TreeItemSelected,
  TreeItemExpanded,
  TreeItemCollapsed,
} from '../../packages/harness-ui/src/widgets/tree-view.ts';
import {
  TreeView,
  TreeViewWidget,
  type TreeNode,
} from '../../packages/harness-ui/src/widgets/tree-view.ts';
import { createTestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';

class RootWidget extends Widget {
  render(): void {}
}

function root(children: Widget[]): RootWidget {
  const r = new RootWidget('root');
  r.flexDirection = 'column';
  r.add(...children);
  return r;
}

const FLAT_NODES: TreeNode[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

const NESTED_NODES: TreeNode[] = [
  {
    id: 'src',
    label: 'src',
    icon: '📁',
    children: [
      { id: 'main', label: 'main.ts', icon: '📄' },
      { id: 'util', label: 'util.ts', icon: '📄' },
    ],
  },
  {
    id: 'pkg',
    label: 'package.json',
    icon: '📄',
  },
];

beforeEach(() => {
  resetAutoIdCounter();
});

describe('TreeView flat rendering', () => {
  test('renders labels', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.expectScreen().toContainRow('Alpha');
    pilot.expectScreen().toContainRow('Beta');
    pilot.expectScreen().toContainRow('Gamma');
  });

  test('selected item is highlighted', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, selectedId: 'b', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.expectRow(1).toContain('Beta');
  });

  test('empty nodes renders nothing', () => {
    const tv = TreeView({ id: 'tv', nodes: [], flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toEqual('                    ');
  });
});

describe('TreeView nested rendering', () => {
  test('collapsed parent shows collapse indicator', () => {
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 30, rows: 5 });
    pilot.expectRow(0).toContain('▸');
    pilot.expectRow(0).toContain('src');
    pilot.expectScreen().not.toContainRow('main.ts');
  });

  test('expanded parent shows children indented', () => {
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, flexGrow: 1 });
    tv.expandedIds = new Set(['src']);
    const pilot = createTestPilot(root([tv]), { cols: 30, rows: 5 });
    pilot.expectRow(0).toContain('▾');
    pilot.expectRow(0).toContain('src');
    pilot.expectScreen().toContainRow('main.ts');
    pilot.expectScreen().toContainRow('util.ts');
  });

  test('icons render before labels', () => {
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, flexGrow: 1 });
    tv.expandedIds = new Set(['src']);
    const pilot = createTestPilot(root([tv]), { cols: 30, rows: 5 });
    pilot.expectRow(0).toContain('📁');
    pilot.expectScreen().toContainRow('📄');
  });

  test('badge renders after label', () => {
    const nodes: TreeNode[] = [{ id: 'x', label: 'Item', badge: '[3]' }];
    const tv = TreeView({ id: 'tv', nodes, flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 30, rows: 3 });
    pilot.expectRow(0).toContain('[3]');
  });
});

describe('TreeView keyboard navigation', () => {
  test('down selects next item', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, selectedId: 'a', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('down');
    assert.equal(tv.selectedId, 'b');
  });

  test('up selects previous item', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, selectedId: 'b', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('up');
    assert.equal(tv.selectedId, 'a');
  });

  test('j/k navigation', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, selectedId: 'a', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('j');
    assert.equal(tv.selectedId, 'b');
    pilot.pressKey('k');
    assert.equal(tv.selectedId, 'a');
  });

  test('wraps at bottom', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, selectedId: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('down');
    assert.equal(tv.selectedId, 'a');
  });

  test('wraps at top', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, selectedId: 'a', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('up');
    assert.equal(tv.selectedId, 'c');
  });

  test('right expands collapsed node', () => {
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, selectedId: 'src', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(tv);
    assert.ok(!tv.expandedIds.has('src'));
    pilot.pressKey('right');
    assert.ok(tv.expandedIds.has('src'));
  });

  test('left collapses expanded node', () => {
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, selectedId: 'src', flexGrow: 1 });
    tv.expandedIds = new Set(['src']);
    const pilot = createTestPilot(root([tv]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('left');
    assert.ok(!tv.expandedIds.has('src'));
  });

  test('navigating into expanded children', () => {
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, selectedId: 'src', flexGrow: 1 });
    tv.expandedIds = new Set(['src']);
    const pilot = createTestPilot(root([tv]), { cols: 30, rows: 6 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('down');
    assert.equal(tv.selectedId, 'main');
    pilot.pressKey('down');
    assert.equal(tv.selectedId, 'util');
    pilot.pressKey('down');
    assert.equal(tv.selectedId, 'pkg');
  });
});

describe('TreeView enter emits TreeItemSelected', () => {
  test('enter emits with selected node', () => {
    let selected: { id: string; label: string } | null = null;
    class Handler extends RootWidget {
      onTreeItemSelected(msg: TreeItemSelected): void {
        selected = { id: msg.nodeId, label: msg.node.label };
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, selectedId: 'b', flexGrow: 1 });
    r.add(tv);
    const pilot = createTestPilot(r, { cols: 20, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('enter');
    assert.notEqual(selected, null);
    assert.equal(selected!.id, 'b');
    assert.equal(selected!.label, 'Beta');
  });
});

describe('TreeView expand/collapse messages', () => {
  test('expand emits TreeItemExpanded', () => {
    let expandedId: string | null = null;
    class Handler extends RootWidget {
      onTreeItemExpanded(msg: TreeItemExpanded): void {
        expandedId = msg.nodeId;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, selectedId: 'src', flexGrow: 1 });
    r.add(tv);
    const pilot = createTestPilot(r, { cols: 30, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('right');
    assert.equal(expandedId, 'src');
  });

  test('collapse emits TreeItemCollapsed', () => {
    let collapsedId: string | null = null;
    class Handler extends RootWidget {
      onTreeItemCollapsed(msg: TreeItemCollapsed): void {
        collapsedId = msg.nodeId;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const tv = TreeView({ id: 'tv', nodes: NESTED_NODES, selectedId: 'src', flexGrow: 1 });
    tv.expandedIds = new Set(['src']);
    r.add(tv);
    const pilot = createTestPilot(r, { cols: 30, rows: 5 });
    pilot.focusManager.focus(tv);
    pilot.pressKey('left');
    assert.equal(collapsedId, 'src');
  });
});

describe('TreeView scrolling', () => {
  test('scrolls when selection moves below viewport', () => {
    const manyNodes: TreeNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
    }));
    const tv = TreeView({ id: 'tv', nodes: manyNodes, selectedId: 'n0', flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 4 });
    pilot.focusManager.focus(tv);
    for (let i = 0; i < 6; i += 1) pilot.pressKey('down');
    assert.ok(tv.scrollOffset > 0);
    pilot.expectScreen().toContainRow('Node 6');
  });
});

describe('TreeView reactive updates', () => {
  test('changing nodes re-renders', () => {
    const tv = TreeView({ id: 'tv', nodes: FLAT_NODES, flexGrow: 1 });
    const pilot = createTestPilot(root([tv]), { cols: 20, rows: 5 });
    pilot.expectScreen().toContainRow('Alpha');
    tv.nodes = [{ id: 'x', label: 'XRay' }];
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('XRay');
    pilot.expectScreen().not.toContainRow('Alpha');
  });
});

describe('TreeView factory', () => {
  test('returns TreeViewWidget', () => {
    const tv = TreeView({ id: 'test' });
    if (!(tv instanceof TreeViewWidget)) throw new Error('should be TreeViewWidget');
    if (!(tv instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    assert.equal(TreeView({}).focusable, true);
  });
});
