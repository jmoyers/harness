import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import { Text, TextWidget } from '../../packages/harness-ui/src/widgets/text.ts';
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

describe('Text widget rendering', () => {
  test('renders plain text', () => {
    const pilot = createTestPilot(
      root([Text({ id: 'greeting', content: 'Hello, World!', height: 1 })]),
      { cols: 20, rows: 3 },
    );
    pilot.expectRow(0).toContain('Hello, World!');
  });

  test('renders at correct position in column layout', () => {
    const r = new RootWidget('root');
    r.flexDirection = 'column';
    const top = Text({ id: 'top', content: 'TOP', height: 1 });
    const bottom = Text({ id: 'bottom', content: 'BOTTOM', height: 1 });
    r.add(top, bottom);
    const pilot = createTestPilot(r, { cols: 10, rows: 3 });
    pilot.expectRow(0).toStartWith('TOP');
    pilot.expectRow(1).toStartWith('BOTTOM');
  });

  test('empty content renders blank', () => {
    const pilot = createTestPilot(root([Text({ id: 't', content: '', height: 1 })]), {
      cols: 10,
      rows: 1,
    });
    pilot.expectRow(0).toEqual('          ');
  });
});

describe('Text widget alignment', () => {
  test('left align (default)', () => {
    const pilot = createTestPilot(root([Text({ id: 't', content: 'hi', height: 1 })]), {
      cols: 10,
      rows: 1,
    });
    pilot.expectCell(0, 0).toHaveGlyph('h');
    pilot.expectCell(1, 0).toHaveGlyph('i');
  });

  test('center align', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'AB', align: 'center', height: 1 })]),
      { cols: 10, rows: 1 },
    );
    pilot.expectCell(4, 0).toHaveGlyph('A');
    pilot.expectCell(5, 0).toHaveGlyph('B');
  });

  test('right align', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'XY', align: 'right', height: 1 })]),
      { cols: 10, rows: 1 },
    );
    pilot.expectCell(8, 0).toHaveGlyph('X');
    pilot.expectCell(9, 0).toHaveGlyph('Y');
  });
});

describe('Text widget styling', () => {
  test('bold text', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'bold', bold: true, height: 1 })]),
      { cols: 10, rows: 1 },
    );
    pilot.expectCell(0, 0).toHaveStyle({ bold: true });
  });

  test('colored text', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'red', fg: '#FF0000', height: 1 })]),
      { cols: 10, rows: 1 },
    );
    pilot.expectCell(0, 0).toHaveStyle({ fg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
  });

  test('dim + italic', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'di', dim: true, italic: true, height: 1 })]),
      { cols: 10, rows: 1 },
    );
    pilot.expectCell(0, 0).toHaveStyle({ dim: true, italic: true });
  });

  test('underline', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'u', underline: true, height: 1 })]),
      { cols: 10, rows: 1 },
    );
    pilot.expectCell(0, 0).toHaveStyle({ underline: true });
  });
});

describe('Text widget wrapping', () => {
  test('wraps long text to multiple rows', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'abcdefghij', height: 3, width: 5 })]),
      { cols: 5, rows: 3 },
    );
    pilot.expectRow(0).toEqual('abcde');
    pilot.expectRow(1).toEqual('fghij');
  });

  test('wrap disabled truncates', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'abcdefghij', wrap: false, height: 1 })]),
      { cols: 5, rows: 1 },
    );
    pilot.expectRow(0).toContain('abcd');
    pilot.expectRow(0).toContain('…');
  });
});

describe('Text widget truncation', () => {
  test('text exceeding width shows ellipsis when wrap off', () => {
    const pilot = createTestPilot(
      root([Text({ id: 't', content: 'Hello, World!', wrap: false, height: 1 })]),
      { cols: 8, rows: 1 },
    );
    pilot.expectRow(0).toContain('…');
  });
});

describe('Text widget wide characters', () => {
  test('CJK text renders with continuations', () => {
    const pilot = createTestPilot(root([Text({ id: 't', content: '你好', height: 1 })]), {
      cols: 10,
      rows: 1,
    });
    pilot.expectCell(0, 0).toHaveGlyph('你');
    pilot.expectCell(1, 0).toBeContinuation();
    pilot.expectCell(2, 0).toHaveGlyph('好');
    pilot.expectCell(3, 0).toBeContinuation();
  });
});

describe('Text widget reactive updates', () => {
  test('content change re-renders', () => {
    const t = Text({ id: 't', content: 'before', height: 1 });
    const pilot = createTestPilot(root([t]), { cols: 20, rows: 1 });
    pilot.expectRow(0).toContain('before');
    t.content = 'after';
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('after');
    pilot.expectRow(0).not.toContain('before');
  });

  test('fg color change re-renders', () => {
    const t = Text({ id: 't', content: 'X', fg: '#FF0000', height: 1 });
    const pilot = createTestPilot(root([t]), { cols: 5, rows: 1 });
    pilot.expectCell(0, 0).toHaveStyle({ fg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
    t.fg = '#00FF00';
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(0, 0).toHaveStyle({ fg: { kind: 'rgb', r: 0, g: 255, b: 0 } });
  });
});

describe('Text factory function', () => {
  test('Text() returns a TextWidget', () => {
    const t = Text({ content: 'hi' });
    const isTextWidget = t instanceof TextWidget;
    const isWidget = t instanceof Widget;
    if (!isTextWidget || !isWidget) {
      throw new Error('Text() should return a TextWidget instance');
    }
  });
});
