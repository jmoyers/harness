import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { ListItemSelected } from '../../packages/harness-ui/src/widgets/list-view.ts';
import {
  ListView,
  ListViewWidget,
  type ListItem,
} from '../../packages/harness-ui/src/widgets/list-view.ts';
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

const ITEMS: ListItem[] = [
  { id: 's1', label: 'Session 1', badge: '●', description: 'running' },
  { id: 's2', label: 'Session 2', badge: '○', description: 'idle' },
  { id: 's3', label: 'Session 3', badge: '!', description: 'needs input' },
];

beforeEach(() => {
  resetAutoIdCounter();
});

describe('ListView rendering', () => {
  test('renders item labels', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.expectScreen().toContainRow('Session 1');
    pilot.expectScreen().toContainRow('Session 2');
    pilot.expectScreen().toContainRow('Session 3');
  });

  test('selected item has indicator', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's2', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.expectRow(1).toContain('▸');
    pilot.expectRow(0).not.toContain('▸');
  });

  test('badges render', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.expectRow(0).toContain('●');
    pilot.expectRow(2).toContain('!');
  });

  test('descriptions render', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 50, rows: 5 });
    pilot.expectRow(0).toContain('running');
    pilot.expectRow(1).toContain('idle');
  });

  test('custom indicator', () => {
    const lv = ListView({
      id: 'lv',
      items: ITEMS,
      selectedId: 's1',
      activeIndicator: '→',
      flexGrow: 1,
    });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.expectRow(0).toContain('→');
  });

  test('icon renders before label', () => {
    const items: ListItem[] = [{ id: 'x', label: 'Test', icon: '📋' }];
    const lv = ListView({ id: 'lv', items, flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 30, rows: 3 });
    pilot.expectRow(0).toContain('📋');
    pilot.expectRow(0).toContain('Test');
  });
});

describe('ListView keyboard navigation', () => {
  test('down moves selection', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's1', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('down');
    assert.equal(lv.selectedId, 's2');
  });

  test('up moves selection', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's2', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('up');
    assert.equal(lv.selectedId, 's1');
  });

  test('wraps at bottom', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's3', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('down');
    assert.equal(lv.selectedId, 's1');
  });

  test('wraps at top', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's1', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('up');
    assert.equal(lv.selectedId, 's3');
  });

  test('no wrap when disabled', () => {
    const lv = ListView({
      id: 'lv',
      items: ITEMS,
      selectedId: 's3',
      wrapSelection: false,
      flexGrow: 1,
    });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('down');
    assert.equal(lv.selectedId, 's3');
  });

  test('home goes to first', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's3', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('home');
    assert.equal(lv.selectedId, 's1');
  });

  test('end goes to last', () => {
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's1', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('end');
    assert.equal(lv.selectedId, 's3');
  });
});

describe('ListView enter emits ListItemSelected', () => {
  test('emits with selected item', () => {
    let selected: { index: number; id: string } | null = null;
    class Handler extends RootWidget {
      onListItemSelected(msg: ListItemSelected): void {
        selected = { index: msg.index, id: msg.item.id };
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const lv = ListView({ id: 'lv', items: ITEMS, selectedId: 's2', flexGrow: 1 });
    r.add(lv);
    const pilot = createTestPilot(r, { cols: 40, rows: 5 });
    pilot.focusManager.focus(lv);
    pilot.pressKey('enter');
    assert.notEqual(selected, null);
    assert.equal(selected!.index, 1);
    assert.equal(selected!.id, 's2');
  });
});

describe('ListView scrolling', () => {
  test('scrolls when selection goes below viewport', () => {
    const manyItems: ListItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `i${i}`,
      label: `Item ${i}`,
    }));
    const lv = ListView({ id: 'lv', items: manyItems, selectedId: 'i0', flexGrow: 1 });
    const pilot = createTestPilot(root([lv]), { cols: 30, rows: 4 });
    pilot.focusManager.focus(lv);
    for (let i = 0; i < 6; i += 1) pilot.pressKey('down');
    assert.ok(lv.scrollOffset > 0);
    pilot.expectScreen().toContainRow('Item 6');
  });
});

describe('ListView factory', () => {
  test('returns ListViewWidget', () => {
    const lv = ListView({ id: 'test' });
    if (!(lv instanceof ListViewWidget)) throw new Error('should be ListViewWidget');
    if (!(lv instanceof Widget)) throw new Error('should be Widget');
  });

  test('is focusable by default', () => {
    assert.equal(ListView({}).focusable, true);
  });
});
