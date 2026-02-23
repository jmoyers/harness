import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { DividerMoved } from '../../packages/harness-ui/src/widgets/pane-divider.ts';
import {
  PaneDivider,
  PaneDividerWidget,
} from '../../packages/harness-ui/src/widgets/pane-divider.ts';
import { createTestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';
import { DEFAULT_CELL_STYLE } from '../../packages/harness-ui/src/core/color.ts';
import type { ClippedCellBuffer } from '../../packages/harness-ui/src/core/cell-buffer.ts';

class FillWidget extends Widget {
  ch: string;
  constructor(id: string, ch: string) {
    super(id);
    this.ch = ch;
  }
  render(buffer: ClippedCellBuffer): void {
    for (let r = 0; r < buffer.rows; r += 1)
      buffer.drawText(0, r, this.ch.repeat(buffer.cols), DEFAULT_CELL_STYLE);
  }
}

class RootWidget extends Widget {
  render(): void {}
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('PaneDivider rendering', () => {
  test('vertical divider renders pipe characters', () => {
    const r = new RootWidget('root');
    r.flexDirection = 'row';
    const left = new FillWidget('l', 'L');
    left.flexGrow = 1;
    const div = PaneDivider({ id: 'div' });
    const right = new FillWidget('r', 'R');
    right.flexGrow = 1;
    r.add(left, div, right);
    const pilot = createTestPilot(r, { cols: 11, rows: 3 });
    pilot.expectCell(5, 0).toHaveGlyph('│');
    pilot.expectCell(5, 1).toHaveGlyph('│');
    pilot.expectCell(5, 2).toHaveGlyph('│');
  });

  test('horizontal divider renders dash characters', () => {
    const r = new RootWidget('root');
    r.flexDirection = 'column';
    const top = new FillWidget('t', 'T');
    top.flexGrow = 1;
    const div = PaneDivider({ id: 'div', orientation: 'horizontal' });
    const bot = new FillWidget('b', 'B');
    bot.flexGrow = 1;
    r.add(top, div, bot);
    const pilot = createTestPilot(r, { cols: 10, rows: 5 });
    pilot.expectRow(2).toContain('─');
  });

  test('width defaults to 1 for vertical', () => {
    const div = PaneDivider({});
    assert.equal(div.width, 1);
  });

  test('height defaults to 1 for horizontal', () => {
    const div = PaneDivider({ orientation: 'horizontal' });
    assert.equal(div.height, 1);
  });
});

describe('PaneDivider drag', () => {
  test('startDrag sets dragging', () => {
    const div = PaneDivider({ id: 'div' });
    assert.equal(div.dragging, false);
    div.startDrag();
    assert.equal(div.dragging, true);
  });

  test('endDrag emits DividerMoved and clears dragging', () => {
    let movedTo: number | null = null;
    class Handler extends RootWidget {
      onDividerMoved(msg: DividerMoved): void {
        movedTo = msg.position;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'row';
    const div = PaneDivider({ id: 'div' });
    r.add(div);
    createTestPilot(r, { cols: 20, rows: 3 });
    div.startDrag();
    div.endDrag(15);
    assert.equal(movedTo, 15);
    assert.equal(div.dragging, false);
  });

  test('cancelDrag clears without emitting', () => {
    let emitted = false;
    class Handler extends RootWidget {
      onDividerMoved(): void {
        emitted = true;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'row';
    const div = PaneDivider({ id: 'div' });
    r.add(div);
    createTestPilot(r, { cols: 20, rows: 3 });
    div.startDrag();
    div.cancelDrag();
    assert.equal(div.dragging, false);
    assert.equal(emitted, false);
  });

  test('startDrag ignored when not draggable', () => {
    const div = PaneDivider({ id: 'div', draggable: false });
    div.startDrag();
    assert.equal(div.dragging, false);
  });
});

describe('PaneDivider factory', () => {
  test('returns PaneDividerWidget', () => {
    const d = PaneDivider({});
    if (!(d instanceof PaneDividerWidget)) throw new Error('should be PaneDividerWidget');
    if (!(d instanceof Widget)) throw new Error('should be Widget');
  });
});
