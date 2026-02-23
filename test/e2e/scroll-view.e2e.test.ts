import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import { ScrollView, ScrollViewWidget } from '../../packages/harness-ui/src/widgets/scroll-view.ts';
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

describe('ScrollView rendering', () => {
  test('renders children within viewport', () => {
    const sv = ScrollView(
      { id: 'sv', flexGrow: 1, contentHeight: 10 },
      Text({ id: 'line0', content: 'LINE_0', height: 1 }),
      Text({ id: 'line1', content: 'LINE_1', height: 1 }),
      Text({ id: 'line2', content: 'LINE_2', height: 1 }),
    );
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('LINE_0');
    pilot.expectRow(1).toContain('LINE_1');
    pilot.expectRow(2).toContain('LINE_2');
  });

  test('only shows viewport rows', () => {
    const children: Widget[] = [];
    for (let i = 0; i < 10; i += 1) {
      children.push(Text({ id: `l${i}`, content: `ROW_${i}`, height: 1 }));
    }
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 10 }, ...children);
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 4 });
    pilot.expectRow(0).toContain('ROW_0');
    pilot.expectRow(3).toContain('ROW_3');
    pilot.expectScreen().not.toContainRow('ROW_4');
  });
});

describe('ScrollView keyboard scrolling', () => {
  test('down scrolls viewport', () => {
    const children: Widget[] = [];
    for (let i = 0; i < 10; i += 1) {
      children.push(Text({ id: `l${i}`, content: `ROW_${i}`, height: 1 }));
    }
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 10, scrollStep: 1 }, ...children);
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(sv);

    pilot.pressKey('down');
    assert.equal(sv.scrollTop, 1);
    pilot.expectRow(0).toContain('ROW_1');

    pilot.pressKey('down');
    assert.equal(sv.scrollTop, 2);
    pilot.expectRow(0).toContain('ROW_2');
  });

  test('up scrolls back', () => {
    const children: Widget[] = [];
    for (let i = 0; i < 10; i += 1) {
      children.push(Text({ id: `l${i}`, content: `ROW_${i}`, height: 1 }));
    }
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 10, scrollStep: 1 }, ...children);
    sv.scrollTop = 5;
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(sv);

    pilot.pressKey('up');
    assert.equal(sv.scrollTop, 4);
    pilot.expectRow(0).toContain('ROW_4');
  });

  test('home scrolls to top', () => {
    const children: Widget[] = [];
    for (let i = 0; i < 10; i += 1) {
      children.push(Text({ id: `l${i}`, content: `ROW_${i}`, height: 1 }));
    }
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 10 }, ...children);
    sv.scrollTop = 5;
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(sv);

    pilot.pressKey('home');
    assert.equal(sv.scrollTop, 0);
    pilot.expectRow(0).toContain('ROW_0');
  });

  test('end scrolls to bottom', () => {
    const children: Widget[] = [];
    for (let i = 0; i < 10; i += 1) {
      children.push(Text({ id: `l${i}`, content: `ROW_${i}`, height: 1 }));
    }
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 10 }, ...children);
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 3 });
    pilot.focusManager.focus(sv);

    pilot.pressKey('end');
    assert.equal(sv.scrollTop, 7);
    pilot.expectRow(0).toContain('ROW_7');
  });

  test('scrollTop clamped to max on render', () => {
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 5 });
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 3 });
    sv.scrollTop = 100;
    pilot.resize(pilot.cols, pilot.rows);
    assert.equal(sv.scrollTop, 2);
  });

  test('scrollTop cannot go negative', () => {
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 5 });
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 3 });
    sv.scrollTop = -10;
    pilot.resize(pilot.cols, pilot.rows);
    assert.equal(sv.scrollTop, 0);
  });
});

describe('ScrollView pageup/pagedown', () => {
  test('pagedown scrolls by viewport height', () => {
    const children: Widget[] = [];
    for (let i = 0; i < 20; i += 1) {
      children.push(Text({ id: `l${i}`, content: `ROW_${i}`, height: 1 }));
    }
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 20 }, ...children);
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(sv);

    pilot.pressKey('pagedown');
    assert.equal(sv.scrollTop, 4);
    pilot.expectRow(0).toContain('ROW_4');
  });

  test('pageup scrolls back up', () => {
    const children: Widget[] = [];
    for (let i = 0; i < 20; i += 1) {
      children.push(Text({ id: `l${i}`, content: `ROW_${i}`, height: 1 }));
    }
    const sv = ScrollView({ id: 'sv', flexGrow: 1, contentHeight: 20 }, ...children);
    sv.scrollTop = 10;
    const pilot = createTestPilot(root([sv]), { cols: 20, rows: 5 });
    pilot.focusManager.focus(sv);

    pilot.pressKey('pageup');
    assert.equal(sv.scrollTop, 6);
  });
});

describe('ScrollView factory', () => {
  test('returns ScrollViewWidget', () => {
    const sv = ScrollView({ id: 'test' });
    if (!(sv instanceof ScrollViewWidget)) throw new Error('should be ScrollViewWidget');
    if (!(sv instanceof Widget)) throw new Error('should be Widget');
  });

  test('accepts children', () => {
    const sv = ScrollView({ id: 'sv' }, Text({ content: 'A' }), Text({ content: 'B' }));
    assert.equal(sv.children.length, 2);
  });
});
