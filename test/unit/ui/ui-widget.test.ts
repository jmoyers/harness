import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import {
  Widget,
  ZERO_RECT,
  ZERO_INSETS,
  edgeInsets,
  resetAutoIdCounter,
} from '../../../packages/harness-ui/src/widget/widget.ts';
import type {
  CellBuffer,
  ClippedCellBuffer,
} from '../../../packages/harness-ui/src/core/cell-buffer.ts';

class TestWidget extends Widget {
  renderCount = 0;
  mountCount = 0;
  unmountCount = 0;

  render(_buffer: CellBuffer | ClippedCellBuffer): void {
    this.renderCount += 1;
  }

  override onMount(): void {
    this.mountCount += 1;
  }

  override onUnmount(): void {
    this.unmountCount += 1;
  }
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Widget construction', () => {
  test('uses provided id', () => {
    const w = new TestWidget('my-widget');
    assert.equal(w.id, 'my-widget');
  });

  test('generates id when none provided', () => {
    const a = new TestWidget();
    const b = new TestWidget();
    assert.ok(a.id.startsWith('widget-'));
    assert.ok(b.id.startsWith('widget-'));
    assert.notEqual(a.id, b.id);
  });

  test('defaults', () => {
    const w = new TestWidget();
    assert.equal(w.parent, null);
    assert.deepEqual([...w.children], []);
    assert.equal(w.mounted, false);
    assert.equal(w.dirty, true);
    assert.equal(w.width, 'auto');
    assert.equal(w.height, 'auto');
    assert.equal(w.flexDirection, 'column');
    assert.equal(w.flexGrow, 0);
    assert.equal(w.flexShrink, 1);
    assert.equal(w.gap, 0);
    assert.deepEqual(w.padding, ZERO_INSETS);
    assert.deepEqual(w.margin, ZERO_INSETS);
    assert.equal(w.alignItems, 'stretch');
    assert.equal(w.justifyContent, 'start');
    assert.equal(w.position, 'relative');
    assert.equal(w.left, undefined);
    assert.equal(w.top, undefined);
    assert.equal(w.zIndex, 0);
    assert.equal(w.visible, true);
    assert.equal(w.overflow, 'hidden');
    assert.equal(w.focusable, false);
    assert.equal(w.focused, false);
    assert.deepEqual(w.computedRect, ZERO_RECT);
    assert.deepEqual(w.absoluteRect, ZERO_RECT);
  });
});

describe('edgeInsets', () => {
  test('single value fills all sides', () => {
    assert.deepEqual(edgeInsets(5), { top: 5, right: 5, bottom: 5, left: 5 });
  });

  test('two values set top/bottom and right/left', () => {
    assert.deepEqual(edgeInsets(2, 4), { top: 2, right: 4, bottom: 2, left: 4 });
  });

  test('three values set top, right/left, bottom', () => {
    assert.deepEqual(edgeInsets(1, 2, 3), { top: 1, right: 2, bottom: 3, left: 2 });
  });

  test('four values set all independently', () => {
    assert.deepEqual(edgeInsets(1, 2, 3, 4), { top: 1, right: 2, bottom: 3, left: 4 });
  });

  test('clamps negatives to 0', () => {
    assert.deepEqual(edgeInsets(-5), { top: 0, right: 0, bottom: 0, left: 0 });
  });

  test('floors fractional values', () => {
    assert.deepEqual(edgeInsets(1.9), { top: 1, right: 1, bottom: 1, left: 1 });
  });
});

describe('Widget tree operations', () => {
  test('add sets parent and updates children', () => {
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    assert.equal(child.parent, parent);
    assert.equal(parent.children.length, 1);
    assert.equal(parent.children[0], child);
  });

  test('add multiple children', () => {
    const parent = new TestWidget('parent');
    const a = new TestWidget('a');
    const b = new TestWidget('b');
    const c = new TestWidget('c');
    parent.add(a, b, c);
    assert.equal(parent.children.length, 3);
    assert.equal(parent.children[0]!.id, 'a');
    assert.equal(parent.children[1]!.id, 'b');
    assert.equal(parent.children[2]!.id, 'c');
  });

  test('add reparents from previous parent', () => {
    const oldParent = new TestWidget('old');
    const newParent = new TestWidget('new');
    const child = new TestWidget('child');
    oldParent.add(child);
    assert.equal(oldParent.children.length, 1);
    newParent.add(child);
    assert.equal(oldParent.children.length, 0);
    assert.equal(newParent.children.length, 1);
    assert.equal(child.parent, newParent);
  });

  test('remove by widget reference', () => {
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    parent.remove(child);
    assert.equal(parent.children.length, 0);
    assert.equal(child.parent, null);
  });

  test('remove by id string', () => {
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    parent.remove('child');
    assert.equal(parent.children.length, 0);
    assert.equal(child.parent, null);
  });

  test('remove non-existent child is no-op', () => {
    const parent = new TestWidget('parent');
    parent.remove('nonexistent');
    assert.equal(parent.children.length, 0);
  });

  test('removeAll clears all children', () => {
    const parent = new TestWidget('parent');
    parent.add(new TestWidget('a'), new TestWidget('b'), new TestWidget('c'));
    assert.equal(parent.children.length, 3);
    parent.removeAll();
    assert.equal(parent.children.length, 0);
  });
});

describe('Widget mounting', () => {
  test('add to mounted parent mounts child', () => {
    const parent = new TestWidget('parent');
    parent._mountRecursive();
    assert.equal(parent.mounted, true);
    const child = new TestWidget('child');
    parent.add(child);
    assert.equal(child.mounted, true);
    assert.equal(child.mountCount, 1);
  });

  test('add to unmounted parent does not mount child', () => {
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    assert.equal(child.mounted, false);
    assert.equal(child.mountCount, 0);
  });

  test('mounting parent mounts existing children recursively', () => {
    const root = new TestWidget('root');
    const mid = new TestWidget('mid');
    const leaf = new TestWidget('leaf');
    root.add(mid);
    mid.add(leaf);
    root._mountRecursive();
    assert.equal(root.mounted, true);
    assert.equal(mid.mounted, true);
    assert.equal(leaf.mounted, true);
    assert.equal(leaf.mountCount, 1);
  });

  test('remove from mounted parent unmounts child', () => {
    const parent = new TestWidget('parent');
    parent._mountRecursive();
    const child = new TestWidget('child');
    parent.add(child);
    assert.equal(child.mounted, true);
    parent.remove(child);
    assert.equal(child.mounted, false);
    assert.equal(child.unmountCount, 1);
  });

  test('unmount is recursive', () => {
    const root = new TestWidget('root');
    const mid = new TestWidget('mid');
    const leaf = new TestWidget('leaf');
    root.add(mid);
    mid.add(leaf);
    root._mountRecursive();
    root._unmountRecursive();
    assert.equal(root.mounted, false);
    assert.equal(mid.mounted, false);
    assert.equal(leaf.mounted, false);
  });

  test('double mount is idempotent', () => {
    const w = new TestWidget('w');
    w._mountRecursive();
    w._mountRecursive();
    assert.equal(w.mountCount, 1);
  });

  test('double unmount is idempotent', () => {
    const w = new TestWidget('w');
    w._mountRecursive();
    w._unmountRecursive();
    w._unmountRecursive();
    assert.equal(w.unmountCount, 1);
  });

  test('removeAll unmounts all children', () => {
    const parent = new TestWidget('parent');
    parent._mountRecursive();
    const a = new TestWidget('a');
    const b = new TestWidget('b');
    parent.add(a, b);
    assert.equal(a.mounted, true);
    parent.removeAll();
    assert.equal(a.mounted, false);
    assert.equal(b.mounted, false);
    assert.equal(a.unmountCount, 1);
    assert.equal(b.unmountCount, 1);
  });
});

describe('Widget dirty tracking', () => {
  test('starts dirty', () => {
    const w = new TestWidget();
    assert.equal(w.dirty, true);
  });

  test('clearDirty resets dirty flag', () => {
    const w = new TestWidget();
    w.clearDirty();
    assert.equal(w.dirty, false);
  });

  test('markDirty sets dirty flag', () => {
    const w = new TestWidget();
    w.clearDirty();
    w.markDirty();
    assert.equal(w.dirty, true);
  });

  test('markDirty propagates to parent', () => {
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    parent.clearDirty();
    child.clearDirty();
    child.markDirty();
    assert.equal(parent.dirty, true);
  });

  test('markDirty propagates up entire chain', () => {
    const root = new TestWidget('root');
    const mid = new TestWidget('mid');
    const leaf = new TestWidget('leaf');
    root.add(mid);
    mid.add(leaf);
    root.clearDirty();
    mid.clearDirty();
    leaf.clearDirty();
    leaf.markDirty();
    assert.equal(mid.dirty, true);
    assert.equal(root.dirty, true);
  });

  test('add marks parent dirty', () => {
    const parent = new TestWidget('parent');
    parent.clearDirty();
    parent.add(new TestWidget());
    assert.equal(parent.dirty, true);
  });

  test('remove marks parent dirty', () => {
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    parent.clearDirty();
    parent.remove(child);
    assert.equal(parent.dirty, true);
  });
});

describe('Widget focus', () => {
  test('focus on non-focusable is no-op', () => {
    const w = new TestWidget();
    w.focusable = false;
    w.focus();
    assert.equal(w.focused, false);
  });

  test('focus on focusable widget', () => {
    const w = new TestWidget();
    w.focusable = true;
    w.clearDirty();
    w.focus();
    assert.equal(w.focused, true);
    assert.equal(w.dirty, true);
  });

  test('blur clears focus', () => {
    const w = new TestWidget();
    w.focusable = true;
    w.focus();
    w.clearDirty();
    w.blur();
    assert.equal(w.focused, false);
    assert.equal(w.dirty, true);
  });

  test('unmount clears focus', () => {
    const parent = new TestWidget('parent');
    parent._mountRecursive();
    const child = new TestWidget('child');
    child.focusable = true;
    parent.add(child);
    child.focus();
    assert.equal(child.focused, true);
    parent.remove(child);
    assert.equal(child.focused, false);
  });
});

describe('Widget query', () => {
  test('queryOne finds by id', () => {
    const root = new TestWidget('root');
    const a = new TestWidget('a');
    const b = new TestWidget('b');
    root.add(a);
    a.add(b);
    assert.equal(root.queryOne('#b'), b);
  });

  test('queryOne returns null when not found', () => {
    const root = new TestWidget('root');
    assert.equal(root.queryOne('#missing'), null);
  });

  test('queryOne finds self', () => {
    const w = new TestWidget('self');
    assert.equal(w.queryOne('#self'), w);
  });

  test('queryAll finds by id', () => {
    const root = new TestWidget('root');
    const target = new TestWidget('target');
    root.add(target);
    const results = root.queryAll('#target');
    assert.equal(results.length, 1);
    assert.equal(results[0], target);
  });

  test('queryAll returns empty when not found', () => {
    const root = new TestWidget('root');
    assert.deepEqual(root.queryAll('#missing'), []);
  });

  test('unsupported selector returns null/empty', () => {
    const w = new TestWidget('w');
    assert.equal(w.queryOne('.class'), null);
    assert.deepEqual(w.queryAll('.class'), []);
  });
});

describe('Widget traversal', () => {
  test('ancestors returns path to root', () => {
    const root = new TestWidget('root');
    const mid = new TestWidget('mid');
    const leaf = new TestWidget('leaf');
    root.add(mid);
    mid.add(leaf);
    const ancestors = leaf.ancestors();
    assert.equal(ancestors.length, 2);
    assert.equal(ancestors[0], mid);
    assert.equal(ancestors[1], root);
  });

  test('ancestors of root is empty', () => {
    const root = new TestWidget('root');
    assert.deepEqual(root.ancestors(), []);
  });

  test('root returns topmost ancestor', () => {
    const root = new TestWidget('root');
    const mid = new TestWidget('mid');
    const leaf = new TestWidget('leaf');
    root.add(mid);
    mid.add(leaf);
    assert.equal(leaf.root(), root);
    assert.equal(mid.root(), root);
    assert.equal(root.root(), root);
  });
});
