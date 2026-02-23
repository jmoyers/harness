import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { TextAreaChanged } from '../../packages/harness-ui/src/widgets/text-area.ts';
import { TextArea, TextAreaWidget } from '../../packages/harness-ui/src/widgets/text-area.ts';
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

describe('TextArea rendering', () => {
  test('shows placeholder when empty and unfocused', () => {
    const ta = TextArea({ id: 'ta', placeholder: 'Notes...', height: 3, flexGrow: 1 });
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('Notes...');
  });

  test('shows text content', () => {
    const ta = TextArea({ id: 'ta', value: 'hello\nworld', height: 3, flexGrow: 1 });
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('hello');
    pilot.expectRow(1).toContain('world');
  });

  test('shows cursor when focused', () => {
    const ta = TextArea({ id: 'ta', value: 'ab', height: 1, flexGrow: 1 });
    const pilot = createTestPilot(root([ta]), { cols: 10, rows: 1 });
    pilot.focusManager.focus(ta);
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(2, 0).toHaveStyle({ inverse: true });
  });
});

describe('TextArea typing', () => {
  test('typing adds characters', () => {
    const ta = TextArea({ id: 'ta', height: 3, flexGrow: 1 });
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('h');
    pilot.pressKey('i');
    assert.equal(ta.value, 'hi');
  });

  test('enter inserts newline', () => {
    const ta = TextArea({ id: 'ta', value: 'ab', height: 3, flexGrow: 1 });
    ta.cursorPos = 1;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('enter');
    assert.equal(ta.value, 'a\nb');
    assert.equal(ta.cursorPos, 2);
  });

  test('backspace removes character', () => {
    const ta = TextArea({ id: 'ta', value: 'abc', height: 3, flexGrow: 1 });
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('backspace');
    assert.equal(ta.value, 'ab');
  });

  test('backspace joins lines', () => {
    const ta = TextArea({ id: 'ta', value: 'a\nb', height: 3, flexGrow: 1 });
    ta.cursorPos = 2;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('backspace');
    assert.equal(ta.value, 'ab');
  });

  test('delete removes character at cursor', () => {
    const ta = TextArea({ id: 'ta', value: 'abc', height: 3, flexGrow: 1 });
    ta.cursorPos = 0;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('delete');
    assert.equal(ta.value, 'bc');
  });
});

describe('TextArea cursor movement', () => {
  test('left/right moves within line', () => {
    const ta = TextArea({ id: 'ta', value: 'abc', height: 1, flexGrow: 1 });
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(ta);
    assert.equal(ta.cursorPos, 3);
    pilot.pressKey('left');
    assert.equal(ta.cursorPos, 2);
    pilot.pressKey('right');
    assert.equal(ta.cursorPos, 3);
  });

  test('up/down moves between lines', () => {
    const ta = TextArea({ id: 'ta', value: 'abc\ndef\nghi', height: 5, flexGrow: 1 });
    ta.cursorPos = 1;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('down');
    assert.equal(ta.cursorPos, 5);
    pilot.pressKey('down');
    assert.equal(ta.cursorPos, 9);
    pilot.pressKey('up');
    assert.equal(ta.cursorPos, 5);
  });

  test('up at first line stays', () => {
    const ta = TextArea({ id: 'ta', value: 'abc\ndef', height: 3, flexGrow: 1 });
    ta.cursorPos = 1;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('up');
    assert.equal(ta.cursorPos, 1);
  });

  test('down at last line stays', () => {
    const ta = TextArea({ id: 'ta', value: 'abc\ndef', height: 3, flexGrow: 1 });
    ta.cursorPos = 5;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('down');
    assert.equal(ta.cursorPos, 5);
  });

  test('home goes to start of line', () => {
    const ta = TextArea({ id: 'ta', value: 'abc\ndef', height: 3, flexGrow: 1 });
    ta.cursorPos = 6;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('home');
    assert.equal(ta.cursorPos, 4);
  });

  test('end goes to end of line', () => {
    const ta = TextArea({ id: 'ta', value: 'abc\ndef', height: 3, flexGrow: 1 });
    ta.cursorPos = 4;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('end');
    assert.equal(ta.cursorPos, 7);
  });

  test('vertical move clamps column to shorter line', () => {
    const ta = TextArea({ id: 'ta', value: 'abcdef\nhi', height: 3, flexGrow: 1 });
    ta.cursorPos = 5;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('down');
    assert.equal(ta.cursorPos, 9);
  });
});

describe('TextArea scrolling', () => {
  test('scrolls down when cursor moves past viewport', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const ta = TextArea({ id: 'ta', value: lines.join('\n'), height: 3, flexGrow: 1 });
    ta.cursorPos = 0;
    const pilot = createTestPilot(root([ta]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    for (let i = 0; i < 5; i += 1) pilot.pressKey('down');
    assert.ok(ta.scrollTop > 0);
    pilot.expectScreen().toContainRow('line5');
  });
});

describe('TextArea messages', () => {
  test('typing emits TextAreaChanged', () => {
    const changes: string[] = [];
    class Handler extends RootWidget {
      onTextAreaChanged(msg: TextAreaChanged): void {
        changes.push(msg.value);
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const ta = TextArea({ id: 'ta', height: 3, flexGrow: 1 });
    r.add(ta);
    const pilot = createTestPilot(r, { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('a');
    pilot.pressKey('b');
    assert.deepEqual(changes, ['a', 'ab']);
  });

  test('enter emits TextAreaChanged (not submitted)', () => {
    const changes: string[] = [];
    class Handler extends RootWidget {
      onTextAreaChanged(msg: TextAreaChanged): void {
        changes.push(msg.value);
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const ta = TextArea({ id: 'ta', value: 'x', height: 3, flexGrow: 1 });
    r.add(ta);
    const pilot = createTestPilot(r, { cols: 20, rows: 3 });
    pilot.focusManager.focus(ta);
    pilot.pressKey('enter');
    assert.equal(changes.length, 1);
    assert.ok(changes[0]!.includes('\n'));
  });
});

describe('TextArea factory', () => {
  test('returns TextAreaWidget', () => {
    const ta = TextArea({ id: 'test' });
    if (!(ta instanceof TextAreaWidget)) throw new Error('should be TextAreaWidget');
    if (!(ta instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    assert.equal(TextArea({}).focusable, true);
  });

  test('lineCount returns correct count', () => {
    const ta = TextArea({ value: 'a\nb\nc' });
    assert.equal(ta.lineCount, 3);
  });
});
