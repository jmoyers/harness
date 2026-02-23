import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'bun:test';
import {
  Widget,
  edgeInsets,
  resetAutoIdCounter,
} from '../../../packages/harness-ui/src/widget/widget.ts';
import { renderWidgetTree } from '../../../packages/harness-ui/src/widget/renderer.ts';
import type { ClippedCellBuffer } from '../../../packages/harness-ui/src/core/cell-buffer.ts';
import {
  DEFAULT_CELL_STYLE,
  rgbColor,
  type CellStyle,
} from '../../../packages/harness-ui/src/core/color.ts';

const RED: CellStyle = { ...DEFAULT_CELL_STYLE, fg: rgbColor(255, 0, 0) };

function stripAnsi(value: string): string {
  let output = '';
  let i = 0;
  while (i < value.length) {
    if (value[i] === '\u001b' && value[i + 1] === '[') {
      i += 2;
      while (i < value.length && value[i] !== 'm') i += 1;
      if (i < value.length) i += 1;
      continue;
    }
    output += value[i];
    i += 1;
  }
  return output;
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
  textRow: number;
  constructor(
    id: string,
    text: string,
    textRow: number = 0,
    style: CellStyle = DEFAULT_CELL_STYLE,
  ) {
    super(id);
    this.text = text;
    this.textRow = textRow;
    this.textStyle = style;
  }
  render(buffer: ClippedCellBuffer): void {
    buffer.drawText(0, this.textRow, this.text, this.textStyle);
  }
}

class EmptyWidget extends Widget {
  render(): void {}
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('renderWidgetTree basics', () => {
  test('returns correct number of rows', () => {
    const root = new EmptyWidget('root');
    const result = renderWidgetTree(root, 10, 3);
    assert.equal(result.rows.length, 3);
  });

  test('root widget render is called', () => {
    const root = new FillWidget('root', 'X');
    const result = renderWidgetTree(root, 5, 2);
    const stripped = result.rows.map(stripAnsi);
    assert.equal(stripped[0], 'XXXXX');
    assert.equal(stripped[1], 'XXXXX');
  });

  test('empty root produces blank rows', () => {
    const root = new EmptyWidget('root');
    const result = renderWidgetTree(root, 5, 1);
    const stripped = result.rows.map(stripAnsi);
    assert.equal(stripped[0], '     ');
  });
});

describe('renderWidgetTree with children', () => {
  test('column layout children render at correct positions', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'column';
    const top = new FillWidget('top', 'T');
    top.height = 1;
    const bottom = new FillWidget('bottom', 'B');
    bottom.height = 1;
    root.add(top, bottom);
    const result = renderWidgetTree(root, 10, 3);
    const stripped = result.rows.map(stripAnsi);
    assert.equal(stripped[0], 'TTTTTTTTTT');
    assert.equal(stripped[1], 'BBBBBBBBBB');
    assert.equal(stripped[2], '          ');
  });

  test('row layout children render side by side', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'row';
    const left = new FillWidget('left', 'L');
    left.width = 3;
    const right = new FillWidget('right', 'R');
    right.width = 3;
    root.add(left, right);
    const result = renderWidgetTree(root, 10, 2);
    const stripped = result.rows.map(stripAnsi);
    assert.equal(stripped[0]!.slice(0, 3), 'LLL');
    assert.equal(stripped[0]!.slice(3, 6), 'RRR');
  });

  test('nested layout renders correctly', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'column';

    const header = new TextWidget('header', 'HEADER', 0, RED);
    header.height = 1;

    const body = new EmptyWidget('body');
    body.flexGrow = 1;
    body.flexDirection = 'row';

    const sidebar = new FillWidget('sidebar', 'S');
    sidebar.width = 5;
    const main = new FillWidget('main', 'M');
    main.flexGrow = 1;

    body.add(sidebar, main);
    root.add(header, body);

    const result = renderWidgetTree(root, 20, 4);
    const stripped = result.rows.map(stripAnsi);
    assert.ok(stripped[0]!.startsWith('HEADER'));
    assert.equal(stripped[1]!.slice(0, 5), 'SSSSS');
    assert.equal(stripped[1]!.slice(5, 20), 'M'.repeat(15));
    assert.equal(stripped[2]!.slice(0, 5), 'SSSSS');
    assert.equal(stripped[3]!.slice(0, 5), 'SSSSS');
  });
});

describe('renderWidgetTree z-ordering', () => {
  test('higher zIndex renders on top', () => {
    const root = new EmptyWidget('root');

    const background = new FillWidget('bg', 'B');
    background.position = 'absolute';
    background.left = 0;
    background.top = 0;
    background.width = 10;
    background.height = 3;
    background.zIndex = 0;

    const overlay = new FillWidget('overlay', 'O');
    overlay.position = 'absolute';
    overlay.left = 2;
    overlay.top = 1;
    overlay.width = 4;
    overlay.height = 1;
    overlay.zIndex = 10;

    root.add(background, overlay);
    const result = renderWidgetTree(root, 10, 3);
    const stripped = result.rows.map(stripAnsi);
    assert.equal(stripped[0], 'BBBBBBBBBB');
    assert.equal(stripped[1], 'BBOOOOBBBB');
    assert.equal(stripped[2], 'BBBBBBBBBB');
  });
});

describe('renderWidgetTree visibility', () => {
  test('invisible widgets are not rendered', () => {
    const root = new EmptyWidget('root');
    root.flexDirection = 'column';
    const vis = new FillWidget('vis', 'V');
    vis.height = 1;
    const invis = new FillWidget('invis', 'X');
    invis.height = 1;
    invis.visible = false;
    root.add(vis, invis);
    const result = renderWidgetTree(root, 5, 2);
    const stripped = result.rows.map(stripAnsi);
    assert.equal(stripped[0], 'VVVVV');
    assert.equal(stripped[1], '     ');
  });
});

describe('renderWidgetTree with padding', () => {
  test('parent padding insets child rendering', () => {
    const root = new EmptyWidget('root');
    root.padding = edgeInsets(1, 2);
    const child = new FillWidget('child', 'C');
    child.flexGrow = 1;
    root.add(child);
    const result = renderWidgetTree(root, 10, 5);
    const stripped = result.rows.map(stripAnsi);
    assert.equal(stripped[0], '          ');
    assert.equal(stripped[1], '  CCCCCC  ');
    assert.equal(stripped[2], '  CCCCCC  ');
    assert.equal(stripped[3], '  CCCCCC  ');
    assert.equal(stripped[4], '          ');
  });
});

describe('renderWidgetTree buffer access', () => {
  test('returned buffer has correct dimensions', () => {
    const root = new EmptyWidget('root');
    const result = renderWidgetTree(root, 80, 24);
    assert.equal(result.buffer.cols, 80);
    assert.equal(result.buffer.rows, 24);
  });

  test('styled text produces SGR in rows', () => {
    const root = new TextWidget('root', 'hello', 0, RED);
    const result = renderWidgetTree(root, 10, 1);
    assert.ok(result.rows[0]!.includes('38;2;255;0;0'));
  });
});
