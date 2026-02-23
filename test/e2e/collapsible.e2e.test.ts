import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import type { CollapsibleToggled } from '../../packages/harness-ui/src/widgets/collapsible.ts';
import {
  Collapsible,
  CollapsibleWidget,
} from '../../packages/harness-ui/src/widgets/collapsible.ts';
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

describe('Collapsible rendering', () => {
  test('renders header with collapse indicator', () => {
    const c = Collapsible({ id: 'c', header: 'Details', flexGrow: 1 });
    c.setContent(['line 1', 'line 2', 'line 3', 'line 4', 'line 5']);
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 8 });
    pilot.expectRow(0).toContain('▸');
    pilot.expectRow(0).toContain('Details');
  });

  test('collapsed shows limited lines', () => {
    const c = Collapsible({ id: 'c', header: 'Output', maxCollapsedLines: 2, flexGrow: 1 });
    c.setContent(['line 1', 'line 2', 'line 3', 'line 4']);
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 8 });
    pilot.expectScreen().toContainRow('line 1');
    pilot.expectScreen().toContainRow('line 2');
    pilot.expectScreen().not.toContainRow('line 3');
    pilot.expectScreen().toContainRow('more lines');
  });

  test('expanded shows all lines', () => {
    const c = Collapsible({ id: 'c', header: 'Output', expanded: true, flexGrow: 1 });
    c.setContent(['line 1', 'line 2', 'line 3', 'line 4']);
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 8 });
    pilot.expectRow(0).toContain('▾');
    pilot.expectScreen().toContainRow('line 1');
    pilot.expectScreen().toContainRow('line 4');
  });

  test('toggle keybinding expands', () => {
    const c = Collapsible({ id: 'c', header: 'Test', flexGrow: 1 });
    c.setContent(['a', 'b', 'c', 'd', 'e']);
    const pilot = createTestPilot(root([c]), { cols: 30, rows: 10 });
    pilot.focusManager.focus(c);
    assert.equal(c.expanded, false);
    pilot.pressKey('enter');
    assert.equal(c.expanded, true);
    pilot.pressKey('enter');
    assert.equal(c.expanded, false);
  });

  test('toggle emits CollapsibleToggled', () => {
    let toggled: boolean | null = null;
    class Handler extends RootWidget {
      onCollapsibleToggled(msg: CollapsibleToggled): void {
        toggled = msg.expanded;
      }
    }
    const r = new Handler('root');
    r.flexDirection = 'column';
    const c = Collapsible({ id: 'c', header: 'Test', flexGrow: 1 });
    r.add(c);
    const pilot = createTestPilot(r, { cols: 30, rows: 8 });
    pilot.focusManager.focus(c);
    pilot.pressKey('enter');
    assert.equal(toggled, true);
  });
});

describe('Collapsible factory', () => {
  test('returns CollapsibleWidget', () => {
    const c = Collapsible({ id: 'test', header: 'H' });
    if (!(c instanceof CollapsibleWidget)) throw new Error('should be CollapsibleWidget');
  });
});
