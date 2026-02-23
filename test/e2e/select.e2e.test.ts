import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { ItemSelected } from '../../packages/harness-ui/src/widgets/select.ts';
import {
  Select,
  SelectWidget,
  type SelectOption,
} from '../../packages/harness-ui/src/widgets/select.ts';
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

const ITEMS: SelectOption[] = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b', description: 'Second letter' },
  { label: 'Gamma', value: 'c' },
  { label: 'Delta', value: 'd' },
  { label: 'Epsilon', value: 'e' },
];

beforeEach(() => {
  resetAutoIdCounter();
});

describe('Select rendering', () => {
  test('renders option labels', () => {
    const sel = Select({ id: 'sel', options: ITEMS, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('Alpha');
    pilot.expectScreen().toContainRow('Beta');
    pilot.expectScreen().toContainRow('Gamma');
  });

  test('selected item has indicator', () => {
    const sel = Select({ id: 'sel', options: ITEMS, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.expectRow(0).toContain('▸');
    pilot.expectRow(1).not.toContain('▸');
  });

  test('description renders next to label', () => {
    const sel = Select({ id: 'sel', options: ITEMS, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 40, rows: 5 });
    pilot.expectRow(1).toContain('Second letter');
  });

  test('empty options renders nothing', () => {
    const sel = Select({ id: 'sel', options: [], height: 3, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toEqual('                    ');
  });
});

describe('Select keyboard navigation', () => {
  test('down moves selection', () => {
    const sel = Select({ id: 'sel', options: ITEMS, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    assert.equal(sel.selectedIndex, 0);
    pilot.pressKey('down');
    assert.equal(sel.selectedIndex, 1);
    pilot.expectRow(1).toContain('▸');
  });

  test('up moves selection', () => {
    const sel = Select({ id: 'sel', options: ITEMS, selectedIndex: 2, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('up');
    assert.equal(sel.selectedIndex, 1);
  });

  test('j/k also navigate', () => {
    const sel = Select({ id: 'sel', options: ITEMS, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('j');
    assert.equal(sel.selectedIndex, 1);
    pilot.pressKey('k');
    assert.equal(sel.selectedIndex, 0);
  });

  test('wrap selection at bottom', () => {
    const sel = Select({ id: 'sel', options: ITEMS, selectedIndex: 4, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('down');
    assert.equal(sel.selectedIndex, 0);
  });

  test('wrap selection at top', () => {
    const sel = Select({ id: 'sel', options: ITEMS, selectedIndex: 0, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('up');
    assert.equal(sel.selectedIndex, 4);
  });

  test('no wrap when disabled', () => {
    const sel = Select({
      id: 'sel',
      options: ITEMS,
      selectedIndex: 4,
      wrapSelection: false,
      height: 5,
      flexGrow: 1,
    });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('down');
    assert.equal(sel.selectedIndex, 4);
  });

  test('home goes to first', () => {
    const sel = Select({ id: 'sel', options: ITEMS, selectedIndex: 3, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('home');
    assert.equal(sel.selectedIndex, 0);
  });

  test('end goes to last', () => {
    const sel = Select({ id: 'sel', options: ITEMS, height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('end');
    assert.equal(sel.selectedIndex, 4);
  });
});

describe('Select enter emits ItemSelected', () => {
  test('enter on selected item emits message', () => {
    let selected: { index: number; value: string } | null = null;

    class Handler extends RootWidget {
      onItemSelected(msg: ItemSelected): void {
        selected = { index: msg.index, value: msg.option.value };
      }
    }

    const r = new Handler('root');
    r.flexDirection = 'column';
    const sel = Select({ id: 'sel', options: ITEMS, selectedIndex: 1, height: 5, flexGrow: 1 });
    r.add(sel);
    const pilot = createTestPilot(r, { cols: 30, rows: 5 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('enter');
    assert.notEqual(selected, null);
    assert.equal(selected!.index, 1);
    assert.equal(selected!.value, 'b');
  });
});

describe('Select scrolling', () => {
  test('scrolls when selection goes below viewport', () => {
    const sel = Select({ id: 'sel', options: ITEMS, height: 3, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('down');
    pilot.pressKey('down');
    pilot.pressKey('down');
    assert.equal(sel.selectedIndex, 3);
    assert.ok(sel.scrollOffset > 0);
    pilot.expectScreen().toContainRow('Delta');
  });

  test('scrolls when selection goes above viewport', () => {
    const sel = Select({ id: 'sel', options: ITEMS, selectedIndex: 4, height: 3, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 3 });
    pilot.focusManager.focus(sel);
    pilot.pressKey('up');
    pilot.pressKey('up');
    pilot.pressKey('up');
    assert.equal(sel.selectedIndex, 1);
    pilot.expectScreen().toContainRow('Beta');
  });
});

describe('Select reactive updates', () => {
  test('changing options re-renders', () => {
    const sel = Select({ id: 'sel', options: ITEMS.slice(0, 2), height: 5, flexGrow: 1 });
    const pilot = createTestPilot(root([sel]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('Alpha');
    pilot.expectScreen().not.toContainRow('Gamma');
    sel.options = ITEMS;
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('Gamma');
  });

  test('selectedIndex clamped when options shrink', () => {
    const sel = Select({ id: 'sel', options: ITEMS, selectedIndex: 4, height: 5, flexGrow: 1 });
    createTestPilot(root([sel]), { cols: 30, rows: 5 });
    assert.equal(sel.selectedIndex, 4);
    sel.options = ITEMS.slice(0, 2);
    sel.selectedIndex = 4;
    assert.equal(sel.selectedIndex, 1);
  });
});

describe('Select factory', () => {
  test('returns SelectWidget', () => {
    const sel = Select({ id: 'test' });
    if (!(sel instanceof SelectWidget)) throw new Error('should be SelectWidget');
    if (!(sel instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    const sel = Select({});
    assert.equal(sel.focusable, true);
  });
});
