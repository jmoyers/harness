import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import {
  Widget,
  edgeInsets,
  resetAutoIdCounter,
} from '../../../packages/harness-ui/src/widget/widget.ts';
import { reactive } from '../../../packages/harness-ui/src/widget/reactive.ts';
import { createTestPilot } from '../../../packages/harness-ui/src/testing/pilot.ts';
import { AssertionError } from '../../../packages/harness-ui/src/testing/assertions.ts';
import { DEFAULT_CELL_STYLE, type CellStyle } from '../../../packages/harness-ui/src/core/color.ts';
import type { ClippedCellBuffer } from '../../../packages/harness-ui/src/core/cell-buffer.ts';
import type { Binding } from '../../../packages/harness-ui/src/widget/keybinding.ts';

const BOLD: CellStyle = { ...DEFAULT_CELL_STYLE, bold: true };

class EmptyWidget extends Widget {
  render(): void {}
}

class FillWidget extends Widget {
  fillChar: string;
  fillStyle: CellStyle;
  constructor(id: string, fillChar: string, fillStyle: CellStyle = DEFAULT_CELL_STYLE) {
    super(id);
    this.fillChar = fillChar;
    this.fillStyle = fillStyle;
  }
  render(buffer: ClippedCellBuffer): void {
    for (let row = 0; row < buffer.rows; row += 1) {
      buffer.drawText(0, row, this.fillChar.repeat(buffer.cols), this.fillStyle);
    }
  }
}

class TextWidget extends Widget {
  text: string;
  textStyle: CellStyle;
  constructor(id: string, text: string, style: CellStyle = DEFAULT_CELL_STYLE) {
    super(id);
    this.text = text;
    this.textStyle = style;
  }
  render(buffer: ClippedCellBuffer): void {
    buffer.drawText(0, 0, this.text, this.textStyle);
  }
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('TestPilot construction', () => {
  test('creates pilot with correct dimensions', () => {
    const root = new EmptyWidget('root');
    const pilot = createTestPilot(root, { cols: 80, rows: 24 });
    assert.equal(pilot.cols, 80);
    assert.equal(pilot.rows, 24);
  });

  test('mounts root on creation', () => {
    const root = new EmptyWidget('root');
    createTestPilot(root, { cols: 10, rows: 5 });
    assert.equal(root.mounted, true);
  });

  test('renders on creation', () => {
    const root = new FillWidget('root', 'X');
    const pilot = createTestPilot(root, { cols: 5, rows: 2 });
    assert.equal(pilot.rowText(0), 'XXXXX');
    assert.equal(pilot.rowText(1), 'XXXXX');
  });
});

describe('TestPilot.expectRow', () => {
  test('toContain passes on match', () => {
    const root = new TextWidget('root', 'hello world');
    const pilot = createTestPilot(root, { cols: 20, rows: 1 });
    pilot.expectRow(0).toContain('hello');
  });

  test('toContain fails on mismatch', () => {
    const root = new TextWidget('root', 'hello');
    const pilot = createTestPilot(root, { cols: 20, rows: 1 });
    assert.throws(() => pilot.expectRow(0).toContain('xyz'), AssertionError);
  });

  test('not.toContain passes when absent', () => {
    const root = new TextWidget('root', 'hello');
    const pilot = createTestPilot(root, { cols: 20, rows: 1 });
    pilot.expectRow(0).not.toContain('xyz');
  });

  test('not.toContain fails when present', () => {
    const root = new TextWidget('root', 'hello');
    const pilot = createTestPilot(root, { cols: 20, rows: 1 });
    assert.throws(() => pilot.expectRow(0).not.toContain('hello'), AssertionError);
  });

  test('toStartWith', () => {
    const root = new TextWidget('root', 'hello');
    const pilot = createTestPilot(root, { cols: 20, rows: 1 });
    pilot.expectRow(0).toStartWith('hel');
    assert.throws(() => pilot.expectRow(0).toStartWith('xyz'), AssertionError);
  });

  test('toEqual', () => {
    const root = new FillWidget('root', 'X');
    const pilot = createTestPilot(root, { cols: 3, rows: 1 });
    pilot.expectRow(0).toEqual('XXX');
    assert.throws(() => pilot.expectRow(0).toEqual('YYY'), AssertionError);
  });
});

describe('TestPilot.expectCell', () => {
  test('toHaveGlyph', () => {
    const root = new TextWidget('root', 'AB');
    const pilot = createTestPilot(root, { cols: 5, rows: 1 });
    pilot.expectCell(0, 0).toHaveGlyph('A');
    pilot.expectCell(1, 0).toHaveGlyph('B');
  });

  test('toHaveGlyph fails on mismatch', () => {
    const root = new TextWidget('root', 'A');
    const pilot = createTestPilot(root, { cols: 5, rows: 1 });
    assert.throws(() => pilot.expectCell(0, 0).toHaveGlyph('X'), AssertionError);
  });

  test('not.toHaveGlyph', () => {
    const root = new TextWidget('root', 'A');
    const pilot = createTestPilot(root, { cols: 5, rows: 1 });
    pilot.expectCell(0, 0).not.toHaveGlyph('X');
  });

  test('toHaveStyle with bold', () => {
    const root = new TextWidget('root', 'B', BOLD);
    const pilot = createTestPilot(root, { cols: 5, rows: 1 });
    pilot.expectCell(0, 0).toHaveStyle({ bold: true });
  });

  test('toHaveStyle fails on mismatch', () => {
    const root = new TextWidget('root', 'N', DEFAULT_CELL_STYLE);
    const pilot = createTestPilot(root, { cols: 5, rows: 1 });
    assert.throws(() => pilot.expectCell(0, 0).toHaveStyle({ bold: true }), AssertionError);
  });

  test('toBeContinuation for wide char', () => {
    const root = new TextWidget('root', '你');
    const pilot = createTestPilot(root, { cols: 5, rows: 1 });
    pilot.expectCell(0, 0).not.toBeContinuation();
    pilot.expectCell(1, 0).toBeContinuation();
  });
});

describe('TestPilot.expectWidget', () => {
  test('toExist passes for existing widget', () => {
    const root = new EmptyWidget('root');
    root.add(new EmptyWidget('child'));
    const pilot = createTestPilot(root, { cols: 10, rows: 5 });
    pilot.expectWidget('#child').toExist();
  });

  test('toExist fails for missing widget', () => {
    const root = new EmptyWidget('root');
    const pilot = createTestPilot(root, { cols: 10, rows: 5 });
    assert.throws(() => pilot.expectWidget('#missing').toExist(), AssertionError);
  });

  test('not.toExist passes for missing widget', () => {
    const root = new EmptyWidget('root');
    const pilot = createTestPilot(root, { cols: 10, rows: 5 });
    pilot.expectWidget('#missing').not.toExist();
  });

  test('toBeVisible', () => {
    const root = new EmptyWidget('root');
    const child = new EmptyWidget('child');
    root.add(child);
    const pilot = createTestPilot(root, { cols: 10, rows: 5 });
    pilot.expectWidget('#child').toBeVisible();
    child.visible = false;
    pilot.expectWidget('#child').not.toBeVisible();
  });

  test('toBeFocused', () => {
    const root = new EmptyWidget('root');
    const input = new EmptyWidget('input');
    input.focusable = true;
    root.add(input);
    const pilot = createTestPilot(root, { cols: 10, rows: 5 });
    pilot.expectWidget('#input').not.toBeFocused();
    pilot.focusManager.focus(input);
    pilot.expectWidget('#input').toBeFocused();
  });

  test('toHaveRect', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'column';
    const child = new EmptyWidget('child');
    child.height = 5;
    root.add(child);
    const pilot = createTestPilot(root, { cols: 80, rows: 24 });
    pilot.expectWidget('#child').toHaveRect({ x: 0, y: 0, width: 80, height: 5 });
  });
});

describe('TestPilot.expectScreen', () => {
  test('toMatchLines passes on exact match', () => {
    const root = new FillWidget('root', 'X');
    const pilot = createTestPilot(root, { cols: 3, rows: 2 });
    pilot.expectScreen().toMatchLines(['XXX', 'XXX']);
  });

  test('toMatchLines fails on mismatch', () => {
    const root = new FillWidget('root', 'X');
    const pilot = createTestPilot(root, { cols: 3, rows: 2 });
    assert.throws(() => pilot.expectScreen().toMatchLines(['XXX', 'YYY']), AssertionError);
  });

  test('toContainRow passes when found', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'column';
    const header = new TextWidget('header', 'HEADER');
    header.height = 1;
    root.add(header);
    const pilot = createTestPilot(root, { cols: 20, rows: 3 });
    pilot.expectScreen().toContainRow('HEADER');
  });

  test('toContainRow fails when not found', () => {
    const root = new EmptyWidget('root');
    const pilot = createTestPilot(root, { cols: 10, rows: 2 });
    assert.throws(() => pilot.expectScreen().toContainRow('MISSING'), AssertionError);
  });

  test('not.toContainRow', () => {
    const root = new EmptyWidget('root');
    const pilot = createTestPilot(root, { cols: 10, rows: 2 });
    pilot.expectScreen().not.toContainRow('MISSING');
  });
});

describe('TestPilot input simulation', () => {
  test('pressKey dispatches to focused widget binding', () => {
    let saved = false;

    class EditorWidget extends Widget {
      static BINDINGS: Binding[] = [{ key: 'ctrl+s', action: 'save' }];
      actionSave(): void {
        saved = true;
      }
      render(): void {}
    }

    const root = new EmptyWidget('root');
    const editor = new EditorWidget('editor');
    editor.focusable = true;
    root.add(editor);
    const pilot = createTestPilot(root, { cols: 20, rows: 5 });
    pilot.focusManager.focus(editor);
    pilot.pressKey('ctrl+s');
    assert.equal(saved, true);
  });

  test('resize updates dimensions and re-renders', () => {
    const root = new FillWidget('root', 'Z');
    const pilot = createTestPilot(root, { cols: 10, rows: 3 });
    assert.equal(pilot.rowText(0), 'ZZZZZZZZZZ');
    pilot.resize(5, 2);
    assert.equal(pilot.cols, 5);
    assert.equal(pilot.rows, 2);
    assert.equal(pilot.rowText(0), 'ZZZZZ');
  });

  test('click focuses focusable widget at position', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'column';
    const input = new EmptyWidget('input');
    input.focusable = true;
    input.height = 3;
    root.add(input);
    const pilot = createTestPilot(root, { cols: 20, rows: 10 });
    pilot.expectWidget('#input').not.toBeFocused();
    pilot.click(5, 1);
    pilot.expectWidget('#input').toBeFocused();
  });

  test('focusNext cycles through focusable widgets', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'column';
    const a = new EmptyWidget('a');
    a.focusable = true;
    a.height = 3;
    const b = new EmptyWidget('b');
    b.focusable = true;
    b.height = 3;
    root.add(a, b);
    const pilot = createTestPilot(root, { cols: 20, rows: 10 });
    pilot.focusNext();
    pilot.expectWidget('#a').toBeFocused();
    pilot.focusNext();
    pilot.expectWidget('#b').toBeFocused();
    pilot.focusNext();
    pilot.expectWidget('#a').toBeFocused();
  });
});

describe('TestPilot with reactive widgets', () => {
  test('reactive state change reflects in re-render', () => {
    class CounterWidget extends Widget {
      count = reactive(0);
      render(buffer: ClippedCellBuffer): void {
        buffer.drawText(0, 0, `count=${this.count}`, DEFAULT_CELL_STYLE);
      }
    }

    const root = new CounterWidget('counter');
    const pilot = createTestPilot(root, { cols: 20, rows: 1 });
    pilot.expectRow(0).toContain('count=0');

    root.count = 42;
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('count=42');
  });
});

describe('TestPilot layout integration', () => {
  test('nested layout with padding renders correctly', () => {
    const root = new EmptyWidget('root');
    root.padding = edgeInsets(1, 2);
    const child = new FillWidget('child', 'C');
    child.flexGrow = 1;
    root.add(child);
    const pilot = createTestPilot(root, { cols: 10, rows: 5 });
    pilot.expectRow(0).toEqual('          ');
    pilot.expectRow(1).toEqual('  CCCCCC  ');
    pilot.expectRow(2).toEqual('  CCCCCC  ');
    pilot.expectRow(3).toEqual('  CCCCCC  ');
    pilot.expectRow(4).toEqual('          ');
  });

  test('row layout with two panels', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'row';
    const left = new FillWidget('left', 'L');
    left.width = 4;
    const right = new FillWidget('right', 'R');
    right.flexGrow = 1;
    root.add(left, right);
    const pilot = createTestPilot(root, { cols: 10, rows: 2 });
    pilot.expectRow(0).toEqual('LLLLRRRRRR');
    pilot.expectRow(1).toEqual('LLLLRRRRRR');
  });
});
