import { describe, test, beforeEach } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import {
  Table,
  TableWidget,
  type TableColumn,
} from '../../packages/harness-ui/src/widgets/table.ts';
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

const COLS: TableColumn[] = [
  { header: 'Name', width: 10 },
  { header: 'Value', width: 8, align: 'right' },
];
const ROWS = [
  ['Alpha', '100'],
  ['Beta', '200'],
  ['Gamma', '300'],
];

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Table rendering', () => {
  test('renders headers', () => {
    const t = Table({ id: 't', columns: COLS, rows: ROWS, flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 8 });
    pilot.expectRow(0).toContain('Name');
    pilot.expectRow(0).toContain('Value');
  });

  test('renders separator line', () => {
    const t = Table({ id: 't', columns: COLS, rows: ROWS, flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 8 });
    pilot.expectRow(1).toContain('─');
    pilot.expectRow(1).toContain('┼');
  });

  test('renders data rows', () => {
    const t = Table({ id: 't', columns: COLS, rows: ROWS, flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 8 });
    pilot.expectRow(2).toContain('Alpha');
    pilot.expectRow(3).toContain('Beta');
    pilot.expectRow(4).toContain('Gamma');
  });

  test('right-aligned column', () => {
    const t = Table({ id: 't', columns: COLS, rows: [['X', '42']], flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 5 });
    pilot.expectRow(2).toContain('42');
  });

  test('column separators between columns', () => {
    const t = Table({ id: 't', columns: COLS, rows: ROWS, flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 8 });
    pilot.expectRow(2).toContain('│');
  });

  test('no header when showHeader false', () => {
    const t = Table({ id: 't', columns: COLS, rows: ROWS, showHeader: false, flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 8 });
    pilot.expectRow(0).toContain('Alpha');
    pilot.expectRow(0).not.toContain('Name');
  });

  test('no separator when showBorder false', () => {
    const t = Table({ id: 't', columns: COLS, rows: ROWS, showBorder: false, flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 8 });
    pilot.expectRow(1).toContain('Alpha');
  });

  test('flexGrow columns fill remaining space', () => {
    const cols: TableColumn[] = [
      { header: 'Key', width: 5 },
      { header: 'Value', flexGrow: 1 },
    ];
    const t = Table({ id: 't', columns: cols, rows: [['abc', 'def']], flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 20, rows: 5 });
    pilot.expectRow(0).toContain('Key');
    pilot.expectRow(0).toContain('Value');
    pilot.expectRow(2).toContain('abc');
    pilot.expectRow(2).toContain('def');
  });

  test('center-aligned column', () => {
    const cols: TableColumn[] = [{ header: 'Mid', width: 10, align: 'center' }];
    const t = Table({ id: 't', columns: cols, rows: [['AB']], flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 15, rows: 5 });
    pilot.expectRow(2).toContain('AB');
  });

  test('empty rows shows only header', () => {
    const t = Table({ id: 't', columns: COLS, rows: [], flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 5 });
    pilot.expectRow(0).toContain('Name');
    pilot.expectRow(2).not.toContain('Alpha');
  });
});

describe('Table reactive updates', () => {
  test('changing rows re-renders', () => {
    const t = Table({ id: 't', columns: COLS, rows: ROWS, flexGrow: 1 });
    const pilot = createTestPilot(root([t]), { cols: 30, rows: 8 });
    pilot.expectScreen().toContainRow('Alpha');
    t.rows = [['Delta', '400']];
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('Delta');
    pilot.expectScreen().not.toContainRow('Alpha');
  });
});

describe('Table factory', () => {
  test('returns TableWidget', () => {
    const t = Table({ id: 'test' });
    if (!(t instanceof TableWidget)) throw new Error('should be TableWidget');
    if (!(t instanceof Widget)) throw new Error('should be Widget');
  });
});
