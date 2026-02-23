import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import {
  Widget,
  edgeInsets,
  resetAutoIdCounter,
} from '../../../packages/harness-ui/src/widget/widget.ts';
import { computeLayout } from '../../../packages/harness-ui/src/widget/layout.ts';
import type {
  CellBuffer,
  ClippedCellBuffer,
} from '../../../packages/harness-ui/src/core/cell-buffer.ts';

class LayoutWidget extends Widget {
  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

function lw(
  id: string,
  props: Partial<
    Pick<
      Widget,
      | 'width'
      | 'height'
      | 'flexDirection'
      | 'flexGrow'
      | 'flexShrink'
      | 'gap'
      | 'padding'
      | 'margin'
      | 'alignItems'
      | 'justifyContent'
      | 'position'
      | 'left'
      | 'top'
      | 'visible'
    >
  > = {},
): LayoutWidget {
  const widget = new LayoutWidget(id);
  if (props.width !== undefined) widget.width = props.width;
  if (props.height !== undefined) widget.height = props.height;
  if (props.flexDirection !== undefined) widget.flexDirection = props.flexDirection;
  if (props.flexGrow !== undefined) widget.flexGrow = props.flexGrow;
  if (props.flexShrink !== undefined) widget.flexShrink = props.flexShrink;
  if (props.gap !== undefined) widget.gap = props.gap;
  if (props.padding !== undefined) widget.padding = props.padding;
  if (props.margin !== undefined) widget.margin = props.margin;
  if (props.alignItems !== undefined) widget.alignItems = props.alignItems;
  if (props.justifyContent !== undefined) widget.justifyContent = props.justifyContent;
  if (props.position !== undefined) widget.position = props.position;
  if (props.left !== undefined) widget.left = props.left;
  if (props.top !== undefined) widget.top = props.top;
  if (props.visible !== undefined) widget.visible = props.visible;
  return widget;
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('computeLayout root', () => {
  test('root gets full available size', () => {
    const root = lw('root');
    computeLayout(root, 80, 24);
    assert.deepEqual(root.computedRect, { x: 0, y: 0, width: 80, height: 24 });
    assert.deepEqual(root.absoluteRect, { x: 0, y: 0, width: 80, height: 24 });
  });

  test('clamps negative available size', () => {
    const root = lw('root');
    computeLayout(root, -5, -3);
    assert.equal(root.computedRect.width, 0);
    assert.equal(root.computedRect.height, 0);
  });
});

describe('column layout', () => {
  test('fixed-height children stack vertically', () => {
    const root = lw('root', { flexDirection: 'column' });
    const a = lw('a', { height: 5 });
    const b = lw('b', { height: 10 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.y, 0);
    assert.equal(a.computedRect.height, 5);
    assert.equal(a.computedRect.width, 80);
    assert.equal(b.computedRect.y, 5);
    assert.equal(b.computedRect.height, 10);
    assert.equal(b.computedRect.width, 80);
  });

  test('flexGrow distributes remaining space', () => {
    const root = lw('root', { flexDirection: 'column' });
    const a = lw('a', { height: 4 });
    const b = lw('b', { flexGrow: 1 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.height, 4);
    assert.equal(b.computedRect.y, 4);
    assert.equal(b.computedRect.height, 20);
  });

  test('two flexGrow children split space proportionally', () => {
    const root = lw('root', { flexDirection: 'column' });
    const a = lw('a', { flexGrow: 1 });
    const b = lw('b', { flexGrow: 3 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.height, 6);
    assert.equal(b.computedRect.height, 18);
  });

  test('gap adds space between children', () => {
    const root = lw('root', { flexDirection: 'column', gap: 2 });
    const a = lw('a', { height: 5 });
    const b = lw('b', { height: 5 });
    const c = lw('c', { height: 5 });
    root.add(a, b, c);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.y, 0);
    assert.equal(b.computedRect.y, 7);
    assert.equal(c.computedRect.y, 14);
  });

  test('percentage height', () => {
    const root = lw('root', { flexDirection: 'column' });
    const a = lw('a', { height: '50%' });
    root.add(a);
    computeLayout(root, 80, 20);
    assert.equal(a.computedRect.height, 10);
  });
});

describe('row layout', () => {
  test('fixed-width children line up horizontally', () => {
    const root = lw('root', { flexDirection: 'row' });
    const a = lw('a', { width: 20 });
    const b = lw('b', { width: 30 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.x, 0);
    assert.equal(a.computedRect.width, 20);
    assert.equal(a.computedRect.height, 24);
    assert.equal(b.computedRect.x, 20);
    assert.equal(b.computedRect.width, 30);
  });

  test('flexGrow in row', () => {
    const root = lw('root', { flexDirection: 'row' });
    const a = lw('a', { width: 10 });
    const b = lw('b', { flexGrow: 1 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.width, 10);
    assert.equal(b.computedRect.x, 10);
    assert.equal(b.computedRect.width, 70);
  });

  test('percentage width', () => {
    const root = lw('root', { flexDirection: 'row' });
    const a = lw('a', { width: '25%' });
    root.add(a);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.width, 20);
  });

  test('gap in row', () => {
    const root = lw('root', { flexDirection: 'row', gap: 1 });
    const a = lw('a', { width: 10 });
    const b = lw('b', { width: 10 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.x, 0);
    assert.equal(b.computedRect.x, 11);
  });
});

describe('padding', () => {
  test('padding insets children', () => {
    const root = lw('root', { padding: edgeInsets(2, 3) });
    const child = lw('child', { flexGrow: 1 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.absoluteRect.x, 3);
    assert.equal(child.absoluteRect.y, 2);
    assert.equal(child.computedRect.width, 74);
    assert.equal(child.computedRect.height, 20);
  });
});

describe('margin', () => {
  test('margin offsets child within parent', () => {
    const root = lw('root', { flexDirection: 'column' });
    const child = lw('child', { height: 5, margin: edgeInsets(1, 2) });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.x, 2);
    assert.equal(child.computedRect.y, 1);
    assert.equal(child.computedRect.width, 76);
    assert.equal(child.computedRect.height, 5);
  });
});

describe('flexShrink', () => {
  test('shrinks children when overflow', () => {
    const root = lw('root', { flexDirection: 'column' });
    const a = lw('a', { height: 15, flexShrink: 1 });
    const b = lw('b', { height: 15, flexShrink: 1 });
    root.add(a, b);
    computeLayout(root, 80, 20);
    assert.ok(a.computedRect.height < 15);
    assert.ok(b.computedRect.height < 15);
    assert.equal(a.computedRect.height + b.computedRect.height, 20);
  });

  test('flexShrink 0 prevents shrinking', () => {
    const root = lw('root', { flexDirection: 'column' });
    const a = lw('a', { height: 15, flexShrink: 0 });
    const b = lw('b', { height: 15, flexShrink: 1 });
    root.add(a, b);
    computeLayout(root, 80, 20);
    assert.equal(a.computedRect.height, 15);
    assert.equal(b.computedRect.height, 5);
  });
});

describe('justifyContent', () => {
  test('center pushes children to center', () => {
    const root = lw('root', { flexDirection: 'column', justifyContent: 'center' });
    const child = lw('child', { height: 4 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.y, 10);
  });

  test('end pushes children to end', () => {
    const root = lw('root', { flexDirection: 'column', justifyContent: 'end' });
    const child = lw('child', { height: 4 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.y, 20);
  });

  test('space-between distributes space', () => {
    const root = lw('root', { flexDirection: 'column', justifyContent: 'space-between' });
    const a = lw('a', { height: 2 });
    const b = lw('b', { height: 2 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(a.computedRect.y, 0);
    assert.equal(b.computedRect.y, 22);
  });
});

describe('alignItems', () => {
  test('center aligns on cross axis (row)', () => {
    const root = lw('root', { flexDirection: 'row', alignItems: 'center' });
    const child = lw('child', { width: 10, height: 4 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.y, 10);
  });

  test('end aligns on cross axis (row)', () => {
    const root = lw('root', { flexDirection: 'row', alignItems: 'end' });
    const child = lw('child', { width: 10, height: 4 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.y, 20);
  });

  test('start aligns at start (row)', () => {
    const root = lw('root', { flexDirection: 'row', alignItems: 'start' });
    const child = lw('child', { width: 10, height: 4 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.y, 0);
  });

  test('stretch fills cross axis (default)', () => {
    const root = lw('root', { flexDirection: 'row' });
    const child = lw('child', { width: 10 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.height, 24);
  });
});

describe('absolute positioning', () => {
  test('absolute child uses left/top offsets', () => {
    const root = lw('root');
    const child = lw('child', { position: 'absolute', left: 5, top: 3, width: 20, height: 10 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.x, 5);
    assert.equal(child.computedRect.y, 3);
    assert.equal(child.computedRect.width, 20);
    assert.equal(child.computedRect.height, 10);
  });

  test('absolute child does not affect siblings', () => {
    const root = lw('root', { flexDirection: 'column' });
    const abs = lw('abs', { position: 'absolute', left: 0, top: 0, width: 80, height: 24 });
    const rel = lw('rel', { height: 5 });
    root.add(abs, rel);
    computeLayout(root, 80, 24);
    assert.equal(rel.computedRect.y, 0);
    assert.equal(rel.computedRect.height, 5);
  });
});

describe('invisible children', () => {
  test('invisible children get zero rect', () => {
    const root = lw('root', { flexDirection: 'column' });
    const child = lw('child', { height: 10, visible: false });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.computedRect.width, 0);
    assert.equal(child.computedRect.height, 0);
  });

  test('invisible children do not occupy space', () => {
    const root = lw('root', { flexDirection: 'column' });
    const a = lw('a', { height: 5, visible: false });
    const b = lw('b', { height: 5 });
    root.add(a, b);
    computeLayout(root, 80, 24);
    assert.equal(b.computedRect.y, 0);
  });
});

describe('nested layout', () => {
  test('nested containers compute absolute positions', () => {
    const root = lw('root', { flexDirection: 'column' });
    const header = lw('header', { height: 3 });
    const body = lw('body', { flexGrow: 1, flexDirection: 'row' });
    const left = lw('left', { width: 20 });
    const right = lw('right', { flexGrow: 1 });
    root.add(header, body);
    body.add(left, right);
    computeLayout(root, 80, 24);
    assert.equal(header.absoluteRect.y, 0);
    assert.equal(header.absoluteRect.height, 3);
    assert.equal(body.absoluteRect.y, 3);
    assert.equal(body.absoluteRect.height, 21);
    assert.equal(left.absoluteRect.x, 0);
    assert.equal(left.absoluteRect.y, 3);
    assert.equal(left.absoluteRect.width, 20);
    assert.equal(left.absoluteRect.height, 21);
    assert.equal(right.absoluteRect.x, 20);
    assert.equal(right.absoluteRect.y, 3);
    assert.equal(right.absoluteRect.width, 60);
    assert.equal(right.absoluteRect.height, 21);
  });

  test('padding + nested layout', () => {
    const root = lw('root', { flexDirection: 'column', padding: edgeInsets(1) });
    const child = lw('child', { flexGrow: 1 });
    root.add(child);
    computeLayout(root, 80, 24);
    assert.equal(child.absoluteRect.x, 1);
    assert.equal(child.absoluteRect.y, 1);
    assert.equal(child.absoluteRect.width, 78);
    assert.equal(child.absoluteRect.height, 22);
  });
});
