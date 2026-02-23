import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type {
  InputChanged,
  InputSubmitted,
} from '../../packages/harness-ui/src/widgets/text-input.ts';
import { TextInput, TextInputWidget } from '../../packages/harness-ui/src/widgets/text-input.ts';
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

describe('TextInput rendering', () => {
  test('shows placeholder when empty and unfocused', () => {
    const input = TextInput({ id: 'inp', placeholder: 'Type here...' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.expectRow(0).toContain('Type here...');
  });

  test('shows value when set', () => {
    const input = TextInput({ id: 'inp', value: 'hello' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.expectRow(0).toContain('hello');
  });

  test('shows cursor when focused', () => {
    const input = TextInput({ id: 'inp', value: '' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('█');
  });

  test('hides placeholder when focused with empty value', () => {
    const input = TextInput({ id: 'inp', placeholder: 'Search' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).not.toContain('Search');
  });
});

describe('TextInput typing', () => {
  test('typing adds characters', () => {
    const input = TextInput({ id: 'inp' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('a');
    pilot.pressKey('b');
    pilot.pressKey('c');
    assert.equal(input.value, 'abc');
    pilot.expectRow(0).toContain('abc');
  });

  test('backspace removes character before cursor', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('backspace');
    assert.equal(input.value, 'ab');
  });

  test('delete removes character at cursor', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    input.cursorPos = 0;
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('delete');
    assert.equal(input.value, 'bc');
  });

  test('backspace at start is no-op', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    input.cursorPos = 0;
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('backspace');
    assert.equal(input.value, 'abc');
  });

  test('delete at end is no-op', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('delete');
    assert.equal(input.value, 'abc');
  });
});

describe('TextInput cursor movement', () => {
  test('left moves cursor back', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    assert.equal(input.cursorPos, 3);
    pilot.pressKey('left');
    assert.equal(input.cursorPos, 2);
  });

  test('right moves cursor forward', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    input.cursorPos = 1;
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('right');
    assert.equal(input.cursorPos, 2);
  });

  test('left at start stays at 0', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    input.cursorPos = 0;
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('left');
    assert.equal(input.cursorPos, 0);
  });

  test('right at end stays at length', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('right');
    assert.equal(input.cursorPos, 3);
  });

  test('home moves to start', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('home');
    assert.equal(input.cursorPos, 0);
  });

  test('end moves to end', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    input.cursorPos = 0;
    const pilot = createTestPilot(root([input]), { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('end');
    assert.equal(input.cursorPos, 3);
  });
});

describe('TextInput messages', () => {
  test('enter emits InputSubmitted', () => {
    let submitted = '';
    class Handler extends RootWidget {
      onInputSubmitted(msg: InputSubmitted): void {
        submitted = msg.value;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const input = TextInput({ id: 'inp', value: 'hello' });
    r.add(input);
    const pilot = createTestPilot(r, { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('enter');
    assert.equal(submitted, 'hello');
  });

  test('typing emits InputChanged', () => {
    const changes: string[] = [];
    class Handler extends RootWidget {
      onInputChanged(msg: InputChanged): void {
        changes.push(msg.value);
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const input = TextInput({ id: 'inp' });
    r.add(input);
    const pilot = createTestPilot(r, { cols: 20, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.pressKey('a');
    pilot.pressKey('b');
    assert.deepEqual(changes, ['a', 'ab']);
  });
});

describe('TextInput cursor rendering', () => {
  test('cursor at end shows block after text', () => {
    const input = TextInput({ id: 'inp', value: 'hi' });
    const pilot = createTestPilot(root([input]), { cols: 10, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(2, 0).toHaveStyle({ inverse: true });
  });

  test('cursor in middle highlights character', () => {
    const input = TextInput({ id: 'inp', value: 'abc' });
    input.cursorPos = 1;
    const pilot = createTestPilot(root([input]), { cols: 10, rows: 1 });
    pilot.focusManager.focus(input);
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(1, 0).toHaveStyle({ inverse: true });
  });
});

describe('TextInput factory', () => {
  test('returns TextInputWidget', () => {
    const input = TextInput({ id: 'test' });
    if (!(input instanceof TextInputWidget)) throw new Error('should be TextInputWidget');
    if (!(input instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    const input = TextInput({});
    assert.equal(input.focusable, true);
  });
});
