import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { BoxWidget } from '../../packages/harness-ui/src/widgets/box.ts';
import { Box } from '../../packages/harness-ui/src/widgets/box.ts';
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

describe('Box partial borders', () => {
  test('left-only border renders pipe on left', () => {
    const b = Box({ id: 'b', borderStyle: 'single', borderEdges: ['left'], width: 10, height: 3 });
    const pilot = createTestPilot(root([b]), { cols: 15, rows: 5 });
    pilot.expectCell(0, 0).not.toHaveGlyph('┌');
    pilot.expectCell(0, 1).toHaveGlyph('│');
    pilot.expectCell(9, 1).not.toHaveGlyph('│');
  });

  test('top-only border renders horizontal line', () => {
    const b = Box({ id: 'b', borderStyle: 'single', borderEdges: ['top'], width: 10, height: 3 });
    const pilot = createTestPilot(root([b]), { cols: 15, rows: 5 });
    pilot.expectCell(1, 0).toHaveGlyph('─');
    pilot.expectCell(0, 1).not.toHaveGlyph('│');
  });

  test('left+top border renders corner and edges', () => {
    const b = Box({
      id: 'b',
      borderStyle: 'single',
      borderEdges: ['left', 'top'],
      width: 10,
      height: 3,
    });
    const pilot = createTestPilot(root([b]), { cols: 15, rows: 5 });
    pilot.expectCell(0, 0).toHaveGlyph('┌');
    pilot.expectCell(0, 1).toHaveGlyph('│');
    pilot.expectCell(9, 0).not.toHaveGlyph('┐');
  });

  test('all edges is same as no borderEdges prop', () => {
    const b = Box({
      id: 'b',
      borderStyle: 'single',
      borderEdges: ['top', 'right', 'bottom', 'left'],
      width: 8,
      height: 3,
    });
    const pilot = createTestPilot(root([b]), { cols: 15, rows: 5 });
    pilot.expectCell(0, 0).toHaveGlyph('┌');
    pilot.expectCell(7, 0).toHaveGlyph('┐');
    pilot.expectCell(0, 2).toHaveGlyph('└');
    pilot.expectCell(7, 2).toHaveGlyph('┘');
  });
});

describe('Box hover', () => {
  test('hovered changes background when hoverBackgroundColor set', () => {
    const b = Box({
      id: 'b',
      backgroundColor: '#111111',
      hoverBackgroundColor: '#333333',
      width: 6,
      height: 2,
    });
    const pilot = createTestPilot(root([b]), { cols: 10, rows: 3 });
    pilot.expectCell(0, 0).toHaveStyle({ bg: { kind: 'rgb', r: 17, g: 17, b: 17 } });
    (b as BoxWidget).mouseOver();
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(0, 0).toHaveStyle({ bg: { kind: 'rgb', r: 51, g: 51, b: 51 } });
    (b as BoxWidget).mouseOut();
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(0, 0).toHaveStyle({ bg: { kind: 'rgb', r: 17, g: 17, b: 17 } });
  });

  test('hovered reactive tracks state', () => {
    const b = Box({ id: 'b', width: 6, height: 2 }) as BoxWidget;
    createTestPilot(root([b]), { cols: 10, rows: 3 });
    assert.equal(b.hovered, false);
    b.mouseOver();
    assert.equal(b.hovered, true);
    b.mouseOut();
    assert.equal(b.hovered, false);
  });

  test('onMouseOver callback fires', () => {
    let fired = false;
    const b = Box({
      id: 'b',
      width: 6,
      height: 2,
      onMouseOver: () => {
        fired = true;
      },
    });
    createTestPilot(root([b]), { cols: 10, rows: 3 });
    (b as BoxWidget).mouseOver();
    assert.equal(fired, true);
  });

  test('onMouseUp callback fires', () => {
    let fired = false;
    const b = Box({
      id: 'b',
      width: 6,
      height: 2,
      onMouseUp: () => {
        fired = true;
      },
    });
    createTestPilot(root([b]), { cols: 10, rows: 3 });
    (b as BoxWidget).mouseUp();
    assert.equal(fired, true);
  });
});
