import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { TerminalData } from '../../packages/harness-ui/src/widgets/terminal.ts';
import { Terminal, TerminalWidgetImpl } from '../../packages/harness-ui/src/widgets/terminal.ts';
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

describe('TerminalWidget rendering', () => {
  test('renders written text', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    term.write('hello world');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('hello world');
  });

  test('renders multiple lines', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    term.write('line1\r\nline2\r\nline3');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('line1');
    pilot.expectRow(1).toContain('line2');
    pilot.expectRow(2).toContain('line3');
  });

  test('renders styled text (bold)', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 3 });
    term.write('\x1b[1mbold\x1b[0m');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(0, 0).toHaveStyle({ bold: true });
    pilot.expectRow(0).toContain('bold');
  });

  test('renders colored text', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 3 });
    term.write('\x1b[38;2;255;0;0mred\x1b[0m');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(0, 0).toHaveStyle({ fg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
  });

  test('handles cursor positioning', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    term.write('\x1b[3;5Hhere');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(2).toContain('here');
  });

  test('blank terminal renders spaces', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 10, rows: 3 });
    pilot.expectRow(0).toEqual('          ');
  });

  test('wide characters render correctly', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 3 });
    term.write('你好世界');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(0, 0).toHaveGlyph('你');
    pilot.expectCell(1, 0).toBeContinuation();
    pilot.expectCell(2, 0).toHaveGlyph('好');
  });
});

describe('TerminalWidget auto-resize', () => {
  test('resizes VTE when widget dimensions change', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    term.write('test');
    pilot.resize(40, 10);
    pilot.expectRow(0).toContain('test');
    const snap = term.snapshot();
    assert.equal(snap.cols, 40);
    assert.equal(snap.rows, 10);
  });
});

describe('TerminalWidget keyboard input', () => {
  test('typing emits TerminalData', () => {
    const received: Uint8Array[] = [];
    class Handler extends RootWidget {
      onTerminalData(msg: TerminalData): void {
        received.push(msg.data);
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const term = Terminal({ id: 'term', flexGrow: 1 });
    r.add(term);
    const pilot = createTestPilot(r, { cols: 20, rows: 5 });
    pilot.focusManager.focus(term);
    pilot.pressKey('a');
    assert.equal(received.length, 1);
    assert.equal(new TextDecoder().decode(received[0]), 'a');
  });

  test('enter sends carriage return', () => {
    const received: string[] = [];
    const term = Terminal({ id: 'term', flexGrow: 1 });
    term.onData = (data) => {
      received.push(new TextDecoder().decode(data));
    };
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(term);
    pilot.pressKey('enter');
    assert.equal(received.length, 1);
    assert.equal(received[0], '\r');
  });

  test('arrow keys send escape sequences', () => {
    const received: string[] = [];
    const term = Terminal({ id: 'term', flexGrow: 1 });
    term.onData = (data) => {
      received.push(new TextDecoder().decode(data));
    };
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(term);
    pilot.pressKey('up');
    pilot.pressKey('down');
    pilot.pressKey('left');
    pilot.pressKey('right');
    assert.equal(received.length, 4);
    assert.equal(received[0], '\x1b[A');
    assert.equal(received[1], '\x1b[B');
    assert.equal(received[2], '\x1b[D');
    assert.equal(received[3], '\x1b[C');
  });

  test('ctrl+c sends ETX', () => {
    const received: string[] = [];
    const term = Terminal({ id: 'term', flexGrow: 1 });
    term.onData = (data) => {
      received.push(new TextDecoder().decode(data));
    };
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(term);
    pilot.pressKey('ctrl+c');
    assert.equal(received.length, 1);
    assert.equal(received[0], '\x03');
  });

  test('unfocused terminal ignores input', () => {
    const received: string[] = [];
    const term = Terminal({ id: 'term', flexGrow: 1 });
    term.onData = (data) => {
      received.push(new TextDecoder().decode(data));
    };
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    pilot.pressKey('a');
    assert.equal(received.length, 0);
  });
});

describe('TerminalWidget DEC modes', () => {
  test('alternate screen', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 5 });
    term.write('primary');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('primary');
    term.write('\x1b[?1049h');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).not.toContain('primary');
    term.write('alternate');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('alternate');
    term.write('\x1b[?1049l');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('primary');
  });

  test('cursor visibility tracked', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    createTestPilot(root([term]), { cols: 20, rows: 3 });
    assert.equal(term.cursorVisible, true);
    term.write('\x1b[?25l');
    assert.equal(term.cursorVisible, false);
    term.write('\x1b[?25h');
    assert.equal(term.cursorVisible, true);
  });

  test('mouse tracking detection', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    createTestPilot(root([term]), { cols: 20, rows: 3 });
    assert.equal(term.isMouseTrackingEnabled(), false);
    term.write('\x1b[?1000h');
    assert.equal(term.isMouseTrackingEnabled(), true);
  });
});

describe('TerminalWidget scrolling', () => {
  test('scrollViewport changes viewport', () => {
    const term = Terminal({ id: 'term', flexGrow: 1 });
    const pilot = createTestPilot(root([term]), { cols: 20, rows: 3 });
    for (let i = 0; i < 10; i += 1) {
      term.write(`line${i}\r\n`);
    }
    term.scrollViewport(-5);
    pilot.resize(pilot.cols, pilot.rows);
    const snap = term.snapshot();
    assert.ok(snap.viewport.top < snap.viewport.totalRows - snap.rows);
  });
});

describe('TerminalWidget factory', () => {
  test('returns TerminalWidgetImpl', () => {
    const t = Terminal({ id: 'test' });
    if (!(t instanceof TerminalWidgetImpl)) throw new Error('should be TerminalWidgetImpl');
    if (!(t instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    assert.equal(Terminal({}).focusable, true);
  });
});
