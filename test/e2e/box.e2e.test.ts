import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import { Box, Row, Column, Spacer, BoxWidget } from '../../packages/harness-ui/src/widgets/box.ts';
import { Text } from '../../packages/harness-ui/src/widgets/text.ts';
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

describe('Box border rendering', () => {
  test('single border', () => {
    const pilot = createTestPilot(
      root([Box({ id: 'b', borderStyle: 'single', width: 6, height: 3 })]),
      { cols: 10, rows: 5 },
    );
    pilot.expectCell(0, 0).toHaveGlyph('┌');
    pilot.expectCell(5, 0).toHaveGlyph('┐');
    pilot.expectCell(0, 2).toHaveGlyph('└');
    pilot.expectCell(5, 2).toHaveGlyph('┘');
    pilot.expectCell(1, 0).toHaveGlyph('─');
    pilot.expectCell(0, 1).toHaveGlyph('│');
  });

  test('double border', () => {
    const pilot = createTestPilot(
      root([Box({ id: 'b', borderStyle: 'double', width: 6, height: 3 })]),
      { cols: 10, rows: 5 },
    );
    pilot.expectCell(0, 0).toHaveGlyph('╔');
    pilot.expectCell(5, 0).toHaveGlyph('╗');
    pilot.expectCell(0, 1).toHaveGlyph('║');
  });

  test('rounded border', () => {
    const pilot = createTestPilot(
      root([Box({ id: 'b', borderStyle: 'rounded', width: 6, height: 3 })]),
      { cols: 10, rows: 5 },
    );
    pilot.expectCell(0, 0).toHaveGlyph('╭');
    pilot.expectCell(5, 0).toHaveGlyph('╮');
    pilot.expectCell(0, 2).toHaveGlyph('╰');
    pilot.expectCell(5, 2).toHaveGlyph('╯');
  });

  test('heavy border', () => {
    const pilot = createTestPilot(
      root([Box({ id: 'b', borderStyle: 'heavy', width: 6, height: 3 })]),
      { cols: 10, rows: 5 },
    );
    pilot.expectCell(0, 0).toHaveGlyph('┏');
    pilot.expectCell(1, 0).toHaveGlyph('━');
  });

  test('no border', () => {
    const pilot = createTestPilot(
      root([Box({ id: 'b', borderStyle: 'none', width: 6, height: 3 })]),
      { cols: 10, rows: 5 },
    );
    pilot.expectCell(0, 0).toHaveGlyph(' ');
  });
});

describe('Box with title', () => {
  test('title renders in top border', () => {
    const pilot = createTestPilot(
      root([Box({ id: 'b', borderStyle: 'single', title: 'Hi', width: 10, height: 3 })]),
      { cols: 15, rows: 5 },
    );
    pilot.expectRow(0).toContain('Hi');
  });

  test('centered title', () => {
    const pilot = createTestPilot(
      root([
        Box({
          id: 'b',
          borderStyle: 'single',
          title: 'AB',
          titleAlign: 'center',
          width: 12,
          height: 3,
        }),
      ]),
      { cols: 15, rows: 5 },
    );
    pilot.expectRow(0).toContain('AB');
  });

  test('right-aligned title', () => {
    const pilot = createTestPilot(
      root([
        Box({
          id: 'b',
          borderStyle: 'single',
          title: 'R',
          titleAlign: 'right',
          width: 10,
          height: 3,
        }),
      ]),
      { cols: 15, rows: 5 },
    );
    pilot.expectRow(0).toContain('R');
  });

  test('long title truncated with ellipsis', () => {
    const pilot = createTestPilot(
      root([
        Box({
          id: 'b',
          borderStyle: 'single',
          title: 'This Is A Very Long Title',
          width: 12,
          height: 3,
        }),
      ]),
      { cols: 15, rows: 5 },
    );
    pilot.expectRow(0).toContain('…');
  });
});

describe('Box background color', () => {
  test('fills with background color', () => {
    const pilot = createTestPilot(
      root([Box({ id: 'b', backgroundColor: '#FF0000', width: 4, height: 2 })]),
      { cols: 10, rows: 3 },
    );
    pilot.expectCell(0, 0).toHaveStyle({ bg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
    pilot.expectCell(3, 1).toHaveStyle({ bg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
  });
});

describe('Box with children', () => {
  test('children render inside border', () => {
    const b = Box(
      { id: 'b', borderStyle: 'single', width: 12, height: 5 },
      Text({ id: 'inner', content: 'inside', height: 1 }),
    );
    const pilot = createTestPilot(root([b]), { cols: 15, rows: 7 });
    pilot.expectRow(0).toContain('┌');
    pilot.expectScreen().toContainRow('inside');
  });

  test('children do not overlap border', () => {
    const b = Box(
      { id: 'b', borderStyle: 'single', width: 10, height: 4 },
      Text({ id: 'inner', content: 'XXXXXXXXXXXX', height: 1 }),
    );
    const pilot = createTestPilot(root([b]), { cols: 15, rows: 6 });
    pilot.expectCell(0, 0).toHaveGlyph('┌');
    pilot.expectCell(0, 1).toHaveGlyph('│');
    pilot.expectCell(9, 1).toHaveGlyph('│');
  });
});

describe('Row and Column factory functions', () => {
  test('Row creates horizontal box', () => {
    const r = Row(
      { id: 'row', height: 1 },
      Text({ content: 'A', width: 3, height: 1 }),
      Text({ content: 'B', width: 3, height: 1 }),
    );
    const pilot = createTestPilot(root([r]), { cols: 10, rows: 2 });
    pilot.expectRow(0).toStartWith('A');
    pilot.expectRow(0).toContain('B');
  });

  test('Column creates vertical box', () => {
    const c = Column(
      { id: 'col', flexGrow: 1 },
      Text({ content: 'TOP', height: 1 }),
      Text({ content: 'BOT', height: 1 }),
    );
    const pilot = createTestPilot(root([c]), { cols: 10, rows: 4 });
    pilot.expectRow(0).toContain('TOP');
    pilot.expectRow(1).toContain('BOT');
  });
});

describe('Spacer widget', () => {
  test('pushes siblings apart in row', () => {
    const r = Row(
      { id: 'row', width: '100%', height: 1 },
      Text({ content: 'L', width: 1, height: 1 }),
      Spacer(),
      Text({ content: 'R', width: 1, height: 1 }),
    );
    const pilot = createTestPilot(root([r]), { cols: 10, rows: 1 });
    pilot.expectCell(0, 0).toHaveGlyph('L');
    pilot.expectCell(9, 0).toHaveGlyph('R');
  });
});

describe('Box reactive updates', () => {
  test('title change re-renders', () => {
    const b = Box({ id: 'b', borderStyle: 'single', title: 'Old', width: 12, height: 3 });
    const pilot = createTestPilot(root([b]), { cols: 15, rows: 5 });
    pilot.expectRow(0).toContain('Old');
    b.title = 'New';
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectRow(0).toContain('New');
    pilot.expectRow(0).not.toContain('Old');
  });

  test('borderStyle change re-renders', () => {
    const b = Box({ id: 'b', borderStyle: 'single', width: 6, height: 3 });
    const pilot = createTestPilot(root([b]), { cols: 10, rows: 5 });
    pilot.expectCell(0, 0).toHaveGlyph('┌');
    b.borderStyle = 'double';
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectCell(0, 0).toHaveGlyph('╔');
  });
});

describe('Box factory returns correct type', () => {
  test('Box() returns BoxWidget', () => {
    const b = Box({ id: 'test' });
    if (!(b instanceof BoxWidget)) throw new Error('Box() should return BoxWidget');
    if (!(b instanceof Widget)) throw new Error('Box() should be a Widget');
  });
});
