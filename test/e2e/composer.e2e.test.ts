import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { ComposerSubmitted } from '../../packages/harness-ui/src/widgets/composer.ts';
import { Composer, ComposerWidget } from '../../packages/harness-ui/src/widgets/composer.ts';
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

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Composer basic input', () => {
  test('typing adds characters', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('h');
    pilot.pressKey('i');
    assert.equal(c.value, 'hi');
  });

  test('enter submits and clears', () => {
    let submitted = '';
    class Handler extends RootWidget {
      onComposerSubmitted(msg: ComposerSubmitted): void {
        submitted = msg.value;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const c = Composer({ id: 'c', flexGrow: 1 });
    r.add(c);
    const pilot = createTestPilot(r, { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('h');
    pilot.pressKey('i');
    pilot.pressKey('enter');
    assert.equal(submitted, 'hi');
    assert.equal(c.value, '');
  });

  test('enter on empty does not submit', () => {
    let submitted = false;
    class Handler extends RootWidget {
      onComposerSubmitted(): void {
        submitted = true;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const c = Composer({ id: 'c', flexGrow: 1 });
    r.add(c);
    const pilot = createTestPilot(r, { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('enter');
    assert.equal(submitted, false);
  });

  test('shift+enter inserts newline', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(c);
    pilot.pressKey('a');
    pilot.pressKey('shift+enter');
    pilot.pressKey('b');
    assert.equal(c.value, 'a\nb');
  });

  test('ctrl+c clears input', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('h');
    pilot.pressKey('i');
    pilot.pressKey('ctrl+c');
    assert.equal(c.value, '');
  });
});

describe('Composer word movement', () => {
  test('alt+right moves to next word boundary', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello world foo';
    c.cursorPos = 0;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('alt+right');
    assert.equal(c.cursorPos, 5);
  });

  test('alt+left moves to previous word boundary', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello world';
    c.cursorPos = 8;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('alt+left');
    assert.equal(c.cursorPos, 6);
  });
});

describe('Composer kill-line', () => {
  test('ctrl+k kills to end of line', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello world';
    c.cursorPos = 5;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('ctrl+k');
    assert.equal(c.value, 'hello');
  });

  test('ctrl+u kills to start of line', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello world';
    c.cursorPos = 6;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('ctrl+u');
    assert.equal(c.value, 'world');
    assert.equal(c.cursorPos, 0);
  });
});

describe('Composer word delete', () => {
  test('ctrl+backspace deletes word backward', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello world';
    c.cursorPos = 11;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('ctrl+backspace');
    assert.equal(c.value, 'hello ');
  });

  test('alt+delete deletes word forward', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello world';
    c.cursorPos = 0;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('alt+delete');
    assert.equal(c.value, ' world');
  });
});

describe('Composer undo/redo', () => {
  test('ctrl+z undoes last change', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('a');
    pilot.pressKey('b');
    pilot.pressKey('c');
    assert.equal(c.value, 'abc');
    pilot.pressKey('ctrl+z');
    assert.equal(c.value, 'ab');
    pilot.pressKey('ctrl+z');
    assert.equal(c.value, 'a');
  });
});

describe('Composer history', () => {
  test('up recalls previous submission', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('h');
    pilot.pressKey('i');
    pilot.pressKey('enter');
    pilot.pressKey('up');
    assert.equal(c.value, 'hi');
  });

  test('down after history recall returns to empty', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('a');
    pilot.pressKey('enter');
    pilot.pressKey('up');
    assert.equal(c.value, 'a');
    pilot.pressKey('down');
    assert.equal(c.value, '');
  });

  test('multiple submissions in history', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('a');
    pilot.pressKey('enter');
    pilot.pressKey('b');
    pilot.pressKey('enter');
    pilot.pressKey('c');
    pilot.pressKey('enter');
    pilot.pressKey('up');
    assert.equal(c.value, 'c');
    pilot.pressKey('up');
    assert.equal(c.value, 'b');
    pilot.pressKey('up');
    assert.equal(c.value, 'a');
  });
});

describe('Composer line navigation', () => {
  test('ctrl+a moves to start of line', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello';
    c.cursorPos = 3;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('ctrl+a');
    assert.equal(c.cursorPos, 0);
  });

  test('ctrl+e moves to end of line', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    c.value = 'hello';
    c.cursorPos = 0;
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('ctrl+e');
    assert.equal(c.cursorPos, 5);
  });
});

describe('Composer rendering', () => {
  test('shows placeholder when empty and unfocused', () => {
    const c = Composer({ id: 'c', placeholder: 'Ask me...', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.expectRow(0).toContain('Ask me...');
  });

  test('shows mode indicator', () => {
    const c = Composer({ id: 'c', modeIndicator: '[Build]', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 3 });
    pilot.expectScreen().toContainRow('[Build]');
  });

  test('cursor visible when focused', () => {
    const c = Composer({ id: 'c', flexGrow: 1 });
    const pilot = createTestPilot(root([c]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(c);
    pilot.pressKey('x');
    pilot.expectCell(1, 0).toHaveStyle({ inverse: true });
  });
});

describe('Composer factory', () => {
  test('returns ComposerWidget', () => {
    const c = Composer({});
    if (!(c instanceof ComposerWidget)) throw new Error('should be ComposerWidget');
    if (!(c instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    assert.equal(Composer({}).focusable, true);
  });
});
