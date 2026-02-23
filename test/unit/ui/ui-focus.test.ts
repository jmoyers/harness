import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../../packages/harness-ui/src/widget/widget.ts';
import { FocusManager } from '../../../packages/harness-ui/src/widget/focus.ts';
import type {
  CellBuffer,
  ClippedCellBuffer,
} from '../../../packages/harness-ui/src/core/cell-buffer.ts';

class TestWidget extends Widget {
  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

function fw(id: string, focusable = true): TestWidget {
  const w = new TestWidget(id);
  w.focusable = focusable;
  return w;
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('FocusManager basics', () => {
  test('starts with no focus', () => {
    const fm = new FocusManager();
    assert.equal(fm.focused, null);
  });

  test('focus sets focused widget', () => {
    const fm = new FocusManager();
    const w = fw('w');
    fm.focus(w);
    assert.equal(fm.focused, w);
    assert.equal(w.focused, true);
  });

  test('focus non-focusable is ignored', () => {
    const fm = new FocusManager();
    const w = fw('w', false);
    fm.focus(w);
    assert.equal(fm.focused, null);
  });

  test('focus invisible is ignored', () => {
    const fm = new FocusManager();
    const w = fw('w');
    w.visible = false;
    fm.focus(w);
    assert.equal(fm.focused, null);
  });

  test('focus blurs previous widget', () => {
    const fm = new FocusManager();
    const a = fw('a');
    const b = fw('b');
    fm.focus(a);
    fm.focus(b);
    assert.equal(fm.focused, b);
    assert.equal(a.focused, false);
    assert.equal(b.focused, true);
  });

  test('blur clears focus', () => {
    const fm = new FocusManager();
    const w = fw('w');
    fm.focus(w);
    fm.blur();
    assert.equal(fm.focused, null);
    assert.equal(w.focused, false);
  });

  test('blur with nothing focused is no-op', () => {
    const fm = new FocusManager();
    fm.blur();
    assert.equal(fm.focused, null);
  });
});

describe('FocusManager tab order', () => {
  test('focusOrder collects focusable widgets depth-first', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    const a = fw('a');
    const b = fw('b');
    const c = fw('c');
    root.add(a, b, c);
    fm.setRoot(root);
    const order = fm.focusOrder();
    assert.equal(order.length, 3);
    assert.equal(order[0]!.id, 'a');
    assert.equal(order[1]!.id, 'b');
    assert.equal(order[2]!.id, 'c');
  });

  test('focusOrder skips non-focusable', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    root.add(fw('a'), fw('b', false), fw('c'));
    fm.setRoot(root);
    const order = fm.focusOrder();
    assert.equal(order.length, 2);
    assert.equal(order[0]!.id, 'a');
    assert.equal(order[1]!.id, 'c');
  });

  test('focusOrder skips invisible subtrees', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    const container = new TestWidget('container');
    container.visible = false;
    container.add(fw('hidden'));
    root.add(fw('visible'), container);
    fm.setRoot(root);
    const order = fm.focusOrder();
    assert.equal(order.length, 1);
    assert.equal(order[0]!.id, 'visible');
  });

  test('focusOrder is nested depth-first', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    const group = new TestWidget('group');
    group.add(fw('inner'));
    root.add(fw('first'), group, fw('last'));
    fm.setRoot(root);
    const order = fm.focusOrder();
    assert.equal(order.length, 3);
    assert.equal(order[0]!.id, 'first');
    assert.equal(order[1]!.id, 'inner');
    assert.equal(order[2]!.id, 'last');
  });
});

describe('FocusManager cycling', () => {
  test('focusNext from no focus goes to first', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    root.add(fw('a'), fw('b'));
    fm.setRoot(root);
    const focused = fm.focusNext();
    assert.equal(focused!.id, 'a');
    assert.equal(fm.focused!.id, 'a');
  });

  test('focusNext cycles forward', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    const a = fw('a');
    const b = fw('b');
    const c = fw('c');
    root.add(a, b, c);
    fm.setRoot(root);
    fm.focus(a);
    fm.focusNext();
    assert.equal(fm.focused!.id, 'b');
    fm.focusNext();
    assert.equal(fm.focused!.id, 'c');
  });

  test('focusNext wraps around', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    const a = fw('a');
    const b = fw('b');
    root.add(a, b);
    fm.setRoot(root);
    fm.focus(b);
    fm.focusNext();
    assert.equal(fm.focused!.id, 'a');
  });

  test('focusPrevious cycles backward', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    const a = fw('a');
    const b = fw('b');
    const c = fw('c');
    root.add(a, b, c);
    fm.setRoot(root);
    fm.focus(b);
    fm.focusPrevious();
    assert.equal(fm.focused!.id, 'a');
  });

  test('focusPrevious wraps around', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    const a = fw('a');
    const b = fw('b');
    root.add(a, b);
    fm.setRoot(root);
    fm.focus(a);
    fm.focusPrevious();
    assert.equal(fm.focused!.id, 'b');
  });

  test('focusNext with no focusable returns null', () => {
    const fm = new FocusManager();
    const root = new TestWidget('root');
    fm.setRoot(root);
    assert.equal(fm.focusNext(), null);
  });

  test('focusNext with no root returns null', () => {
    const fm = new FocusManager();
    assert.equal(fm.focusNext(), null);
  });
});

describe('FocusManager removal', () => {
  test('handleRemovedWidget clears focused if removed', () => {
    const fm = new FocusManager();
    const w = fw('w');
    fm.focus(w);
    fm.handleRemovedWidget(w);
    assert.equal(fm.focused, null);
  });

  test('handleRemovedWidget ignores non-focused widget', () => {
    const fm = new FocusManager();
    const a = fw('a');
    const b = fw('b');
    fm.focus(a);
    fm.handleRemovedWidget(b);
    assert.equal(fm.focused, a);
  });
});
