import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../../packages/harness-ui/src/widget/widget.ts';
import {
  normalizeKeyString,
  keyEventToString,
  actionMethodName,
  resolveKeybinding,
  dispatchKeyToBindings,
  collectAllBindings,
  LeaderKeyState,
  type Binding,
} from '../../../packages/harness-ui/src/widget/keybinding.ts';
import type { KeyEvent } from '../../../packages/harness-ui/src/widget/input.ts';
import type {
  CellBuffer,
  ClippedCellBuffer,
} from '../../../packages/harness-ui/src/core/cell-buffer.ts';

class TestWidget extends Widget {
  render(_buffer: CellBuffer | ClippedCellBuffer): void {}
}

function mkKey(key: string, ctrl = false, alt = false, shift = false): KeyEvent {
  return { key, raw: Buffer.from([]), ctrl, alt, shift };
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('normalizeKeyString', () => {
  test('simple key', () => {
    assert.equal(normalizeKeyString('a'), 'a');
  });

  test('ctrl+key', () => {
    assert.equal(normalizeKeyString('ctrl+s'), 'ctrl+s');
  });

  test('normalizes order', () => {
    assert.equal(normalizeKeyString('shift+ctrl+a'), 'ctrl+shift+a');
  });

  test('case insensitive', () => {
    assert.equal(normalizeKeyString('Ctrl+S'), 'ctrl+s');
  });

  test('trims whitespace', () => {
    assert.equal(normalizeKeyString(' ctrl + s '), 'ctrl+s');
  });
});

describe('keyEventToString', () => {
  test('plain key', () => {
    assert.equal(keyEventToString(mkKey('a')), 'a');
  });

  test('ctrl+key', () => {
    assert.equal(keyEventToString(mkKey('c', true)), 'ctrl+c');
  });

  test('alt+key', () => {
    assert.equal(keyEventToString(mkKey('x', false, true)), 'alt+x');
  });

  test('ctrl+shift+key', () => {
    assert.equal(keyEventToString(mkKey('up', true, false, true)), 'ctrl+shift+up');
  });

  test('shift on single char is not included', () => {
    assert.equal(keyEventToString(mkKey('A', false, false, true)), 'a');
  });

  test('shift on named key is included', () => {
    assert.equal(keyEventToString(mkKey('tab', false, false, true)), 'shift+tab');
  });
});

describe('actionMethodName', () => {
  test('simple action', () => {
    assert.equal(actionMethodName('save'), 'actionSave');
  });

  test('hyphenated action', () => {
    assert.equal(actionMethodName('select-all'), 'actionSelectAll');
  });

  test('dotted action', () => {
    assert.equal(actionMethodName('file.open'), 'actionFileOpen');
  });

  test('underscored action', () => {
    assert.equal(actionMethodName('new_tab'), 'actionNewTab');
  });
});

describe('resolveKeybinding', () => {
  test('returns null with no focused widget', () => {
    assert.equal(resolveKeybinding(null, mkKey('a')), null);
  });

  test('resolves binding on focused widget', () => {
    class BoundWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+s', action: 'save' }];
    }

    const w = new BoundWidget('w');
    const result = resolveKeybinding(w, mkKey('s', true));
    assert.notEqual(result, null);
    assert.equal(result!.widget, w);
    assert.equal(result!.binding.action, 'save');
    assert.equal(result!.actionMethod, 'actionSave');
  });

  test('resolves binding on ancestor', () => {
    class ParentWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+q', action: 'quit' }];
    }

    const parent = new ParentWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    const result = resolveKeybinding(child, mkKey('q', true));
    assert.notEqual(result, null);
    assert.equal(result!.widget, parent);
    assert.equal(result!.binding.action, 'quit');
  });

  test('focused widget binding takes priority over ancestor', () => {
    class ParentWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'enter', action: 'parent-enter' }];
    }

    class ChildWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'enter', action: 'child-enter' }];
    }

    const parent = new ParentWidget('parent');
    const child = new ChildWidget('child');
    parent.add(child);
    const result = resolveKeybinding(child, mkKey('enter'));
    assert.notEqual(result, null);
    assert.equal(result!.binding.action, 'child-enter');
  });

  test('returns null when no binding matches', () => {
    class BoundWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+s', action: 'save' }];
    }

    const w = new BoundWidget('w');
    assert.equal(resolveKeybinding(w, mkKey('a')), null);
  });

  test('widget with no BINDINGS is skipped', () => {
    const parent = new TestWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    assert.equal(resolveKeybinding(child, mkKey('a')), null);
  });
});

describe('dispatchKeyToBindings', () => {
  test('calls action method and returns true', () => {
    let called = false;

    class BoundWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+s', action: 'save' }];
      actionSave(): void {
        called = true;
      }
    }

    const w = new BoundWidget('w');
    const result = dispatchKeyToBindings(w, mkKey('s', true));
    assert.equal(result, true);
    assert.equal(called, true);
  });

  test('returns false when no binding matches', () => {
    const w = new TestWidget('w');
    assert.equal(dispatchKeyToBindings(w, mkKey('a')), false);
  });

  test('returns false when action method missing', () => {
    class BoundWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+s', action: 'save' }];
    }

    const w = new BoundWidget('w');
    assert.equal(dispatchKeyToBindings(w, mkKey('s', true)), false);
  });

  test('dispatches to ancestor action', () => {
    let called = false;

    class ParentWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+q', action: 'quit' }];
      actionQuit(): void {
        called = true;
      }
    }

    const parent = new ParentWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);
    dispatchKeyToBindings(child, mkKey('q', true));
    assert.equal(called, true);
  });
});

describe('collectAllBindings', () => {
  test('collects from nested tree', () => {
    class A extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+a', action: 'action-a', description: 'Action A' }];
    }
    class B extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+b', action: 'action-b', description: 'Action B' }];
    }

    const root = new TestWidget('root');
    root.add(new A('a'), new B('b'));
    const all = collectAllBindings(root);
    assert.equal(all.length, 2);
    assert.equal(all[0]!.binding.action, 'action-a');
    assert.equal(all[1]!.binding.action, 'action-b');
  });

  test('empty tree returns empty', () => {
    const root = new TestWidget('root');
    assert.deepEqual(collectAllBindings(root), []);
  });
});

describe('LeaderKeyState', () => {
  test('leader key enters pending state', () => {
    const leader = new LeaderKeyState('ctrl+x');
    assert.equal(leader.pending, false);
    const handled = leader.dispatch(null, mkKey('x', true));
    assert.equal(handled, true);
    assert.equal(leader.pending, true);
  });

  test('second key after leader dispatches leader binding', () => {
    let called = false;
    class LeaderWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: '<leader> n', action: 'new-session' }];
      actionNewSession(): void {
        called = true;
      }
    }
    const w = new LeaderWidget('w');
    const leader = new LeaderKeyState('ctrl+x');
    leader.dispatch(w, mkKey('x', true));
    assert.equal(leader.pending, true);
    const handled = leader.dispatch(w, mkKey('n'));
    assert.equal(handled, true);
    assert.equal(called, true);
    assert.equal(leader.pending, false);
  });

  test('non-leader key falls through to normal dispatch', () => {
    let called = false;
    class NormalWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+s', action: 'save' }];
      actionSave(): void {
        called = true;
      }
    }
    const w = new NormalWidget('w');
    const leader = new LeaderKeyState('ctrl+x');
    const handled = leader.dispatch(w, mkKey('s', true));
    assert.equal(handled, true);
    assert.equal(called, true);
    assert.equal(leader.pending, false);
  });

  test('unmatched second key clears pending', () => {
    const leader = new LeaderKeyState('ctrl+x');
    leader.dispatch(null, mkKey('x', true));
    assert.equal(leader.pending, true);
    leader.dispatch(null, mkKey('z'));
    assert.equal(leader.pending, false);
  });

  test('cancel clears pending state', () => {
    const leader = new LeaderKeyState('ctrl+x');
    leader.dispatch(null, mkKey('x', true));
    leader.cancel();
    assert.equal(leader.pending, false);
  });

  test('setLeader changes leader key', () => {
    const leader = new LeaderKeyState('ctrl+x');
    assert.equal(leader.leader, 'ctrl+x');
    leader.setLeader('ctrl+a');
    assert.equal(leader.leader, 'ctrl+a');
    const handled = leader.dispatch(null, mkKey('a', true));
    assert.equal(handled, true);
    assert.equal(leader.pending, true);
  });

  test('multiple leader bindings on same widget', () => {
    const results: string[] = [];
    class MultiWidget extends TestWidget {
      static BINDINGS: Binding[] = [
        { key: '<leader> n', action: 'new' },
        { key: '<leader> s', action: 'save' },
        { key: '<leader> q', action: 'quit' },
      ];
      actionNew(): void {
        results.push('new');
      }
      actionSave(): void {
        results.push('save');
      }
      actionQuit(): void {
        results.push('quit');
      }
    }
    const w = new MultiWidget('w');
    const leader = new LeaderKeyState('ctrl+x');

    leader.dispatch(w, mkKey('x', true));
    leader.dispatch(w, mkKey('n'));
    leader.dispatch(w, mkKey('x', true));
    leader.dispatch(w, mkKey('s'));
    leader.dispatch(w, mkKey('x', true));
    leader.dispatch(w, mkKey('q'));
    assert.deepEqual(results, ['new', 'save', 'quit']);
  });

  test('leader binding on ancestor widget', () => {
    let called = false;
    class ParentWidget extends TestWidget {
      static BINDINGS: Binding[] = [{ key: '<leader> h', action: 'help' }];
      actionHelp(): void {
        called = true;
      }
    }
    const parent = new ParentWidget('parent');
    const child = new TestWidget('child');
    parent.add(child);

    const leader = new LeaderKeyState('ctrl+x');
    leader.dispatch(child, mkKey('x', true));
    leader.dispatch(child, mkKey('h'));
    assert.equal(called, true);
  });
});
